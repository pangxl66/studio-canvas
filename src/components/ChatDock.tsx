import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioRFNode } from '@/types/reactFlow';

const CHAT_DOCK_COLLAPSED_KEY = 'studio.chatDockCollapsed';

type QuickAction = {
  label: string;
  onClick: () => void;
};

function readChatDockCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CHAT_DOCK_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

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

function nodeKindLabel(node: StudioRFNode): string {
  if (node.type === 'department') {
    if (node.data.type === 'storyboard') return '分镜节点';
    if (node.data.type === 'prompt') return 'Prompt 节点';
    if (node.data.type === 'writing') return '编剧节点';
  }
  if (node.type === 'textNode') return '文本卡片';
  if (node.type === 'shotList') return '镜头表节点';
  if (node.type === 'promptReview') return '提示词审核节点';
  if (node.type === 'storyboardFile') return '分镜表文件';
  if (node.type === 'imageNode') return '图片表格';
  if (node.type === 'videoNode') return '视频节点';
  return node.data.label || '未知节点';
}

function isNodeAssistantSupported(node: StudioRFNode): boolean {
  return (
    node.type === 'textNode' ||
    node.type === 'shotList' ||
    (node.type === 'department' &&
      (node.data.type === 'writing' || node.data.type === 'storyboard' || node.data.type === 'prompt'))
  );
}

