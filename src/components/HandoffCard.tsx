import { useState } from 'react';
import { MarkdownView } from './MarkdownView';
import type { HandoffMode } from '../types/pi';

interface HandoffCardProps {
  /** 顾问给出的结论原文（那个围栏块里的内容） */
  text: string;
  /**
   * 把结论交出去。
   * `file` = 先存成计划文件再投递（执行方用工具读全文，推理链不丢）；
   * `text` = 直接把这段文字投过去（短指令用）。
   * 返回一句给用户看的话，例如「已存为 docs/plans/xxx.md 并投递」。
   * 失败就抛错，卡片上会把原因显示出来。
   */
  onDeliver: (text: string, mode: HandoffMode) => Promise<string>;
}

/**
 * 顾问的结论卡片。
 *
 * 顾问输出里的 ```handoff 围栏块会渲染成它（见 MarkdownView），所以「把结论交给
 * 执行窗口」不用复制粘贴，也不会漏掉上下文——上面那个「为什么」是跟着一起过去的。
 */
export function HandoffCard({ text, onDeliver }: HandoffCardProps) {
  /** null = 不在编辑。不编辑时直接显示原文，这样流式期间内容会跟着长 */
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const body = draft ?? text;
  const deliver = async (mode: HandoffMode) => {
    if (busy || !body.trim()) return;

    setBusy(true);
    setError('');
    try {
      setNote(await onDeliver(body, mode));
      setDraft(null);
    } catch (err) {
      setError((err as Error)?.message || '投递失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-handoff-card
      className="my-4 rounded-xl border border-border bg-surface/60 px-3.5 py-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] tracking-wide text-muted">交给执行窗口</span>
        <button
          onClick={() => setDraft(draft === null ? text : null)}
          className="rounded-full px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          {draft === null ? '编辑' : '取消编辑'}
        </button>
      </div>

      {draft === null ? (
        // 长计划先收在卡片里，要细看就滚它自己
        <div className="max-h-72 overflow-y-auto">
          <MarkdownView content={text} />
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          rows={10}
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12.5px] leading-[1.7] text-foreground outline-none focus:border-foreground/30"
          aria-label="编辑要交给执行窗口的内容"
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void deliver('file')}
          disabled={busy || !body.trim()}
          title="存成 docs/plans/*.md，再让执行窗口按这份文件做（它会读全文）"
          className="rounded-full border border-foreground/20 bg-foreground px-3 py-1 text-[11.5px] text-background transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
        >
          {busy ? '投递中…' : '存为计划并投递'}
        </button>
        <button
          onClick={() => void deliver('text')}
          disabled={busy || !body.trim()}
          title="把这段文字原样发到执行窗口的输入框"
          className="rounded-full border border-border px-3 py-1 text-[11.5px] text-foreground transition-colors hover:border-foreground/40 disabled:cursor-default disabled:opacity-40"
        >
          直接投递
        </button>

        {note && <span className="text-[11.5px] text-muted">{note}</span>}
        {error && <span className="text-[11.5px] text-rose-500">{error}</span>}
      </div>
    </div>
  );
}
