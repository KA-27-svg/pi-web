/**
 * 从 API 地址的域名推一个供应商标识。
 *
 * 标识是 `models.json` / `auth.json` 里的键，也是 pi 报错时显示的供应商名，所以
 * **必须是 ASCII**（桥接那边限成 `^[A-Za-z0-9][A-Za-z0-9._-]*$`）。显示名多半是中文，
 * 推不出可用的标识，只能从域名来。
 *
 * 单独放在 utils 而不是跟组件放一起：组件文件里导出非组件会让 fast refresh 失效。
 */
export function deriveProviderId(baseUrl: string): string {
  try {
    const host = new URL(baseUrl.trim()).hostname;
    const slug = host
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .replace(/^[^A-Za-z0-9]+/, '');
    return slug || 'relay';
  } catch {
    // 地址还没填完、或者根本不是 URL
    return 'relay';
  }
}
