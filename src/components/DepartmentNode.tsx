import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useState, type MouseEvent } from 'react';
import { ReviewFeedbackDialog } from '@/components/ReviewFeedbackDialog';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';
import {
  DEPT_INPUT_HANDLE_ID,
  DEPT_INPUT_PULL_HANDLE_ID,
  DEPT_OUTPUT_HANDLE_ID,
  departmentNodeHasInputWire,
} from '@/utils/departmentInputWire';
import {
  parseShotListItemOutputHandleId,
  SHOT_LIST_LINK_HANDLE_ID,
} from '@/utils/shotListWire';

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M8 5v14l11-7z" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

type DeptRF = Node<StudioNodeData, 'department'>;

function displayDepartmentLabel(label: string | undefined, fallback: string): string {
  if (!label) return fallback;
  const normalized = label.replace(/\s+/g, ' ').trim();
  const suffix = normalized.match(/([a-z0-9]{4})$/i)?.[1];
  const looksBroken =
    normalized.includes('?') ||
    /[缂栧墽鍒嗛暅闂傚倹鐗曟晶浠嬫焾妫濋弳鍛]/.test(normalized) ||
    normalized.includes('墨');

  if (suffix && (looksBroken || !normalized.startsWith(fallback))) {
    return `${fallback} · ${suffix}`;
  }

  return normalized.replace(/\s*路\s*/g, ' · ');
}

function previewText(data: StudioNodeData): string {
  if (data.status === 'IN_PROGRESS' && data.streaming_preview?.trim()) {
    const text = data.streaming_preview.trim();
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  }

  if (data.type === 'prompt' && data.output_stale_reason?.trim()) {
    const text = data.output_stale_reason.trim();
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  }

  if (data.type === 'writing' && data.output && typeof data.output === 'object') {
    const output = data.output as { scenes?: { title?: string; coreConflict?: string }[] };
    if (Array.isArray(output.scenes)) {
      return (
        output.scenes
          .slice(0, 2)
          .map((scene) => scene?.title ?? scene?.coreConflict ?? '')
          .filter(Boolean)
          .join(' · ') || '（场次预览）'
      );
    }
  }

  if (data.type === 'storyboard' && data.output && typeof data.output === 'object') {
    const output = data.output as {
      shots?: { description?: string; visual_description?: string; action?: string }[];
    };
    if (Array.isArray(output.shots)) {
      return (
        output.shots
          .slice(0, 2)
          .map((shot) => shot?.description ?? shot?.visual_description ?? shot?.action ?? '')
          .filter(Boolean)
          .join(' / ') || '（分镜预览）'
      );
    }
  }

  if (data.type === 'prompt' && data.output && typeof data.output === 'object') {
    const output = data.output as {
      userTemplate?: string;
      shotPrompts?: { shot_id?: string; prompt?: string }[];
    };
    const first = output.shotPrompts?.[0];
    if (first?.prompt) {
      const head = `${first.shot_id ?? 'shot'}: ${first.prompt}`;
      return head.length > 100 ? `${head.slice(0, 100)}…` : head;
    }
    if (typeof output.userTemplate === 'string') {
      return output.userTemplate.length > 100
        ? `${output.userTemplate.slice(0, 100)}…`
        : output.userTemplate;
    }
  }

  if (data.input) {
    return data.input.length > 80 ? `${data.input.slice(0, 80)}…` : data.input;
  }

  return '等待输入或执行…';
}

export {
  DEPT_INPUT_HANDLE_ID,
  DEPT_INPUT_PULL_HANDLE_ID,
  DEPT_OUTPUT_HANDLE_ID,
} from '@/utils/departmentInputWire';

