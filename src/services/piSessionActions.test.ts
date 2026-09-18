import { describe, expect, it, vi } from 'vitest';
import type { PiBridge } from './piBridge';
import { createSessionActions } from './piSessionActions';

/** 指令形状就是这个模块的全部契约，所以直接盯着发出去的东西 */
function harness() {
  const sent: Record<string, any>[] = [];
  const beginSwitch = vi.fn();

  const bridge = {
    setMessages: vi.fn(),
    setStatus: vi.fn(),
    handler: { beginSwitch } as never,
    request: vi.fn(),
    sendCommand: (command: object) => {
      sent.push(command as Record<string, any>);
    },
    isOpen: () => true,
  } as unknown as PiBridge;

  return { actions: createSessionActions(bridge), sent, beginSwitch };
}

describe('session 动作', () => {
  it('拉会话列表 / 会话用量', () => {
    const { actions, sent } = harness();

    actions.requestSessions();
    actions.requestStats();

    expect(sent).toEqual([{ type: 'list_sessions' }, { type: 'get_session_stats' }]);
  });

  it('切换会话先进入「切换中」，再发指令', () => {
    const { actions, sent, beginSwitch } = harness();

    actions.switchSession('C:/s/a.jsonl');

    expect(beginSwitch).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ type: 'switch_session', sessionPath: 'C:/s/a.jsonl' }]);
  });

  it('改名 / 删除 / 回收箱那一组的指令形状', () => {
    const { actions, sent } = harness();

    actions.renameSession('a.jsonl', '新名字');
    actions.deleteSession('a.jsonl');
    actions.requestTrash();
    actions.restoreSession('a.jsonl');
    actions.purgeSession('a.jsonl');
    actions.emptyTrash();

    expect(sent).toEqual([
      { type: 'rename_session', sessionPath: 'a.jsonl', name: '新名字' },
      { type: 'trash_session', sessionPath: 'a.jsonl' },
      { type: 'list_trash' },
      { type: 'restore_session', sessionPath: 'a.jsonl' },
      { type: 'purge_session', sessionPath: 'a.jsonl' },
      { type: 'empty_trash' },
    ]);
  });
});
