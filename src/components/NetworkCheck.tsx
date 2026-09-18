import { useState } from 'react';
import type { ConnectivityResult } from '../types/pi';
import { RefreshCw } from 'lucide-react';

export interface NetworkCheckTarget {
  id: string;
  label: string;
  url: string;
}

interface NetworkCheckProps {
  targets: NetworkCheckTarget[];
  /** 交给桥接在 Node 里发请求（浏览器直连会被 CORS 挡住） */
  onCheck: (targets: { id: string; url: string }[]) => Promise<ConnectivityResult[]>;
}

/**
 * 网络连通性。环境自检那一堆只看本机，真正对话 / 安装都还要联网，
 * 出问题时「本机都对、就是没回话」最常见的原因就在这儿。
 */
export function NetworkCheck({ targets, onCheck }: NetworkCheckProps) {
  const [phase, setPhase] = useState<'idle' | 'pending' | 'done'>('idle');
  const [results, setResults] = useState<ConnectivityResult[]>([]);

  const run = () => {
    setPhase('pending');
    onCheck(targets.map(({ id, url }) => ({ id, url })))
      .then(next => {
        setResults(next);
        setPhase('done');
      })
      .catch((error: Error) => {
        setResults(
          targets.map(target => ({
            id: target.id,
            url: target.url,
            ok: false,
            error: error.message || '检测失败',
          }))
        );
        setPhase('done');
      });
  };

  return (
    <div className="mt-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">网络</span>
        <button
          onClick={run}
          disabled={phase === 'pending'}
          className="flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-foreground disabled:cursor-default"
        >
          <RefreshCw className={`w-3 h-3 ${phase === 'pending' ? 'animate-spin' : ''}`} />
          {phase === 'pending' ? '检测中…' : phase === 'done' ? '重新检测' : '测试网络'}
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map(result => {
            const target = targets.find(item => item.id === result.id);
            return (
              <div
                key={result.id}
                className="flex items-baseline justify-between gap-3 text-[11px]"
              >
                <span className="shrink-0 text-muted">{target?.label ?? result.id}</span>
                <span
                  className={`min-w-0 truncate ${result.ok ? 'text-emerald-600' : 'text-rose-500'}`}
                  title={result.url}
                >
                  {result.ok ? `通（HTTP ${result.status}）` : `不通：${result.error}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
