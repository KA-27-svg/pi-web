import { createContext } from 'react';

/**
 * 「点空白」这一下是否先被别的交互占着。
 *
 * 目前唯一的占用者是侧栏：侧栏开着时，点对话区空白是「收起侧栏」。这一下不该
 * 顺带把展开的执行块也收掉——留给侧栏，执行块等下一次空白点击。
 * 默认 false（没人占着），所以不套 Provider 也能正常工作。
 */
export const ExecutionDismissContext = createContext(false);
