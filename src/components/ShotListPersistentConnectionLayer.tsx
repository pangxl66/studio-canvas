import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStudioStore } from '@/store/useStudioStore';
import { parseShotListItemOutputHandleId } from '@/utils/shotListWire';

type PersistentConnectionPath = {
  edgeId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

type PersistentConnectionElements = {
  edgeId: string;
  sourceHandle: HTMLElement | null;
  targetHandle: HTMLElement | null;
  targetNode: HTMLElement | null;
};

function pathD({ fromX, fromY, toX, toY }: PersistentConnectionPath): string {
  const bend = Math.max(48, Math.abs(toX - fromX) * 0.45);
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`;
}

function rectCenter(rect: DOMRect): { x: number; y: number } | null {
  if (rect.width <= 0 && rect.height <= 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function pathsMatch(
  previous: PersistentConnectionPath[],
  next: PersistentConnectionPath[],
): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((path, index) => {
    const candidate = next[index];
    return (
      path.edgeId === candidate.edgeId &&
      Math.abs(path.fromX - candidate.fromX) < 0.5 &&
      Math.abs(path.fromY - candidate.fromY) < 0.5 &&
      Math.abs(path.toX - candidate.toX) < 0.5 &&
      Math.abs(path.toY - candidate.toY) < 0.5
    );
  });
}

export function ShotListPersistentConnectionLayer() {
  const edges = useStudioStore((state) => state.edges);
  const relevantEdges = useMemo(
    () =>
      edges.filter(
        (edge) => parseShotListItemOutputHandleId(edge.sourceHandle) != null,
      ),
    [edges],
  );
  const edgeSignature = useMemo(
    () =>
      relevantEdges
        .map(
          (edge) =>
            `${edge.id}:${edge.source}:${edge.sourceHandle ?? ''}:${edge.target}:${edge.targetHandle ?? ''}`,
        )
        .join('|'),
    [relevantEdges],
  );
  const relevantEdgesRef = useRef(relevantEdges);
  relevantEdgesRef.current = relevantEdges;
  const [paths, setPaths] = useState<PersistentConnectionPath[]>([]);
  const frameRef = useRef<number | null>(null);
  const elementsRef = useRef<PersistentConnectionElements[]>([]);

  const selectEdge = useCallback((edgeId: string) => {
    const state = useStudioStore.getState();
    state.onEdgesChange(
      state.edges.map((edge) => ({
        type: 'select' as const,
        id: edge.id,
        selected: edge.id === edgeId,
      })),
    );
  }, []);

  useEffect(() => {
    const resolveElements = () => {
      const handles = Array.from(
        document.querySelectorAll<HTMLElement>('.react-flow__handle[data-nodeid]'),
      );
      const handleMap = new Map<string, HTMLElement>();
      for (const handle of handles) {
        const nodeId = handle.dataset.nodeid;
        const handleId = handle.dataset.handleid;
        if (!nodeId || !handleId) continue;
        const handleType = handle.classList.contains('source') ? 'source' : 'target';
        handleMap.set(`${nodeId}\u0000${handleId}\u0000${handleType}`, handle);
      }
      const nodeMap = new Map(
        Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node[data-id]'))
          .filter((node) => Boolean(node.dataset.id))
          .map((node) => [node.dataset.id!, node]),
      );

      elementsRef.current = relevantEdgesRef.current.map((edge) => {
        const sourceHandle = edge.sourceHandle
          ? handleMap.get(`${edge.source}\u0000${edge.sourceHandle}\u0000source`) ?? null
          : null;
        const targetHandle = edge.targetHandle
          ? handleMap.get(`${edge.target}\u0000${edge.targetHandle}\u0000target`) ?? null
          : handles.find(
              (handle) =>
                handle.dataset.nodeid === edge.target && handle.classList.contains('target'),
            ) ?? null;
        return {
          edgeId: edge.id,
          sourceHandle,
          targetHandle,
          targetNode: nodeMap.get(edge.target) ?? null,
        };
      });
    };

    const measure = () => {
      frameRef.current = null;
      const nextPaths: PersistentConnectionPath[] = [];
      for (const elements of elementsRef.current) {
        const from = elements.sourceHandle?.isConnected
          ? rectCenter(elements.sourceHandle.getBoundingClientRect())
          : null;
        if (!from) continue;

        let to = elements.targetHandle?.isConnected
          ? rectCenter(elements.targetHandle.getBoundingClientRect())
          : null;
        if (!to && elements.targetNode?.isConnected) {
          const targetRect = elements.targetNode.getBoundingClientRect();
          if (targetRect && (targetRect.width > 0 || targetRect.height > 0)) {
            to = { x: targetRect.left, y: targetRect.top + targetRect.height / 2 };
          }
        }
        if (!to) continue;
        nextPaths.push({
          edgeId: elements.edgeId,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
        });
      }
      setPaths((previous) => (pathsMatch(previous, nextPaths) ? previous : nextPaths));
    };

    const scheduleMeasure = () => {
      if (frameRef.current != null) return;
      frameRef.current = window.requestAnimationFrame(measure);
    };

    const resolveAndScheduleMeasure = () => {
      resolveElements();
      scheduleMeasure();
    };

    resolveElements();
    measure();
    window.addEventListener('resize', scheduleMeasure);
    document.addEventListener('scroll', scheduleMeasure, true);

    const flowViewport = document.querySelector<HTMLElement>('.react-flow__viewport');
    const mutationObserver = flowViewport
      ? new MutationObserver((records) => {
          if (
            records.some(
              (record) =>
                record.type === 'childList' ||
                (record.type === 'attributes' && record.attributeName === 'class'),
            )
          ) {
            resolveAndScheduleMeasure();
            return;
          }
          scheduleMeasure();
        })
      : null;
    if (flowViewport) {
      mutationObserver?.observe(flowViewport, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }

    const flowRoot = document.querySelector<HTMLElement>('.react-flow');
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(resolveAndScheduleMeasure)
        : null;
    if (flowRoot) resizeObserver?.observe(flowRoot);

    return () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', scheduleMeasure);
      document.removeEventListener('scroll', scheduleMeasure, true);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [edgeSignature]);

  if (typeof document === 'undefined' || relevantEdges.length === 0) return null;
  return createPortal(
    <svg
      className="shot-list-canvas__persistent-connection-layer"
      data-edge-count={paths.length}
      data-relevant-edge-count={relevantEdges.length}
      viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
      aria-hidden
    >
      {paths.map((path) => (
        <path
          key={path.edgeId}
          data-edge-id={path.edgeId}
          d={pathD(path)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            selectEdge(path.edgeId);
          }}
        />
      ))}
    </svg>,
    document.body,
  );
}