function DepartmentNodeInner({ id, data, selected }: NodeProps<DeptRF>) {
  const [reviewOpen, setReviewOpen] = useState(false);

  const dept =
    data.department === 'WRITING'
      ? '编剧部'
      : data.department === 'STORYBOARD'
        ? '分镜部'
        : 'Prompt部';
  const displayLabel = displayDepartmentLabel(data.label, dept);

  const showPullHandle =
    data.type === 'writing' || data.type === 'storyboard' || data.type === 'prompt';
  const supportsReview = data.type === 'writing' || data.type === 'storyboard';

  const hasInputFeed = useStudioStore(
    useCallback((s) => departmentNodeHasInputWire(id, s.edges, s.nodes), [id]),
  );

  const displayStatus =
    data.type === 'prompt' && (data.status === 'WAITING_REVIEW' || data.status === 'REVIEWED')
      ? 'APPROVED'
      : data.status;
  const statusDisplay =
    displayStatus === 'NOT_STARTED' && hasInputFeed ? '输入已挂载' : displayStatus;

  const canExecute =
    (data.type === 'writing' || data.type === 'storyboard' || data.type === 'prompt') &&
    (data.status === 'NOT_STARTED' || data.status === 'REJECTED');

  const canReviewOnCanvas = supportsReview && data.status === 'WAITING_REVIEW';
  const canReviewedDecisionOnCanvas = supportsReview && data.status === 'REVIEWED';
  const canRegenerate =
    showPullHandle &&
    data.status !== 'IN_PROGRESS' &&
    (data.status === 'REJECTED' ||
      data.status === 'WAITING_REVIEW' ||
      data.status === 'REVIEWED' ||
      data.status === 'APPROVED');

  const promptSourceBadge = useStudioStore(
    useCallback((s) => {
      if (data.type !== 'prompt') return null;
      const incoming = s.edges.filter(
        (edge) =>
          edge.target === id &&
          (edge.targetHandle == null || edge.targetHandle === DEPT_INPUT_HANDLE_ID),
      );
      const shotItemHandles = incoming
        .map((edge) => parseShotListItemOutputHandleId(edge.sourceHandle))
        .filter((wireId): wireId is string => Boolean(wireId));
      if (shotItemHandles.length >= 2) return '多镜头组合';
      if (shotItemHandles.length === 1) return '单镜头';
      const hasShotListWhole = incoming.some(
        (edge) =>
          edge.sourceHandle === DEPT_OUTPUT_HANDLE_ID &&
          s.nodes.find((n) => n.id === edge.source)?.type === 'shotList',
      );
      return hasShotListWhole ? '整表提示词' : null;
    }, [data.type, id]),
  );

  const handlePlay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (data.onExecute) {
        void data.onExecute();
        return;
      }
      const st = useStudioStore.getState();
      st.focusNode(id, { openDetail: true });
      void st.executeNodeTask(id);
    },
    [id, data.onExecute],
  );

  const submitLeaderReviewFeedback = useStudioStore((s) => s.submitLeaderReviewFeedback);
  const manualPassLeaderReview = useStudioStore((s) => s.manualPassLeaderReview);
  const runReviewedOptimization = useStudioStore((s) => s.runReviewedOptimization);
  const approveReviewedAsIs = useStudioStore((s) => s.approveReviewedAsIs);
  const regenerateNode = useStudioStore((s) => s.regenerateNode);

  const handleReviewInput = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      setReviewOpen(true);
    },
    [],
  );

  const handleManualPass = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      manualPassLeaderReview(id);
    },
    [id, manualPassLeaderReview],
  );

  const handleOptimizeFromReviewed = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      runReviewedOptimization(id);
    },
    [id, runReviewedOptimization],
  );

  const handleApproveReviewedAsIs = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      approveReviewedAsIs(id);
    },
    [id, approveReviewedAsIs],
  );

  const handleRegenerate = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      regenerateNode(id);
    },
    [id, regenerateNode],
  );

  const flash = data.pipeline_decision_flash;
  const flashClass = (() => {
    if (!flash || flash.until <= Date.now()) return '';
    if (flash.kind === 'approve') return ' dept-node--flash-approve';
    return ' dept-node--flash-optimize';
  })();

  return (
    <div
      className={`dept-node ${selected ? 'dept-node--selected' : ''} dept-node--border-${displayStatus}${
        data.status === 'IN_PROGRESS' ? ' dept-node--streaming' : ''
      }${flashClass}`}
    >
      <ReviewFeedbackDialog
        open={reviewOpen}
        initialValue={data.ai_review_feedback?.trim() ?? ''}
        onClose={() => setReviewOpen(false)}
        onSubmit={(feedback) => submitLeaderReviewFeedback(id, feedback)}
      />

      {showPullHandle ? (
        <Handle
          type="source"
          position={Position.Left}
          id={DEPT_INPUT_PULL_HANDLE_ID}
          className="dept-handle dept-handle--pull"
          title="从这里拖到空白处，可创建文本、编剧、分镜或 Prompt 节点并自动连线。"
        />
      ) : null}
      <Handle
        type="target"
        position={Position.Left}
        id={DEPT_INPUT_HANDLE_ID}
        className={showPullHandle ? 'dept-handle dept-handle--in' : 'dept-handle'}
        title="Input：接入文本卡片或上游部门输出。"
      />

      <header className="dept-node__head">
        <span className="dept-node__dept">{dept}</span>
        <div className="dept-node__head-actions">
          {canExecute ? (
            <button
              type="button"
              className="dept-node__play nodrag nopan"
              disabled={!hasInputFeed}
              onClick={handlePlay}
              title={hasInputFeed ? '执行任务' : '请先连接输入源'}
              aria-label={hasInputFeed ? '执行任务' : '请先连接输入源'}
            >
              <PlayIcon />
            </button>
          ) : null}
          {canRegenerate ? (
            <button
              type="button"
              className="dept-node__regen nodrag nopan"
              onClick={handleRegenerate}
              title="重新生成"
              aria-label="重新生成"
            >
              <RefreshIcon />
            </button>
          ) : null}
          <span
            className={`dept-node__status dept-node__status--${displayStatus}${
              displayStatus === 'NOT_STARTED' && hasInputFeed ? ' dept-node__status--feed' : ''
            }`}
          >
            {statusDisplay}
          </span>
        </div>
      </header>

      <div className="dept-node__body">
        <div className="dept-node__label">{displayLabel}</div>
        {promptSourceBadge ? <div className="dept-node__source-badge">{promptSourceBadge}</div> : null}
        <p className="dept-node__preview">{previewText(data)}</p>
        <div className="dept-node__meta">v{data.version} · Input / Output 资产</div>
      </div>

      {canReviewOnCanvas ? (
        <div className="dept-node__review-actions nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="dept-node__review-btn"
            onClick={handleReviewInput}
            title="填写审核意见，进入已审核状态。"
          >
            填写审核意见
          </button>
          <button
            type="button"
            className="dept-node__review-btn dept-node__review-btn--secondary"
            onClick={handleManualPass}
            title="跳过审核意见，直接通过当前结果。"
          >
            手动通过
          </button>
        </div>
      ) : null}

      {canReviewedDecisionOnCanvas ? (
        <div className="dept-node__review-actions nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="dept-node__review-btn"
            onClick={handleOptimizeFromReviewed}
            title="按当前审核意见重新生成并覆盖当前结果。"
          >
            按意见优化
          </button>
          <button
            type="button"
            className="dept-node__review-btn dept-node__review-btn--secondary"
            onClick={handleApproveReviewedAsIs}
            title="维持当前结果，直接通过。"
          >
            维持现状通过
          </button>
        </div>
      ) : null}

      {data.status === 'NOT_STARTED' && data.generation_error?.trim() ? (
        <div className="dept-node__generation-error">
          <div className="dept-node__generation-error-label">生成未成功</div>
          <p className="dept-node__generation-error-text">{data.generation_error.trim()}</p>
        </div>
      ) : null}

      {data.status === 'REJECTED' && data.review_result ? (
        <div className="dept-node__review-comment">
          <div className="dept-node__review-comment-label">审核意见</div>
          <p className="dept-node__review-comment-text">{data.review_result}</p>
        </div>
      ) : null}

      {data.type === 'storyboard' ? (
        <Handle
          type="source"
          position={Position.Bottom}
          id={SHOT_LIST_LINK_HANDLE_ID}
          className="dept-handle dept-handle--shot-list-link"
          title="镜头表子节点：执行后会自动在下方创建并连线。"
        />
      ) : null}

      {showPullHandle ? (
        <Handle
          type="source"
          position={Position.Right}
          id={DEPT_OUTPUT_HANDLE_ID}
          className="dept-handle dept-handle--out"
          title="Output：把本节点生成的资产连接到下游。"
        />
      ) : null}
    </div>
  );
}

export const DepartmentNode = memo(DepartmentNodeInner);
