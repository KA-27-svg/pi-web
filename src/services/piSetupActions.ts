import type { PiBridge } from './piBridge';

/**
 * 首次运行向导相关的桥接调用。
 *
 * 现在只有「重新探测环境」。安装 pi、写模型配置在后续切片里加进来，
 * 与另外三个领域动作模块（对话 / 会话 / 附件）同构。
 */
export function createSetupActions({ sendCommand }: PiBridge) {
  const requestSetupStatus = () => sendCommand({ type: 'get_setup_status' });

  return { requestSetupStatus };
}
