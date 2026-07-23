import type { ReactNode } from 'react';

export type DetailPanelHeaderActionItem = {
  id: string;
  label: string;
  node: ReactNode;
};

/**
 * 保持纯渲染：只做简单换行，不再用测量 + setState 在渲染过程中切布局，
 * 避免详情头部在按钮数量/宽度变化时触发更新环。
 */
export function DetailPanelHeaderActionsBar(props: {
  items: DetailPanelHeaderActionItem[];
  pinnedCount?: number;
}) {
  const { items } = props;
  const pinnedCount = Math.max(0, Math.min(props.pinnedCount ?? items.length, items.length));
  const pinnedItems = items.slice(0, pinnedCount);
  const overflowItems = items.slice(pinnedCount);

  if (overflowItems.length === 0) {
    return (
      <div className="node-detail-header-actions-bar node-detail-header-actions-bar--inline">
        {pinnedItems.map((item) => (
          <span key={item.id} className="node-detail-header-actions-bar__slot" data-label={item.label}>
            {item.node}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="node-detail-header-actions-bar node-detail-header-actions-bar--split">
      <div className="node-detail-header-actions-bar__pinned">
        {pinnedItems.map((item) => (
          <span key={item.id} className="node-detail-header-actions-bar__slot" data-label={item.label}>
            {item.node}
          </span>
        ))}
      </div>
      <details className="node-detail-header-actions-bar__details">
        <summary className="node-detail-header-actions-bar__more" aria-label="更多节点操作">
          <span className="node-detail-header-actions-bar__more-icon" aria-hidden>
            ⋯
          </span>
          <span className="node-detail-header-actions-bar__more-label">更多</span>
        </summary>
        <div className="node-detail-header-actions-bar__dropdown">
          {overflowItems.map((item) => (
            <div key={item.id} className="node-detail-header-actions-bar__dropdown-row">
              <span className="node-detail-header-actions-bar__dropdown-label">{item.label}</span>
              <div className="node-detail-header-actions-bar__dropdown-control">{item.node}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
