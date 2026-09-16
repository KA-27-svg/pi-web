import type { PiBridge } from './piBridge';

/**
 * 首次运行向导相关的桥接调用。
 *
 * 安装 pi 与写模型配置在同一支线上（后续切片补充），与另外三个领域动作模块
 * （对话 / 会话 / 附件）同构。
 */
export function createSetupActions({ sendCommand }: PiBridge) {
  const requestSetupStatus = () => sendCommand({ type: 'get_setup_status' });

  /**
   * 让桥接代跑官方安装器。
   * 输出与结果都由桥接广播回来，所以这里只负责发起。
   */
  const installPi = () => sendCommand({ type: 'install_pi' });

  return { requestSetupStatus, installPi };
}
