import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';

/**
 * 镜头表子节点详情：在表格上方展示父分镜「已阅」态的总监意见与双按钮（操作作用于父分镜节点）。
 */
export function ShotListReviewDecisionBar(props: {
  parentNodeId: string;
  parentNode: StudioNodeData;
}) {
  const { parentNodeId, parentNode } = props;
  const runReviewedOptimization = useStudioStore((s) => s.runReviewedOptimization);
  const approveReviewedAsIs = useStudioStore((s) => s.approveReviewedAsIs);

  if (parentNode.type !== 'storyboard' || parentNode.status !== 'REVIEWED') return null;

  const fb = parentNode.ai_review_feedback?.trim() || '（暂无总监审核正文）';
  const suggestedPass = parentNode.leader_review_suggested_pass === true;

  return (
    <div className="shotlist-review-decision" role="region" aria-label="分镜总监审核与决策">
      <div className="shotlist-review-decision__head">
        <span className="shotlist-review-decision__title">审核建议</span>
        {suggestedPass ? (
          <span className="shotlist-review-decision__tag" title="自动审核倾向">
            审核建议通过
          </span>
        ) : (
          <span className="shotlist-review-decision__tag shotlist-review-decision__tag--revise">建议修订</span>
        )}
      </div>
      <p className="shotlist-review-decision__body">{fb}</p>
      <div className="shotlist-review-decision__actions">
        <button
          type="button"
          className="shotlist-review-decision__btn shotlist-review-decision__btn--optimize"
          onClick={() => runReviewedOptimization(parentNodeId)}
        >
          执行优化
        </button>
        <button
          type="button"
          className="shotlist-review-decision__btn shotlist-review-decision__btn--pass"
          onClick={() => void approveReviewedAsIs(parentNodeId)}
        >
          维持现状并通过
        </button>
      </div>
      <p className="shotlist-review-decision__hint">
        决策将作用于父「分镜」节点：执行优化将按意见重跑分镜流水线；维持现状将终审通过并登记分镜资产。
      </p>
    </div>
  );
}
