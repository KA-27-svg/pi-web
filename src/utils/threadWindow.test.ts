import { describe, expect, it } from 'vitest';
import {
  THREAD_PAGE,
  growWindow,
  historyWeight,
  initialWindow,
  loadLater,
  messageWeight,
  visibleSlice,
  windowAround,
  windowFor,
} from './threadWindow';

/** 一条挂满工具卡的消息：19 个工具 → 体量 20 */
const heavyTools = () => Array.from({ length: 19 }, () => ({}));

describe('对话区渲染窗口', () => {
  it('初始只渲染一页', () => {
    expect(windowFor(initialWindow(), 'h1')).toEqual({ size: THREAD_PAGE, end: 0 });
  });

  it('同一段历史里沿用已展开的量', () => {
    const grown = growWindow(initialWindow(), 'h1', 500);
    expect(windowFor(grown, 'h1')).toEqual({ size: THREAD_PAGE * 2, end: 0 });
  });

  it('换了会话就回到一页，避免把上个会话的位置带过去', () => {
    let w = initialWindow();
    w = growWindow(w, 'h1', 500);
    w = growWindow(w, 'h1', 500);
    w = windowAround('h1', Array.from({ length: 500 }, (_, i) => i), 100);
    expect(windowFor(w, 'h1').end).toBeGreaterThan(0);

    // 新的历史（key 变了）
    expect(windowFor(w, 'h2')).toEqual({ size: THREAD_PAGE, end: 0 });
  });

  it('向上补页不会超过窗口上沿', () => {
    const w = growWindow(initialWindow(), 'h1', 60);
    expect(w.size).toBe(60);

    expect(growWindow(w, 'h1', 60).size).toBe(60);
  });

  it('消息很少时窗口就是全部', () => {
    expect(growWindow(initialWindow(), 'h1', 3).size).toBe(3);
  });

  it('上限按体量算，不按条数：消息很重时往上滚不能卡住', () => {
    // 157 条、每条 20 个体量单位（一段工具调用很多的历史）。
    // 上限如果错用条数（157），窗口加到 157 就再也长不动了，
    // 而 157 个体量单位只够装七八条消息——用户往上滚就停在那儿。
    const heavy = Array.from({ length: 157 }, (_, i) => ({ id: `m${i}`, tools: heavyTools() }));

    const available = historyWeight(heavy, messageWeight);

    let w = growWindow(initialWindow(), 'h1', available);
    expect(w.size).toBe(THREAD_PAGE * 2);
    w = growWindow(w, 'h1', available);
    expect(w.size).toBe(THREAD_PAGE * 3);
    w = growWindow(w, 'h1', available);
    expect(w.size).toBe(THREAD_PAGE * 4);
  });

  it('一直往上补，能把整段历史都放进来', () => {
    const heavy = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, tools: heavyTools() }));

    const available = historyWeight(heavy, messageWeight);

    let w = initialWindow();
    for (let i = 0; i < 30; i++) {
      w = growWindow(w, 'h1', available);
      if (!visibleSlice(heavy, w, 'h1', messageWeight).hasEarlier) break;
    }

    const slice = visibleSlice(heavy, w, 'h1', messageWeight);
    expect(slice.hasEarlier).toBe(false);
    expect(slice.visible).toHaveLength(heavy.length);
  });
});

describe('实际渲染的片段', () => {
  const history = Array.from({ length: 120 }, (_, i) => `m${i}`);

  it('长会话只渲染末尾一页，其余等到往上滚才补', () => {
    const { visible, startIndex, endIndex, hasEarlier, hasLater } = visibleSlice(
      history,
      initialWindow(),
      'h1'
    );

    expect(visible).toHaveLength(THREAD_PAGE);
    expect(visible[0]).toBe('m70');
    expect(visible[visible.length - 1]).toBe('m119');
    expect(startIndex).toBe(70);
    expect(endIndex).toBe(120);
    expect(hasEarlier).toBe(true);
    expect(hasLater).toBe(false);
  });

  it('短会话全都渲染，两侧都不给提示', () => {
    const { visible, hasEarlier, hasLater } = visibleSlice(history.slice(0, 10), initialWindow(), 'h1');

    expect(visible).toHaveLength(10);
    expect(hasEarlier).toBe(false);
    expect(hasLater).toBe(false);
  });

  it('向上补了一页后，片段往前扩一段', () => {
    const grown = growWindow(initialWindow(), 'h1', history.length);
    const { visible, startIndex, hasEarlier, hasLater } = visibleSlice(history, grown, 'h1');

    expect(visible).toHaveLength(THREAD_PAGE * 2);
    expect(visible[0]).toBe('m20');
    expect(startIndex).toBe(20);
    expect(hasEarlier).toBe(true);
    expect(hasLater).toBe(false);
  });

  it('换会话后回到只渲染末尾一页', () => {
    const grown = growWindow(initialWindow(), 'h1', history.length);
    const { visible, hasEarlier, hasLater } = visibleSlice(history, grown, 'h2');

    expect(visible).toHaveLength(THREAD_PAGE);
    expect(hasEarlier).toBe(true);
    expect(hasLater).toBe(false);
  });
});

