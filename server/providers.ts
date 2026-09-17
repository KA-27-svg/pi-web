/**
 * 内置供应商目录。
 *
 * 数据来自 pi 的 providers 文档：`id` 就是 `auth.json` 里的键，`envVar` 是等价的
 * 环境变量。两者对得上，向导才能把用户贴的 key 写到 pi 真正会读的位置。
 *
 * 只收常见的一批：清单越长，维护与翻译成本越高，而新供应商 pi 自己更新内置目录
 * 就能用，不需要在这里补。
 */

export interface ProviderPreset {
  /** `auth.json` 里的键，必须与 pi 一致 */
  id: string;
  label: string;
  /** 等价的环境变量名 */
  envVar: string;
  /** 只支持订阅登录（OAuth），不能只贴 API key */
  subscriptionOnly?: boolean;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
  { id: 'google', label: 'Google Gemini', envVar: 'GEMINI_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
  { id: 'xai', label: 'xAI (Grok)', envVar: 'XAI_API_KEY' },
  { id: 'zai', label: 'Z.AI 编程套餐', envVar: 'ZAI_API_KEY' },
  { id: 'kimi-coding', label: 'Kimi For Coding', envVar: 'KIMI_API_KEY' },
  { id: 'minimax', label: 'MiniMax', envVar: 'MINIMAX_API_KEY' },
  { id: 'groq', label: 'Groq', envVar: 'GROQ_API_KEY' },
  { id: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY' },
  { id: 'together', label: 'Together AI', envVar: 'TOGETHER_API_KEY' },
  { id: 'nvidia', label: 'NVIDIA NIM', envVar: 'NVIDIA_API_KEY' },
  { id: 'cerebras', label: 'Cerebras', envVar: 'CEREBRAS_API_KEY' },
  { id: 'fireworks', label: 'Fireworks', envVar: 'FIREWORKS_API_KEY' },
  { id: 'huggingface', label: 'Hugging Face', envVar: 'HF_TOKEN' },
  { id: 'xiaomi', label: 'Xiaomi MiMo', envVar: 'XIAOMI_API_KEY' },
  { id: 'github-copilot', label: 'GitHub Copilot', envVar: '', subscriptionOnly: true },
  { id: 'radius', label: 'Radius', envVar: 'RADIUS_API_KEY' },
];

/**
 * 订阅登录（OAuth）入口。
 * 这些只能在终端里跑 pi 的 `/login`，桥接做不了，所以向导只做引导。
 */
export const SUBSCRIPTION_LOGINS: readonly { id: string; label: string }[] = [
  { id: 'anthropic', label: 'Claude Pro/Max' },
  { id: 'openai', label: 'ChatGPT Plus/Pro (Codex)' },
  { id: 'github-copilot', label: 'GitHub Copilot' },
  { id: 'xai', label: 'xAI (Grok/X 订阅)' },
  { id: 'openrouter', label: 'OpenRouter' },
];

/** 供应商 id → 环境变量名。用于「没写 auth.json 但设了环境变量」这种用法 */
export const PROVIDER_ENV_VARS: Record<string, string> = Object.fromEntries(
  PROVIDER_PRESETS.filter(preset => preset.envVar).map(preset => [preset.id, preset.envVar])
);
