/** 这些元素上的点击不算「点空白处」，收起侧栏会打断用户正在做的事 */
const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, summary, [role="button"], [contenteditable="true"]';

/**
 * 对话框区域的这次点击是否应该收起侧栏。
 *
 * 两种情况要放过：
 *  - 点在交互元素上（展开/折叠、代码复制、链接、按钮等）；
 *  - 用户刚用拖拽选中了文字——那也会触发 click，别把它当成「点空白」。
 */
export function isSidebarDismissClick(
  target: EventTarget | null,
  selectionIsCollapsed: boolean
): boolean {
  if (!selectionIsCollapsed) return false;
  // 拿不到具体元素（例如点在文本节点之外）时按空白处理
  if (!(target instanceof Element)) return true;
  return target.closest(INTERACTIVE_SELECTOR) === null;
}
