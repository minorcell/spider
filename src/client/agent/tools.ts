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
 * `observe` returns the full look. Every action also returns `near`:
 * what you can eat or carry within reach, and the body's own state.
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
            ? '前方被固体挡住了。self.ways 是可走的坐标，用 go 的 point 走过去，不要顶同一个方向。'
            : '前方被固体挡住了。换一个 x、z，用 go 绕开。',
          next: 'go',
        };
      case 'steep':
        return {
          code: 'steep',
          message: '这段坡太陡。用 self.ways 里的坐标换一条路，或先 set_height 再走。',
          next: self.ways?.length ? 'go' : 'set_height',
        };
      case 'no-path':
        return {
          code: 'no-path',
          message: '没有可走的路线。换一个目标，或先 observe。',
          next: 'observe',
        };
      case 'out-of-reach':
        return {
          code: 'out-of-reach',
          message: '目标还不在够得着的范围内。用 go，mode 填 id，走到它旁边。',
          next: 'go',
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
          message: '背包已经满了。先用 act 的 drop 或 store 放下一件。',
          next: 'act',
        };
      case 'no-water':
        return self.water
          ? {
              code: 'no-water',
              message: '附近没有够得着的水。按 self.water 的 x、z 用 go 走过去。',
              next: 'go',
            }
          : {
              code: 'no-water',
              message: '附近没有水。先 observe，再按看见的水走过去。',
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
                  message: `现在是${world.clock.phase}，光线把视野缩短到了 ${observation.view}。靠近后再 observe。`,
                  next: 'go',
                }
              : observation.beyond > 0 || observation.hidden > 0
                ? {
                    code: 'partial-observation',
                    message: `这次只看到了视野内的对象，还有 ${observation.beyond} 个在视野外、${observation.hidden} 个被遮挡。移动或抬高身体后再 observe。`,
                    next: 'go',
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
    go: tool({
      description:
        '移动或转身，一次只做一件事。point 走到 x、z，自动绕开固体，陡坡仍需自己爬。id 走到对象旁边并面向它。heading 或 degrees 只转身。',
      inputSchema: z.discriminatedUnion('mode', [
        call({
          mode: z.literal('point').describe('走到一个坐标。'),
          x: z.number().describe('目标 x。'),
          z: z.number().describe('目标 z。'),
          fast: z.boolean().optional().describe('跑起来。'),
        }),
        call({
          mode: z.literal('id').describe('走到一个对象旁边。'),
          id: z.string().describe('对象 id。'),
          standoff: z.number().min(0).optional().describe('停在多远。不填就贴近。'),
          fast: z.boolean().optional().describe('跑起来。'),
        }),
        call({
          mode: z.literal('heading').describe('转到一个绝对朝向。'),
          heading: z.number().min(-180).max(180).describe('绝对朝向，0 是 -Z，范围 -180..180。'),
        }),
        call({
          mode: z.literal('degrees').describe('相对现在转身。'),
          degrees: z.number().describe('相对角度，顺时针为正。'),
        }),
      ]),
      execute: async (input) => {
        if (input.mode === 'point')
          return finish(await session.moveTo(input.x, input.z, input.fast ?? false));
        if (input.mode === 'id')
          return finish(await session.approach(input.id, input.standoff, input.fast ?? false));
        if (input.mode === 'heading')
          return { ...finish(await session.turnTo(input.heading)), heading: input.heading };
        return finish(await session.turn(input.degrees));
      },
    }),
    mark: tool({
      description: `记录、查看或删除有名字的地点，最多 ${MARK_LIMIT} 个。`,
      inputSchema: call({
        command: z.enum(['add', 'list', 'remove']).describe('add、list 或 remove。'),
        name: z.string().optional().describe(`地点名，${MARK_NAME_MAX} 字以内。add、remove 要填。`),
        note: z.string().optional().describe(`备注，${MARK_NOTE_MAX} 字以内。`),
      }),
      execute: async ({ command, name, note }) => {
        if (command === 'list') return { ...finish({ ok: true }), marks: session.marks() };
        if (!name) return finish({ ok: false, reason: 'need-name' });
        if (command === 'add') return finish(session.mark(name, note));
        return finish(session.forgetMark(name));
      },
    }),
    act: tool({
      description: `吃、搬、放下、存进巢、喝水或睡觉。eat、pick_up、drop、store 要带 id，背上最多 ${CARRY_LIMIT} 件。`,
      inputSchema: z.discriminatedUnion('verb', [
        call({
          verb: z.literal('eat').describe('吃附近或背上的食物。'),
          id: z.string().describe('对象 id。'),
        }),
        call({
          verb: z.literal('pick_up').describe('搬起附近能搬的东西。'),
          id: z.string().describe('对象 id。'),
        }),
        call({
          verb: z.literal('drop').describe('把背上的东西放在面前。'),
          id: z.string().describe('物品 id。'),
        }),
        call({
          verb: z.literal('store').describe('把背上的东西放进巢里。'),
          id: z.string().describe('物品 id。'),
        }),
        call({
          verb: z.literal('drink').describe('在水边喝水。'),
        }),
        call({
          verb: z.literal('sleep').describe('在巢里睡觉，醒来还在原地。'),
        }),
      ]),
      execute: async (input) => {
        if (input.verb === 'eat') return finish(await session.eat(input.id));
        if (input.verb === 'pick_up') return finish(await session.pickUp(input.id));
        if (input.verb === 'drop') return finish(session.drop(input.id));
        if (input.verb === 'store') return finish(session.store(input.id));
        if (input.verb === 'drink') return finish(session.drink());
        return finish(await session.sleep());
      },
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
