import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dressChrome,
  dressUsage,
  paintCanvas,
  paintDocument,
  paintObserve,
  paintPin,
  paintStage,
  paintTrace,
  placeTail,
} from './dress.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mediaStub(): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {
      return undefined;
    },
  }));
}

function usagePage(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="top"><h1>用量</h1><p class="eyebrow">设置</p><div class="top-actions"></div></div>
    <div class="select-wrap">
      <button class="range" aria-expanded="false">7</button>
      <span class="select-arrow">⌄</span>
      <div class="select-menu">
        <button aria-selected="true">7</button>
        <button aria-selected="false">30</button>
      </div>
    </div>
    <p class="notice"><b>口径</b>说明</p>
    <div class="kpis"><article class="kpi"><span class="kpi-label">请求</span><div class="kpi-value">1<span class="kpi-unit">%</span></div><span class="kpi-foot">脚</span></article></div>
    <div class="grid"></div>
    <article class="card section"><div class="card-head"><h2>表</h2><small>注</small></div>
      <table></table>
      <table><thead><tr><th>名</th><th class="num">数</th></tr></thead>
        <tbody><tr><td>a</td><td class="num">1</td></tr><tr><td class="tool-name">b</td><td class="num ok">2</td></tr></tbody></table>
    </article>
    <div class="chart"><div class="y-axis"></div><div class="bars">
      <div class="bar-group"><div class="bar-stack"><i class="bar input"></i><i class="bar output"></i></div><small>今天</small></div>
    </div></div>
    <div class="legend"></div>
    <div class="donut-wrap"><div class="donut"></div><div class="donut-center"><strong>1</strong><small>总</small></div>
      <div class="breakdown"><div class="break-row"><span class="name">新</span><strong>1</strong><div class="track"><i class="fill"></i></div></div></div>
    </div>
    <span class="model-name"><i class="model-dot"></i><i class="model-dot blue"></i></span>
    <span class="sub">接口</span>
    <span class="pill">完成</span>
    <div class="requests">
      <details class="request"><summary><span class="step">步</span><span class="request-model">m<small>s</small></span><span class="request-tokens">1</span><span class="request-time">2</span><span class="chevron">›</span></summary>
        <div class="request-detail"><strong>原因</strong><div class="tool-list"></div></div>
      </details>
      <details class="request"></details>
    </div>
    <p class="usage-empty">空</p>
    <p class="footer-note">注</p>
  `;
  return root;
}

describe('dress', () => {
  it('paints the document, the stage, and both tails', () => {
    paintDocument(document);
    const sheet = document.createElement('div');
    const stage = document.createElement('div');
    paintStage(sheet, stage);
    const canvas = document.createElement('canvas');
    paintCanvas(canvas);
    expect(document.body.style.backgroundColor).toBe('rgb(243, 239, 230)');
    expect(canvas.style.display).toBe('block');
    const trace = document.createElement('ol');
    const tail = document.createElement('span');
    paintTrace(trace, tail);
    placeTail(tail, 20, 40, 30, true);
    expect(tail.style.borderBottomWidth).toBe('1px');
    expect(tail.style.left).toBe('30px');
    expect(tail.style.top).toBe('55px');
    placeTail(tail, 20, 40, 30, false);
    expect(tail.style.borderTopWidth).toBe('1px');
    expect(tail.style.top).toBe('15px');
    const layer = document.createElement('div');
    const readout = document.createElement('div');
    const pins = document.createElement('div');
    paintObserve(layer, readout, pins);
    const pin = document.createElement('span');
    paintPin(pin, 'seen');
    expect(pin.style.opacity).toBe('1');
    paintPin(pin, 'hidden');
    paintPin(pin, 'beyond');
    expect(pin.style.opacity).toBe('0.45');
  });

  it('dresses a usage page for wide and narrow viewports, then an empty one', () => {
    mediaStub();
    const full = usagePage();
    dressUsage(full);
    dressUsage(full);
    const range = full.querySelector<HTMLElement>('.range')!;
    range.setAttribute('aria-expanded', 'true');
    range.dispatchEvent(new MouseEvent('click'));
    expect(range.style.outline).toContain('1px');
    range.setAttribute('aria-expanded', 'false');
    range.click();
    expect(range.style.outline).toBe('');
    const selected = full.querySelector<HTMLElement>('[aria-selected="true"]')!;
    const other = full.querySelector<HTMLElement>('[aria-selected="false"]')!;
    other.dispatchEvent(new MouseEvent('mouseenter'));
    other.dispatchEvent(new MouseEvent('mouseleave'));
    expect(other.style.outline).toBe('');
    selected.dispatchEvent(new MouseEvent('mouseleave'));
    expect(selected.style.outline).toContain('1px');
    const request = full.querySelector('details')!;
    const summary = request.querySelector('summary')!;
    summary.dispatchEvent(new MouseEvent('mouseenter'));
    summary.dispatchEvent(new MouseEvent('mouseleave'));
    const sparse = document.createElement('div');
    sparse.innerHTML = `
      <p class="notice"></p>
      <div class="card-head"></div>
      <div class="bar-group"></div>
      <div class="break-row"></div>
      <details class="request"><div class="request-detail"></div></details>
    `;
    dressUsage(sparse);
    dressUsage(document.createElement('div'));
  });

  it('reflows the settings shell when the viewport is narrow and when pieces are missing', () => {
    mediaStub();
    const nodes = {
      keys: document.createElement('aside'),
      corner: document.createElement('div'),
      pilot: document.createElement('form'),
      goal: document.createElement('input'),
      shell: document.createElement('div'),
      rail: document.createElement('aside'),
      brand: document.createElement('p'),
      nav: document.createElement('nav'),
      foot: document.createElement('p'),
      body: document.createElement('div'),
    };
    nodes.keys.append(document.createElement('p'));
    nodes.brand.append(document.createElement('small'));
    nodes.shell.append(Object.assign(document.createElement('section'), { id: 'panel-model' }));
    nodes.shell.append(Object.assign(document.createElement('section'), { id: 'memory' }));
    dressChrome(nodes);
    expect(nodes.shell.style.gridTemplateColumns).toBe('1fr');
    const bare = {
      ...nodes,
      keys: document.createElement('aside'),
      brand: document.createElement('p'),
      shell: document.createElement('div'),
    };
    dressChrome(bare);
    expect(bare.brand.querySelector('small')).toBeNull();
    expect(bare.keys.querySelector('p')).toBeNull();
  });
});
