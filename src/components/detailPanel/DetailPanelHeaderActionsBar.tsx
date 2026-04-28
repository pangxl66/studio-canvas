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

  return (
    <div className="node-detail-header-actions-bar node-detail-header-actions-bar--inline">
      {items.map((i) => (
        <span key={i.id} className="node-detail-header-actions-bar__slot" data-label={i.label}>
          {i.node}
        </span>
      ))}
    </div>
  );
}
