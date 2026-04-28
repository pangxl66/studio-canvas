import { useMemo } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { PipelineResolutionHistoryEntry, StudioNodeData } from '@/types/studio';
import {
  formatReviewedNodeCurrentContent,
  suggestionPointsFromFeedback,
} from '@/utils/pipelineReviewContentPreview';

function histKindLabel(e: PipelineResolutionHistoryEntry): string {
  if (e.kind === 'ai_optimize') return 'AI 优化';
  return '人工通过（维持现状）';
}

export function PipelineReviewDecisionPanel(props: { nodeId: string; node: StudioNodeData }) {
  const { nodeId, node } = props;
  const runReviewedOptimization = useStudioStore((s) => s.runReviewedOptimization);
  const approveReviewedAsIs = useStudioStore((s) => s.approveReviewedAsIs);

  if (node.status !== 'REVIEWED') return null;

  const fb = node.ai_review_feedback?.trim() || '（暂无总监审核正文）';
  const suggestedPass = node.leader_review_suggested_pass === true;
  const hist = node.pipeline_resolution_history ?? [];

  const currentContent = useMemo(() => formatReviewedNodeCurrentContent(node), [node]);
  const suggestionPoints = useMemo(() => suggestionPointsFromFeedback(fb), [fb]);

  return (
    <div className="pipeline-reviewed-decision" role="region" aria-label="总监已阅 · 请选择后续操作">
      <div className="pipeline-reviewed-decision__banner">
        <span className="pipeline-reviewed-decision__banner-title">总监已阅</span>
        {suggestedPass ? (
          <span className="pipeline-reviewed-decision__banner-tag" title="自动审核倾向">
            审核建议通过
          </span>
        ) : (
          <span className="pipeline-reviewed-decision__banner-tag pipeline-reviewed-decision__banner-tag--revise">
            建议修订
          </span>
        )}
      </div>

      {!suggestedPass ? (
        <div className="pipeline-reviewed-decision__compare" aria-label="当前产出与修改建议对比">
          <div className="pipeline-reviewed-decision__compare-col">
            <div className="pipeline-reviewed-decision__compare-label">当前产出</div>
            <pre className="pipeline-reviewed-decision__compare-pre pipeline-reviewed-decision__compare-pre--content">
              {currentContent}
            </pre>
          </div>
          <div className="pipeline-reviewed-decision__compare-divider" aria-hidden />
          <div className="pipeline-reviewed-decision__compare-col">
            <div className="pipeline-reviewed-decision__compare-label">修改建议点</div>
            <ul className="pipeline-reviewed-decision__suggest-list">
              {suggestionPoints.map((pt, i) => (
                <li key={i} className="pipeline-reviewed-decision__suggest-item">
                  {pt}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="pipeline-reviewed-decision__feedback-block">
          <div className="pipeline-reviewed-decision__feedback-label">审核意见</div>
          <p className="pipeline-reviewed-decision__feedback-text">{fb}</p>
        </div>
      )}

      <div className="pipeline-reviewed-decision__actions pipeline-reviewed-decision__actions--large">
        <button
          type="button"
          className="pipeline-reviewed-decision__btn pipeline-reviewed-decision__btn--recalc"
          onClick={() => runReviewedOptimization(nodeId)}
        >
          <span className="pipeline-reviewed-decision__btn-emoji" aria-hidden>
            ✨
          </span>
          采纳建议并重算
        </button>
        <button
          type="button"
          className="pipeline-reviewed-decision__btn pipeline-reviewed-decision__btn--pass"
          onClick={() => approveReviewedAsIs(nodeId)}
        >
          <span className="pipeline-reviewed-decision__btn-emoji" aria-hidden>
            ✅
          </span>
          忽略建议直接通过
        </button>
      </div>
      <p className="pipeline-reviewed-decision__hint">
        「采纳建议并重算」将结合总监意见重新跑员工与总监；「忽略建议直接通过」立即终审并激活 Output。操作会记入节点历史，画布节点会短暂高亮提示状态。
      </p>

      {hist.length > 0 ? (
        <div className="pipeline-reviewed-decision__history">
          <div className="pipeline-reviewed-decision__history-title">决策历史</div>
          <ul className="pipeline-reviewed-decision__history-list">
            {hist.map((e, i) => (
              <li key={`${e.at}-${i}`} className="pipeline-reviewed-decision__history-item">
                <span className="pipeline-reviewed-decision__history-kind">{histKindLabel(e)}</span>
                <span className="pipeline-reviewed-decision__history-summary">{e.summary}</span>
                <time className="pipeline-reviewed-decision__history-time" dateTime={new Date(e.at).toISOString()}>
                  {new Date(e.at).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
