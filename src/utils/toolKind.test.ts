import { describe, expect, it } from 'vitest';
import { toolKind } from './toolKind';

describe('toolKind', () => {
  it('shell 类：bash 与 powershell', () => {
    expect(toolKind('bash')).toBe('shell');
    expect(toolKind('powershell')).toBe('shell');
    expect(toolKind('BASH')).toBe('shell');
  });

  it('读类：read / ls / find', () => {
    expect(toolKind('read')).toBe('read');
    expect(toolKind('ls')).toBe('read');
    expect(toolKind('find')).toBe('read');
  });

  it('写与改分开', () => {
    expect(toolKind('write')).toBe('write');
    expect(toolKind('edit')).toBe('edit');
  });

  it('搜索类既认内置（grep）也认扩展（exa_search）', () => {
    expect(toolKind('grep')).toBe('search');
    expect(toolKind('exa_search')).toBe('search');
    expect(toolKind('exa_contents')).toBe('other'); // 名字里没有 search，不好猜
    expect(toolKind('web_fetch')).toBe('search');
  });

  it('认不出来就归到 other，而不是瞎猜', () => {
    expect(toolKind('some_custom_tool')).toBe('other');
    expect(toolKind('')).toBe('other');
  });
});
