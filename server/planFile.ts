import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 顾问的结论落成文件时放这儿（相对工作目录）。
 * 用正斜杠：这个路径要写进投递给执行窗口的消息里，Windows 的反斜杠在 markdown 里
 * 会变成转义字符。
 */
export const PLAN_DIR = 'docs/plans';

/** 计划文件的时间戳：`20250901-1430`。用本地时间，跟用户看到的一致 */
export function stamp(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

/**
 * 标题 → 文件名片段。
 *
 * 只留字母数字（含中文，`\p{L}` 覆盖），其它一律变连字符：这样不可能出现
 * 路径分隔符、不可能出现 `.`、也就不可能拼出 `..`。全被滤掉时退回 `plan`。
 */
export function slugify(title: string): string {
  const cleaned = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return cleaned || 'plan';
}

/** 从正文里取一个标题：优先第一个 markdown 标题，否则第一行 */
export function planTitle(text: string): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading?.[1]) return heading[1].trim();
  }
  return (lines[0] ?? '').replace(/^[-*>]\s*/, '').slice(0, 60);
}

/**
 * 把文件名解析成绝对路径，并**挡住越出计划目录的写法**。
 *
 * 现在的调用方只会传自己生成的文件名，但这是唯一一处「按前端给的内容新建文件」，
 * 所以守在这里而不是靠调用方自觉。
 */
export function resolvePlanPath(root: string, name: string): string {
  const base = path.resolve(root, ...PLAN_DIR.split('/'));
  const full = path.resolve(base, name);
  if (!full.startsWith(base + path.sep)) {
    throw new Error(`计划文件名越出了计划目录：${name}`);
  }
  return full;
}

/** 把顾问的结论写进 `docs/plans/`，返回可直接写进消息的相对路径 */
export async function savePlan(
  root: string,
  input: { text: string; title?: string },
  now: Date = new Date()
): Promise<{ relative: string; absolute: string }> {
  const text = input.text.trim();
  if (!text) throw new Error('计划内容为空');

  const base = path.resolve(root, ...PLAN_DIR.split('/'));
  await fs.mkdir(base, { recursive: true });

  const stem = `${stamp(now)}-${slugify(input.title ?? planTitle(text))}`;
  let name = `${stem}.md`;
  for (let i = 2; i < 100; i += 1) {
    const taken = await fs
      .stat(resolvePlanPath(root, name))
      .then(() => true)
      .catch(() => false);
    if (!taken) break;
    name = `${stem}-${i}.md`;
  }

  const absolute = resolvePlanPath(root, name);
  await fs.writeFile(absolute, text.endsWith('\n') ? text : `${text}\n`, 'utf-8');

  return { relative: `${PLAN_DIR}/${name}`, absolute };
}
