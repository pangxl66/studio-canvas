import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import { findEdgesCutByScissor } from '@/utils/edgeScissor';

/**
 * 右键按住拖动：显示剪刀与轨迹，划过的连线将被断开（与 removeEdges 一致刷新合并输入）。
 */
export function ScissorCutLayer() {
  const removeEdges = useStudioStore((s) => s.removeEdges);
  const rf = useReactFlow();
  const rfRef = useRef(rf);
  rfRef.current = rf;

  const [cutting, setCutting] = useState(false);
  const [screenTrail, setScreenTrail] = useState<{ x: number; y: number }[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const flowPointsRef = useRef<{ x: number; y: number }[]>([]);
  const cuttingRef = useRef(false);

  useEffect(() => {
    const finishCut = () => {
      if (!cuttingRef.current) return;
      cuttingRef.current = false;
      setCutting(false);
      setCursor(null);
      const pts = [...flowPointsRef.current];
      flowPointsRef.current = [];
      setScreenTrail([]);
      const { edges } = useStudioStore.getState();
      const api = rfRef.current;
      const zoom = api.getViewport().zoom;
      const ids = findEdgesCutByScissor(edges, pts, api.getInternalNode, zoom);
      if (ids.length > 0) {
        removeEdges(ids);
      }
    };

    const isOnPaneOnly = (el: HTMLElement | null) =>
      Boolean(el?.closest?.('.react-flow__pane')) && !el?.closest?.('.react-flow__node');

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      const t = e.target as HTMLElement | null;
      /** pane 包裹了节点，必须排除节点，否则会吞掉节点右键菜单 */
      if (!isOnPaneOnly(t)) return;
      e.preventDefault();
      cuttingRef.current = true;
      setCutting(true);
      const flow = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      flowPointsRef.current = [flow];
      setScreenTrail([{ x: e.clientX, y: e.clientY }]);
      setCursor({ x: e.clientX, y: e.clientY });
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!cuttingRef.current) return;
      if ((e.buttons & 2) === 0) return;
      e.preventDefault();
      const last = flowPointsRef.current[flowPointsRef.current.length - 1];
      const flow = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (last && Math.hypot(flow.x - last.x, flow.y - last.y) < 2) {
        setCursor({ x: e.clientX, y: e.clientY });
        return;
      }
      flowPointsRef.current.push(flow);
      setScreenTrail((prev) => [...prev, { x: e.clientX, y: e.clientY }]);
      setCursor({ x: e.clientX, y: e.clientY });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!cuttingRef.current || e.button !== 2) return;
      e.preventDefault();
      finishCut();
    };

    const onContextMenu = (e: Event) => {
      const el = e.target as HTMLElement | null;
      /** 仅空白画布上屏蔽浏览器菜单；节点/边等保留，供 onNodeContextMenu 等 */
      if (isOnPaneOnly(el)) {
        e.preventDefault();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', finishCut, true);
    window.addEventListener('contextmenu', onContextMenu, true);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', finishCut, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [removeEdges]);

  if (!cutting || !cursor) return null;

  const pointsAttr = screenTrail.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <>
      <svg className="scissor-cut-overlay" aria-hidden>
        {screenTrail.length >= 2 ? (
          <polyline
            points={pointsAttr}
            fill="none"
            stroke="rgba(255, 120, 90, 0.92)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="6 4"
          />
        ) : null}
      </svg>
      <div
        className="scissor-cut-cursor"
        style={{ left: cursor.x, top: cursor.y }}
        aria-hidden
      >
        ✂️
      </div>
    </>
  );
}
