import { Panel, useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { useStudioStore } from '@/store/useStudioStore';

/** Dagre 整理画布后自动 fitView */
export function CanvasLayoutButton() {
  const layoutCanvasWithDagre = useStudioStore((s) => s.layoutCanvasWithDagre);
  const { fitView } = useReactFlow();

  const onClick = useCallback(() => {
    layoutCanvasWithDagre();
    queueMicrotask(() => {
      setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 0);
    });
  }, [layoutCanvasWithDagre, fitView]);

  return (
    <Panel position="top-right" className="studio-layout-panel">
      <button type="button" className="studio-layout-panel__btn nodrag nopan" onClick={onClick} title="按连线层级自动排列">
        整理画布
      </button>
    </Panel>
  );
}
