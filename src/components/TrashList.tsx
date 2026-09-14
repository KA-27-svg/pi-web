import { useState } from 'react';
import type { TrashedSession } from '../types/pi';
import { RotateCcw } from 'lucide-react';
import { projectName, remainingDays } from '../utils/format';

interface TrashListProps {
  items: TrashedSession[];
  onRestore: (path: string) => void;
  onPurge: (path: string) => void;
  onEmpty: () => void;
}

/**
 * 回收箱视图。彻底删除和清空都不可逆，所以这两个动作保留二次确认，
 * 而「移入回收箱」是一次点击 + 撤销。
 */
export function TrashList({ items, onRestore, onPurge, onEmpty }: TrashListProps) {
  const [confirmingPurge, setConfirmingPurge] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);

  if (items.length === 0) {
    return (
      <p className="px-2 py-3 text-[12px] leading-[1.7] text-muted">
        回收箱是空的。
        <br />
        删除的对话会在这里保留 30 天。
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-0.5">
        {items.map(item => {
          const title = item.name || item.preview || '未命名对话';
          const project = projectName(item.cwd);
          const confirming = confirmingPurge === item.path;

          return (
            <li key={item.path} className="rounded-md px-2.5 py-2 hover:bg-surface">
              <div className="truncate text-[13.5px] text-foreground/85" title={title}>
                {title}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span>{remainingDays(item.expiresAt)} 天后清除</span>
                {project && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{project}</span>
                  </>
                )}
              </div>

              <div className="mt-1.5 flex items-center gap-2 text-[12.5px]">
                <button
                  onClick={() => onRestore(item.path)}
                  className="flex items-center gap-1 text-muted transition-colors hover:text-foreground"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  恢复
                </button>

                {confirming ? (
                  <>
                    <button
                      onClick={() => {
                        setConfirmingPurge(null);
                        onPurge(item.path);
                      }}
                      className="text-rose-500 transition-opacity hover:opacity-80"
                    >
                      确认彻底删除
                    </button>
                    <button
                      onClick={() => setConfirmingPurge(null)}
                      className="text-muted transition-colors hover:text-foreground"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmingPurge(item.path)}
                    className="text-muted transition-colors hover:text-rose-500"
                  >
                    彻底删除
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 border-t border-border px-2.5 pt-2.5 pb-1">
        {confirmingEmpty ? (
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="flex-1 text-muted">清空后无法找回</span>
            <button
              onClick={() => {
                setConfirmingEmpty(false);
                onEmpty();
              }}
              className="text-rose-500 transition-opacity hover:opacity-80"
            >
              确认清空
            </button>
            <button
              onClick={() => setConfirmingEmpty(false)}
              className="text-muted transition-colors hover:text-foreground"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingEmpty(true)}
            className="text-[12.5px] text-muted transition-colors hover:text-foreground"
          >
            清空回收箱
          </button>
        )}
      </div>
    </>
  );
}
