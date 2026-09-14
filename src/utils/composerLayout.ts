export interface ComposerLayoutInput {
  /** 已经拿到过当前会话的消息 */
  sessionReady: boolean;
  /** 还没点开过开场图标（点开或新建过就为假） */
  openingIcon: boolean;
  /** 当前确实没有对话内容，切换中不算空 */
  isEmpty: boolean;
  /** 用户主动点过输入框，此后就一直贴底 */
  composerEngaged: boolean;
}

export interface ComposerLayout {
  /** 输入栏是否呈现为开场图标态 */
  showIcon: boolean;
  /** 底部栏是否贴底；不贴底时输入栏垂直居中 */
  stickToBottom: boolean;
}

/**
 * 输入栏的两种状态。
 *
 * 关键约束：**在确知会话内容之前一律不进入空白态**（不显示开场图标、也不居中）。
 * 否则刷新一个已有对话时，会先按空白态演一遍开场形变，再把输入栏从居中滑到底部——
 * 那就是每次刷新都能看到的过渡动画。
 */
export function composerLayout({
  sessionReady,
  openingIcon,
  isEmpty,
  composerEngaged,
}: ComposerLayoutInput): ComposerLayout {
  if (!sessionReady) {
    return { showIcon: false, stickToBottom: true };
  }
  return {
    showIcon: openingIcon && isEmpty,
    stickToBottom: !isEmpty || composerEngaged,
  };
}
