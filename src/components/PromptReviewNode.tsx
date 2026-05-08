import {
  Handle,
  NodeResizeControl,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { PromptReviewHistoryEntry, StudioNodeData } from '@/types/studio';
import { DEPT_OUTPUT_HANDLE_ID } from '@/utils/departmentInputWire';

type PromptReviewRF = Node<StudioNodeData, 'promptReview'>;

export const PROMPT_REVIEW_INPUT_HANDLE_ID = 'in';
export const PROMPT_REVIEW_OUTPUT_HANDLE_ID = DEPT_OUTPUT_HANDLE_ID;

const PROMPT_REVIEW_MIN_WIDTH = 320;
const PROMPT_REVIEW_MAX_WIDTH = 760;
const PROMPT_REVIEW_DEFAULT_WIDTH = 380;
const PROMPT_REVIEW_MIN_HEIGHT = 560;
const PROMPT_REVIEW_MAX_HEIGHT = 980;
const PROMPT_REVIEW_DEFAULT_HEIGHT = 640;

function formatHistoryTime(value: number): string {
  if (!Number.isFinite(value)) return '未知时间';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function historyPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 72 ? `${normalized.slice(0, 72)}...` : normalized;
}

function PromptReviewNodeInner({ id, data, selected }: NodeProps<PromptReviewRF>) {
  const [instruction, setInstruction] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const syncPromptReviewInputFromGraph = useStudioStore((s) => s.syncPromptReviewInputFromGraph);
  const savePromptReviewSnapshot = useStudioStore((s) => s.savePromptReviewSnapshot);
  const restorePromptReviewSnapshot = useStudioStore((s) => s.restorePromptReviewSnapshot);
  const runPromptReviewLlm = useStudioStore((s) => s.runPromptReviewLlm);
  const stopNodeTask = useStudioStore((s) => s.stopNodeTask);
  const activeNodeId = useStudioStore((s) => s.activeNodeId);
  const updateNodeInternals = useUpdateNodeInternals();
  const text = data.raw_text ?? data.input ?? '';
  const busy = data.status === 'IN_PROGRESS';
  const displayText = busy ? (data.streaming_preview ?? text) : text;
  const totalChars = displayText.replace(/\s+/g, '').length;
  const history = (Array.isArray(data.prompt_review_history)
    ? data.prompt_review_history
    : []) as PromptReviewHistoryEntry[];
  const persistedWidth = Math.min(
    PROMPT_REVIEW_MAX_WIDTH,
    Math.max(PROMPT_REVIEW_MIN_WIDTH, Math.round(data.canvasWidth ?? PROMPT_REVIEW_DEFAULT_WIDTH)),
  );
  const persistedHeight = Math.min(
    PROMPT_REVIEW_MAX_HEIGHT,
    Math.max(
      PROMPT_REVIEW_MIN_HEIGHT,
      Math.round(data.canvasHeight ?? PROMPT_REVIEW_DEFAULT_HEIGHT),
    ),
  );
  const [liveSize, setLiveSize] = useState({ width: persistedWidth, height: persistedHeight });
  const resizeFrameRef = useRef<number | null>(null);
  const resizingRef = useRef(false);
  const width = liveSize.width;
  const height = liveSize.height;

  const scheduleInternalsRefresh = useCallback(() => {
    if (resizeFrameRef.current != null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      updateNodeInternals(id);
    });
  }, [id, updateNodeInternals]);

  useEffect(() => {
    if (resizingRef.current) return;
    setLiveSize({ width: persistedWidth, height: persistedHeight });
  }, [persistedHeight, persistedWidth]);

  useEffect(
    () => () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!busy || (!selected && activeNodeId !== id)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      stopNodeTask(id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeNodeId, busy, id, selected, stopNodeTask]);

  const onTextChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      patchNodeData(id, {
        input: next,
        raw_text: next,
        output: { text: next },
        status: 'APPROVED',
        generation_error: undefined,
      }, false);
    },
    [id, patchNodeData],
  );

  const onInstructionChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setInstruction(event.target.value);
  }, []);

  const onSync = useCallback(() => {
    syncPromptReviewInputFromGraph(id);
  }, [id, syncPromptReviewInputFromGraph]);

  const onSaveSnapshot = useCallback(() => {
    if (savePromptReviewSnapshot(id)) {
      setHistoryOpen(true);
    }
  }, [id, savePromptReviewSnapshot]);

  const onRestoreSnapshot = useCallback(
    (snapshotId: string) => {
      if (restorePromptReviewSnapshot(id, snapshotId)) {
        setHistoryOpen(false);
      }
    },
    [id, restorePromptReviewSnapshot],
  );

  const onRunLlm = useCallback(() => {
    void runPromptReviewLlm(id, instruction);
  }, [id, instruction, runPromptReviewLlm]);

  const onStop = useCallback(() => {
    stopNodeTask(id);
  }, [id, stopNodeTask]);

  return (
    <div
      className={`prompt-review-node ${selected ? 'prompt-review-node--selected' : ''}`}
      style={{ width, minWidth: width, maxWidth: width, height, minHeight: height }}
    >
      <NodeResizeControl
        className="prompt-review-node__resize-handle"
        minWidth={PROMPT_REVIEW_MIN_WIDTH}
        maxWidth={PROMPT_REVIEW_MAX_WIDTH}
        minHeight={PROMPT_REVIEW_MIN_HEIGHT}
        maxHeight={PROMPT_REVIEW_MAX_HEIGHT}
        position="bottom-right"
        onResizeStart={() => {
          resizingRef.current = true;
        }}
        onResize={(_event, params) => {
          setLiveSize({
            width: Math.min(
              PROMPT_REVIEW_MAX_WIDTH,
              Math.max(PROMPT_REVIEW_MIN_WIDTH, Math.round(params.width)),
            ),
            height: Math.min(
              PROMPT_REVIEW_MAX_HEIGHT,
              Math.max(PROMPT_REVIEW_MIN_HEIGHT, Math.round(params.height)),
            ),
          });
          scheduleInternalsRefresh();
        }}
        onResizeEnd={(_event, params) => {
          resizingRef.current = false;
          const nextWidth = Math.min(
            PROMPT_REVIEW_MAX_WIDTH,
            Math.max(PROMPT_REVIEW_MIN_WIDTH, Math.round(params.width)),
          );
          const nextHeight = Math.min(
            PROMPT_REVIEW_MAX_HEIGHT,
            Math.max(PROMPT_REVIEW_MIN_HEIGHT, Math.round(params.height)),
          );
          setLiveSize({ width: nextWidth, height: nextHeight });
          patchNodeData(id, { canvasWidth: nextWidth, canvasHeight: nextHeight }, false);
          scheduleInternalsRefresh();
        }}
      >
        <div className="prompt-review-node__resize-grip" aria-hidden />
      </NodeResizeControl>
      <div className="prompt-review-node__resize-corner" aria-hidden />

      <Handle
        type="target"
        position={Position.Left}
        id={PROMPT_REVIEW_INPUT_HANDLE_ID}
        className="prompt-review-node__handle prompt-review-node__handle--in"
        title="Input：接入 Prompt 节点 Output，自动读取卡片提示词。"
      />
      <header className="prompt-review-node__head">
        <div>
          <div className="prompt-review-node__eyebrow">Prompt 审核</div>
          <div className="prompt-review-node__title">{data.label || '提示词审核节点'}</div>
        </div>
        <span className={`prompt-review-node__status prompt-review-node__status--${data.status}`}>
          {busy ? '调整中' : '可编辑'}
        </span>
      </header>

      <div className="prompt-review-node__toolbar nodrag nopan">
        <button type="button" onClick={onSync} disabled={busy}>
          同步上游
        </button>
        <button type="button" onClick={onSaveSnapshot} disabled={busy || !text.trim()}>
          保存版本
        </button>
        {busy ? (
          <button type="button" className="prompt-review-node__stop" onClick={onStop}>
            停止 Esc
          </button>
        ) : (
          <button type="button" className="prompt-review-node__primary" onClick={onRunLlm} disabled={!text.trim()}>
            LLM 调整
          </button>
        )}
      </div>

      <textarea
        className="prompt-review-node__instruction nodrag nopan nowheel"
        value={instruction}
        onChange={onInstructionChange}
        placeholder="可选：写调整要求，例如：强化灯光层次，减少重复，保留时长只在摄影机动态参数中出现。"
        rows={3}
        spellCheck={false}
        disabled={busy}
      />

      <textarea
        className="prompt-review-node__body nodrag nopan nowheel"
        value={displayText}
        onChange={onTextChange}
        placeholder="从 Prompt 节点右侧 Output 拖出并选择“创建提示词审核”，这里会载入卡片提示词。"
        rows={12}
        spellCheck={false}
        disabled={busy}
      />

      <footer className="prompt-review-node__footer">
        <span>
          提示词总字数：<strong>{totalChars.toLocaleString('zh-CN')}</strong>
        </span>
        <button
          type="button"
          className="prompt-review-node__history-toggle nodrag nopan"
          onClick={() => setHistoryOpen((open) => !open)}
          disabled={history.length === 0}
          aria-expanded={historyOpen}
        >
          {history.length > 0 ? `历史 ${history.length}` : '暂无历史'}
        </button>
      </footer>

      {historyOpen && history.length > 0 ? (
        <section className="prompt-review-node__history nodrag nopan nowheel">
          {history.slice(0, 6).map((entry) => (
            <article className="prompt-review-node__history-item" key={entry.id}>
              <div className="prompt-review-node__history-head">
                <strong>{entry.label}</strong>
                <time>{formatHistoryTime(entry.at)}</time>
              </div>
              <p>{historyPreview(entry.text)}</p>
              <div className="prompt-review-node__history-foot">
                <span>{entry.charCount.toLocaleString('zh-CN')} 字</span>
                <button type="button" onClick={() => onRestoreSnapshot(entry.id)} disabled={busy}>
                  回退
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {data.generation_error?.trim() ? (
        <div className="prompt-review-node__error">{data.generation_error.trim()}</div>
      ) : null}

      <Handle
        type="source"
        position={Position.Right}
        id={PROMPT_REVIEW_OUTPUT_HANDLE_ID}
        className="prompt-review-node__handle prompt-review-node__handle--out"
        title="Output：输出审核后的提示词文本。"
      />
    </div>
  );
}

export const PromptReviewNode = memo(PromptReviewNodeInner);
