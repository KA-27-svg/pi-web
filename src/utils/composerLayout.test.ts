import { describe, expect, it } from 'vitest';
import { composerLayout } from './composerLayout';

const base = {
  sessionReady: true,
  openingIcon: true,
  isEmpty: true,
  composerEngaged: false,
};

describe('输入栏布局', () => {
  it('还不知道会话内容时不进入空白态', () => {
    // 刷新已有对话时，开场图标与居中都必须等到确知为空之后才允许出现，
    // 否则会先演一遍形变再被历史替掉
    const layout = composerLayout({ ...base, sessionReady: false, isEmpty: true });

    expect(layout.showIcon).toBe(false);
    expect(layout.stickToBottom).toBe(true);
  });

  it('确知为空时才显示开场图标并居中', () => {
    const layout = composerLayout(base);

    expect(layout.showIcon).toBe(true);
    expect(layout.stickToBottom).toBe(false);
  });

  it('已有对话时不显示图标，并且贴底', () => {
    const layout = composerLayout({ ...base, isEmpty: false });

    expect(layout.showIcon).toBe(false);
    expect(layout.stickToBottom).toBe(true);
  });

  it('用户点过输入框之后，即使为空也不再居中', () => {
    const layout = composerLayout({ ...base, composerEngaged: true });

    expect(layout.stickToBottom).toBe(true);
  });

  it('新建会话后重新回到开场图标态', () => {
    const layout = composerLayout({ ...base, openingIcon: true, isEmpty: true, composerEngaged: false });

    expect(layout.showIcon).toBe(true);
    expect(layout.stickToBottom).toBe(false);
  });

  it('已经点开过开场图标就不再显示', () => {
    expect(composerLayout({ ...base, openingIcon: false }).showIcon).toBe(false);
  });
});
