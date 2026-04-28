import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { routeLabel, stageLabel, type WorkflowAgentSession } from '@/services/workflowAgent';
import { useStudioStore } from '@/store/useStudioStore';

const CMD_PROMPT = /^@prompt\b\s*(.*)$/is;
const CMD_TEXT = /^@文本(?:节点)?\s*(.*)$/is;
const CHAT_DOCK_COLLAPSED_KEY = 'studio.chatDockCollapsed';

function readChatDockCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CHAT_DOCK_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

type QuickAction = {
  label: string;
  onClick: () => void;
};

function formatMsgTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

function buildAgentActions(
  session: WorkflowAgentSession | null,
  sendPreset: (text: string) => void,
): QuickAction[] {
  if (!session) {
    return [
      { label: '发小说正文', onClick: () => sendPreset('这是小说正文，请按标准流程开始。') },
      { label: '发剧本文本', onClick: () => sendPreset('这是剧本，请按标准流程往下走。') },
      { label: '快速出提示词', onClick: () => sendPreset('这是剧本，直接生成提示词，走快速模式。') },
    ];
  }

  switch (session.state) {
    case 'SCRIPT_READY':
      return [
        { label: '继续做分镜', onClick: () => sendPreset('继续') },
        { label: '重新开始', onClick: () => sendPreset('重新开始') },
      ];
    case 'STORYBOARD_GENERATED':
    case 'STORYBOARD_ADJUSTED':
      return [
        { label: '定位分镜', onClick: () => sendPreset('调整分镜') },
        { label: '确认分镜', onClick: () => sendPreset('确认分镜') },
        { label: '重新开始', onClick: () => sendPreset('重新开始') },
      ];
    case 'STORYBOARD_CONFIRMED':
      return [
        { label: '查看提示词节点', onClick: () => sendPreset('继续') },
        { label: '重新开始', onClick: () => sendPreset('重新开始') },
      ];
    case 'PROMPT_GENERATED':
      return [
        { label: '完成这一轮', onClick: () => sendPreset('完成') },
        { label: '重新开始', onClick: () => sendPreset('重新开始') },
      ];
    case 'COMPLETED':
    case 'FAILED':
      return [{ label: '重新开始', onClick: () => sendPreset('重新开始') }];
    default:
      return [{ label: '重新开始', onClick: () => sendPreset('重新开始') }];
  }
}

