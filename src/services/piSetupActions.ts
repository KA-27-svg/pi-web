import type { CustomProviderDraft } from '../types/pi';
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
   * 保存供应商凭证。
   * 走 sendCommand 而不是 request：结果由桥接以 provider_saved 事件广播，
   * 成功与失败都经过同一条路径，界面不必多一套状态。
   */
  const saveProviderKey = (provider: string, key: string) =>
    sendCommand({ type: 'save_provider_key', provider, key });

  /**
   * 拉自定义端点的模型列表。
   * 这个必须拿回结果，所以走 request；失败会以 Promise 拒绝的形式抛回来，
   * 由表单显示原因并退回手填。
   */
  const listProviderModels = (baseUrl: string, key: string) =>
    request<{ models?: string[] }>('list_provider_models', { baseUrl, key }).then(
      response => response.models ?? []
    );

  const saveCustomProvider = (draft: CustomProviderDraft) =>
    // 草稿里的 id 映射成 providerId：`id` 这条指令里是请求配对用的，不能占用
    sendCommand({
      type: 'save_custom_provider',
      providerId: draft.id,
      label: draft.label,
      baseUrl: draft.baseUrl,
      api: draft.api,
      models: draft.models,
      key: draft.key,
    });

  return { requestSetupStatus, installPi, saveProviderKey, listProviderModels, saveCustomProvider };
}
