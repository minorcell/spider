import { tool } from 'ai';
import { z } from 'zod';
import type { GoalOutcome, SimSession } from '../../shared/sim/session.js';
import type { Observation, Sense } from '../../shared/state.js';
import { CARRY_LIMIT } from '../../shared/config.js';
import { GRASS_VIEW, REACH, VIEW_DISTANCE } from '../../shared/world.js';
import type { MemoryApi } from '../journal/diary.js';

/**
 * Built-in tools. Each one is a function call on the local simulation.
 * `observe` returns the full look; every other action returns only the body's
 * own state, so a walk does not repeat the whole island back to the model.
 */
export interface ToolResult extends GoalOutcome {
  observation?: Observation;
  self?: Sense;
}

const thought = z
  .string()
  .describe(
    '一句第一人称的短话，用中文说你正在做什么。它出现在你旁边。说你要做的事，不要写坐标，也不要写行动的名字。',
  );

function call<T extends z.ZodRawShape>(shape: T) {
  return z.object({ description: thought, ...shape });
}

export function spiderTools(session: SimSession, memory?: MemoryApi) {
  const finish = (outcome: GoalOutcome): ToolResult => {
    const { halt: _halt, ...rest } = outcome;
    const blocked =
      rest.reason === 'blocked' || rest.reason === 'steep' || rest.reason === 'no-path';
    return { ...rest, self: session.sense(blocked) };
  };

  return {
    observe: tool({
      description:
        '停下看看。这是唯一返回周围东西的行动。返回你在哪里，以及你看得见的东西：位置、stage，还有 properties。' +
        `不填距离就看 ${VIEW_DISTANCE}，最远也是这么远，没有一次看完这片地方的办法。` +
        `走进草丛后距离会缩到 ${GRASS_VIEW}。observation.view 是这一次实际看见的距离。` +
        'observation.beyond 是超出视线的数目，observation.hidden 是被比你高的固体挡住的数目。' +
        `inReach 表示水平距离在 ${REACH} 以内，而且没有被挡住。` +
        `observation.self.carrying 是你背上的东西，先背上的在前，空着是 []，最多 ${CARRY_LIMIT} 件。observation.self.home 为真表示你在巢里。observation.self.cover 为 grass 表示你站在草丛里。` +
        'observation.self.ahead 是你面前这一段：open 是沿着朝向还能走多远；by 为 wall 时 id 和 kind 是挡住的固体，slope 是陡坡，clear 是这段是空的。' +
        'observation.self.ways 是已经写好的短句，告诉你相对朝向转多少度之后能走多远，正数是顺时针。任何固体都用同一套说法。',
      inputSchema: call({
        distance: z
          .number()
          .min(0)
          .max(VIEW_DISTANCE)
          .optional()
          .describe(`往外看多远，最多 ${VIEW_DISTANCE}。不填就看这么远。`),
      }),
      execute: async ({ distance }) => ({
        ok: true,
        observation: session.observe(distance ?? VIEW_DISTANCE),
      }),
    }),
    walk: tool({
      description:
        '顺着现在的朝向走一段路，快到的时候慢下来。负数是后退。大约超过 2 个单位就设 fast，不然你只会慢慢挪。这条路不会自己绕开。返回要走的距离和实际走过的距离。被固体挡住时 ok 是 false、reason 是 blocked；坡太陡是 steep。这时 self.ways 是已经写好的短句，按里面的角度转，不要用同样的参数再顶。',
      inputSchema: call({
        distance: z.number().describe('顺着朝向走多少单位。正数向前。'),
        fast: z.boolean().optional().describe('为真就跑。距离大约超过 2 个单位时用。'),
      }),
      execute: async ({ distance, fast }) => finish(await session.walk(distance, fast ?? false)),
    }),
    turn: tool({
      description: '原地转过若干度。正数是顺时针。返回要转的度数和实际转过的度数。',
      inputSchema: call({
        degrees: z.number().describe('转多少度。正数顺时针。'),
      }),
      execute: async ({ degrees }) => finish(await session.turn(degrees)),
    }),
    turn_to: tool({
      description:
        '转到一个绝对朝向。0 是世界的 -Z，顺时针为正，范围 -180 到 180。返回目标朝向和这次转过的度数。',
      inputSchema: call({
        heading: z.number().min(-180).max(180).describe('绝对朝向，单位是度。'),
      }),
      execute: async ({ heading }) => finish(await session.turnTo(heading)),
    }),
    move_to: tool({
      description:
        '走到地上的一个点。挡住的固体由这条路自己绕开，你不用为了绕路再去转身。坡你自己爬。大约超过 2 个单位就设 fast。到了之后，detour 是一句已经写好的话，说明绕开了什么；直线能到时 detour 是 null。哪里都走不过去时 reason 是 no-path。近乎竖直的地方是 steep，被固体卡住是 blocked。',
      inputSchema: call({
        x: z.number().describe('目标的 x，单位。'),
        z: z.number().describe('目标的 z，单位。'),
        fast: z.boolean().optional().describe('走路这一段要不要跑。'),
      }),
      execute: async ({ x, z: zPos, fast }) => finish(await session.moveTo(x, zPos, fast ?? false)),
    }),
    approach: tool({
      description:
        '走到一件东西够得着的地方，并面向它。中间的固体由这条路自己绕开。id 用最近一次观察里的。大约超过 2 个单位就设 fast。detour 的写法和 move_to 一样。找不到是 not-found，已经够近是 already-close，走不过去是 no-path。',
      inputSchema: call({
        id: z.string().describe('最近一次观察里的 id。'),
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
        '吃一件 properties 里有 edible 的东西。它在够得着的地方，或者已经在你背上。吃要花时间，stage 会变。吃完这一只就没了，以后的观察里也不会再出现。中途停下的话，咬到哪算哪。',
      inputSchema: call({
        id: z
          .string()
          .optional()
          .describe('观察里的 id，或背上某一件的 id。不填就吃够得着的、最近的能吃的，背上的也算。'),
      }),
      execute: async ({ id }) => finish(await session.eat(id)),
    }),
    pick_up: tool({
      description:
        `搬起一件 properties 里有 carryable 的东西。背上最多 ${CARRY_LIMIT} 件，满了再搬的原因是 full。返回 carrying，是背上全部的 id，先背上的在前。` +
        '够得着的能搬的有几件，就在同一次回复里对每件各调用一次，每次填那个 id。',
      inputSchema: call({
        id: z.string().optional().describe('观察里的 id。不填就搬最近的、够得着的、能搬的。'),
      }),
      execute: async ({ id }) => finish(await session.pickUp(id)),
    }),
    drop: tool({
      description:
        '把背上的一件放在面前。不填 id 就放最后背上的那件。放下的那件不再在 carrying 里。' +
        '有几件要放，就在同一次回复里对每件各调用一次，每次填那个 id。',
      inputSchema: call({
        id: z.string().optional().describe('背上某一件的 id。不填就放最后背上的那件。'),
      }),
      execute: async ({ id }) => finish(session.drop(id)),
    }),
    store: tool({
      description:
        '把背上的一件留在巢里。你得在家里。不填 id 就留最后背上的那件。留下的那件不再在 carrying 里。',
      inputSchema: call({
        id: z.string().optional().describe('背上某一件的 id。不填就留最后背上的那件。'),
      }),
      execute: async ({ id }) => finish(session.store(id)),
    }),
    sleep: tool({
      description: '在巢里睡觉。你得在家里。醒来还在你躺下的地方。',
      inputSchema: call({}),
      execute: async () => finish(await session.sleep()),
    }),
    set_height: tool({
      description: '把身子相对脚下的地面抬高或放低一点。这不是爬山。返回目标和实际抬起的高度。',
      inputSchema: call({
        level: z.number().min(-0.35).max(0.7).describe('想离地多高。'),
      }),
      execute: async ({ level }) => finish(await session.setHeight(level)),
    }),
    drive: tool({
      description:
        '朝一个方向撑一小会儿。只有别的行动都说不清你要做什么时才用。顶到固体上会提前停下，reason 是 blocked；坡太陡是 steep。返回秒数。',
      inputSchema: call({
        seconds: z.number().min(0).max(10).describe('撑多久，秒。'),
        throttle: z.number().min(-1).max(1).optional().describe('向前 1，向后 -1。默认 0。'),
        turn: z.number().min(-1).max(1).optional().describe('向右 1，向左 -1。默认 0。'),
        lift: z.number().min(-1).max(1).optional().describe('抬高 1，放低 -1。默认 0。'),
        boost: z.number().min(0).max(1).optional().describe('1 是加速。默认 0。'),
      }),
      execute: async ({ seconds, throttle, turn, lift, boost }) =>
        finish(await session.drive(seconds, { throttle, turn, lift, boost })),
    }),
    wait: tool({
      description: '停在原地，让时间过去。返回秒数。',
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
}
