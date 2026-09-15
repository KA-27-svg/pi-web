export interface ToolCallState {
  id: string;
  name: string;
  args: any;
  status: 'running' | 'done' | 'error';
  result?: any;
}

export interface PiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  tools?: ToolCallState[];
  timestamp: number;
  status?: 'streaming' | 'done' | 'error';
  /** status 为 error 时的原因，用于直接展示给用户 */
  error?: string;
  /** 从会话记录里恢复出来的消息，不播放入场动画 */
  fromHistory?: true;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
}

/** pi 报上来的 token 用量；input/output/cacheRead/cacheWrite 都是累计值 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface ContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

/**
 * 当前会话的用量与花费（来自 pi 的 get_session_stats）。
 * cost 是 pi 按 models.json 里配的单价算出来的估算值，不是供应商账单。
 */
export interface SessionStats {
  cost: number;
  tokens: TokenUsage;
  contextUsage?: ContextUsage;
}

export interface SessionSummary {
  path: string;
  id: string;
  name?: string;
  preview: string;
  updatedAt: number;
  cwd?: string;
}

/** 回收箱里的会话，比普通摘要多了删除/到期时间 */
export interface TrashedSession {
  path: string;
  id: string;
  name?: string;
  preview: string;
  cwd?: string;
  deletedAt: number;
  expiresAt: number;
}

export interface BridgeStatus {
  connected: boolean;
  cwd: string;
  isStreaming: boolean;
  currentTool?: string;
  model?: ModelInfo;
  thinkingLevel?: string;
  sessionId?: string;
  availableModels?: ModelInfo[];
  availableThinkingLevels?: string[];
  /** 当前会话的累计用量与花费 */
  stats?: SessionStats;
  sessions?: SessionSummary[];
  /** 磁盘上的会话总数；比 sessions.length 大说明列表被截断 */
  sessionsTotal?: number;
  trashed?: TrashedSession[];
  /** 需要告知用户的一次性提示（切换会话失败等） */
  notice?: string;
  /**
   * 正在切换会话。此时对话区不显示任何内容（也不会显示上一个会话），
   * 但布局仍按「有对话」算，以免底部输入区位置与滚动位置跟着弹一次。
   */
  switching?: boolean;
  /**
   * 已经拿到过当前会话的消息。在此之前无从得知会话是否为空，
   * 所以不能进入「空白界面」（开场图标、输入框居中）。
   */
  sessionLoaded?: boolean;
}
