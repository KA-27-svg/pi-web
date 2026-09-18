import type { ApiProbeResult } from '../types/pi';
import type { PiBridge } from './piBridge';

/**
 * 首次运行向导相关的桥接调用。
 *
 * 安装 pi 与写模型配置在同一支线上（后续切片补充），与另外三个领域动作模块
 * （对话 / 会话 / 附件）同构。
 */
export function createSetupActions({ request, sendCommand }: PiBridge) {
  const requestSetupStatus = () => sendCommand({ type: 'get_setup_status' });

  /**
   * 让桥接代跑官方安装器。
   * 输出与结果都由桥接广播回来，所以这里只负责发起。
   */
  const installPi = () => sendCommand({ type: 'install_pi' });

  /**
   * 保存一个供应商入口。
   *
   * `baseUrl` 的语义：填了它就保存成一个**独立端点**（新的供应商 id，如
   * `deepseek-relay`），自己的密钥 + 自己的地址 + 从 pi 内置目录复制的模型清单。
   * 官方条目一个字节不动。以前是写进官方那一条，结果配完中转官方入口就没了。
   */
  const saveProviderKey = (
    provider: string,
    key: string,
    baseUrl?: string,
    name?: string
  ) =>
    sendCommand({
      type: 'save_provider_key',
      provider,
      key,
      ...(baseUrl ? { baseUrl, newEndpoint: true } : {}),
      // 名字总是发：空字符串 = 请把已有那个清掉、退回官方名字
      name: name ?? '',
    });

  /**
   * 删掉一个已配供应商的凭证（写 auth.json）。
   * 结果由桥接广播回来（provider_deleted → setup_status）。
   */
  const deleteProvider = (provider: string) =>
    sendCommand({ type: 'delete_provider', provider });

  /**
   * 上游 API 探针：带密钥请求上游的模型列表，验地址 / 密钥 / 模型是否存在。
   * 必须拿回结果，所以走 request。
   */
  const probeApi = (input: {
    provider: string;
    modelId: string;
    baseUrl: string;
    api?: string;
  }) =>
    request<{ result?: ApiProbeResult }>('probe_api', input).then(
      response => response.result ?? { ok: false, keyUsed: false, error: '没有拿到结果' }
    );

  return {
    requestSetupStatus,
    installPi,
    saveProviderKey,
    deleteProvider,
    probeApi,
  };
}