function countTextChars(value: unknown): number {
  if (typeof value === 'string') return value.trim().length;
  if (value == null) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function nodeStatusLabel(node: StudioRFNode): string {
  if (!isNodeAssistantSupported(node)) return '暂不支持直接改写';
  if (node.data.generation_error) return '最近生成失败';
  if (node.data.output_stale_reason) return '上游已更新';
  if (node.data.output) return '已有可修改结果';
  if (node.data.raw_text || node.data.input) return '已有原文';
  return '等待输入';
}

function selectedNodeSummary(node: StudioRFNode): string {
  if (!isNodeAssistantSupported(node)) {
    return '当前节点暂不支持由助手直接写回。请先选中文本卡片、镜头表/分镜节点或 Prompt 节点。';
  }
  if (node.data.generation_error) {
    return `最近错误：${node.data.generation_error}`;
  }
  if (node.data.output_stale_reason) {
    return `提示：${node.data.output_stale_reason}。这次修改会以当前节点可读取内容为底稿。`;
  }
  if (node.type === 'textNode') {
    const count = countTextChars(node.data.raw_text ?? node.data.input ?? '');
    return count > 0 ? `当前文本约 ${count} 字。输入要求后，我会直接改写并写回文本卡片。` : '当前文本卡片为空。你可以让我写入、扩写或润色内容。';
  }
  if (node.data.output) {
    const count = countTextChars(node.data.output);
    return `当前节点已有结果，约 ${count} 字符。输入修改要求后，我会尽量保持结构，只改必要内容。`;
  }
  if (node.data.input) {
    const count = countTextChars(node.data.input);
    return `当前节点有输入原文，约 ${count} 字。可先补充执行要求，或让我基于现有内容调整。`;
  }
  return '当前节点还没有可改写内容。你可以先补充下次执行要求，或连接上游后再修改。';
}

function buildNodeEditDraft(node: StudioRFNode): string {
  if (node.type === 'textNode') {
    return '按剧本格式润色当前文本，保留原意，加强场景、动作和情绪，不要扩写到失控。';
  }
  if (node.type === 'shotList' || (node.type === 'department' && node.data.type === 'storyboard')) {
    return '保持镜头数量和顺序不变，只修改我点名的内容：把……改成……，其它镜头不要重写。';
  }
  if (node.type === 'department' && node.data.type === 'prompt') {
    return '保持提示词结构、镜头数量和总时长不变，只调整：……';
  }
  return '只修改当前选中节点，保持未点名内容不变，具体要求是：……';
}

function buildPreserveDraft(node: StudioRFNode): string {
  if (node.type === 'shotList' || (node.type === 'department' && node.data.type === 'storyboard')) {
    return '在不改变镜头数量、镜头顺序、角色关系和连续性的前提下，精修当前镜头表，让动作逻辑更清楚。';
  }
  if (node.type === 'department' && node.data.type === 'prompt') {
    return '在不改变提示词字段结构、shotPrompts 数量、shot_id 和总时长的前提下，精修当前提示词，让画面表达更稳定。';
  }
  if (node.type === 'textNode') {
    return '保留原意和人物关系，按剧本格式精修这段文字，让画面、动作和情绪更清楚。';
  }
  return '保持当前节点结构不变，只做必要精修。';
}

export function ChatDock() {
  const { screenToFlowPosition } = useReactFlow();
  const messages = useStudioStore((s) => s.messages);
  const nodes = useStudioStore((s) => s.nodes);
  const selectedNodeId = useStudioStore((s) => s.selectedNodeId);
  const activeNodeId = useStudioStore((s) => s.activeNodeId);
  const addTextNode = useStudioStore((s) => s.addTextNode);
  const focusNode = useStudioStore((s) => s.focusNode);
  const pushMessage = useStudioStore((s) => s.pushMessage);
  const submitAssistantChat = useStudioStore((s) => s.submitAssistantChat);

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

  const onSend = useCallback(async () => {
    const raw = text.trim();
    if (!raw || isSubmitting) return;

    if (!selectedChatNodeId) {
      pushMessage({
        role: 'system',
        text: '请先在画布中选中一个要修改的节点，再输入修改要求。当前助手只负责“选中节点内容修改”。',
      });
      return;
    }

    if (selectedChatNode && !isNodeAssistantSupported(selectedChatNode)) {
      pushMessage({
        role: 'system',
        text: '当前选中的节点暂不支持直接改写。请选中文本卡片、镜头表/分镜节点或 Prompt 节点后再发送修改要求。',
        nodeId: selectedChatNode.id,
      });
      return;
    }

    setIsSubmitting(true);
    setText('');
    try {
      await submitAssistantChat(raw, centerFlow());
    } finally {
      setIsSubmitting(false);
    }
  }, [centerFlow, isSubmitting, pushMessage, selectedChatNode, selectedChatNodeId, submitAssistantChat, text]);

  const quickActions = useMemo<QuickAction[]>(() => {
    if (selectedChatNode) {
      if (!isNodeAssistantSupported(selectedChatNode)) {
        return [
          {
            label: '定位节点',
            onClick: () => focusNode(selectedChatNode.id, { openDetail: true }),
          },
          {
            label: '支持范围',
            onClick: () =>
              pushMessage({
                role: 'assistant',
                text: '当前节点暂不支持直接改写。新版节点助手优先支持：文本卡片、镜头表/分镜节点、Prompt 节点。',
                nodeId: selectedChatNode.id,
              }),
          },
        ];
      }
      return [
        {
          label: '局部修改',
          onClick: () => focusInputWithDraft(buildNodeEditDraft(selectedChatNode)),
        },
        {
          label: '保持结构精修',
          onClick: () => focusInputWithDraft(buildPreserveDraft(selectedChatNode)),
        },
        {
          label: '定位节点',
          onClick: () => focusNode(selectedChatNode.id, { openDetail: true }),
        },
      ];
    }

    return [
      {
        label: '创建文本卡片',
        onClick: () => {
          const id = addTextNode('', centerFlow());
          focusNode(id, { openDetail: true });
        },
      },
      {
        label: '使用说明',
        onClick: () =>
          pushMessage({
            role: 'assistant',
            text: '先选中一个节点，再输入修改要求。我会调用 LLM 读取当前节点内容，并把修改后的结果写回该节点。当前优先支持文本卡片、镜头表/分镜节点、Prompt 节点。',
          }),
      },
    ];
  }, [addTextNode, centerFlow, focusInputWithDraft, focusNode, pushMessage, selectedChatNode]);

  const assistantTitle = selectedChatNode ? `节点修改助手 · ${selectedChatNode.data.label}` : '节点修改助手';
  const assistantHint = selectedChatNode
    ? isNodeAssistantSupported(selectedChatNode)
      ? `当前选中：${nodeKindLabel(selectedChatNode)}。输入修改要求后，我只处理这个节点。`
      : `当前选中：${nodeKindLabel(selectedChatNode)}。这个节点暂不支持直接改写。`
    : '先在画布中选中一个节点，再告诉我怎么改。这里不再做复杂流程导演，只负责节点内容修改。';
  const collapsedTitle = '节点助手';

  if (collapsed) {
    return (
      <div className="chat-dock-rail nowheel nopan">
        <button
          type="button"
          className="chat-dock-rail__toggle"
          onClick={() => setCollapsed(false)}
          title="展开节点助手"
          aria-label="展开节点助手"
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
            title="收起节点助手"
            aria-label="收起节点助手"
          >
            收起
          </button>
        </div>
        <div className="chat-dock__assistant-hint">{assistantHint}</div>
        <div className="chat-dock__agent-card">
          <div className="chat-dock__agent-meta">
            <span className="chat-dock__agent-badge">
              {selectedChatNode ? nodeKindLabel(selectedChatNode) : '未选中节点'}
            </span>
            <span className="chat-dock__agent-route">
              {selectedChatNode ? nodeStatusLabel(selectedChatNode) : '等待选择'}
            </span>
          </div>
          <div className="chat-dock__agent-status">
            {selectedChatNode
              ? selectedNodeSummary(selectedChatNode)
              : '这个新版助手会更安静：不抢流程、不乱建节点。你选中哪个节点，我就只帮你改哪个节点。'}
          </div>
        </div>
      </div>

      <div className="chat-dock__messages" ref={listRef}>
        {sorted.length === 0 ? (
          <div className="chat-dock__empty">
            <div className="chat-dock__empty-title">
              {selectedChatNode ? '可以开始修改当前节点' : '请先选中一个节点'}
            </div>
            <p className="chat-dock__empty-text">
              {selectedChatNode
                ? '例如：把第 3 镜里的毒雾改成红雾，保持镜头数不变；或让 Prompt 节点保持结构，只加强灯光和镜头运动。'
                : '支持文本卡片、镜头表/分镜节点、Prompt 节点。选中后输入要求，助手会调用 LLM 改写并写回节点。'}
            </p>
            <div className="chat-dock__empty-actions">
              <button
                type="button"
                className="chat-dock__suggestion"
                onClick={() =>
                  selectedChatNode
                    ? focusInputWithDraft(buildNodeEditDraft(selectedChatNode))
                    : pushMessage({
                        role: 'assistant',
                        text: '先点一下画布上的目标节点。选中后，这里会显示节点类型和状态，再输入修改要求即可。',
                      })
                }
              >
                {selectedChatNode ? '填入局部修改模板' : '怎么使用'}
              </button>
              <button
                type="button"
                className="chat-dock__suggestion"
                onClick={() =>
                  selectedChatNode
                    ? focusInputWithDraft(buildPreserveDraft(selectedChatNode))
                    : (() => {
                        const id = addTextNode('', centerFlow());
                        focusNode(id, { openDetail: true });
                      })()
                }
              >
                {selectedChatNode ? '填入结构精修模板' : '新建文本卡片'}
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
              ? isNodeAssistantSupported(selectedChatNode)
                ? `修改「${selectedChatNode.data.label}」：例如把毒雾改成红雾，保持其它不变`
                : '当前节点暂不支持直接改写，请换选文本卡片、镜头表或 Prompt 节点'
              : '请先选中节点，再输入修改要求'
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
          {isSubmitting ? '修改中...' : '发送'}
        </button>
      </div>

      <div className="chat-dock__helper">
        回车发送，Shift + 回车换行。助手只修改当前选中节点；没有选中节点时不会调用 LLM。
      </div>
    </div>
  );
}
