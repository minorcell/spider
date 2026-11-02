import { h } from '../dom/index.js';
import { paint } from '../style.js';
import { border, color, ring as RING } from '../token.js';

export type StackedBar = {
  label: string;
  /** Share of the chart height, from 0 to 100. */
  height: number;
  /** Share of this bar that is input, from 0 to 100. */
  input: number;
  /** Share of this bar that is output, from 0 to 100. */
  output: number;
};

export type DonutPart = {
  name: string;
  /** Already formatted amount, shown beside the name. */
  value: string;
  /** Raw amount used to size the ring and the track. */
  amount: number;
  tone: string;
};

function swatch(doc: Document, background: string, bordered: boolean): HTMLElement {
  const node = h(doc, 'span');
  paint(node, {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    marginRight: '5px',
    background,
    border: bordered ? border.ink : '0',
    verticalAlign: 'middle',
  });
  return node;
}

function card(doc: Document, title: string, hint: string, ...body: Node[]): HTMLElement {
  const head = h(
    doc,
    'div',
    { class: 'card-head' },
    h(doc, 'h2', {}, title),
    h(doc, 'small', {}, hint),
  );
  paint(head, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '12px',
  });
  return h(doc, 'article', { class: 'card' }, head, ...body);
}

/** Daily stacked bars. Input sits above output. Heights are percentages, not raw tokens. */
export function stackedBarChart(
  doc: Document,
  options: {
    title: string;
    hint: string;
    ariaLabel: string;
    ticks: string[];
    bars: StackedBar[];
  },
): HTMLElement {
  const ticks = options.ticks.map((label) => h(doc, 'span', {}, label));
  const groups = options.bars.map((bar) => {
    const stack = h(doc, 'div', { class: 'bar-stack' });
    stack.style.height = `${bar.height}%`;
    const input = h(doc, 'i', { class: 'bar input' });
    const output = h(doc, 'i', { class: 'bar output' });
    input.style.height = `${bar.input}%`;
    output.style.height = `${bar.output}%`;
    stack.append(input, output);
    const caption = h(doc, 'small', {}, bar.label);
    paint(caption, { color: color.muted });
    return h(doc, 'div', { class: 'bar-group' }, stack, caption);
  });
  const plot = h(
    doc,
    'div',
    { class: 'chart' },
    h(doc, 'div', { class: 'y-axis' }, ...ticks),
    h(doc, 'div', { class: 'bars', 'aria-label': options.ariaLabel }, ...groups),
  );
  const legend = h(
    doc,
    'div',
    { class: 'legend' },
    h(doc, 'span', {}, swatch(doc, color.hatchStrong, true), '输入'),
    h(doc, 'span', { class: 'out' }, swatch(doc, color.output, false), '输出'),
  );
  paint(legend, { color: color.muted });
  return card(doc, options.title, options.hint, plot, legend);
}

function ring(parts: DonutPart[]): string {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total === 0) return color.paperDeep;
  const stops: string[] = [];
  let start = 0;
  parts.forEach((part, index) => {
    if (part.amount <= 0) return;
    const next = start + (part.amount / total) * 100;
    stops.push(`${RING[index % RING.length]!} ${start}% ${next}%`);
    start = next;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

/** A ring of parts with a center total and one track per part. */
export function donutChart(
  doc: Document,
  options: { title: string; hint: string; center: string; caption: string; parts: DonutPart[] },
): HTMLElement {
  const total = options.parts.reduce((sum, part) => sum + part.amount, 0);
  const ringNode = h(doc, 'div', { class: 'donut' });
  ringNode.style.background = ring(options.parts);
  const center = h(
    doc,
    'div',
    { class: 'donut-center' },
    h(doc, 'strong', {}, options.center),
    h(doc, 'small', {}, options.caption),
  );
  const rows = options.parts.map((part, index) => {
    const width = total === 0 ? 0 : (part.amount / total) * 100;
    const fill = h(doc, 'i', { class: part.tone === '' ? 'fill' : `fill ${part.tone}` });
    fill.style.width = `${width}%`;
    fill.style.background = RING[index % RING.length]!;
    return h(
      doc,
      'div',
      { class: 'break-row' },
      h(doc, 'span', { class: 'name' }, part.name),
      h(doc, 'strong', {}, part.value),
      h(doc, 'div', { class: 'track' }, fill),
    );
  });
  const wrap = h(
    doc,
    'div',
    { class: 'donut-wrap' },
    ringNode,
    center,
    h(doc, 'div', { class: 'breakdown' }, ...rows),
  );
  return card(doc, options.title, options.hint, wrap);
}
