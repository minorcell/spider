import { kindOf } from '@/src/shared/kinds';
import type { Observation } from '@/src/shared/state';
import { REACH } from '@/src/shared/world';

export function describeObservation(observation: Observation): string {
  const aheadInfo = observation.self.ahead;
  const front =
    aheadInfo.by === 'wall'
      ? `面前 ${aheadInfo.open} 米是 ${aheadInfo.id}`
      : aheadInfo.by === 'slope'
        ? `面前 ${aheadInfo.open} 米是近乎竖直的坡`
        : `面前 ${aheadInfo.open} 米是空的`;
  const carrying = observation.self.carrying.map((item) => item.id).join('、') || '空';
  const where = observation.self.home
    ? '在家里'
    : observation.self.wet
      ? '在水里'
      : observation.self.cover
        ? `在${kindOf(observation.self.cover)?.label ?? observation.self.cover}里`
        : '在空地上';
  const water = observation.self.water;
  const shore = observation.self.shore;
  const pool = observation.self.wet
    ? `脚下是水 ${meters(observation.self.waterDepth)} 米，${observation.self.swimming ? '正浮着' : '在涉水'}` +
      `${shore ? `，最近的岸在 ${shore.bearing}° 方向 ${meters(shore.distance)} 米` : ''}`
    : water
      ? `水在 ${water.bearing}° 方向 ${meters(water.distance)} 米，深 ${meters(water.depth)} 米，至少 ${meters(water.span)} 米宽`
      : '附近没有水';
  return [
    `${where}　地面 ${meters(observation.self.ground)} 米　离地 ${meters(observation.self.height)} 米`,
    `朝向 ${observation.self.heading}°　速度 ${observation.self.speed}`,
    `看见 ${observation.view}　够得着 ${REACH}　${front}`,
    `背上 ${carrying}　超出视线 ${observation.beyond}　被挡住 ${observation.hidden}`,
    pool,
    ...observation.self.ways.map((way) => `可走到 ${way.x}, ${way.z}（${meters(way.open)} 米）`),
  ].join('\n');
}

export function meters(value: number): string {
  const text = (Math.round(value * 10) / 10).toFixed(1);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}
