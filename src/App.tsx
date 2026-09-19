import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePiWebSocket } from './hooks/usePiWebSocket';
import { useAssistantMode } from './hooks/useAssistantMode';
import type { ApiProbeResult } from './types/pi';
import { AssistantLayout } from './components/AssistantLayout';
import { AdvisorPane } from './components/AdvisorPane';
import { ConversationPane } from './components/ConversationPane';
import { createHandoffDelivery } from './services/piHandoffActions';
import { SettingsPanel } from './components/SettingsPanel';
import { SetupWizard } from './components/SetupWizard';
import { ProviderDialog } from './components/ProviderDialog';
import { CwdDialog } from './components/CwdDialog';
import { Sidebar } from './components/Sidebar';
import { Settings, PanelLeftOpen, Columns2 } from 'lucide-react';

/** 与 Tailwind 的 sm 断点一致：窄屏时侧栏是覆盖层，而不是并排的一栏 */
const NARROW_VIEWPORT = '(max-width: 640px)';
const isOverlaySidebar = () => window.matchMedia(NARROW_VIEWPORT).matches;

export default function App() {
  /**
   * 执行窗口的那条连接。对话区整块在 ConversationPane 里，
   * 这里只留外壳（侧栏 / 设置 / 向导 / 提示）。
   */
  const session = usePiWebSocket();
  const { status, switchSession, switchAdvisorSession, renameSession, deleteSession, requestSessions, requestTrash, restoreSession, purgeSession, emptyTrash, newSession, setModel, setThinkingLevel, compactContext, requestStats, requestSetupStatus, installPi, saveProviderKey, probeEndpointModels, deleteProvider, probeApi, sendPrompt, savePlanFile } =
    session;

  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 侧栏那两个弹窗。同时只开一个，所以用一个 state 而不是两个 boolean */
  const [dialog, setDialog] = useState<'provider' | 'cwd' | null>(null);
  /** 一次性提示（配好了、切会话失败之类）。自己会淡掉 */
  const [toast, setToast] = useState<string>();
  /** 助手模式的开关与分栏比例（存 localStorage） */
  const { enabled: assistantMode, toggle: toggleAssistantMode, ratio, setRatio } = useAssistantMode();
  /**
   * 变一次就让执行窗口的 pane 复位（回开场图标、窗口回一页）。
   * 那些状态归 pane 所有，外壳碰不到，所以用信号通知而不是直接调它的 setter。
   */
  const [paneReset, setPaneReset] = useState(0);
  /** 顾问当前停在哪个会话（侧栏的顾问分组高亮用），由顾问窗口上报 */
  const [advisorSessionId, setAdvisorSessionId] = useState<string | undefined>(undefined);

  /**
   * 环境从「没就绪」变成「就绪」时说一声。
   * 首次运行向导配完最后一样东西就是这样：那一整页直接消失、换上对话界面，
   * 不说一句用户会愣一下。
   */
  const readyRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const ready = status.setup?.ready;
    if (ready === undefined) return;
    const was = readyRef.current;
    readyRef.current = ready;
    // 只在「刚变成就绪」时报。启动时本来就绪不该报
    if (was === false && ready) setToast('已经配置完成，可以开始项目了');
  }, [status.setup?.ready]);

  // 提示自己淡掉，不用用户去关
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 上游探针的结果放在这里而不是设置面板里：面板关了再开数字还在，
  // 只有下一次「重新检测」才会刷新。
  const [upstream, setUpstream] = useState<{
    phase: 'idle' | 'pending' | 'done';
    result?: ApiProbeResult;
  }>({ phase: 'idle' });

  const probeUpstream = useCallback(() => {
    const model = status.model;
    if (!model?.baseUrl) {
      setUpstream({ phase: 'idle' });
      return;
    }

    setUpstream({ phase: 'pending' });
    probeApi({
      provider: model.provider,
      modelId: model.id,
      baseUrl: model.baseUrl,
      api: model.api,
    })
      .then(result => setUpstream({ phase: 'done', result }))
      .catch((error: Error) =>
        setUpstream({
          phase: 'done',
          result: { ok: false, keyUsed: false, error: error.message || '检测失败' },
        })
      );
  }, [status.model, probeApi]);

  /**
   * 执行窗口是否正在生成。用 ref 而不是直接读 status：
   * deliverHandoff 会一路传到每条消息上（handoff 卡片），它的引用必须稳定，
   * 否则流式期间每次 delta 都会让整个消息列重渲染。
   */
  const streamingRef = useRef(status.isStreaming);
  useEffect(() => {
    streamingRef.current = status.isStreaming;
  }, [status.isStreaming]);

  /**
   * 把顾问的结论交给执行窗口。
   *
   * 默认先落成计划文件再投递「按 `<路径>` 执行」：执行方用工具读全文，
   * 拆成两个窗口之后最容易丢的那半（为什么）就跟着过去了。
   * 真身是个与 React 无关的纯函数（`createHandoffDelivery`），便于单测。
   */
  /* oxlint-disable react/refs */
  // oxlint 会在这里报「渲染期访问 ref」，是误报：createHandoffDelivery 只是把读 ref
  // 的函数装进返回的对象，真正读它在用户点卡片之后。
  const deliverHandoff = useMemo(
    () =>
      createHandoffDelivery({
        savePlanFile,
        sendPrompt,
        isStreaming: () => streamingRef.current,
      }),
    [savePlanFile, sendPrompt]
  );
  /* oxlint-enable react/refs */

  // 展开侧栏时刷新一次，保证顺序与最新改动一致（首次拉取在连接建立时完成）
  useEffect(() => {
    if (!sidebarOpen) return;
    requestSessions();
    // 回收箱数量显示在侧栏底部，一并拉一下
    requestTrash();
    // 助手模式开着时，侧栏里的顾问分组也一起刷
    if (assistantMode) requestSessions('advisor');
  }, [sidebarOpen, assistantMode, requestSessions, requestTrash]);

  // 打开助手模式时拉一次顾问历史，让侧栏分组有内容可看
  useEffect(() => {
    if (!assistantMode) return;
    requestSessions('advisor');
  }, [assistantMode, requestSessions]);

  const handleToggleAssistantMode = () => {
    toggleAssistantMode();
    // 关掉时顾问窗口整个卸载，它上报的「当前会话」也就不作数了
    setAdvisorSessionId(undefined);
  };

  // 打开设置面板时拉一次用量，保证花费是刚发生的（而不是上次收尾时的）
  useEffect(() => {
    if (!panelOpen) return;
    requestStats();
  }, [panelOpen, requestStats]);

  const startNewSession = () => {
    newSession();
    // 回到与首次打开一致的开场态：Pi 图标居中，等待点击展开
    setPaneReset(value => value + 1);
  };

  /**
   * 环境没就绪不进对话界面。
   * 缺 pi 时继续显示输入框，用户打完字永远等不到回复，只会以为程序坏了——
   * 不如直接把「缺什么」摆在他面前。
   */
  if (status.setup && !status.setup.ready) {
    return (
      <SetupWizard
        status={status}
        onRecheck={requestSetupStatus}
        onInstall={installPi}
        onSaveProvider={saveProviderKey}
        onProbeEndpointModels={probeEndpointModels}
      />
    );
  }

  return (
    <div className="relative flex h-screen w-full bg-background text-foreground selection:bg-foreground/10 overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        status={status}
        onToggle={() => setSidebarOpen(false)}
        onNewSession={startNewSession}
        onOpenProviders={() => setDialog('provider')}
        onOpenCwd={() => setDialog('cwd')}
        onSwitchSession={sessionPath => {
          switchSession(sessionPath);
          // 侧栏保持展开，便于继续挑别的会话；
          // 但窄屏时它是覆盖层，不收起来会挡住刚打开的对话
          if (isOverlaySidebar()) setSidebarOpen(false);
        }}
        onSwitchAdvisorSession={sessionPath => {
          // 顾问的历史在另一条 lane 上：路由由桥接按路径决定，
          // 回包也只回顾问那边，所以这里不用收起侧栏也不用进切换中
          switchAdvisorSession(sessionPath);
        }}
        onRequestAdvisorSessions={() => requestSessions('advisor')}
        advisorAvailable={assistantMode}
        advisorSessionId={advisorSessionId}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        onRefreshSessions={requestSessions}
        onRequestTrash={requestTrash}
        onRestoreSession={restoreSession}
        onPurgeSession={purgeSession}
        onEmptyTrash={emptyTrash}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* 侧栏收起时的展开入口，与右上角设置对称 */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-4 top-3 z-[110] rounded-full p-2 text-muted hover:text-foreground hover:bg-surface transition-colors duration-200"
            aria-label="展开侧栏"
            title="历史对话"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {/* 设置入口：常驻可见，不随焦点或点击位置隐藏 */}
        <button
          onClick={() => setPanelOpen(o => !o)}
          className="absolute right-4 top-3 z-[110] rounded-full p-2 text-muted hover:text-foreground hover:bg-surface transition-colors duration-200"
          aria-label="设置"
          title="设置"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* 助手模式开关：左下是执行、右下是顾问。关着时连顾问进程都不会起 */}
        <button
          onClick={handleToggleAssistantMode}
          aria-pressed={assistantMode}
          className={`absolute right-14 top-3 z-[110] rounded-full p-2 transition-colors duration-200 ${
            assistantMode
              ? 'bg-surface text-foreground'
              : 'text-muted hover:text-foreground hover:bg-surface'
          }`}
          aria-label="助手模式"
          title="助手模式：左边执行、右边顾问（只聊不碰项目）"
        >
          <Columns2 className="w-4 h-4" />
        </button>

        {panelOpen && (
          <SettingsPanel
            status={status}
            onClose={() => setPanelOpen(false)}
            onSelectModel={setModel}
            onSelectThinkingLevel={setThinkingLevel}
            onRecheckSetup={requestSetupStatus}
            onCompact={compactContext}
            upstream={upstream}
            onProbeUpstream={probeUpstream}
          />
        )}

        {dialog === 'provider' && (
          <ProviderDialog
            status={status}
            onClose={() => setDialog(null)}
            onSaveProvider={saveProviderKey}
            onProbeEndpointModels={probeEndpointModels}
            onDeleteProvider={deleteProvider}
            onSaved={() => {
              // 直接转回对话，并在上面报一声——不然用户不知道配完没、下一步干什么
              setDialog(null);
              setToast('已经配置完成，可以开始项目了');
            }}
          />
        )}

        {dialog === 'cwd' && (
          <CwdDialog cwd={status.cwd} onClose={() => setDialog(null)} onChangeCwd={session.changeCwd} />
        )}

        {/* 一次性提示。浮在对话区上方，不挡操作 */}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 top-5 z-[130] flex justify-center px-4">
            <div className="paper-in rounded-full border border-border bg-background px-4 py-2 text-[12.5px] text-foreground shadow-[0_4px_24px_-8px_rgba(0,0,0,0.2)]">
              {toast}
            </div>
          </div>
        )}

        <AssistantLayout
          enabled={assistantMode}
          ratio={ratio}
          onRatioChange={setRatio}
          main={
            <ConversationPane
              session={session}
              sidebarOpen={sidebarOpen}
              onDismissSidebar={() => setSidebarOpen(false)}
              resetSignal={paneReset}
            />
          }
          // 关闭时不挂载：顾问是一个独立 pi 进程，开关没开就不该平白多一个
          advisor={
            assistantMode ? (
              <AdvisorPane onHandoff={deliverHandoff} onSessionIdChange={setAdvisorSessionId} />
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
