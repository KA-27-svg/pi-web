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
  /** 用户消息随行的附件（图片 / 文件） */
  attachments?: MessageAttachment[];
  timestamp: number;
  status?: 'streaming' | 'done' | 'error';
  /** status 为 error 时的原因，用于直接展示给用户 */
  error?: string;
  /** 从会话记录里恢复出来的消息，不播放入场动画 */
  fromHistory?: true;
  /** 这条回答用的模型（pi 里存的是模型 id）。旧消息可能没有，界面上用当前模型兜底。 */
  model?: string;
  /**
   * 生成中发出、还在 pi 队列里等的消息。
   * 中断时靠它把这些消息从对话里收回输入栏；pi 开始处理后就清掉。
   */
  queued?: true;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
}

/** 工作目录里的一个条目（桥接列目录的结果） */
export interface DirEntry {
  name: string;
  /** 相对工作目录的路径，正斜杠 */
  path: string;
  isDir: boolean;
  bytes?: number;
}

export interface DirListing {
  path: string;
  /** 上一级；已经是工作目录根时为 null */
  parent: string | null;
  entries: DirEntry[];
}

/** 桥接读一个附件的结果，按 kind 分流 */
export type AttachmentContent =
  | { kind: 'text'; text: string; truncated: boolean; bytes: number }
  | { kind: 'image'; data: string; mimeType: string; bytes: number }
  | { kind: 'binary'; bytes: number };

/** pi 原生的图片附件（prompt.images 的元素），data 是不带 data URL 前缀的 base64 */
export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/** 对话里展示的附件：图片渲染成缩略图，文件渲染成卡片 */
export interface MessageAttachment {
  kind: 'image' | 'file';
  name: string;
  /** 图片的 data URL，直接给 <img src>；拼接一次存下来，避免每帧重生成长串 */
  dataUrl?: string;
  /** 文件在会话工作目录里的相对路径 */
  path?: string;
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

/** 环境探测结果（桥接 server/env.ts 的产出） */
export interface SetupStatus {
  platform: string;
  node: { version: string | null; ok: boolean; minimum: string };
  npm: { available: boolean };
  pi: { installed: boolean; version: string | null };
  /** Git Bash 只在 Windows 上必需 */
  gitBash: { required: boolean; available: boolean };
  /** 已配好凭证的供应商（只看有没有，不含凭证内容） */
  credentials: { providers: string[] };
  /** 环境与凭证都就绪，可以开始对话 */
  ready: boolean;
  issues: SetupIssue[];
}

/** 内置供应商（桥接 server/providers.ts 的产出） */
export interface ProviderPreset {
  /** auth.json 里的键 */
  id: string;
  label: string;
  envVar: string;
  /** 只支持订阅登录，不能只贴 API key */
  subscriptionOnly?: boolean;
}

export interface SetupIssue {
  code:
    | 'node-missing'
    | 'node-too-old'
    | 'npm-missing'
    | 'pi-missing'
    | 'git-bash-missing'
    | 'no-credentials';
  message: string;
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
  /** 中断后从队列里取回的文本，交回输入框继续编辑。seq 区分重复的同一段文本。 */
  restoredDraft?: { text: string; seq: number };
  /** 环境探测结果 */
  setup?: SetupStatus;
  /**
   * 官方安装命令原文。
   * 代跑失败或不允许代跑时展示给用户，复制到终端就能跑。
   */
  installCommand?: string;
  /** 能不能由桥接代跑官方安装器；不能时 reason 说明原因 */
  preflight?: { allowed: boolean; reason?: string };
  /** 可选供应商目录（桥接下发，免得两边各维护一份） */
  providers?: ProviderPreset[];
  /** 支持订阅登录（OAuth）的供应商，只能在终端跑 /login */
  subscriptions?: { id: string; label: string }[];
  /** 正在代跑安装器 */
  installing?: boolean;
  /** 安装器输出（已去 ANSI、压掉重复），只保留最近若干行 */
  installLog?: string[];
  /** 安装失败或被拒绝的原因 */
  installError?: string;
  /** 写配置失败的原因（保存供应商 / 默认模型 / 默认工具） */
  setupNotice?: string;
  /**
   * 正在自动重试（过载 / 限流 / 5xx）。
   * 有值时界面要明说“在重试”，否则用户看着不动的界面会以为卡死了。
   */
  retrying?: { attempt: number; maxAttempts: number };
}
