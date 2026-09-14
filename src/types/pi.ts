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
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
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
  sessions?: SessionSummary[];
  /** 磁盘上的会话总数；比 sessions.length 大说明列表被截断 */
  sessionsTotal?: number;
  trashed?: TrashedSession[];
}
