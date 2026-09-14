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
  turns: number;
  updatedAt: number;
  cwd?: string;
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
}
