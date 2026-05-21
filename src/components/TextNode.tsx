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
import type { StudioNodeData } from '@/types/studio';

type TextRF = Node<StudioNodeData, 'textNode'>;

export const TEXT_NODE_OUTPUT_HANDLE_ID = 'out';
export const TEXT_NODE_INPUT_HANDLE_ID = 'in';

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
  const nodes = useStudioStore((s) => s.nodes);
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
        label: node.data.imageFileName?.trim() || node.data.label?.trim() || '图片参考',
        src: node.data.imageDataUrl,
      }));
  }, [edges, id, nodes]);
  const raw = data.raw_text ?? data.input ?? '';
  const [instruction, setInstruction] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(raw);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef(raw);
  const lastLocalCommitRef = useRef(raw);
  const draftCommitTimerRef = useRef<number | null>(null);
  const lastInsertionRef = useRef<{ char: string; at: number; start: number; end: number } | null>(null);
  const busy = data.status === 'IN_PROGRESS';
  const displayText = busy ? (data.streaming_preview ?? raw) : draft;
  const displayLabel = displayTextNodeLabel(data.label);
  const plainMode = data.text_view_mode === 'plain';
  const polishMode = data.text_polish_mode === 'simple' ? 'simple' : 'deep';
  const hasText = Boolean(displayText.trim());
  const hasImages = imageReferences.length > 0;
  const canGenerate = busy || Boolean(instruction.trim() || draft.trim() || hasImages);
  const editable = isEditing || busy;

  useEffect(() => {
    if (raw === lastLocalCommitRef.current) return;
    setDraft(raw);
    draftRef.current = raw;
    lastLocalCommitRef.current = raw;
  }, [raw]);

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
    (mode: 'simple' | 'deep') => {
      patchNodeData(id, { text_polish_mode: mode }, false);
    },
    [id, patchNodeData],
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

  const onGenerate = useCallback(
    (event?: MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation();
      if (busy) {
        onStop();
        return;
      }
      commitDraft();
      const nextInstruction = instruction.trim();
      void runTextPolish(id, nextInstruction ? { instruction: nextInstruction, mode: polishMode } : { mode: polishMode });
      if (nextInstruction) setInstruction('');
    },
    [busy, commitDraft, id, instruction, onStop, polishMode, runTextPolish],
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
      />
      <header className="text-node__head">
        <span className="text-node__title">
          <span className="text-node__title-icon" aria-hidden />
          <span className="text-node__title-label">{displayLabel}</span>
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
          {hasImages ? (
            <div className="text-node__workspace-images">
              {imageReferences.slice(0, 4).map((image, index) => (
                <div className="text-node__workspace-thumb" key={image.id} title={image.label}>
                  {image.src ? <img src={image.src} alt={image.label} /> : <span className="text-node__workspace-thumb-empty">图</span>}
                  <span className="text-node__workspace-thumb-count">{index + 1}</span>
                </div>
              ))}
              {imageReferences.length > 4 ? <span className="text-node__workspace-more">+{imageReferences.length - 4}</span> : null}
            </div>
          ) : null}
          <textarea
            className="text-node__workspace-input"
            value={instruction}
            onChange={onInstructionChange}
            onKeyDown={stopKeyboardPropagation}
            onKeyUp={stopKeyboardPropagation}
            placeholder=""
            spellCheck={false}
            disabled={busy}
          />
          <div className="text-node__workspace-footer">
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
            </div>
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
      />
    </div>
  );
}

export const TextNode = memo(TextNodeInner);
