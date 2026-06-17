import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getResolvedLlmGatewayConfig } from '@/config/llmSettings';
import { requestLLM } from '@/services/ModelGateway';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioRFNode } from '@/types/reactFlow';

const SCRIPT_CHAT_STORAGE_PREFIX = 'studio.scriptChatWorkspace.v1';
const MAX_CONTEXT_CHARS = 52_000;
const MAX_HISTORY_CHARS = 10_000;
const CHUNK_TARGET_CHARS = 2_800;
const CHUNK_MAX_CHARS = 4_200;

type ScriptChatRole = 'user' | 'assistant' | 'system';

type ScriptChatDocument = {
  id: string;
  name: string;
  text: string;
  createdAt: number;
};

type ScriptChatMessage = {
  id: string;
  role: ScriptChatRole;
  text: string;
  ts: number;
};

type ScriptChatState = {
  key: string;
  documents: ScriptChatDocument[];
  messages: ScriptChatMessage[];
  materialDraft: string;
};

type ScriptChunk = {
  docName: string;
  index: number;
  text: string;
  score: number;
};

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function storageKeyForProject(projectId: string | null, projectName: string): string {
  const key = projectId?.trim() || projectName?.trim() || 'local';
  return `${SCRIPT_CHAT_STORAGE_PREFIX}:${key}`;
}

function readStoredState(key: string): ScriptChatState {
  if (typeof window === 'undefined') {
    return { key, documents: [], messages: [], materialDraft: '' };
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Partial<ScriptChatState>) : null;
    const documents = Array.isArray(parsed?.documents)
      ? parsed.documents.filter(
          (item): item is ScriptChatDocument =>
            Boolean(item) &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            typeof item.text === 'string' &&
            typeof item.createdAt === 'number',
        )
      : [];
    const messages = Array.isArray(parsed?.messages)
      ? parsed.messages.filter(
          (item): item is ScriptChatMessage =>
            Boolean(item) &&
            typeof item.id === 'string' &&
            (item.role === 'user' || item.role === 'assistant' || item.role === 'system') &&
            typeof item.text === 'string' &&
            typeof item.ts === 'number',
        )
      : [];
    return {
      key,
      documents,
      messages,
      materialDraft: typeof parsed?.materialDraft === 'string' ? parsed.materialDraft : '',
    };
  } catch {
    return { key, documents: [], messages: [], materialDraft: '' };
  }
}

