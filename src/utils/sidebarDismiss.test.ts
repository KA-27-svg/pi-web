// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { isSidebarDismissClick } from './sidebarDismiss';

let root: HTMLElement;

const build = (html: string) => {
  root.innerHTML = html;
  return root;
};

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

describe('isSidebarDismissClick', () => {
  it('点在正文空白处算数', () => {
    build('<main><div class="msg">你好</div></main>');
    expect(isSidebarDismissClick(root.querySelector('.msg')!, true)).toBe(true);
  });

  it('点在 main 本身（真正的空白）算数', () => {
    build('<main></main>');
    expect(isSidebarDismissClick(root.querySelector('main')!, true)).toBe(true);
  });

  it('点在按钮上不算，否则会打断展开/复制等操作', () => {
    build('<main><button>展开</button></main>');
    expect(isSidebarDismissClick(root.querySelector('button')!, true)).toBe(false);
  });

  it('点在按钮里的图标上也不算（事件目标是图标）', () => {
    build('<main><button><svg data-x></svg></button></main>');
    expect(isSidebarDismissClick(root.querySelector('[data-x]')!, true)).toBe(false);
  });

  it('点在同 button 的折叠块里也不算', () => {
    build('<main><div role="button"><span data-x>步骤</span></div></main>');
    expect(isSidebarDismissClick(root.querySelector('[data-x]')!, true)).toBe(false);
  });

  it('点在链接上不算', () => {
    build('<main><a href="#"><span data-x>链接</span></a></main>');
    expect(isSidebarDismissClick(root.querySelector('[data-x]')!, true)).toBe(false);
  });

  it('用户刚选中文字时不算，避免把选词当成点空白', () => {
    build('<main><div class="msg">可以选中的文字</div></main>');
    expect(isSidebarDismissClick(root.querySelector('.msg')!, false)).toBe(false);
  });

  it('拿不到元素时按空白处理', () => {
    expect(isSidebarDismissClick(null, true)).toBe(true);
  });
});
