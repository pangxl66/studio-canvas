import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';

/**
 * 画布镜头表节点顶部：父分镜「已阅」时显示黄色建议浮层与双按钮（作用在父分镜节点）。
 */
export function ShotListCanvasDecisionStrip(props: {
  parentId: string;
  parentData: StudioNodeData;
}) {
  const { parentId, parentData } = props;
  const runReviewedOptimization = useStudioStore((s) => s.runReviewedOptimization);
  const approveReviewedAsIs = useStudioStore((s) => s.approveReviewedAsIs);

  if (parentData.type !== 'storyboard' || parentData.status !== 'REVIEWED') return null;

  const fb = parentData.ai_review_feedback?.trim() || '（暂无审核正文，可直接确认或通过）';
  const suggestedPass = parentData.leader_review_suggested_pass === true;

  return (
    <div
      className="shot-list-canvas__decision-strip nodrag nopan nowheel"
      role="region"
      aria-label="审核与状态决策"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="shot-list-canvas__decision-strip-inner">
        <div className="shot-list-canvas__decision-main">
          <span className="shot-list-canvas__decision-label">AI 建议</span>
          {suggestedPass ? (
            <span className="shot-list-canvas__decision-tag shot-list-canvas__decision-tag--pass">倾向通过</span>
          ) : (
            <span className="shot-list-canvas__decision-tag shot-list-canvas__decision-tag--revise">建议修订</span>
          )}
          <p className="shot-list-canvas__decision-text">{fb}</p>
        </div>
        <div className="shot-list-canvas__decision-actions">
          <button
            type="button"
            className="shot-list-canvas__decision-btn shot-list-canvas__decision-btn--optimize nodrag nopan nowheel"
            onClick={() => runReviewedOptimization(parentId)}
          >
            <span aria-hidden>✨</span> 采纳并优化
          </button>
          <button
            type="button"
            className="shot-list-canvas__decision-btn shot-list-canvas__decision-btn--pass nodrag nopan nowheel"
            onClick={() => void approveReviewedAsIs(parentId)}
          >
            <span aria-hidden>✅</span> 确认通过
          </button>
        </div>
      </div>
    </div>
  );
}
