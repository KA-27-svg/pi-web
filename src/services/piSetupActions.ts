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

  /**
   * `baseUrl` 只在走中转站时给——给了它就仍然用 pi 内置的模型清单，
   * 只是把请求发到那个地址（pi 的凭证解析认这个字段）。
   */
  const saveProviderKey = (provider: string, key: string, baseUrl?: string, name?: string) =>
    sendCommand({
      type: 'save_provider_key',
      provider,
      key,
      ...(baseUrl ? { baseUrl } : {}),
      // 名字总是发：空字符串 = 请把已有那个清掉、退回官方名字
      name: name ?? '',
    });

  return { requestSetupStatus, installPi, saveProviderKey };
}
