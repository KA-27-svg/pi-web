/**
 * 会话的**全量**历史。
 *
 * pi 的 `get_messages` 给的是「模型当前上下文」——自动压缩之后，压缩掉的那段
 * 就整个消失了：界面上只剩摘要之后的三两条，右侧轨道也跟着只剩一根线。
 * 会话文件本身是只增不减的，压缩只是往上下文里塞一条摘要，所以回看要用文件。
 *
 * 走 `get_entries`（pi 的会话条目）而不是自己读文件：分支归属、条目顺序都由
 * pi 说了算，桥接不用再复刻一遍它的树逻辑。
 */

export interface SessionEntry {
  type?: string;
  id?: string;
  parentId?: string | null;
  /** type === 'message' 时是 pi 的消息对象 */
  message?: any;
  /** type === 'compaction' */
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  timestamp?: string | number;
}

/** 压缩摘要：前端把它渲染成一条「上下文已压缩」的分隔，不是真的对话消息 */
export interface CompactionSummary {
  role: 'compactionSummary';
  summary: string;
  tokensBefore?: number;
  timestamp: number;
}

/**
 * 当前分支上的条目（时间顺序）。
 *
 * 会话是一棵树，`get_entries` 会把被抛弃的分叉也一起给回来。认不出叶子
 * （pi 版本不同 / 会话刚被清空）时原样返回：宁多勿少，少一条消息比多一条严重。
 */
export function branchEntries(entries: SessionEntry[], leafId?: string): SessionEntry[] {
  if (!leafId) return entries;

  const byId = new Map(entries.map(entry => [entry.id ?? '', entry]));
  if (!byId.has(leafId)) return entries;

  const chain: SessionEntry[] = [];
  let current: SessionEntry | undefined = byId.get(leafId);
  while (current) {
    chain.push(current);
    const parentId: string | null | undefined = current.parentId;
    current = parentId ? byId.get(parentId) : undefined;
  }

  return chain.reverse();
}

const stampOf = (entry: SessionEntry): number => {
  if (typeof entry.timestamp === 'number') return entry.timestamp;
  if (typeof entry.timestamp === 'string') return Date.parse(entry.timestamp) || 0;
  return 0;
};

const markerOf = (entry: SessionEntry): CompactionSummary => ({
  role: 'compactionSummary',
  summary: entry.summary ?? '',
  tokensBefore: entry.tokensBefore,
  timestamp: stampOf(entry),
});

/** 同一条消息的两份拷贝：文件里那份和内存里那份，靠角色 + 时间戳认 */
const sameMessage = (a: any, b: any): boolean =>
  !!a && !!b && a.role === b.role && (a.timestamp ?? 0) === (b.timestamp ?? 0);

/**
 * 当前分支 → 前端认的消息数组。
 *
 * 压缩摘要要落在**它保留的第一条之前**（那才是分界），而不是文件里 compaction
 * 那条的位置——文件是追加写的，压缩记录永远排在它压缩的那些消息后面。
 *
 * `liveTail` 是 pi 当前上下文：流式生成中的那条在开始时就被推进了上下文，但
 * 还没落进会话文件。只在它跟历史末尾不是同一条时才补上（否则就是重开页面时
 * 多出来一条重复的）。
 */
export function historyMessages(
  entries: SessionEntry[],
  leafId?: string,
  liveTail?: any[]
): any[] {
  const branch = branchEntries(entries, leafId);

  const atBoundary = new Map<string, SessionEntry[]>();
  for (const entry of branch) {
    if (entry.type !== 'compaction') continue;
    const boundary = entry.firstKeptEntryId;
    if (!boundary) continue;
    atBoundary.set(boundary, [...(atBoundary.get(boundary) ?? []), entry]);
  }

  const messages: any[] = [];
  const placed = new Set<SessionEntry>();
  for (const entry of branch) {
    // compaction 条目本身的位置在末尾，靠下面的边界插进去
    if (entry.type === 'compaction') continue;

    const boundary = entry.id ? atBoundary.get(entry.id) : undefined;
    if (boundary) {
      for (const entry2 of boundary) {
        messages.push(markerOf(entry2));
        placed.add(entry2);
      }
    }

    if (entry.type === 'message' && entry.message) messages.push(entry.message);
  }

  // 边界条目不在当前分支上（被后来的压缩吃掉 / 分叉）：至少别把摘要弄丢
  for (const entry of branch) {
    if (entry.type === 'compaction' && !placed.has(entry)) messages.push(markerOf(entry));
  }

  const last = liveTail?.[liveTail.length - 1];
  if (last && !sameMessage(last, messages[messages.length - 1])) messages.push(last);

  return messages;
}
