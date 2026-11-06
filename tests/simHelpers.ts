import { STUCK_LIMIT } from '../src/shared/sim/goals.js';
import type { GoalOutcome, SimSession } from '../src/shared/sim/session.js';
import type { Controls } from '../src/shared/types.js';

/** Apply raw controls for a fixed time; resolves when the time is up or the body stalls. */
export function drive(
  session: SimSession,
  seconds: number,
  input: Partial<Controls>,
): Promise<GoalOutcome> {
  const controls: Controls = {
    throttle: input.throttle ?? 0,
    turn: input.turn ?? 0,
    lift: input.lift ?? 0,
    boost: input.boost ?? 0,
  };
  const startedAt = session.spider.time;
  const held = () => Math.abs(controls.throttle) > 0.05 && session.spider.stuckFor >= STUCK_LIMIT;
  return session.run({
    timeout: seconds + 1,
    controls: () => controls,
    done: () => session.spider.time - startedAt >= seconds || held(),
    result: () => (held() ? { seconds, halt: session.spider.halt } : { seconds }),
  });
}
