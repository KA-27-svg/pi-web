import type { HandoffMode } from '../types/pi';
import { ADVISOR_LANE } from '../services/piBridge';
import { usePiWebSocket } from '../hooks/usePiWebSocket';
import { ConversationPane } from './ConversationPane';

interface AdvisorPaneProps {
  /** 把结论交给执行窗口。由 App 用**执行窗口**那套动作实现 */
  onHandoff: (text: string, mode: HandoffMode) => Promise<string>;
}

/**
 * 顾问窗口。
 *
 * 它是一个**独立的 pi 进程**（桥接按 lane 路由）：没有工具、独立会话目录、
 * 独立人格，所以从构造上就碰不到项目，也不会污染你自己的会话列表。
 *
 * 这个组件只有在助手模式打开时才会被挂载——它就是「多一个 pi 进程」的开关，
 * 关着时不该有第二个进程常驻。
 */
export function AdvisorPane({ onHandoff }: AdvisorPaneProps) {
  const session = usePiWebSocket({ lane: ADVISOR_LANE });
  const models = session.status.availableModels ?? [];
  const current = session.status.model;
  // 换过模型但列表里没有（比如列表还没刷新）时，把当前模型补进去，
  // 否则 select 的 value 对不上任何 option，浏览器会把第一项显示成选中
  const options = current && !models.some(model => model.id === current.id) ? [current, ...models] : models;

  return (
    <ConversationPane
      session={session}
      scrollId="advisor-scroll"
      // 顾问窗口不要开场形变：它一出现就该是个普通输入框
      animateOpening={false}
      onHandoff={onHandoff}
      toolbar={
        <div className="flex items-center gap-2 text-[11.5px] text-muted">
          <span className="shrink-0">顾问</span>
          <select
            value={current?.id ?? ''}
            onChange={event => session.setLaneModel(event.target.value)}
            aria-label="顾问窗口用的模型"
            title="顾问可以跟执行窗口用不同的模型（只影响这个窗口，不会改全局默认）"
            className="min-w-0 max-w-[16rem] truncate rounded-full border border-border bg-surface px-2 py-0.5 text-[11.5px] text-foreground outline-none transition-colors hover:border-foreground/30"
          >
            {options.map(model => (
              <option key={model.id} value={model.id}>
                {model.name || model.id}
              </option>
            ))}
          </select>
          <span className="min-w-0 truncate">只聊，不碰项目</span>
          {/* 顾问的上下文会一直长下去，而且跟执行窗口一样是独立的一条，
              必须给一个「重新开始」的入口 */}
          <button
            onClick={() => session.newSession()}
            className="shrink-0 rounded-full px-2 py-0.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
            title="开一段新的顾问对话（现在的这段留在顾问自己的会话目录里）"
          >
            新对话
          </button>
        </div>
      }
    />
  );
}
