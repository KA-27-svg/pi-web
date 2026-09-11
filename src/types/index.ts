export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string; // 思考链过程内容 (<think>...</think>)
  timestamp: number;
  status?: 'sending' | 'streaming' | 'done' | 'error';
  error?: string;
}

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  systemPrompt: 'You are Pi, a helpful, precise and minimal AI assistant.',
};
