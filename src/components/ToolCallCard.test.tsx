// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ToolCallState } from '../types/pi';
import { ToolCallCard } from './ToolCallCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

const tool = (over: Partial<ToolCallState> = {}): ToolCallState => ({
  id: 't1',
  name: 'bash',
  args: { command: 'ls -la' },
  status: 'done',
  ...over,
});

const render = (t: ToolCallState) => {
  act(() => {
    root.render(<ToolCallCard tool={t} />);
  });
};

const row = () => host.querySelector('button') as HTMLButtonElement;
const chip = () => row().querySelector('span') as HTMLSpanElement;
const expand = () => {
  act(() => {
    row().click();
  });
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('折叠行', () => {
  it('标签显示工具名，摘要显示命令', () => {
    render(tool());

    expect(chip().textContent).toBe('bash');
    expect(row().textContent).toContain('ls -la');
  });

  it('标签按工具类型配色', () => {
    render(tool());
    // shell 是琥珀色那一档
    expect(chip().className).toContain('text-amber-600');

    act(() => root.render(<ToolCallCard tool={tool({ name: 'read', args: { path: 'a.ts' } })} />));
    expect(chip().className).toContain('text-sky-600');
  });

  it('运行中显示转圈而不是展开箭头', () => {
    render(tool({ status: 'running' }));

    expect(host.querySelector('.animate-spin')).not.toBeNull();
  });

  it('默认不展开', () => {
    render(tool());

    expect(row().getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('pre')).toBeNull();
  });
});

describe('展开内容', () => {
  it('bash 展开显示完整命令，而不是一段 JSON', () => {
    // 之前会把 {"command":"ls -la"} 整个糊出来，与上面那行重复且难读
    render(tool({ args: { command: 'cd /tmp && ls' } }));

    expand();

    expect(host.textContent).toContain('cd /tmp && ls');
    expect(host.textContent).not.toContain('"command"');
  });

  it('其它工具仍然显示参数 JSON', () => {
    render(tool({ name: 'write', args: { path: 'a.ts', content: 'hi' } }));

    expand();

    expect(host.textContent).toContain('"path"');
  });

  it('输出渲染在等宽代码框里', () => {
    render(tool({ result: 'total 48\ndrwxr-xr-x' }));

    expand();

    const pre = host.querySelector('pre');
    expect(pre?.textContent).toContain('total 48');
  });

  it('edit 的增删用不同颜色对照显示', () => {
    render(
      tool({
        name: 'edit',
        args: { path: 'a.ts', edits: [{ oldText: '旧行', newText: '新行' }] },
      })
    );

    expand();

    expect(host.textContent).toContain('- 旧行');
    expect(host.textContent).toContain('+ 新行');
    // 有 edits 时不再重复显示参数 JSON
    expect(host.textContent).not.toContain('"edits"');
  });

  it('再点一下收起', () => {
    render(tool());
    expand();
    expect(row().getAttribute('aria-expanded')).toBe('true');

    expand();

    expect(row().getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('pre')).toBeNull();
  });
});
