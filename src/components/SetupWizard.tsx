import { useEffect, useState } from 'react';
import type { BridgeStatus } from '../types/pi';
import { AlertCircle, Check, Copy, Download, RefreshCw } from 'lucide-react';

/** 自动轮询间隔：用户可能正在自己的终端里跑那条命令，页面应该自己认出来 */
const POLL_INTERVAL_MS = 5000;

/** 日志面板只显示末尾这么多行：进度看的是最新几行 */
const VISIBLE_LOG_LINES = 12;

interface SetupWizardProps {
  status: BridgeStatus;
  /** 重新探测环境 */
  onRecheck: () => void;
  /** 让桥接代跑官方安装器 */
  onInstall: () => void;
}

/**
 * 首次运行向导。
 *
 * 在此之前，环境不满足时界面照常显示输入框，用户打完字等不到任何回复，
 * 只能以为程序坏了——这是新手最难自己诊断的一步。
 *
 * 安装走 pi 的官方安装器：允许代跑时提供按钮，不允许时（例如 Node 版本不够，
 * 官方脚本在无终端下不会自己装 Node）就只把命令摆出来让人自己跑。
 * 无论哪条路，命令原文都先展示——用户有权知道要执行什么。
 */
export function SetupWizard({ status, onRecheck, onInstall }: SetupWizardProps) {
  const setup = status.setup;
  const ready = setup?.ready ?? false;
  const installing = status.installing ?? false;
  const issues = setup?.issues ?? [];
  const log = status.installLog ?? [];
  const canInstall = status.preflight?.allowed ?? false;
  const [copied, setCopied] = useState(false);

  // 未就绪且没在装时定期重探。用户在自己终端装完之后，页面不该还停在旧结论上。
  useEffect(() => {
    if (ready || installing) return;

    const timer = window.setInterval(onRecheck, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [ready, installing, onRecheck]);

  const copyCommand = () => {
    const command = status.installCommand;
    if (!command) return;

    const writing = navigator.clipboard?.writeText(command);
    if (!writing) return;

    void writing
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // 剪贴板不可用就算了，命令已经明文显示在页面上
      });
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background px-6 text-foreground overflow-y-auto">
      <div className="w-full max-w-content py-10">
        <h1 className="text-[15px] font-medium">还差一点就能开始</h1>
        <p className="mt-2 text-[13px] leading-[1.7] text-muted">
          Pi Web 只是 pi 的界面，需要本机的 pi 才能工作。下面这些还没就绪：
        </p>

        <ul className="mt-5 space-y-2.5">
          {issues.map(issue => (
            <li
              key={issue.code}
              className="flex gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="text-[12.5px] leading-[1.7]">{issue.message}</span>
            </li>
          ))}
        </ul>

        {/*
          把探测到的真实版本摊开：出问题时这几行是用户唯一能提供的信息，
          也让「明明装了却说没装」这类情况能当场看出来。
        */}
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px] text-muted">
          <div className="flex gap-1.5">
            <dt>Node</dt>
            <dd className="font-mono">
              {setup?.node.version ?? '未找到'}
              <span className="ml-1.5 text-muted/70">需要 ≥ {setup?.node.minimum}</span>
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>pi</dt>
            <dd className="font-mono">{setup?.pi.version ?? '未找到'}</dd>
          </div>
          {setup?.gitBash.required && (
            <div className="flex gap-1.5">
              <dt>Git Bash</dt>
              <dd className="font-mono">{setup.gitBash.available ? '已找到' : '未找到'}</dd>
            </div>
          )}
        </dl>

        {status.installCommand && (
          <section className="mt-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[12px] text-muted">用 pi 官方的方式安装</h2>
              <button
                onClick={copyCommand}
                className="flex items-center gap-1 text-[11.5px] text-muted transition-colors hover:text-foreground"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>

            <pre className="mt-1.5 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11.5px] text-foreground/90">
              {status.installCommand}
            </pre>

            {!canInstall && status.preflight?.reason && (
              <p className="mt-2 text-[12px] leading-[1.7] text-amber-600">
                {status.preflight.reason}
              </p>
            )}

            {canInstall && !installing && (
              <button
                onClick={onInstall}
                className="mt-3 flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[12px] text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                <Download className="h-3 w-3" />
                帮我安装 pi
              </button>
            )}

            {installing && (
              <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-2">
                <p className="text-[11px] text-muted">正在安装…</p>
                <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-[1.7] text-foreground/80">
                  {log.slice(-VISIBLE_LOG_LINES).join('\n') || '等待安装器输出…'}
                </pre>
              </div>
            )}

            {status.installError && (
              <p className="mt-2 text-[12.5px] leading-[1.7] text-rose-500">{status.installError}</p>
            )}
          </section>
        )}

        <button
          onClick={onRecheck}
          className="mt-6 flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[12px] text-foreground/90 transition-colors hover:bg-surface"
        >
          <RefreshCw className="h-3 w-3" />
          重新检测
        </button>
      </div>
    </div>
  );
}
