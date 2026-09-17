import type { BridgeStatus } from '../types/pi';
import { Modal } from './Modal';
import { ProviderSetup } from './ProviderSetup';

interface ProviderDialogProps {
  status: BridgeStatus;
  onClose: () => void;
  onSaveProvider: (provider: string, key: string, baseUrl?: string) => void;
}

/**
 * 模型供应商。
 *
 * 以前这块在设置面板里，跟模型、思考强度、花费、环境自检挤在一个下拉里，又长又乱。
 * 挪到侧栏一个图标加几个字，点开就是这个弹窗。
 *
 * 为什么需要一个常驻入口：首次运行的向导只在「一个凭证都没有」时显示
 * （SetupWizard 里的 needsCredentials），配完第一个它就永远消失了——想再加一个
 * 供应商只能去终端改 pi 的 auth.json。
 */
export function ProviderDialog({ status, onClose, onSaveProvider }: ProviderDialogProps) {
  const configured = status.setup?.credentials.providers ?? [];
  /** 供应商 id → 显示名。预设目录由桥接下发，取不到就退回 id */
  const label = (id: string) => status.providers?.find(preset => preset.id === id)?.label ?? id;

  return (
    <Modal title="模型供应商" onClose={onClose}>
      <div className="mb-4">
        <div className="mb-1.5 text-[11px] text-muted">已经配好的</div>
        {configured.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {configured.map(id => (
              <span
                key={id}
                className="rounded bg-surface px-2 py-0.5 font-mono text-[11px] text-foreground/80"
              >
                {label(id)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-[1.7] text-muted">
            还没有配置，先添加一个才能对话。
          </p>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <div className="mb-2 text-[11px] text-muted">添加 / 更换</div>
        <ProviderSetup status={status} variant="settings" onSave={onSaveProvider} />
      </div>

      <p className="mt-3 text-[10.5px] leading-[1.6] text-muted/80">
        写进 pi 自己的 auth.json。加完在设置里选模型。
      </p>
    </Modal>
  );
}