describe('定位到某一条（右侧轨道点击还没渲染的提问）', () => {
  const history = Array.from({ length: 120 }, (_, i) => `m${i}`);

  it('把目标放到窗口开头，前后都留出未渲染的段', () => {
    const { visible, startIndex, endIndex, hasEarlier, hasLater } = visibleSlice(
      history,
      windowAround('h1', history, 30),
      'h1'
    );

    expect(startIndex).toBe(30);
    expect(endIndex).toBe(80);
    expect(visible[0]).toBe('m30');
    expect(visible[visible.length - 1]).toBe('m79');
    expect(hasEarlier).toBe(true);
    expect(hasLater).toBe(true);
  });

  it('目标靠近末尾时退化成末尾一页', () => {
    const { visible, hasLater } = visibleSlice(
      history,
      windowAround('h1', history, 110),
      'h1'
    );

    expect(visible[visible.length - 1]).toBe('m119');
    expect(hasLater).toBe(false);
  });

  it('目标越界时夹回合法范围', () => {
    const { visible } = visibleSlice(
      history,
      windowAround('h1', history, 9999),
      'h1'
    );

    expect(visible[visible.length - 1]).toBe('m119');
  });
});

describe('向下补页', () => {
  const history = Array.from({ length: 120 }, (_, i) => `m${i}`);

  it('上沿不动，只在下面接一段，并把尾部留白吃掉', () => {
    const jumped = windowAround('h1', history, 30); // 窗口 m30..m79
    const more = loadLater(jumped, 'h1'); // 再往下接一页

    const { visible, startIndex, endIndex, hasLater } = visibleSlice(history, more, 'h1');

    expect(startIndex).toBe(30);
    expect(endIndex).toBe(120);
    expect(visible[0]).toBe('m30');
    expect(visible[visible.length - 1]).toBe('m119');
    expect(hasLater).toBe(false);
  });

  it('已经贴到最新时不动', () => {
    const w = loadLater(initialWindow(), 'h1');
    expect(windowFor(w, 'h1')).toEqual({ size: THREAD_PAGE, end: 0 });
  });
});

describe('按体量算窗口（合并回合后一条可能很重）', () => {
  it('一条挂了几十个工具卡的消息会挤掉前面几条', () => {
    const all = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: i, tools: [] as unknown[] })),
      { id: 20, tools: Array.from({ length: 60 }, () => ({})) },
    ];

    const { visible } = visibleSlice(all, initialWindow(), 'h1', messageWeight);

    // 最后那条体量 61 已经超过一页（50），窗口里只剩它
    expect(visible.map(m => m.id)).toEqual([20]);
  });

  it('附件也算体量（图片渲染更重）', () => {
    const all = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: i, tools: [] as unknown[] })),
      { id: 20, attachments: Array.from({ length: 60 }, () => ({})) },
    ];

    const { visible } = visibleSlice(all, initialWindow(), 'h1', messageWeight);

    expect(visible.map(m => m.id)).toEqual([20]);
  });

  it('没有工具 / 附件时和按条数算完全一致', () => {
    const all = Array.from({ length: 120 }, (_, i) => ({ id: i, tools: [] as unknown[] }));

    const counted = visibleSlice(all, initialWindow(), 'h1');
    const weighed = visibleSlice(all, initialWindow(), 'h1', messageWeight);

    expect(weighed.startIndex).toBe(counted.startIndex);
    expect(weighed.visible.length).toBe(counted.visible.length);
  });

  it('windowAround 里目标仍然是窗口第一条（不会被体量裁掉）', () => {
    const all = Array.from({ length: 100 }, (_, i) => ({ id: i, tools: [] as unknown[] }));

    const { visible } = visibleSlice(
      all,
      windowAround('h1', all, 10, messageWeight),
      'h1',
      messageWeight
    );

    expect(visible[0].id).toBe(10);
  });
});
