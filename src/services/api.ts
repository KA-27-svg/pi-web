import type { Message, Settings } from '../types';

export async function sendChatMessageStream(
  messages: Message[],
  settings: Settings,
  onUpdate: (chunk: { content?: string; reasoning?: string }) => void,
  signal: AbortSignal
) {
  const formattedMessages = [
    ...(settings.systemPrompt
      ? [{ role: 'system', content: settings.systemPrompt }]
      : []),
    ...messages
      .filter(m => m.status !== 'error')
      .map(m => ({
        role: m.role,
        content: m.content,
      })),
  ];

  const endpoint = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (settings.apiKey) {
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: settings.model,
      messages: formattedMessages,
      temperature: settings.temperature,
      stream: true,
    }),
  });

  if (!response.ok) {
    let errDetail = '';
    try {
      const errJson = await response.json();
      errDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errDetail = await response.text();
    }
    throw new Error(
      `请求失败 [${response.status}]: ${errDetail || response.statusText}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('无法读取响应流数据');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      if (trimmed === 'data: [DONE]') return;

      try {
        const json = JSON.parse(trimmed.replace(/^data:\s*/, ''));
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        // 兼容各大模型 (DeepSeek / OpenAI o-series) 的 reasoning_content 或普通 content
        const reasoningDelta =
          delta.reasoning_content || delta.reasoning || '';
        const contentDelta = delta.content || '';

        if (reasoningDelta || contentDelta) {
          onUpdate({
            reasoning: reasoningDelta,
            content: contentDelta,
          });
        }
      } catch (err) {
        // 忽略非关键解析跳跃
      }
    }
  }
}
