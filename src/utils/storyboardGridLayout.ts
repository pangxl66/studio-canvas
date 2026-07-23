export const STORYBOARD_GRID_MAX_PANELS = 9;

const GRID_NAMES = [
  '零',
  '单镜头',
  '二宫格',
  '三宫格',
  '四宫格',
  '五宫格',
  '六宫格',
  '七宫格',
  '八宫格',
  '九宫格',
] as const;

export function storyboardGridName(panelCount: number): string {
  const normalized = Math.max(0, Math.min(STORYBOARD_GRID_MAX_PANELS, Math.floor(panelCount)));
  return GRID_NAMES[normalized] ?? `${normalized} 格`;
}

export function storyboardGridLayout(panelCount: number, aspectRatio?: '16:9' | '9:16'): string {
  if (panelCount === 1) return '单幅画面铺满主体区域，不绘制宫格分隔线';
  if (panelCount === 2) return '一行两列，两个面板等大';
  if (panelCount === 3) return '一行三列，三个面板等大';
  if (panelCount === 4) return '两行两列，四个面板等大';
  if (panelCount === 5) return '第一行三个面板，第二行两个面板并居中排列';
  if (panelCount === 6) {
    return aspectRatio === '9:16' ? '三行两列，六个面板等大' : '两行三列，六个面板等大';
  }
  if (panelCount === 7) return '前两行各三个面板，最后一行一个面板并居中排列';
  if (panelCount === 8) return '前两行各三个面板，最后一行两个面板并居中排列';
  return '三行三列，九个面板等大';
}

/**
 * A 3×2 grid needs an 8:3 canvas (and a 2×3 portrait grid needs 3:8) for
 * every panel to retain the requested frame ratio without margins or crops.
 */
export function storyboardGridCanvasSize(
  panelCount: number,
  aspectRatio: '16:9' | '9:16',
): '1536x864' | '864x1536' | '1536x576' | '576x1536' {
  if (panelCount === 6) return aspectRatio === '9:16' ? '576x1536' : '1536x576';
  return aspectRatio === '9:16' ? '864x1536' : '1536x864';
}

/**
 * Geometry that lets both the full board and every panel keep the same aspect
 * ratio. Empty film-board margins are intentional; no post-generation crop is
 * required.
 */
export function storyboardGridGeometryInstruction(panelCount: number, aspectRatio: '16:9' | '9:16'): string {
  if (panelCount <= 1) return `单个面板铺满整张 ${aspectRatio} 画布。`;
  if (panelCount === 2) {
    return `几何硬约束：两个 ${aspectRatio} 面板各占画布宽度 1/2、高度 1/2；面板排成一行并垂直居中，画布上方和下方各保留 1/4 深色空白。`;
  }
  if (panelCount === 3) {
    return `几何硬约束：三个 ${aspectRatio} 面板各占画布宽度 1/3、高度 1/3；面板排成一行并垂直居中，画布上方和下方各保留 1/3 深色空白。`;
  }
  if (panelCount === 4) {
    return `几何硬约束：使用 2×2，四个 ${aspectRatio} 面板各占画布宽度 1/2、高度 1/2，完整铺满画布。`;
  }
  if (panelCount === 5) {
    return `几何硬约束：宫格只使用画布中央高度 2/3 的区域，画布上方和下方各保留严格 1/6 深色空白；第一行三个面板，第二行两个面板保持相同尺寸并水平居中。每个 ${aspectRatio} 面板的边界框严格占画布宽度 1/3、高度 1/3。禁止让两行宫格铺满画布高度，禁止生成正方形单格。`;
  }
  if (panelCount === 6) {
    return aspectRatio === '9:16'
      ? '六宫格专属几何硬约束：整张画布为 3:8，使用 2×3 三行两列并完整铺满画布；每个 9:16 面板严格占画布宽度 1/2、高度 1/3，不留外边距，不裁切，不生成正方形单格。'
      : '六宫格专属几何硬约束：整张画布为 8:3，使用 3×2 两行三列并完整铺满画布；每个 16:9 面板严格占画布宽度 1/3、高度 1/2，不留外边距，不裁切，不生成正方形单格。';
  }
  const lastRow = panelCount === 7
    ? '最后一行一个面板水平居中'
    : panelCount === 8
      ? '最后一行两个面板水平居中'
      : '最后一行三个面板';
  return `几何硬约束：使用三行布局，每个 ${aspectRatio} 面板严格占画布宽度 1/3、高度 1/3；前两行各三个面板，${lastRow}。`;
}

export function storyboardGridPagePanelCounts(shotCount: number): number[] {
  const normalized = Math.max(0, Math.floor(shotCount));
  const counts: number[] = [];
  for (let remaining = normalized; remaining > 0; remaining -= STORYBOARD_GRID_MAX_PANELS) {
    counts.push(Math.min(remaining, STORYBOARD_GRID_MAX_PANELS));
  }
  return counts;
}

export function storyboardGridActionLabel(shotCount: number): string {
  if (shotCount <= 0) return '生成分镜宫格图片';
  if (shotCount <= STORYBOARD_GRID_MAX_PANELS) return `生成${storyboardGridName(shotCount)}图片`;
  return `生成 ${storyboardGridPagePanelCounts(shotCount).length} 张分镜宫格`;
}
