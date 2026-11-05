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
import { GRASS_VIEW, REACH, VIEW_DISTANCE } from '../../shared/world.js';
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

const WORLD =
  'world 是当前世界上下文：simulationTime 是蜘蛛模拟已经推进的秒数；world.clock.localDate 和 world.clock.localTime 是客户端本地日期和时间；world.clock.phase 是 night、dawn、day 或 dusk；world.clock.daylight 是 0 到 1 的连续日照值。';

const RESULT_CONTRACT =
  '空间工具结果里的 world 和 near 是当前行动完成后的状态；改变身体的行动还会返回 self。near 永远存在，空数组就是现在没有能吃、能搬或能交互的近处对象。hint 只在有明确的下一步时出现，优先按 hint 处理，不要盲目重复失败的行动。observe 另外返回 observation，里面是这一次看见的东西和 observation.self。';

const thought = z
  .string()
  .describe(
    '一句第一人称的短话，用中文说你正在做什么。它出现在你旁边。说你要做的事，不要写坐标，也不要写行动的名字。',
  );

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
      description: `停下观察远处。默认最多看 ${VIEW_DISTANCE}；草丛会把范围缩到 ${GRASS_VIEW}，抬高身体可以恢复。可以观察到可见对象、距离和遮挡；inReach 表示不超过 ${REACH} 且没有被挡住。${WORLD}`,
      inputSchema: call({
        distance: z
          .number()
          .min(0)
          .max(VIEW_DISTANCE)
          .optional()
          .describe(`往外看多远，最多 ${VIEW_DISTANCE}。不填就看这么远。`),
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
      description:
        '沿当前朝向走直线；失败后按 hint 或 self.ways 换方向。当然距离较远时，你可以 fast！',
      inputSchema: call({
        distance: z.number().describe('顺着朝向走多少单位。正数向前。'),
        fast: z.boolean().optional().describe('为真就跑。距离大约超过 2 个单位时用。'),
      }),
      execute: async ({ distance, fast }) => finish(await session.walk(distance, fast ?? false)),
    }),
    turn: tool({
      description:
        '原地转。degrees 是相对角度，heading 是绝对朝向；两个只填一个。正数顺时针，heading 的 0 是世界 -Z。',
      inputSchema: call({
        degrees: z.number().optional().describe('相对现在转多少度。正数顺时针。'),
        heading: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe('转到哪个绝对朝向。0 是世界的 -Z，顺时针为正。'),
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
      description:
        '走到 x、z。move_to 会自动绕开固体；坡仍需自己爬。距离较长时设置 fast，失败后按 hint 重新观察或换目标。',
      inputSchema: call({
        x: z.number().describe('目标的 x，单位。'),
        z: z.number().describe('目标的 z，单位。'),
        fast: z.boolean().optional().describe('走路这一段要不要跑。'),
      }),
      execute: async ({ x, z: zPos, fast }) => finish(await session.moveTo(x, zPos, fast ?? false)),
    }),
    mark: tool({
      description: `保存和回到有名字的地点。add 记录当前位置，list 查看，remove 删除，go 自动走回去。最多 ${MARK_LIMIT} 个；name 最多 ${MARK_NAME_MAX} 个字，note 最多 ${MARK_NOTE_MAX} 个字。`,
      inputSchema: call({
        command: z
          .enum(['add', 'list', 'remove', 'go'])
          .describe('add 记下这里，list 看看记过哪些，remove 忘掉一个，go 回一个。'),
        name: z.string().optional().describe('地点名。add、remove、go 要填。'),
        note: z.string().optional().describe('add 时可以留一句，方便以后认出来。'),
        fast: z.boolean().optional().describe('go 时路程大约超过 2 个单位就设。'),
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
      description: `走到 id 对应对象旁边并面向它。id 必须来自 near 或 observation.entities；中间的固体会自动绕开。默认停在 ${REACH - 0.3} 的距离。`,
      inputSchema: call({
        id: z.string().describe('最近一次 near 或观察里的 id。'),
        standoff: z
          .number()
          .min(0)
          .optional()
          .describe(`停在离它多远的地方。默认 ${REACH - 0.3}。`),
        fast: z.boolean().optional().describe('离它大约超过 2 个单位时就跑。'),
      }),
      execute: async ({ id, standoff, fast }) =>
        finish(await session.approach(id, standoff, fast ?? false)),
    }),
    eat: tool({
      description:
        '吃 properties 含 edible 的对象。id 来自 near 或背包；进食有阶段，完成后对象会消失。',
      inputSchema: call({
        id: z
          .string()
          .optional()
          .describe(
            '最近一次 near 或观察里的 id，或背上某一件的 id。不填就吃够得着的、最近的能吃的，背上的也算。',
          ),
      }),
      execute: async ({ id }) => finish(await session.eat(id)),
    }),
    drink: tool({
      description: '在够得着的水边喝水。没有水时按 hint 使用 self.water 找位置。',
      inputSchema: call({}),
      execute: async () => finish(session.drink()),
    }),
    pick_up: tool({
      description: `搬起 properties 含 carryable 的对象。背上最多 ${CARRY_LIMIT} 件；near 中有几件就按 id 分别调用。`,
      inputSchema: call({
        id: z
          .string()
          .optional()
          .describe('最近一次 near 或观察里的 id。不填就搬最近的、够得着的、能搬的。'),
      }),
      execute: async ({ id }) => finish(await session.pickUp(id)),
    }),
    drop: tool({
      description: '把背上的对象放在面前。省略 id 表示最后背上的一件。',
      inputSchema: call({
        id: z.string().optional().describe('背上某一件的 id。不填就放最后背上的那件。'),
      }),
      execute: async ({ id }) => finish(session.drop(id)),
    }),
    store: tool({
      description: '在巢里把背上的对象留下。省略 id 表示最后背上的一件；不在巢里时按 hint 处理。',
      inputSchema: call({
        id: z.string().optional().describe('背上某一件的 id。不填就留最后背上的那件。'),
      }),
      execute: async ({ id }) => finish(session.store(id)),
    }),
    sleep: tool({
      description: '在巢里睡觉，推进模拟时间，醒来仍在原地。',
      inputSchema: call({}),
      execute: async () => finish(await session.sleep()),
    }),
    set_height: tool({
      description: `抬高或放低身体来改变视线和越过矮坡；不会移动位置，范围是 ${GAIT.heightMin} 到 ${GAIT.heightMax}。`,
      inputSchema: call({
        level: z.number().min(GAIT.heightMin).max(GAIT.heightMax).describe('想离地多高。'),
      }),
      execute: async ({ level }) => finish(await session.setHeight(level)),
    }),
    wait: tool({
      description: '停在原地推进模拟时间，最多等待 10 秒；真实客户端时间由 world.clock 提供。',
      inputSchema: call({
        seconds: z.number().min(0).max(10).describe('等多久，秒。'),
      }),
      execute: async ({ seconds }) => finish(await session.wait(seconds)),
    }),
    ...(memory
      ? {
          memory: tool({
            description:
              '跨天的日记。list 列出每一天的目录。get 读某一天。write 改某一天：先 get，已有的 noted 要留在新的 noted 里。' +
              '不改变你站的地方，结果里没有观察。不要写坐标、看见的东西或背上的东西。',
            inputSchema: call({
              command: z.enum(['list', 'get', 'write']).describe('list、get 或 write。'),
              date: z.string().optional().describe('这一天，YYYY-MM-DD。get 和 write 要填。'),
              line: z.string().optional().describe('目录上的一句。'),
              noted: z.string().optional().describe('明确要留下的话。不填就保持原来的。'),
              summary: z.string().optional().describe('这一天的摘要。不填就保持原来的。'),
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
  for (const [name, current] of Object.entries(tools)) {
    if (name === 'memory') continue;
    const tool = current as { description?: string };
    tool.description = `${String(tool.description)} ${RESULT_CONTRACT}`;
  }
  return tools;
}
