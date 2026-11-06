import { tool } from 'ai';
import { z } from 'zod';
import type { GoalOutcome, SimSession } from '../../shared/sim/session.js';
import type { ActionHint, NearEntity, Observation, Sense, WorldInfo } from '../../shared/state.js';
import {
  CARRY_LIMIT,
  GAIT,
  MARK_LIMIT,
  MARK_NAME_MAX,
  MARK_NOTE_MAX,
} from '../../shared/config.js';
import { VIEW_DISTANCE } from '../../shared/world.js';
import type { MemoryApi } from '../journal/diary.js';

/**
 * Built-in tools. Each one is a function call on the local simulation.
 * `observe` returns the full look. A move, and handling something on the
 * ground, also returns `near`: what you can eat or carry within reach.
 * Other actions return only the body's own state.
 */
export interface ToolResult extends GoalOutcome {
  observation?: Observation;
  self?: Sense;
  /** Current simulation and client-local world clock. */
  world: WorldInfo;
  /** Present after an absolute turn. */
  heading?: number;
  /** Present after a move or after handling something on the ground. */
  /** Always present for spatial tools; empty means there is no actionable nearby object. */
  near: NearEntity[];
  hint?: ActionHint;
}

const thought = z.string().describe('用第一人称说一句你在做什么，20 字以内。');

function call<T extends z.ZodRawShape>(shape: T) {
  return z.object({ description: thought, ...shape });
}

