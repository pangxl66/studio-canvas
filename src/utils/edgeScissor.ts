import { getBezierPath, type Edge, type InternalNode, type Node, Position } from '@xyflow/react';

type XY = { x: number; y: number };

function ccw(A: XY, B: XY, C: XY): boolean {
  return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
}

/** 线段相交（不含共线重叠的完整判定，足够划断检测） */
export function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function distPointToSegment(p: XY, a: XY, b: XY): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-9) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * abx;
  const qy = a.y + t * aby;
  return Math.hypot(p.x - qx, p.y - qy);
}

function parseBezierPath(path: string): { p0: XY; p1: XY; p2: XY; p3: XY } | null {
  const m = path.match(
    /^M\s*([\d.-]+)\s*,\s*([\d.-]+)\s+C\s*([\d.-]+)\s*,\s*([\d.-]+)\s+([\d.-]+)\s*,\s*([\d.-]+)\s+([\d.-]+)\s*,\s*([\d.-]+)\s*$/,
  );
  if (!m) return null;
  return {
    p0: { x: Number(m[1]), y: Number(m[2]) },
    p1: { x: Number(m[3]), y: Number(m[4]) },
    p2: { x: Number(m[5]), y: Number(m[6]) },
    p3: { x: Number(m[7]), y: Number(m[8]) },
  };
}

function cubicPoint(t: number, p0: XY, p1: XY, p2: XY, p3: XY): XY {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function sampleBezier(p0: XY, p1: XY, p2: XY, p3: XY, steps: number): XY[] {
  const pts: XY[] = [];
  for (let i = 0; i <= steps; i++) {
    pts.push(cubicPoint(i / steps, p0, p1, p2, p3));
  }
  return pts;
}

function handleCenter(
  node: InternalNode<Node>,
  handleId: string | null | undefined,
  role: 'source' | 'target',
): XY {
  const abs = node.internals.positionAbsolute;
  const list = node.internals.handleBounds?.[role];
  if (!list?.length) {
    const w = node.measured.width ?? 260;
    const h = node.measured.height ?? 120;
    return { x: abs.x + w / 2, y: abs.y + h / 2 };
  }
  const h =
    handleId != null && handleId !== ''
      ? list.find((x) => (x.id ?? '') === handleId)
      : list[0];
  if (!h) {
    const w = node.measured.width ?? 260;
    const hgt = node.measured.height ?? 120;
    return { x: abs.x + w / 2, y: abs.y + hgt / 2 };
  }
  return { x: abs.x + h.x + h.width / 2, y: abs.y + h.y + h.height / 2 };
}

function handlePosition(
  node: InternalNode<Node>,
  handleId: string | null | undefined,
  role: 'source' | 'target',
): Position {
  const list = node.internals.handleBounds?.[role];
  const h =
    handleId != null && handleId !== '' && list
      ? list.find((x) => (x.id ?? '') === handleId)
      : list?.[0];
  return h?.position ?? (role === 'source' ? Position.Right : Position.Left);
}

function edgeToSegments(
  edge: Edge,
  getInternalNode: (id: string) => InternalNode<Node> | undefined,
  bezierSteps: number,
): XY[] | null {
  const src = getInternalNode(edge.source);
  const tgt = getInternalNode(edge.target);
  if (!src || !tgt) return null;
  const p0 = handleCenter(src, edge.sourceHandle, 'source');
  const p3 = handleCenter(tgt, edge.targetHandle, 'target');
  const sp = handlePosition(src, edge.sourceHandle, 'source');
  const tp = handlePosition(tgt, edge.targetHandle, 'target');
  const [pathStr] = getBezierPath({
    sourceX: p0.x,
    sourceY: p0.y,
    sourcePosition: sp,
    targetX: p3.x,
    targetY: p3.y,
    targetPosition: tp,
  });
  const parsed = parseBezierPath(pathStr);
  if (!parsed) return sampleBezier(p0, p0, p3, p3, bezierSteps);
  return sampleBezier(parsed.p0, parsed.p1, parsed.p2, parsed.p3, bezierSteps);
}

function scissorSegments(points: XY[]): [XY, XY][] {
  const segs: [XY, XY][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push([points[i], points[i + 1]]);
  }
  return segs;
}

function edgeSegments(edgePts: XY[]): [XY, XY][] {
  const segs: [XY, XY][] = [];
  for (let i = 0; i < edgePts.length - 1; i++) {
    segs.push([edgePts[i], edgePts[i + 1]]);
  }
  return segs;
}

function scissorHitsEdge(scissor: [XY, XY][], edgePts: XY[], proximityFlow: number): boolean {
  const eSegs = edgeSegments(edgePts);
  for (const [a, b] of scissor) {
    for (const [c, d] of eSegs) {
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  for (const [a, b] of scissor) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const p of edgePts) {
      if (Math.hypot(p.x - mid.x, p.y - mid.y) < proximityFlow) return true;
    }
    for (const [c, d] of eSegs) {
      if (distPointToSegment(mid, c, d) < proximityFlow) return true;
    }
  }
  return false;
}

/**
 * 根据画布 flow 坐标下的剪刀轨迹，找出被划过的边 id（与默认 Bezier 边几何近似求交）。
 */
export function findEdgesCutByScissor(
  edges: Edge[],
  scissorFlowPoints: XY[],
  getInternalNode: (id: string) => InternalNode<Node> | undefined,
  viewportZoom: number,
): string[] {
  if (scissorFlowPoints.length < 2) return [];
  const proximityFlow = Math.max(6, 14 / Math.max(viewportZoom, 0.05));
  const scissors = scissorSegments(scissorFlowPoints);
  const hit: string[] = [];
  for (const e of edges) {
    const samples = edgeToSegments(e, getInternalNode, 40);
    if (!samples) continue;
    if (scissorHitsEdge(scissors, samples, proximityFlow)) {
      hit.push(e.id);
    }
  }
  return hit;
}
