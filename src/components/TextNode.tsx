import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import { FLUSH_TEXT_NODE_DRAFTS_EVENT } from '@/utils/textDraftCommit';
import { useStudioGraphContentNodes } from '@/hooks/useStudioGraphContent';
import {
  DEFAULT_STORYBOARD_SKILL_ID,
  listSkillsInFolder,
  normalizeFilmStoryboardSkillId,
} from '@/services/skillLoader';
import type { StudioNodeData, TextImageTaskMode } from '@/types/studio';
import {
  collectTextNodeContextForNode,
  inferTextNodeSemanticRole,
} from '@/utils/textNodeContext';
import {
  TEXT_NODE_INPUT_HANDLE_ID,
  TEXT_NODE_OUTPUT_HANDLE_ID,
} from '@/utils/textNodeHandles';
import { recoverInterruptedTextPolish } from '@/services/textPolishLifecycle';
import { resolveImageReferenceName } from '@/utils/imageReferenceNaming';
import {
  STORYBOARD_TEXT_NORMALIZER_SKILL_NAME,
  STORYBOARD_TEXT_NORMALIZER_SKILL_VERSION,
} from '@/services/storyboardTextNormalizer';

type TextRF = Node<StudioNodeData, 'textNode'>;

function displayTextNodeLabel(label: string | undefined): string {
  if (!label) return '文本卡片';
  return label.trim() || '文本卡片';
}

function isSingleSymbol(value: string): boolean {
  return Array.from(value).length === 1 && /[^\p{L}\p{N}\s]/u.test(value);
}

