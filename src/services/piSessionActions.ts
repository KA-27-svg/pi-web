import type { PiBridge } from './piBridge';

/**
 * 历史会话与回收箱。
 *
 * pi 的 RPC 只管「当前会话」，列举/重命名/删除它都没有，所以这些指令都由桥接
 * 直接操作会话文件（见 server/sessions.ts、server/trash.ts），前端只管发指令。
 */
export function createSessionActions({ handler, sendCommand }: PiBridge) {
  /**
   * 拉历史会话列表。
   * `scope: 'advisor'` 列的是顾问自己的目录（侧栏的顾问分组用）。
   * 这个动作挂在执行窗口那条连接上也能调：侧栏要展示两个列表。
   */
  const requestSessions = (scope?: 'advisor') =>
    sendCommand({ type: 'list_sessions', ...(scope ? { scope } : {}) });
  const requestStats = () => sendCommand({ type: 'get_session_stats' });

  const switchSession = (sessionPath: string) => {
    // 点下就进入「切换中」：对话区不再显示上一个会话，历史到达后原地换上
    handler.beginSwitch();
    sendCommand({ type: 'switch_session', sessionPath });
  };

  /**
   * 替顾问窗口切换它的历史会话（侧栏的顾问分组用）。
   *
   * 与 switchSession 的差别：**本地不进「切换中」**。那条指令会被桥接路由到
   * 顾问的 pi，回包（以及重拉的历史）都只回顾问那边；执行窗口要是也把自己
   * 置成切换中，就永远等不到自己的回包，界面会卡在空白上。
   */
  const switchAdvisorSession = (sessionPath: string) =>
    sendCommand({ type: 'switch_session', sessionPath, scope: 'advisor' });

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
    switchAdvisorSession,
    renameSession,
    deleteSession,
    requestTrash,
    restoreSession,
    purgeSession,
    emptyTrash,
  };
}