function persistState(state: ScriptChatState): void {
  if (typeof window === 'undefined') return;
  const payload: ScriptChatState = {
    ...state,
    materialDraft: state.materialDraft.slice(0, 20_000),
    messages: state.messages.slice(-80),
  };
  try {
    window.localStorage.setItem(state.key, JSON.stringify(payload));
  } catch {
    const compact: ScriptChatState = {
      ...payload,
      documents: payload.documents.map((doc) => ({
        ...doc,
        text: doc.text.slice(0, 120_000),
      })),
      messages: payload.messages.slice(-30),
    };
    try {
      window.localStorage.setItem(state.key, JSON.stringify(compact));
    } catch {
      // Ignore storage quota errors. The current in-memory session still works.
    }
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function compactText(value: string, max = 420): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

function extractTerms(query: string): string[] {
  const terms = new Set<string>();
  const normalized = query.toLowerCase();
  for (const match of normalized.matchAll(/[a-z0-9_#.-]{2,}/g)) {
    terms.add(match[0]);
  }
  for (const match of query.matchAll(/第?\d+[-—_一二三四五六七八九十百千万]*[集场幕镜]?/g)) {
    terms.add(match[0]);
  }
  for (const match of query.matchAll(/[\u4e00-\u9fa5]{2,12}/g)) {
    const token = match[0];
    terms.add(token);
    if (token.length > 4) {
      for (let index = 0; index <= token.length - 2; index += 2) {
        terms.add(token.slice(index, Math.min(index + 4, token.length)));
      }
    }
  }
  return [...terms].filter((term) => !/^(这个|那个|然后|帮我|请你|根据|生成|分析|修改|一下|可以|现在)$/.test(term));
}

function splitDocument(doc: ScriptChatDocument): ScriptChunk[] {
  const lines = doc.text.split('\n');
  const chunks: ScriptChunk[] = [];
  let buffer: string[] = [];
  let length = 0;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      chunks.push({
        docName: doc.name,
        index: chunks.length + 1,
        text,
        score: 0,
      });
    }
    buffer = [];
    length = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isSceneBoundary =
      /^(第?\s*\d+\s*[集场幕镜]|场次|镜头|scene\b|episode\b|INT\.|EXT\.)/i.test(trimmed) ||
      /^[-=]{3,}$/.test(trimmed);
    if (length >= CHUNK_TARGET_CHARS && isSceneBoundary) flush();
    buffer.push(line);
    length += line.length + 1;
    if (length >= CHUNK_MAX_CHARS) flush();
  }
  flush();
  return chunks;
}

function scoreChunk(chunk: ScriptChunk, terms: string[]): number {
  const haystack = `${chunk.docName}\n${chunk.text}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const normalized = term.toLowerCase();
    if (!normalized) continue;
    const occurrences = haystack.split(normalized).length - 1;
    if (occurrences > 0) {
      score += Math.min(occurrences, 6) * Math.max(2, Math.min(normalized.length, 8));
    }
  }
  return score;
}

function buildRelevantContext(documents: ScriptChatDocument[], query: string): string {
  if (!documents.length) return '当前还没有导入剧本或资料。';
  const total = documents.reduce((sum, doc) => sum + doc.text.length, 0);
  if (total <= MAX_CONTEXT_CHARS) {
    return documents.map((doc) => `【资料：${doc.name}】\n${doc.text}`).join('\n\n---\n\n');
  }

  const terms = extractTerms(query);
  const chunks = documents
    .flatMap(splitDocument)
    .map((chunk) => ({ ...chunk, score: scoreChunk(chunk, terms) }))
    .sort((a, b) => b.score - a.score);

  const picked: ScriptChunk[] = [];
  let used = 0;

  for (const chunk of chunks) {
    if (chunk.score <= 0 && picked.length > 0) continue;
    const nextLength = chunk.text.length + chunk.docName.length + 80;
    if (used + nextLength > MAX_CONTEXT_CHARS) continue;
    picked.push(chunk);
    used += nextLength;
    if (used >= MAX_CONTEXT_CHARS * 0.9) break;
  }

  if (!picked.length) {
    for (const doc of documents) {
      const head = doc.text.slice(0, 8_000);
      const tail = doc.text.length > 16_000 ? doc.text.slice(-6_000) : '';
      const text = tail ? `${head}\n\n[中段略]\n\n${tail}` : head;
      const nextLength = text.length + doc.name.length + 80;
      if (used + nextLength > MAX_CONTEXT_CHARS && picked.length > 0) break;
      picked.push({ docName: doc.name, index: 1, text, score: 0 });
      used += nextLength;
      if (used >= MAX_CONTEXT_CHARS * 0.9) break;
    }
  }

  return picked
    .map((chunk) => `【资料片段：${chunk.docName} #${chunk.index}】\n${chunk.text}`)
    .join('\n\n---\n\n');
}

function buildHistory(messages: ScriptChatMessage[]): string {
  const recent = messages.filter((message) => message.role === 'user' || message.role === 'assistant').slice(-10);
  const lines: string[] = [];
  let used = 0;
  for (const message of recent.reverse()) {
    const line = `${message.role === 'user' ? '用户' : '助手'}：${message.text}`;
    if (used + line.length > MAX_HISTORY_CHARS) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines.join('\n\n') || '暂无历史对话。';
}

function buildSystemPrompt(): string {
  return [
    '你是 Studio Canvas 内的项目级影视创作对话助手，工作方式接近 ChatGPT 官网对话，但你必须服务当前项目。',
    '用户会导入剧本、角色资料、Skill、分镜描述或创作要求。你要基于项目资料持续对话，回答用户的后续需求。',
    '',
    '工作原则：',
    '1. 优先依据项目资料，不要凭空编造剧本事实。',
    '2. 如果资料不足，明确说明缺口，并给出可继续推进的合理方案。',
    '3. 用户要分析，就输出清晰结论；用户要生成，就输出可直接使用的文本。',
    '4. 用户要角色设定、九宫格分镜、Seedance/Veo/Runway/MJ/GPT Image/Nano Banana 提示词时，按影视工业可执行标准写，不要写空泛建议。',
    '5. 多轮对话中要记住用户刚才的要求，允许承接“继续、改成竖版、保留角色不变、按上一版压缩”等指令。',
    '6. 你不能假装已经生成图片或视频；你可以生成可复制的提示词、分镜方案、节点内容或操作建议。',
    '7. 输出默认使用中文，除非用户明确要求英文。',
    '',
    '输出风格：像专业影视创作伙伴，直接、具体、可落地。不要输出 JSON，除非用户明确要求结构化 JSON。',
  ].join('\n');
}

function buildUserPrompt(params: {
  projectName: string;
  documents: ScriptChatDocument[];
  messages: ScriptChatMessage[];
  selectedNodeContext: { label: string; text: string } | null;
  userText: string;
}): string {
  const docsMeta = params.documents
    .map((doc, index) => `${index + 1}. ${doc.name}，约 ${formatCount(doc.text.length)} 字`)
    .join('\n') || '暂无资料。';
  return [
    `当前项目：${params.projectName || '未命名项目'}`,
    '',
    '【已导入资料】',
    docsMeta,
    '',
    '【与本次问题最相关的资料内容】',
    buildRelevantContext(params.documents, params.userText),
    '',
    '【最近对话】',
    buildHistory(params.messages),
    '',
    '【当前选中节点】',
    params.selectedNodeContext
      ? `节点：${params.selectedNodeContext.label}\n${params.selectedNodeContext.text.slice(0, 12_000)}`
      : '当前没有可读取的选中节点内容。',
    '',
    '【用户本次需求】',
    params.userText,
  ].join('\n');
}

function textFromNode(node: StudioRFNode): string {
  if (node.type === 'textNode') return (node.data.raw_text ?? node.data.input ?? '').trim();
  if (typeof node.data.raw_text === 'string' && node.data.raw_text.trim()) return node.data.raw_text.trim();
  if (typeof node.data.input === 'string' && node.data.input.trim()) return node.data.input.trim();
  if (node.data.output) {
    try {
      return JSON.stringify(node.data.output, null, 2);
    } catch {
      return String(node.data.output);
    }
  }
  return '';
}

export function ScriptChatWorkspace() {
  const { screenToFlowPosition } = useReactFlow();
  const currentProjectId = useStudioStore((state) => state.currentProjectId);
  const currentProjectName = useStudioStore((state) => state.currentProjectName);
  const nodes = useStudioStore((state) => state.nodes);
  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const activeNodeId = useStudioStore((state) => state.activeNodeId);
  const addTextNode = useStudioStore((state) => state.addTextNode);
  const focusNode = useStudioStore((state) => state.focusNode);
  const pushMessage = useStudioStore((state) => state.pushMessage);

  const storageKey = useMemo(
    () => storageKeyForProject(currentProjectId, currentProjectName),
    [currentProjectId, currentProjectName],
  );
  const [state, setState] = useState<ScriptChatState>(() => readStoredState(storageKey));
  const [collapsed, setCollapsed] = useState(true);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const documents = state.documents;
  const messages = state.messages;
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === (selectedNodeId ?? activeNodeId)) ?? null,
    [activeNodeId, nodes, selectedNodeId],
  );
  const totalDocumentChars = documents.reduce((sum, doc) => sum + doc.text.length, 0);
  const selectedNodeContext = useMemo(() => {
    if (!selectedNode) return null;
    const text = textFromNode(selectedNode);
    if (!text) return null;
    return {
      label: selectedNode.data.label || selectedNode.id,
      text,
    };
  }, [selectedNode]);

  useEffect(() => {
    setState(readStoredState(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (state.key !== storageKey) return;
    persistState(state);
  }, [state, storageKey]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, collapsed]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const appendMessage = useCallback((message: Omit<ScriptChatMessage, 'id' | 'ts'> & { id?: string }) => {
    const next: ScriptChatMessage = {
      id: message.id ?? uid('script_msg'),
      role: message.role,
      text: message.text,
      ts: Date.now(),
    };
    setState((prev) =>
      prev.key === storageKey
        ? {
            ...prev,
            messages: [...prev.messages, next].slice(-80),
          }
        : prev,
    );
    return next.id;
  }, [storageKey]);

  const updateMessage = useCallback((id: string, text: string, role?: ScriptChatRole) => {
    setState((prev) =>
      prev.key === storageKey
        ? {
            ...prev,
            messages: prev.messages.map((message) =>
              message.id === id ? { ...message, text, role: role ?? message.role, ts: Date.now() } : message,
            ),
          }
        : prev,
    );
  }, [storageKey]);

  const addDocument = useCallback((name: string, rawText: string) => {
    const text = normalizeText(rawText);
    if (!text) return false;
    setState((prev) =>
      prev.key === storageKey
        ? {
            ...prev,
            materialDraft: '',
            documents: [
              ...prev.documents,
              {
                id: uid('script_doc'),
                name: name.trim() || `项目资料 ${prev.documents.length + 1}`,
                text,
                createdAt: Date.now(),
              },
            ],
          }
        : prev,
    );
    return true;
  }, [storageKey]);

  const clearDocuments = useCallback(() => {
    setState((prev) =>
      prev.key === storageKey
        ? {
            ...prev,
            documents: [],
            materialDraft: '',
          }
        : prev,
    );
    appendMessage({ role: 'system', text: '已清空项目资料。' });
  }, [appendMessage, storageKey]);

  const addSelectedNodeAsDocument = useCallback(() => {
    if (!selectedNode) {
      appendMessage({ role: 'system', text: '当前没有选中节点，无法导入节点内容。' });
      return;
    }
    const text = textFromNode(selectedNode);
    if (!text) {
      appendMessage({ role: 'system', text: '当前选中节点没有可读取的文本内容。' });
      return;
    }
    addDocument(selectedNode.data.label || '画布节点资料', text);
    appendMessage({ role: 'system', text: `已导入选中节点「${selectedNode.data.label || selectedNode.id}」。` });
  }, [addDocument, appendMessage, selectedNode]);

  const onFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const unsupported: string[] = [];
    let added = 0;
    for (const file of Array.from(files)) {
      const lowerName = file.name.toLowerCase();
      const isProbablyText =
        file.type.startsWith('text/') ||
        /\.(txt|md|markdown|fountain|json|csv|tsv|srt|ass)$/i.test(lowerName);
      if (!isProbablyText) {
        unsupported.push(file.name);
        continue;
      }
      const text = await file.text();
      if (addDocument(file.name, text)) added += 1;
    }
    if (added > 0) {
      appendMessage({ role: 'system', text: `已导入 ${added} 份项目资料。` });
    }
    if (unsupported.length > 0) {
      appendMessage({
        role: 'system',
        text: `第一版暂只直接读取纯文本文件，以下文件请先转成 TXT/MD 后导入：${unsupported.join('、')}`,
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [addDocument, appendMessage]);

  const createTextNodeFromMessage = useCallback((message: ScriptChatMessage) => {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = addTextNode(message.text, position);
    focusNode(id, { openDetail: true });
    pushMessage({ role: 'system', text: '已把剧本对话结果生成文本卡片。', nodeId: id });
  }, [addTextNode, focusNode, pushMessage, screenToFlowPosition]);

  const createTextNodeFromLastAssistant = useCallback(() => {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.text.trim());
    if (!lastAssistant) {
      appendMessage({ role: 'system', text: '还没有可生成文本节点的助手回复。' });
      return;
    }
    createTextNodeFromMessage(lastAssistant);
    appendMessage({ role: 'system', text: '已按你的指令，把上一条回复生成文本节点。' });
  }, [appendMessage, createTextNodeFromMessage, messages]);

  const addLongInputAsDocument = useCallback((raw: string) => {
    const cleaned = raw.replace(/^(把|将)?(以下|这段)?(内容|资料|文本)?(作为|加入|导入|保存为)?项目?资料[:：\s]*/i, '').trim();
    const ok = addDocument(`对话资料 ${documents.length + 1}`, cleaned || raw);
    if (ok) appendMessage({ role: 'system', text: '已把这段内容加入项目资料。' });
  }, [addDocument, appendMessage, documents.length]);

  const handleLocalCommand = useCallback((raw: string): boolean => {
    const compact = raw.replace(/\s+/g, '');
    if (/(清空|清除|移除全部|删除全部).*(资料|附件|上下文)/.test(compact)) {
      clearDocuments();
      return true;
    }
    if (
      /((上一条|上一次|最近|刚才).*(生成|创建|新建|转成).*(文本节点|文本卡片|节点))|((生成|创建|新建).*(文本节点|文本卡片).*(上一条|上一次|最近|刚才))/.test(
        compact,
      )
    ) {
      createTextNodeFromLastAssistant();
      return true;
    }
    if (/^(导入|读取|加入|使用).*(选中|当前).*(节点|卡片)[。.!！]*$/.test(compact)) {
      addSelectedNodeAsDocument();
      return true;
    }
    if (raw.length > 1000 && /(作为资料|加入资料|导入资料|保存为资料|记住这段|读取这段)/.test(raw)) {
      addLongInputAsDocument(raw);
      return true;
    }
    return false;
  }, [addLongInputAsDocument, addSelectedNodeAsDocument, clearDocuments, createTextNodeFromLastAssistant]);

  const send = useCallback(async () => {
    const raw = input.trim();
    if (!raw || isRunning) return;
    setInput('');
    const shouldSummarizeUserInput =
      raw.length > 1000 && /(作为资料|加入资料|导入资料|保存为资料|记住这段|读取这段)/.test(raw);
    appendMessage({
      role: 'user',
      text: shouldSummarizeUserInput ? `把粘贴内容加入项目资料（约 ${formatCount(raw.length)} 字）。` : raw,
    });
    if (handleLocalCommand(raw)) return;

    const config = getResolvedLlmGatewayConfig();
    if (!config) {
      appendMessage({
        role: 'system',
        text: '未配置可用模型网关。请先在模型设置或服务器环境变量里配置 GPT 通道。',
      });
      return;
    }
    const pendingId = appendMessage({ role: 'assistant', text: '正在读取项目资料并调用 LLM...' });
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    try {
      const result = await requestLLM(config, {
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt({
          projectName: currentProjectName,
          documents,
          messages,
          selectedNodeContext,
          userText: raw,
        }),
        temperature: 0.28,
        jsonMode: false,
        feature: 'script-chat-workspace',
        maxOutputTokens: 7000,
        signal: controller.signal,
      });
      if (!result.ok) {
        updateMessage(pendingId, result.error.message, 'system');
        return;
      }
      updateMessage(pendingId, result.content.trim() || '模型没有返回内容。', 'assistant');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsRunning(false);
    }
  }, [appendMessage, currentProjectName, documents, handleLocalCommand, input, isRunning, messages, selectedNodeContext, updateMessage]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  if (collapsed) {
    return (
      <div className="script-chat-rail nowheel nopan">
        <button
          type="button"
          className="script-chat-rail__button"
          onClick={() => setCollapsed(false)}
          title="打开剧本对话工作区"
          aria-label="打开剧本对话工作区"
        >
          <span className="script-chat-rail__title">剧本对话</span>
          <span className="script-chat-rail__meta">{documents.length ? `${documents.length} 份资料` : 'GPT 工作区'}</span>
        </button>
      </div>
    );
  }

  return (
    <section className="script-chat nowheel nopan" aria-label="剧本对话工作区">
      <header className="script-chat__head">
        <div>
          <div className="script-chat__eyebrow">PROJECT CHAT</div>
          <h2>项目对话</h2>
        </div>
        <button type="button" className="script-chat__ghost" onClick={() => setCollapsed(true)}>
          收起
        </button>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.fountain,.json,.csv,.tsv,.srt,.ass,text/*"
        multiple
        className="script-chat__file"
        onChange={(event) => void onFilesSelected(event.target.files)}
      />

      <div className="script-chat__attachments" aria-label="项目上下文">
        {documents.length > 0 ? (
          <>
            <div className="script-chat__attachment-summary">
              已附加 {documents.length} 份资料 / {formatCount(totalDocumentChars)} 字
            </div>
            <div className="script-chat__attachment-list">
            {documents.map((doc) => (
              <div className="script-chat__attachment-chip" key={doc.id}>
                <strong>{doc.name}</strong>
                <span>{formatCount(doc.text.length)} 字 · {compactText(doc.text, 54)}</span>
              </div>
            ))}
            </div>
          </>
        ) : (
          <div className="script-chat__attachment-summary">可直接对话，也可以点 + 附加 TXT / MD 资料。</div>
        )}
        {selectedNodeContext ? (
          <div className="script-chat__context-line">
            当前选中：{selectedNodeContext.label}
          </div>
        ) : null}
        <div className="script-chat__hint-line">
          可直接说：清空资料、读取当前选中节点、把上一条生成文本节点。
        </div>
      </div>

      <div className="script-chat__messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="script-chat__empty">
            <strong>像 GPT 一样聊项目</strong>
            <p>直接输入需求即可：提取第一集场景、生成角色设定、把上一版改成竖版、继续生成下一场。</p>
          </div>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`script-chat__msg script-chat__msg--${message.role}`}>
              <pre>{message.text}</pre>
            </article>
          ))
        )}
      </div>

      <div className="script-chat__composer">
        <button
          type="button"
          className="script-chat__attach"
          onClick={() => fileInputRef.current?.click()}
          title="附加 TXT / MD 资料"
          aria-label="附加 TXT / MD 资料"
        >
          +
        </button>
        <textarea
          ref={inputRef}
          value={input}
          disabled={isRunning}
          placeholder="像 GPT 一样输入需求。也可以直接粘贴资料，或说：把上一条生成文本节点..."
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="script-chat__send" onClick={isRunning ? stop : () => void send()} disabled={!isRunning && !input.trim()}>
          {isRunning ? '停止' : '↑'}
        </button>
      </div>
    </section>
  );
}