export function spiderTools(session: SimSession, memory?: MemoryApi) {
  const hintFor = (outcome: GoalOutcome, self: Sense): ActionHint | undefined => {
    switch (outcome.reason) {
      case 'blocked':
        return {
          code: 'blocked',
          message: self.ways?.length
            ? '前方被固体挡住了。按 self.ways 里的转向换一条路，不要继续顶同一个方向。'
            : '前方被固体挡住了，换一个方向或使用 move_to 绕路。',
          next: self.ways?.length ? 'turn' : 'move_to',
        };
      case 'steep':
        return {
          code: 'steep',
          message: '这段坡太陡。先用 self.ways 找可走方向，或抬高身体后重新观察。',
          next: 'observe',
        };
      case 'no-path':
        return {
          code: 'no-path',
          message: '目标没有找到可走的路线，换一个目标点或先观察环境。',
          next: 'observe',
        };
      case 'out-of-reach':
        return {
          code: 'out-of-reach',
          message: '目标还不在够得着的范围内，先 approach 到它旁边。',
          next: 'approach',
        };
      case 'not-found':
        return {
          code: 'stale-target',
          message: '这个 id 已经不在当前世界里，先 observe 获取新的 id。',
          next: 'observe',
        };
      case 'nothing-to-eat':
      case 'nothing-to-carry':
        return {
          code: 'no-target',
          message: '当前附近没有符合条件的对象，不要重复调用同一个动作。',
          next: 'observe',
        };
      case 'full':
        return {
          code: 'carry-full',
          message: '背包已经满了，先 drop 或 store 一件再继续搬。',
          next: 'drop',
        };
      case 'no-water':
        return {
          code: 'no-water',
          message: '附近没有够得着的水，先根据 self.water 找到水边。',
          next: 'observe',
        };
      case 'cancelled':
      case 'timeout':
        return {
          code: outcome.reason,
          message: '行动没有完成，先根据当前 self 和 near 重新决定下一步。',
          next: 'observe',
        };
      default:
        return undefined;
    }
  };

  const finish = (outcome: GoalOutcome): ToolResult => {
    const { halt: _halt, ...rest } = outcome;
    const blocked =
      rest.reason === 'blocked' || rest.reason === 'steep' || rest.reason === 'no-path';
    const self = session.sense(blocked);
    const hint = hintFor(rest, self);
    const result: ToolResult = {
      ...rest,
      self,
      world: session.worldInfo(),
      near: session.near(),
    };
    if (hint) result.hint = hint;
    return result;
  };

  const tools = {
    observe: tool({
      description: '观察周围。草丛会缩短视野，抬高身体能看得更远；inReach 表示够得着。',
      inputSchema: call({
        distance: z
          .number()
          .min(0)
          .max(VIEW_DISTANCE)
          .optional()
          .describe(`看多远，最多 ${VIEW_DISTANCE}。不填就尽量看远。`),
      }),
      execute: async ({ distance }) => {
        const observation = session.observe(distance ?? VIEW_DISTANCE);
        const world = session.worldInfo();
        const hint =
          observation.self.cover === 'grass' && observation.view < VIEW_DISTANCE
            ? {
                code: 'view-limited-by-grass',
                message: `草丛把视野缩短到了 ${observation.view}。先用 set_height 抬高身体，再 observe。`,
                next: 'set_height',
              }
            : world.clock.phase !== 'day' && observation.view < VIEW_DISTANCE
              ? {
                  code: 'view-limited-by-light',
                  message: `现在是${world.clock.phase}，光线把视野缩短到了 ${observation.view}。靠近、换方向或等到更亮时再 observe。`,
                  next: 'observe',
                }
              : observation.beyond > 0 || observation.hidden > 0
                ? {
                    code: 'partial-observation',
                    message: `这次只看到了视野内的对象，还有 ${observation.beyond} 个在视野外、${observation.hidden} 个被遮挡。移动、抬高身体或换方向后再 observe。`,
                    next: 'observe',
                  }
                : undefined;
        return {
          ok: true,
          world,
          near: session.near(),
          ...(hint ? { hint } : {}),
          observation,
        };
      },
    }),
    walk: tool({
      description: '沿当前朝向走直线。距离远时用 fast。',
      inputSchema: call({
        distance: z.number().describe('走多少单位。正数向前。'),
        fast: z.boolean().optional().describe('跑起来。'),
      }),
      execute: async ({ distance, fast }) => finish(await session.walk(distance, fast ?? false)),
    }),
    turn: tool({
      description: '原地转向。degrees 相对，heading 绝对，只填一个。',
      inputSchema: call({
        degrees: z.number().optional().describe('相对角度，顺时针为正。'),
        heading: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe('绝对朝向，0 是 -Z，范围 -180..180。'),
      }),
      execute: async ({ degrees, heading }) => {
        if (degrees === undefined) {
          if (heading === undefined) return finish({ ok: false, reason: 'need-turn' });
          return { ...finish(await session.turnTo(heading)), heading };
        }
        if (heading !== undefined) return finish({ ok: false, reason: 'ambiguous-turn' });
        return finish(await session.turn(degrees));
      },
    }),
    move_to: tool({
      description: '走到 x、z，自动绕开固体；陡坡仍需自己爬。',
      inputSchema: call({
        x: z.number().describe('目标 x。'),
        z: z.number().describe('目标 z。'),
        fast: z.boolean().optional().describe('跑起来。'),
      }),
      execute: async ({ x, z: zPos, fast }) => finish(await session.moveTo(x, zPos, fast ?? false)),
    }),
    mark: tool({
      description: `记录、查看、删除或走回有名字的地点，最多 ${MARK_LIMIT} 个。`,
      inputSchema: call({
        command: z.enum(['add', 'list', 'remove', 'go']).describe('add、list、remove 或 go。'),
        name: z
          .string()
          .optional()
          .describe(`地点名，${MARK_NAME_MAX} 字以内。add、remove、go 要填。`),
        note: z.string().optional().describe(`备注，${MARK_NOTE_MAX} 字以内。`),
        fast: z.boolean().optional().describe('走回去时跑起来。'),
      }),
      execute: async ({ command, name, note, fast }) => {
        if (command === 'list') return { ...finish({ ok: true }), marks: session.marks() };
        if (!name) return finish({ ok: false, reason: 'need-name' });
        if (command === 'add') return finish(session.mark(name, note));
        if (command === 'remove') return finish(session.forgetMark(name));
        const outcome = await session.goToMark(name, fast ?? false);
        return { ...finish(outcome), name };
      },
    }),
    approach: tool({
      description: '走到对象旁边并面向它，自动绕开固体。',
      inputSchema: call({
        id: z.string().describe('对象 id。'),
        standoff: z.number().min(0).optional().describe('停在多远。不填就贴近。'),
        fast: z.boolean().optional().describe('跑起来。'),
      }),
      execute: async ({ id, standoff, fast }) =>
        finish(await session.approach(id, standoff, fast ?? false)),
    }),
    eat: tool({
      description: '吃附近或背上的食物。',
      inputSchema: call({
        id: z.string().optional().describe('对象 id。不填就吃最近的。'),
      }),
      execute: async ({ id }) => finish(await session.eat(id)),
    }),
    drink: tool({
      description: '在水边喝水。',
      inputSchema: call({}),
      execute: async () => finish(session.drink()),
    }),
    pick_up: tool({
      description: `搬起附近能搬的东西，最多 ${CARRY_LIMIT} 件。`,
      inputSchema: call({
        id: z.string().optional().describe('对象 id。不填就搬最近的。'),
      }),
      execute: async ({ id }) => finish(await session.pickUp(id)),
    }),
    drop: tool({
      description: '把背上的东西放在面前。',
      inputSchema: call({
        id: z.string().optional().describe('物品 id。不填就放最后一件。'),
      }),
      execute: async ({ id }) => finish(session.drop(id)),
    }),
    store: tool({
      description: '把背上的东西放进巢里。',
      inputSchema: call({
        id: z.string().optional().describe('物品 id。不填就放最后一件。'),
      }),
      execute: async ({ id }) => finish(session.store(id)),
    }),
    sleep: tool({
      description: '在巢里睡觉，醒来还在原地。',
      inputSchema: call({}),
      execute: async () => finish(await session.sleep()),
    }),
    set_height: tool({
      description: '抬高或放低身体，改变视线和越坡能力，不移动位置。',
      inputSchema: call({
        level: z
          .number()
          .min(GAIT.heightMin)
          .max(GAIT.heightMax)
          .describe(`离地高度，${GAIT.heightMin} 到 ${GAIT.heightMax}。`),
      }),
      execute: async ({ level }) => finish(await session.setHeight(level)),
    }),
    ...(memory
      ? {
          memory: tool({
            description: '跨天日记：列目录、读某天、写某天。',
            inputSchema: call({
              command: z.enum(['list', 'get', 'write']).describe('list、get 或 write。'),
              date: z.string().optional().describe('YYYY-MM-DD。get、write 要填。'),
              line: z.string().optional().describe('目录上的一句。'),
              noted: z.string().optional().describe('要留下的话。'),
              summary: z.string().optional().describe('当天摘要。'),
            }),
            execute: async ({ command, date, line, noted, summary }) => {
              if (command === 'list') return { ok: true, pages: await memory.list() };
              if (!date) return { ok: false, reason: 'need-date' };
              if (command === 'get') {
                const page = await memory.get(date);
                return page ? { ok: true, ...page } : { ok: false, reason: 'not-found', date };
              }
              return { ok: true, ...(await memory.write({ date, line, noted, summary })) };
            },
          }),
        }
      : {}),
  };
  return tools;
}
