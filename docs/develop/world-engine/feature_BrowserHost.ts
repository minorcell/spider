import type { UnixMs } from './base';
import type { World, WorldFrame, WorldView } from './module_World';

/** 即使本地推理期间降低绘制频率，宿主也能处理每次更新的全部事件。 */
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
    /** 页面可见且符合本地与云端写入租约的条件时，才推进模拟。 */
    setActive(next: boolean, wallNowMs: UnixMs): void {
      if (active === next) return;
      active = next;
      previousFrameMs = undefined;
      accumulator = 0;
      if (active) publish(world.reconcileWallTime(wallNowMs));
    },

    /** 动画回调分别提供单调时间和现实时间。 */
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
