import type { PiBridge } from './piBridge';

/**
 * 历史会话与回收箱。
 *
 * pi 的 RPC 只管「当前会话」，列举/重命名/删除它都没有，所以这些指令都由桥接
 * 直接操作会话文件（见 server/sessions.ts、server/trash.ts），前端只管发指令。
 */
export function createSessionActions({ handler, sendCommand }: PiBridge) {
  const requestSessions = () => sendCommand({ type: 'list_sessions' });
  const requestStats = () => sendCommand({ type: 'get_session_stats' });

  const switchSession = (sessionPath: string) => {
    // 点下就进入「切换中」：对话区不再显示上一个会话，历史到达后原地换上
    handler.beginSwitch();
    sendCommand({ type: 'switch_session', sessionPath });
  };

  const renameSession = (sessionPath: string, name: string) =>
    sendCommand({ type: 'rename_session', sessionPath, name });

  /** 删除 = 移入回收箱（保留 30 天），所以不需要二次确认 */
  const deleteSession = (sessionPath: string) =>
    sendCommand({ type: 'trash_session', sessionPath });

  const requestTrash = () => sendCommand({ type: 'list_trash' });
  const restoreSession = (sessionPath: string) =>
    sendCommand({ type: 'restore_session', sessionPath });
  const purgeSession = (sessionPath: string) =>
    sendCommand({ type: 'purge_session', sessionPath });
  const emptyTrash = () => sendCommand({ type: 'empty_trash' });

  return {
    requestSessions,
    requestStats,
    switchSession,
    renameSession,
    deleteSession,
    requestTrash,
    restoreSession,
    purgeSession,
    emptyTrash,
  };
}
