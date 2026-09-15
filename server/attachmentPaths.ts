/**
 * 从会话内容里挖出用户贴过的附件路径。
 *
 * 这是「谁能被打开」的第三种依据，也是最可靠的一种：
 * 前两种是「在工作目录内」和「用户刚在文件选择框里选过」——都易失
 * （换个工作目录、重启一次桥接就没了），而**转录里的事实是稳定的**：
 * 用户确实把 `C:\...\报告.docx` 贴进过这个对话，他想点开它就再自然不过。
 */

/** 附件行的前缀。必须与前端 `src/utils/attachments.ts` 里的同名常量一致。 */
export const ATTACHMENT_PREFIX = '[附件] ';

/** 从一段消息文本里取回附件路径 */
export function attachmentPathsInText(text: string): string[] {
  const paths: string[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(ATTACHMENT_PREFIX)) continue;

    const value = trimmed.slice(ATTACHMENT_PREFIX.length).trim();
    if (value) paths.push(value);
  }

  return paths;
}

/**
 * 从 `get_messages` 的回包里挖出所有附件路径。
 *
 * **只看用户消息**：助理的输出可能被文件内容里的提示注入影响，用户消息不会。
 */
export function attachmentPathsInMessages(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];

  const found = new Set<string>();

  for (const entry of messages) {
    if (!entry || typeof entry !== 'object') continue;

    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== 'user') continue;

    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map(block =>
                block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
                  ? (block as { text: string }).text
                  : ''
              )
              .join('\n')
          : '';

    for (const path of attachmentPathsInText(text)) found.add(path);
  }

  return [...found];
}
