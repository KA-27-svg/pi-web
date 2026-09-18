import type React from 'react';
import type { BridgeStatus, PiMessage } from '../types/pi';
import type { RpcEventHandler } from './rpcHandler';

/**
 * 不带 lane 的连接归到 main。与桥接的缺省值一致：
 * 再开的标签页仍然镜像同一个会话，这是改造前就有的语义。
 */
export const DEFAULT_LANE = 'main';

/** 顾问窗口的 lane（与桥接的 `server/advisor.ts` 一致） */
export const ADVISOR_LANE = 'advisor';

/**
 * 各个动作模块共用的「连接上下文」。
 *
 * 动作模块（发消息 / 会话 / 附件）只依赖这个接口，不直接碰 WebSocket。
 * 这样它们能各自独立读、独立想，也不会因为连接细节变了就跟着改——
 * 拆开这个 Hook 的全部意义就在这里。
 */
export interface PiBridge {
  setMessages: React.Dispatch<React.SetStateAction<PiMessage[]>>;
  setStatus: React.Dispatch<React.SetStateAction<BridgeStatus>>;
  handler: RpcEventHandler;
  /**
   * 这条连接属于哪个 lane。指令会自动带上它，动作模块一般不必自己拼，
   * 但有些操作（换顾问的模型）要先知道自己在哪一边。
   */
  lane: string;
  /** 发一条桥接指令并等回包（按 id 配对）。用于「我问桥接要一个结果」的场景 */
  request: <T>(type: string, payload?: Record<string, unknown>) => Promise<T>;
  /** 发一条不关心回包的指令 */
  sendCommand: (command: object) => void;
  /**
   * 连接是否可用。
   * 有些动作必须先确认再改本地状态（比如发消息：连接断了就不该先把气泡加进对话），
   * 所以光有 sendCommand 的静默丢弃还不够。
   */
  isOpen: () => boolean;
}
