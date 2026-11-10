import type { UnixMs } from './base';
import type { World, WorldFrame, WorldView } from './module_World';

/** A host can consume every event even when drawing is throttled for local inference. */
export function browserDriver(
  world: World,
  publish: (frame: WorldFrame) => void,
  paint: (view: WorldView) => void,
) {
  let active = false;
  let previousFrameMs: number | undefined;
  let accumulator = 0;
  const step = world.stepSeconds;
  const maxCatchup = 3 * step;

  return {
    /** Active means visible and authorized by the local and cloud write lease rules. */
    setActive(next: boolean, wallNowMs: UnixMs): void {
      if (active === next) return;
      active = next;
      previousFrameMs = undefined;
      accumulator = 0;
      if (active) publish(world.reconcileWallTime(wallNowMs));
    },

    /** The animation source provides monotonic and wall time separately. */
    frame(monotonicMs: number, wallNowMs: UnixMs): void {
      if (active) {
        const elapsed = Math.max(0, (monotonicMs - (previousFrameMs ?? monotonicMs)) / 1000);
        previousFrameMs = monotonicMs;
        accumulator = Math.min(maxCatchup, accumulator + elapsed);
        while (accumulator >= step) {
          publish(world.step(wallNowMs));
          accumulator -= step;
        }
      }
      paint(world.view());
    },
  };
}