function findSingleInsertion(previous: string, next: string): { inserted: string; start: number; end: number } | null {
  if (next.length <= previous.length) return null;

  let start = 0;
  while (start < previous.length && previous[start] === next[start]) start += 1;

  let previousEnd = previous.length - 1;
  let nextEnd = next.length - 1;
  while (previousEnd >= start && nextEnd >= start && previous[previousEnd] === next[nextEnd]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const inserted = next.slice(start, nextEnd + 1);
  if (Array.from(inserted).length !== 1) return null;
  return { inserted, start, end: start + inserted.length };
}

function TextNodeInner({ id, data, selected }: NodeProps<TextRF>) {
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const runTextPolish = useStudioStore((s) => s.runTextPolish);
  const stopNodeTask = useStudioStore((s) => s.stopNodeTask);
  const nodes = useStudioGraphContentNodes();
  const edges = useStudioStore((s) => s.edges);
  const imageReferences = useMemo(() => {
    const incoming = edges.filter((edge) => {
      if (edge.target !== id || (edge.targetHandle != null && edge.targetHandle !== TEXT_NODE_INPUT_HANDLE_ID)) return false;
      return nodes.find((node) => node.id === edge.source)?.type === 'imageNode';
    });
    return incoming
      .map((edge) => nodes.find((node) => node.id === edge.source))
      .filter((node): node is Node<StudioNodeData, 'imageNode'> => node != null && node.type === 'imageNode')
      .map((node) => ({
        id: node.id,
        kind: 'image' as const,
        label: resolveImageReferenceName(node.data, '图片参考'),
        src: node.data.imageDataUrl,
      }));
  }, [edges, id, nodes]);
  const videoReferences = useMemo(() => {
    const incoming = edges.filter((edge) => {
      if (edge.target !== id || (edge.targetHandle != null && edge.targetHandle !== TEXT_NODE_INPUT_HANDLE_ID)) return false;
      return nodes.find((node) => node.id === edge.source)?.type === 'videoNode';
    });
    return incoming
      .map((edge) => nodes.find((node) => node.id === edge.source))
      .filter((node): node is Node<StudioNodeData, 'videoNode'> => node != null && node.type === 'videoNode')
      .map((node) => ({
        id: node.id,
        kind: 'video' as const,
        label: node.data.videoFileName?.trim() || node.data.label?.trim() || '视频参考',
        src: node.data.videoFrameDataUrl,
      }));
  }, [edges, id, nodes]);
  const raw = data.raw_text ?? data.input ?? '';
  const [instruction, setInstruction] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState(data.label ?? '');
  const [draft, setDraft] = useState(raw);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef(raw);
  const lastLocalCommitRef = useRef(raw);
  const draftCommitTimerRef = useRef<number | null>(null);
  const lastInsertionRef = useRef<{ char: string; at: number; start: number; end: number } | null>(null);
  const busy = data.status === 'IN_PROGRESS';
  const displayText = busy ? (data.streaming_preview ?? raw) : draft;
  const displayLabel = displayTextNodeLabel(data.label);
  const textRole = data.text_node_role ?? 'auto';
  const resolvedTextRole = inferTextNodeSemanticRole(data);
  const upstreamTextCount = useMemo(
    () => collectTextNodeContextForNode(id, nodes, edges, { includeSelf: false }).length,
    [edges, id, nodes],
  );
  const plainMode = data.text_view_mode === 'plain';
  const polishMode =
    data.text_polish_mode === 'simple' || data.text_polish_mode === 'storyboard'
      ? data.text_polish_mode
      : 'deep';
  const imageTaskMode: TextImageTaskMode =
    data.text_image_task_mode === 'skill_analysis' ||
    data.text_image_task_mode === 'normalize_storyboard' ||
    data.text_image_task_mode === 'continue_shot'
      ? data.text_image_task_mode
      : 'extract_shot';
  const storyboardSkills = useMemo(() => listSkillsInFolder('storyboard'), []);
  const storyboardSkillId = normalizeFilmStoryboardSkillId(
    data.text_storyboard_skill_id ?? DEFAULT_STORYBOARD_SKILL_ID,
  );
  const hasText = Boolean(displayText.trim());
  const hasImages = imageReferences.length > 0;
  const hasVideos = videoReferences.length > 0;
  const visualReferences = [...imageReferences, ...videoReferences];
  const canGenerate = busy || Boolean(instruction.trim() || draft.trim() || hasImages || hasVideos);
  const editable = isEditing || busy;

  useEffect(() => {
    if (raw === lastLocalCommitRef.current) return;
    setDraft(raw);
    draftRef.current = raw;
    lastLocalCommitRef.current = raw;
  }, [raw]);

  useEffect(() => {
    if (!isRenaming) setLabelDraft(data.label ?? '');
  }, [data.label, isRenaming]);

  const clearDraftCommitTimer = useCallback(() => {
    if (draftCommitTimerRef.current == null) return;
    window.clearTimeout(draftCommitTimerRef.current);
    draftCommitTimerRef.current = null;
  }, []);

  const commitDraft = useCallback(
    (value = draftRef.current) => {
      clearDraftCommitTimer();
      const latestNode = useStudioStore.getState().nodes.find((node) => node.id === id);
      const latestText = latestNode?.type === 'textNode' ? (latestNode.data.raw_text ?? latestNode.data.input ?? '') : '';
      if (value === latestText) return;
      lastLocalCommitRef.current = value;
      patchNodeData(id, { raw_text: value, input: value }, false);
    },
    [clearDraftCommitTimer, id, patchNodeData],
  );

  useEffect(() => {
    const flush = () => commitDraft();
    window.addEventListener(FLUSH_TEXT_NODE_DRAFTS_EVENT, flush);
    return () => window.removeEventListener(FLUSH_TEXT_NODE_DRAFTS_EVENT, flush);
  }, [commitDraft]);

  const scheduleDraftCommit = useCallback(
    (value: string) => {
      clearDraftCommitTimer();
      draftCommitTimerRef.current = window.setTimeout(() => {
        commitDraft(value);
      }, 220);
    },
    [clearDraftCommitTimer, commitDraft],
  );

  useEffect(() => {
    return () => {
      if (draftCommitTimerRef.current != null) {
        window.clearTimeout(draftCommitTimerRef.current);
      }
      const value = draftRef.current;
      const latestNode = useStudioStore.getState().nodes.find((node) => node.id === id);
      const latestText = latestNode?.type === 'textNode' ? (latestNode.data.raw_text ?? latestNode.data.input ?? '') : '';
      if (value !== latestText) {
        patchNodeData(id, { raw_text: value, input: value }, false);
      }
    };
  }, [id, patchNodeData]);

  useEffect(() => {
    if (selected) return;
    commitDraft();
    setIsEditing(false);
  }, [commitDraft, selected]);

  useEffect(() => {
    if (!busy && selected && editable) {
      areaRef.current?.focus();
    }
  }, [busy, editable, selected]);

  useEffect(() => {
    if (!busy || typeof data.text_polish_started_at === 'number') return;
    patchNodeData(id, recoverInterruptedTextPolish(data), true);
  }, [busy, data, id, patchNodeData]);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      const previous = draftRef.current;
      const insertion = findSingleInsertion(previous, value);
      const now = window.performance.now();
      if (insertion && isSingleSymbol(insertion.inserted)) {
        const lastInsertion = lastInsertionRef.current;
        const isDuplicatedSymbol =
          lastInsertion?.char === insertion.inserted &&
          insertion.start === lastInsertion.end &&
          now - lastInsertion.at <= 90;

        if (isDuplicatedSymbol) {
          event.currentTarget.value = previous;
          event.currentTarget.setSelectionRange(insertion.start, insertion.start);
          return;
        }
        lastInsertionRef.current = {
          char: insertion.inserted,
          at: now,
          start: insertion.start,
          end: insertion.end,
        };
      } else {
        lastInsertionRef.current = null;
      }
      draftRef.current = value;
      setDraft(value);
      scheduleDraftCommit(value);
    },
    [scheduleDraftCommit],
  );

  const onBlur = useCallback(
    (_event: FocusEvent<HTMLTextAreaElement>) => {
      commitDraft();
    },
    [commitDraft],
  );

  const stopKeyboardPropagation = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
  }, []);

  const onInstructionChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setInstruction(event.target.value);
  }, []);

  const onPolishModeChange = useCallback(
    (mode: 'simple' | 'deep' | 'storyboard') => {
      patchNodeData(id, { text_polish_mode: mode }, false);
    },
    [id, patchNodeData],
  );

  const onImageTaskModeChange = useCallback(
    (nextMode: TextImageTaskMode) => {
      patchNodeData(id, { text_image_task_mode: nextMode }, false);
    },
    [id, patchNodeData],
  );

  const commitLabel = useCallback(
    (value = labelDraft) => {
      const normalized = value.replace(/[\r\n]+/g, ' ').trim().slice(0, 80) || '文本卡片';
      setLabelDraft(normalized);
      setIsRenaming(false);
      if (normalized !== data.label) patchNodeData(id, { label: normalized }, true);
    },
    [data.label, id, labelDraft, patchNodeData],
  );

  const onLabelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commitLabel(event.currentTarget.value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setLabelDraft(data.label ?? '');
        setIsRenaming(false);
      }
    },
    [commitLabel, data.label],
  );

  const startRenaming = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      if (busy) return;
      setLabelDraft(data.label ?? '');
      setIsRenaming(true);
    },
    [busy, data.label],
  );

  const onStop = useCallback(() => {
    stopNodeTask(id);
  }, [id, stopNodeTask]);

  const onSwitchToPlainText = useCallback(
    (event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      patchNodeData(id, { text_view_mode: 'plain' }, true);
      setIsEditing(true);
      window.setTimeout(() => areaRef.current?.focus(), 0);
    },
    [id, patchNodeData],
  );

  const onEnterEdit = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      if (busy) return;
      setIsEditing(true);
      window.setTimeout(() => areaRef.current?.focus(), 0);
    },
    [busy],
  );

  const onQuickAction = useCallback(
    (
      event: MouseEvent<HTMLButtonElement>,
      action: 'write' | 'storyboard' | 'extract_shot' | 'skill_analysis',
    ) => {
      event.stopPropagation();
      if (busy) return;
      if (action === 'write') {
        setIsEditing(true);
        window.setTimeout(() => areaRef.current?.focus(), 0);
        return;
      }
      if (action === 'storyboard') {
        onPolishModeChange('storyboard');
        setIsEditing(true);
        window.setTimeout(() => areaRef.current?.focus(), 0);
        return;
      }
      onImageTaskModeChange(action);
    },
    [busy, onImageTaskModeChange, onPolishModeChange],
  );

  const onGenerate = useCallback(
    (event?: MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation();
      if (busy) {
        onStop();
        return;
      }
      commitDraft();
      const nextInstruction = instruction.trim();
      void runTextPolish(id, {
        ...(nextInstruction ? { instruction: nextInstruction } : {}),
        mode: polishMode,
        ...(hasImages && !hasVideos
          ? {
              imageMode: imageTaskMode,
              storyboardSkillId,
            }
          : {}),
      });
    },
    [
      busy,
      commitDraft,
      hasImages,
      hasVideos,
      id,
      imageTaskMode,
      instruction,
      onStop,
      polishMode,
      runTextPolish,
      storyboardSkillId,
    ],
  );

  return (
    <div
      className={`text-node ${plainMode ? 'text-node--plain' : ''} ${hasText ? 'text-node--filled' : 'text-node--empty'} ${selected ? 'text-node--selected' : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={TEXT_NODE_INPUT_HANDLE_ID}
        className="text-node__handle text-node__handle--in"
        title="Input：接入上游文本或部门资产；拖向空白可创建节点并连线"
      >
        <span aria-hidden>+</span>
      </Handle>
      <header className="text-node__head">
        <span
          className="text-node__title nodrag nopan"
          onDoubleClick={startRenaming}
          title="双击修改文本节点名称"
        >
          <span className="text-node__title-icon" aria-hidden />
          {isRenaming ? (
            <input
              className="text-node__title-input nodrag nopan"
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={(event) => commitLabel(event.currentTarget.value)}
              onKeyDown={onLabelKeyDown}
              autoFocus
              maxLength={80}
              aria-label="文本节点名称"
            />
          ) : (
            <span className="text-node__title-label">{displayLabel}</span>
          )}
          {upstreamTextCount > 0 ? (
            <span
              className="text-node__chain-badge"
              title={`已串联 ${upstreamTextCount} 个上游文本节点`}
            >
              串联 {upstreamTextCount}
            </span>
          ) : null}
        </span>
        <span className="text-node__head-meta" aria-label={busy ? '正在生成' : selected ? '正在编辑' : hasText ? '已有文本' : '空白文本'}>
          <span className={`text-node__status ${busy ? 'text-node__status--busy' : ''}`}>
            {busy ? '生成中' : selected ? '编辑' : hasText ? '文本' : '空白'}
          </span>
          {hasText ? <span className="text-node__count">{displayText.trim().length} 字</span> : null}
        </span>
      </header>
      <section
        className={`text-node__surface ${editable ? 'text-node__surface--editing' : ''}`}
        onDoubleClick={onEnterEdit}
      >
        {editable ? (
          <textarea
            ref={areaRef}
            className="text-node__area nodrag nopan nowheel"
            value={displayText}
            onChange={onChange}
            onBlur={onBlur}
            onKeyDown={stopKeyboardPropagation}
            onKeyUp={stopKeyboardPropagation}
            onDoubleClick={onEnterEdit}
            placeholder={editable ? '输入内容...' : '生成后的文本会出现在这里'}
            rows={10}
            spellCheck={false}
            disabled={busy}
          />
        ) : hasText ? (
          <div className="text-node__preview" onDoubleClick={onEnterEdit}>
            {displayText}
          </div>
        ) : (
          <div className="text-node__empty-state">
            <div className="text-node__empty-mark" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
            {selected ? (
              <div className="text-node__quick-start nodrag nopan">
                <span className="text-node__quick-label">尝试：</span>
                <button type="button" onClick={(event) => onQuickAction(event, 'write')}>
                  <span className="text-node__quick-icon text-node__quick-icon--write" aria-hidden />
                  <span>自己编写内容</span>
                </button>
                <button type="button" onClick={(event) => onQuickAction(event, 'storyboard')}>
                  <span className="text-node__quick-icon text-node__quick-icon--storyboard" aria-hidden />
                  <span>整理分镜规范</span>
                </button>
                <button
                  type="button"
                  disabled={!hasImages || hasVideos}
                  onClick={(event) => onQuickAction(event, 'extract_shot')}
                  title={hasImages && !hasVideos ? '提取已连接图片中的分镜信息' : '连接图片节点后可用'}
                >
                  <span className="text-node__quick-icon text-node__quick-icon--image" aria-hidden />
                  <span>提取图片分镜</span>
                </button>
                <button
                  type="button"
                  disabled={!hasImages || hasVideos}
                  onClick={(event) => onQuickAction(event, 'skill_analysis')}
                  title={hasImages && !hasVideos ? '按分镜 Skill 分析已连接图片' : '连接图片节点后可用'}
                >
                  <span className="text-node__quick-icon text-node__quick-icon--skill" aria-hidden>✦</span>
                  <span>分镜 Skill 分析</span>
                </button>
              </div>
            ) : (
              <span className="text-node__empty-hint">双击输入内容</span>
            )}
          </div>
        )}
        {!plainMode ? (
          <button
            type="button"
            className="text-node__mode-switch nodrag nopan"
            onPointerDown={onSwitchToPlainText}
            onPointerUp={onSwitchToPlainText}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onSwitchToPlainText}
            aria-label="切换为常规文本节点"
            title="切换为常规文本节点"
          >
            <span aria-hidden />
          </button>
        ) : null}
      </section>
      {data.generation_error?.trim() ? (
        <div className="text-node__error">{data.generation_error.trim()}</div>
      ) : null}
      {selected ? (
        <div className="text-node__workspace nodrag nopan nowheel">
          <div className="text-node__workspace-head">
            <div>
              <span>文本工作台</span>
              <strong>{hasImages && !hasVideos ? '识别图片并整理文本' : '编写、整理与生成'}</strong>
            </div>
            <small>双击上方正文可直接修改</small>
          </div>
          <div className="text-node__role-row">
            <span>文本用途</span>
            <select
              value={textRole}
              onChange={(event) =>
                patchNodeData(
                  id,
                  {
                    text_node_role: event.target.value as NonNullable<
                      StudioNodeData['text_node_role']
                    >,
                  },
                  true,
                )
              }
              disabled={busy}
              aria-label="文本节点用途"
            >
              <option value="auto">自动识别</option>
              <option value="project_constraints">项目约束</option>
              <option value="story_content">分镜正文</option>
              <option value="reference_notes">参考资料</option>
            </select>
            <small>
              {textRole === 'auto'
                ? `当前识别：${
                    resolvedTextRole === 'project_constraints'
                      ? '项目约束'
                      : resolvedTextRole === 'story_content'
                        ? '分镜正文'
                        : '参考资料'
                  }`
                : upstreamTextCount > 0
                  ? `已继承 ${upstreamTextCount} 个上游文本`
                  : '将随连线传递到下游'}
            </small>
          </div>
          {visualReferences.length > 0 ? (
            <div className="text-node__workspace-images">
              {visualReferences.slice(0, 4).map((visual, index) => (
                <div className="text-node__workspace-thumb" key={visual.id} title={visual.label}>
                  {visual.src ? <img src={visual.src} alt={visual.label} /> : <span className="text-node__workspace-thumb-empty">{visual.kind === 'video' ? '视' : '图'}</span>}
                  <span className="text-node__workspace-thumb-count">{index + 1}</span>
                </div>
              ))}
              {visualReferences.length > 4 ? <span className="text-node__workspace-more">+{visualReferences.length - 4}</span> : null}
            </div>
          ) : null}
          {hasImages && !hasVideos ? (
            <div className="text-node__image-task-panel">
              <div className="text-node__image-task-head">
                <strong>图片任务</strong>
                <span>连线只挂载图片，点击生成后才执行所选任务</span>
              </div>
              <div
                className="text-node__image-task-modes"
                role="group"
                aria-label="图片分析任务"
              >
                <button
                  type="button"
                  className={imageTaskMode === 'extract_shot' ? 'is-active' : ''}
                  disabled={busy}
                  onClick={() => onImageTaskModeChange('extract_shot')}
                  title="只提取当前图片中的场景、景别、机位、构图、表演、光影和连续性，不生成下一镜"
                >
                  提取当前分镜
                </button>
                <button
                  type="button"
                  className={imageTaskMode === 'skill_analysis' ? 'is-active' : ''}
                  disabled={busy}
                  onClick={() => onImageTaskModeChange('skill_analysis')}
                  title="按选择的分镜 Skill 分析当前图片的场面机制、空间结构与英雄画面"
                >
                  分镜 Skill 分析
                </button>
                <button
                  type="button"
                  className={imageTaskMode === 'normalize_storyboard' ? 'is-active' : ''}
                  disabled={busy}
                  onClick={() => onImageTaskModeChange('normalize_storyboard')}
                  title="识别图片中的分镜表字段和画面事实，与当前文字交叉核对后按基础分镜规范整理；不续写剧情"
                >
                  识别并整理
                </button>
                <button
                  type="button"
                  className={imageTaskMode === 'continue_shot' ? 'is-active' : ''}
                  disabled={busy}
                  onClick={() => onImageTaskModeChange('continue_shot')}
                  title="把图片作为首帧，并根据文本内容推算后续动作与镜头发展"
                >
                  下一镜推算
                </button>
              </div>
              {imageTaskMode === 'skill_analysis' ? (
                <label className="text-node__image-skill">
                  <span>分镜 Skill</span>
                  <select
                    value={storyboardSkillId}
                    disabled={busy}
                    onChange={(event) =>
                      patchNodeData(
                        id,
                        { text_storyboard_skill_id: event.target.value },
                        true,
                      )
                    }
                    aria-label="图片分析分镜 Skill"
                  >
                    {storyboardSkills.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : imageTaskMode === 'normalize_storyboard' ? (
                <div className="text-node__image-skill" aria-label="当前整理 Skill">
                  <span>整理 Skill</span>
                  <strong>{STORYBOARD_TEXT_NORMALIZER_SKILL_NAME} v{STORYBOARD_TEXT_NORMALIZER_SKILL_VERSION}</strong>
                </div>
              ) : null}
            </div>
          ) : null}
          <textarea
            className="text-node__workspace-input"
            value={instruction}
            onChange={onInstructionChange}
            onKeyDown={stopKeyboardPropagation}
            onKeyUp={stopKeyboardPropagation}
            placeholder={
              hasImages && !hasVideos
                ? imageTaskMode === 'continue_shot'
                  ? '补充下一镜要发生的动作、情绪或镜头意图（可选）'
                  : imageTaskMode === 'normalize_storyboard'
                    ? '补充场次、命名规则或需要保留的字段（可选）'
                  : imageTaskMode === 'skill_analysis'
                    ? '补充分镜导演要求或需要重点分析的内容（可选）'
                    : '补充场景名称、人物身份或需要核对的信息（可选）'
                : '输入本次优化要求（可选）'
            }
            spellCheck={false}
            disabled={busy}
          />
          <div className="text-node__workspace-footer">
            {hasImages && !hasVideos ? (
              <span className="text-node__image-task-summary">
                {imageTaskMode === 'continue_shot'
                  ? '将推算下一镜'
                  : imageTaskMode === 'normalize_storyboard'
                    ? '识别图片 · 整理规范 · 不改剧情'
                  : imageTaskMode === 'skill_analysis'
                    ? '只分析当前画面 · 使用 Skill'
                    : '默认安全模式 · 不推算下一镜'}
              </span>
            ) : (
              <div className="text-node__polish-mode" role="group" aria-label="文本优化模式">
                <button
                  type="button"
                  className={`text-node__polish-mode-btn ${polishMode === 'simple' ? 'text-node__polish-mode-btn--active' : ''}`}
                  disabled={busy}
                  onClick={() => onPolishModeChange('simple')}
                  title="简单优化：贴近原文，只做轻量润色"
                >
                  简单
                </button>
                <button
                  type="button"
                  className={`text-node__polish-mode-btn ${polishMode === 'deep' ? 'text-node__polish-mode-btn--active' : ''}`}
                  disabled={busy}
                  onClick={() => onPolishModeChange('deep')}
                  title="深度优化：补充影视级运镜、构图、灯光和表演细节"
                >
                  深度
                </button>
                <button
                  type="button"
                  className={`text-node__polish-mode-btn ${polishMode === 'storyboard' ? 'text-node__polish-mode-btn--active' : ''}`}
                  disabled={busy}
                  onClick={() => onPolishModeChange('storyboard')}
                  title="分镜规范：不改剧情，统一术语、空间、动作、落点及镜头格式"
                >
                  分镜规范
                </button>
              </div>
            )}
            <div className="text-node__workspace-actions">
              <button
                type="button"
                className={`text-node__workspace-submit ${busy ? 'text-node__workspace-submit--stop' : ''}`}
                disabled={!canGenerate}
                onClick={onGenerate}
                aria-label={busy ? '停止生成' : '生成到文本节点'}
                title={busy ? '停止生成' : '生成到上方文本节点'}
              >
                <span aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="text-node__handle text-node__handle--out"
        id={TEXT_NODE_OUTPUT_HANDLE_ID}
        title="Output：拖向节点或空白处继续创建下游"
      >
        <span aria-hidden>+</span>
      </Handle>
    </div>
  );
}

export const TextNode = memo(TextNodeInner);
