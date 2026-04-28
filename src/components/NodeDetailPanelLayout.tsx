import type { ReactNode, RefObject } from 'react';
import type { NodeKind, NodeStatus } from '@/types/studio';

const STATUS_LABEL: Record<NodeStatus, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '生成中',
  WAITING_REVIEW: '待终裁',
  REVIEWED: '已阅',
  APPROVED: '已通过',
  REJECTED: '已驳回',
};

function NodeKindIcon({ kind }: { kind: NodeKind }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  if (kind === 'writing') {
    return (
      <svg {...common} aria-hidden>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M8 7h8M8 11h8M8 15h5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'storyboard') {
    return (
      <svg {...common} aria-hidden>
        <rect x="3" y="4" width="7" height="6" rx="1" />
        <rect x="14" y="4" width="7" height="6" rx="1" />
        <rect x="3" y="14" width="7" height="6" rx="1" />
        <rect x="14" y="14" width="7" height="6" rx="1" />
      </svg>
    );
  }
  if (kind === 'prompt') {
    return (
      <svg {...common} aria-hidden>
        <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" strokeLinejoin="round" />
        <path d="M5 19h14" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'shot_list_node') {
    return (
      <svg {...common} aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 9h10M7 13h6M7 17h8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" />
    </svg>
  );
}

export function NodeDetailPanelLayout(props: {
  kind: NodeKind;
  nodeLabel: string;
  nodeId: string;
  status: NodeStatus;
  leaderFeedback: string | null;
  headerActions?: ReactNode;
  footerTokens?: number | null;
  footerUpdatedAt?: number | null;
  onClose: () => void;
  /** 可滚动内容区 ref（如生成中滚到底） */
  bodyRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const {
    kind,
    nodeLabel,
    nodeId,
    status,
    leaderFeedback,
    headerActions,
    footerTokens,
    footerUpdatedAt,
    onClose,
    bodyRef,
    children,
  } = props;

  const fb = leaderFeedback?.trim() ?? '';
  const preview = fb.length > 160 ? `${fb.slice(0, 160)}…` : fb;

  return (
    <div className="node-detail-layout">
      <div className="node-detail-layout__chrome">
        <header className="node-detail-layout__header">
          <div className="node-detail-layout__header-left">
            <div className="node-detail-layout__icon" aria-hidden>
              <NodeKindIcon kind={kind} />
            </div>
            <div className="node-detail-layout__meta">
              <span className="node-detail-layout__label" title={nodeLabel}>
                {nodeLabel}
              </span>
              <code className="node-detail-layout__node-id" title={nodeId}>
                {nodeId}
              </code>
            </div>
          </div>
          <div className="node-detail-layout__header-right">
            {headerActions}
            <button type="button" className="node-detail-layout__close" onClick={onClose} aria-label="关闭详情">
              <span className="node-detail-layout__close-text">关闭</span>
              <span className="node-detail-layout__close-icon" aria-hidden>
                ×
              </span>
            </button>
          </div>
        </header>

        <div className={`node-detail-layout__status node-detail-layout__status--${status}`} role="status">
          <span className="node-detail-layout__status-badge">{STATUS_LABEL[status] ?? status}</span>
          <div className="node-detail-layout__leader-preview-wrap">
            {preview ? (
              <p className="node-detail-layout__leader-preview" title={fb}>
                {preview}
              </p>
            ) : (
              <p className="node-detail-layout__leader-preview node-detail-layout__leader-preview--muted">
                暂无审核/反馈摘要
              </p>
            )}
          </div>
        </div>
      </div>

      <div ref={bodyRef} className="node-detail-layout__body">
        {children}
      </div>

      <footer className="node-detail-layout__footer">
        <span className="node-detail-layout__footer-item">
          Token {footerTokens != null ? footerTokens.toLocaleString('zh-CN') : '—'}
        </span>
        <span className="node-detail-layout__footer-sep" aria-hidden>
          ·
        </span>
        <span className="node-detail-layout__footer-item">
          更新{' '}
          {footerUpdatedAt != null
            ? new Date(footerUpdatedAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—'}
        </span>
      </footer>
    </div>
  );
}