export function ChatDock() {
  const { screenToFlowPosition } = useReactFlow();
  const messages = useStudioStore((s) => s.messages);
  const nodes = useStudioStore((s) => s.nodes);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const activeNodeId = useStudioStore((s) => s.activeNodeId);
  const addDepartmentNode = useStudioStore((s) => s.addDepartmentNode);
  const startStoryboardPipeline = useStudioStore((s) => s.startStoryboardPipeline);
  const startPromptPipeline = useStudioStore((s) => s.startPromptPipeline);
  const addTextNode = useStudioStore((s) => s.addTextNode);
  const focusNode = useStudioStore((s) => s.focusNode);
  const pushMessage = useStudioStore((s) => s.pushMessage);
  const submitAssistantChat = useStudioStore((s) => s.submitAssistantChat);
  const submitWorkflowAgentChat = useStudioStore((s) => s.submitWorkflowAgentChat);
  const workflowAgentSession = useStudioStore((s) => s.workflowAgentSession);

  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readChatDockCollapsed());
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const centerFlow = useCallback(() => {
    return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }, [screenToFlowPosition]);

  const sorted = useMemo(() => [...messages].sort((a, b) => a.ts - b.ts), [messages]);

  const selectedChatNodeId = selectedNodeId ?? activeNodeId;
  const selectedChatNode = useMemo(
    () => nodes.find((node) => node.id === selectedChatNodeId) ?? null,
    [nodes, selectedChatNodeId],
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CHAT_DOCK_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // Ignore persistence failures.
    }
  }, [collapsed]);

  const focusInputWithDraft = useCallback((draft: string) => {
    setText(draft);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const sendPresetToAgent = useCallback(
    (draft: string) => {
      setText('');
      void submitWorkflowAgentChat(draft, centerFlow());
    },
    [centerFlow, submitWorkflowAgentChat],
  );

  const handleGlobalAgent = useCallback(
    async (raw: string) => {
      const promptCmd = CMD_PROMPT.exec(raw);
      if (promptCmd) {
        const brief = (promptCmd[1] ?? '').trim();
        if (!brief) {
          pushMessage({ role: 'system', text: '请在 `@prompt` 后补充说明。' });
          return;
        }
        const id = startPromptPipeline(brief, centerFlow());
        focusNode(id);
        return;
      }

      const textCmd = CMD_TEXT.exec(raw);
      if (textCmd) {
        const body = (textCmd[1] ?? '').trim();
        const id = addTextNode(body, centerFlow());
        focusNode(id, { openDetail: true });
        return;
      }

      await submitWorkflowAgentChat(raw, centerFlow());
    },
    [
      addTextNode,
      centerFlow,
      focusNode,
      pushMessage,
      startPromptPipeline,
      submitWorkflowAgentChat,
    ],
  );

  const onSend = useCallback(async () => {
    const raw = text.trim();
    if (!raw || isSubmitting) return;
    setIsSubmitting(true);
    setText('');
    try {
      if (selectedChatNodeId) {
        await submitAssistantChat(raw, centerFlow());
        return;
      }

      await handleGlobalAgent(raw);
    } finally {
      setIsSubmitting(false);
    }
  }, [centerFlow, handleGlobalAgent, isSubmitting, selectedChatNodeId, submitAssistantChat, text]);

  const createDepartmentNode = useCallback(
    (kind: 'writing' | 'prompt') => {
      const id = addDepartmentNode(kind, centerFlow());
      focusNode(id);
    },
    [addDepartmentNode, centerFlow, focusNode],
  );

  const quickActions = useMemo(
    () => [
      {
        label: selectedChatNode ? '给当前节点提要求' : '交给流程 Agent',
        onClick: () =>
          focusInputWithDraft(
            selectedChatNode
              ? '请基于当前选中节点做修改，例如：增加一个分镜，内容是……'
              : '把小说或剧本文本贴到这里，我来判断走哪条流程。',
          ),
      },
      {
        label: '创建编剧节点',
        onClick: () => createDepartmentNode('writing'),
      },
      {
        label: '创建文本卡片',
        onClick: () => {
          const id = addTextNode('', centerFlow());
          focusNode(id, { openDetail: true });
        },
      },
      {
        label: '创建分镜节点',
        onClick: () => {
          const id = startStoryboardPipeline(centerFlow());
          focusNode(id);
        },
      },
      {
        label: '创建 Prompt 节点',
        onClick: () => createDepartmentNode('prompt'),
      },
    ],
    [
      addTextNode,
      centerFlow,
      createDepartmentNode,
      focusInputWithDraft,
      focusNode,
      selectedChatNode,
      startStoryboardPipeline,
    ],
  );

  const agentActions = useMemo(
    () => buildAgentActions(workflowAgentSession, sendPresetToAgent),
    [sendPresetToAgent, workflowAgentSession],
  );

  const assistantTitle = selectedChatNode
    ? `节点助手 · ${selectedChatNode.data.label}`
    : workflowAgentSession
      ? `流程 Agent · ${stageLabel(workflowAgentSession.state)}`
      : '流程 Agent 待命中';

  const assistantHint = selectedChatNode
    ? '选中节点后，这里负责节点级改稿、补要求和记偏好。'
    : workflowAgentSession
      ? `当前路线：${routeLabel(workflowAgentSession.route)}`
      : '未选中节点时，这里会作为全局流程 Agent：识别小说/剧本输入，自动推进剧本、分镜和提示词阶段。';

  const agentStatusText = workflowAgentSession
    ? workflowAgentSession.lastAssistantMessage
    : '把故事正文、剧本文本或一句“这是小说/这是剧本”发给我，我会先判断路线，再替你起流程。';

  const collapsedTitle = selectedChatNode ? '节点助手' : '流程 Agent';

  if (collapsed) {
    return (
      <div className="chat-dock-rail nowheel nopan">
        <button
          type="button"
          className="chat-dock-rail__toggle"
          onClick={() => setCollapsed(false)}
          title="展开左侧助手"
          aria-label="展开左侧助手"
        >
          <span className="chat-dock-rail__icon" aria-hidden>
            ❯
          </span>
          <span className="chat-dock-rail__label">{collapsedTitle}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="chat-dock nowheel nopan">
      <div className="chat-dock__assistant-bar">
        <div className="chat-dock__assistant-head">
          <div className="chat-dock__assistant-title">{assistantTitle}</div>
          <button
            type="button"
            className="chat-dock__collapse-btn"
            onClick={() => setCollapsed(true)}
            title="收起左侧助手"
            aria-label="收起左侧助手"
          >
            收起
          </button>
        </div>
        <div className="chat-dock__assistant-hint">{assistantHint}</div>
        {!selectedChatNode ? (
          <div className="chat-dock__agent-card">
            <div className="chat-dock__agent-meta">
              <span className="chat-dock__agent-badge">
                {workflowAgentSession ? stageLabel(workflowAgentSession.state) : '待启动'}
              </span>
              {workflowAgentSession ? (
                <span className="chat-dock__agent-route">{routeLabel(workflowAgentSession.route)}</span>
              ) : null}
            </div>
            <div className="chat-dock__agent-status">{agentStatusText}</div>
            <div className="chat-dock__agent-actions">
              {agentActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="chat-dock__agent-action"
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="chat-dock__messages" ref={listRef}>
        {sorted.length === 0 ? (
          <div className="chat-dock__empty">
            <div className="chat-dock__empty-title">
              {selectedChatNode ? '当前是节点助手模式' : '当前是流程 Agent 模式'}
            </div>
            <p className="chat-dock__empty-text">
              {selectedChatNode
                ? '你可以直接针对当前节点提修改意见，比如增加分镜、改提示词、补充下次执行要求。'
                : '直接贴小说或剧本文本即可。Agent 会识别输入类型，选择“小说 -> 剧本 -> 分镜 -> 提示词”或“剧本 -> 分镜 -> 提示词/快速提示词”的路线。'}
            </p>
            <div className="chat-dock__empty-actions">
              <button
                type="button"
                className="chat-dock__suggestion"
                onClick={() =>
                  focusInputWithDraft(
                    selectedChatNode
                      ? '增加一个分镜，内容是罗幽兰从屏风后探头，看见黑影背起包袱。'
                      : '这是剧本，请按标准流程往下走。\n△屋内，月光从窗棂斜落……',
                  )
                }
              >
                {selectedChatNode ? '试一个节点修改' : '试一次流程启动'}
              </button>
              <button
                type="button"
                className="chat-dock__suggestion"
                onClick={() =>
                  focusInputWithDraft(
                    selectedChatNode
                      ? '以后这个节点默认更电影感一些，少一点平均分配。'
                      : '这是剧本，直接生成提示词，走快速模式。',
                  )
                }
              >
                {selectedChatNode ? '试一个长期偏好' : '试一次快速模式'}
              </button>
            </div>
          </div>
        ) : (
          sorted.map((message) => {
            const clickable = Boolean(message.nodeId);
            return (
              <button
                key={message.id}
                type="button"
                className={`chat-dock__msg chat-dock__msg--${message.role}`}
                onClick={() => {
                  if (message.nodeId) focusNode(message.nodeId);
                }}
                disabled={!clickable}
                title={clickable ? '点击定位并选中画布节点' : undefined}
                aria-label={clickable ? `${message.text}（点击定位节点）` : message.text}
              >
                <span className="chat-dock__msg-text">{message.text}</span>
                <span className="chat-dock__msg-meta">
                  <time dateTime={new Date(message.ts).toISOString()}>{formatMsgTime(message.ts)}</time>
                  {clickable ? <span className="chat-dock__msg-locate"> 定位</span> : null}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="chat-dock__quick-actions" aria-label="快捷操作">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="chat-dock__quick-action"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="chat-dock__input-row">
        <textarea
          ref={inputRef}
          className="chat-dock__input"
          rows={1}
          placeholder={
            selectedChatNode
              ? `针对「${selectedChatNode.data.label}」提修改意见或补充要求`
              : '贴小说或剧本文本，或继续告诉 Agent “确认分镜”“继续”“重新开始”'
          }
          value={text}
          disabled={isSubmitting}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void onSend();
            }
          }}
        />
        <button type="button" className="chat-dock__send" onClick={() => void onSend()} disabled={isSubmitting}>
          {isSubmitting ? '执行中...' : '发送'}
        </button>
      </div>

      <div className="chat-dock__helper">
        回车发送，Shift + 回车换行。未选中节点时走流程 Agent，选中节点后走节点助手。
      </div>
    </div>
  );
}
