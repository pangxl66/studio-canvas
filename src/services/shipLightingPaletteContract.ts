export const SHIP_LIGHTING_PALETTE_SKILL_ID = 'scene-lighting-palette@1.1.0';
export const SHIP_LIGHTING_PALETTE_REQUEST_SIZE = '1536x864' as const;
export const SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH = 1920;
export const SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT = 1080;

export function normalizeLightingPaletteSceneName(raw: string): string {
  const unwrapped = raw
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let candidate = unwrapped;
  try {
    const parsed = JSON.parse(unwrapped) as { sceneName?: unknown };
    if (typeof parsed.sceneName === 'string') candidate = parsed.sceneName;
  } catch {
    const match = unwrapped.match(/"sceneName"\s*:\s*"([^"]+)"/i);
    if (match?.[1]) candidate = match[1];
  }
  const cleaned = candidate
    .replace(/^(场景名称|场景名|场景)[:：]\s*/i, '')
    .replace(/(?:灯光)?色表$/i, '')
    .replace(/[《》【】"'“”‘’]/g, '')
    .replace(/[，。；;、|/\\]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  return cleaned.slice(0, 12) || '场景';
}

export function lightingPaletteTitle(sceneName: string): string {
  return `${normalizeLightingPaletteSceneName(sceneName)}色表`;
}

export function buildShipLightingPalettePrompt(
  sourceLabel: string,
  sceneName: string,
): string {
  const normalizedSceneName = normalizeLightingPaletteSceneName(sceneName);
  const title = lightingPaletteTitle(normalizedSceneName);
  return [
    `任务：参考图 1“${sourceLabel}”已经过场景识别，场景名称为“${normalizedSceneName}”。请分析它的真实像素颜色，生成一张专业的“${title}”。`,
    '场景识别结果只用于标题和色彩功能命名；不得重绘原场景，不得把参考图缩略图放进色表。',
    '参考图职责：参考图 1 是唯一颜色数据来源；参考图 2 是固定版式模板，只复用它的标题层级、四列网格、间距和信息位置，严禁复制参考图 2 中的颜色、HEX、RGB、比例或名称。',
    '输出必须是 16:9 横版纯色分析板，不要重绘原场景，不要放原图缩略图，不要添加品牌、logo、水印、装饰纹理、渐变背景、阴影特效或发光描边。',
    '画布与风格：最终交付会校正为 1920×1080 PNG；背景使用近黑色 RGB(5,10,7)，整体简洁、专业、克制，像工业设计色彩分析板。',
    `左上角标题必须逐字为：${title}  /  Extracted Color Palette`,
    '副标题必须逐字为：按原图主导色 + 高光灯光色提取；HEX / RGB / 画面占比。',
    'A 区标题必须逐字为：A. 画面主导色  /  Dominant palette',
    'A 区必须包含且仅包含 20 个主导色，严格四列×五行，按全图像素占比从高到低排列。每个色块内部显示准确 HEX 与 RGB；色块下方显示保留两位小数的画面占比，以及“中文色名 / 画面功能或位置”。',
    `中文用途名称必须结合已经识别出的“${normalizedSceneName}”场景，描述真实可见的位置、材质、受光面或环境功能；不得把所有图片都写成舱壁、舱道或飞船设备。`,
    '主导色分析要求：模拟 K-means++ 像素聚类，保留暗部层级，区分纯黑、棕黑、青黑、墨绿黑、枪灰、暖棕金属、冷蓝钢灰等；不要把所有暗色合并，不要使用“颜色1”“深色”等空泛名称。',
    'B 区标题必须逐字为：B. 灯光与高光色  /  Practical & highlight colors',
    'B 区必须包含且仅包含 4 个代表性灯光或高光色，严格四列×一行。必须从参考图 1 的真实高光区域提取，优先覆盖真实存在的暖色灯芯、冷青环境光、红色警示光、绿色状态光或中性高光；不存在的类型改用图中其他真实高光，严禁凭空编造。',
    'B 区每个色块内部显示准确 HEX 与 RGB；下方显示该高光类别占全图的两位小数比例，以及“中文功能名 / 使用场景”。代表色采用较亮像素的稳健中位数，避免单个过曝像素污染。',
    '底部说明必须逐字为：色彩比例基于原图像素聚类；高光区域单独分析，便于灯光迁移与场景重打光。',
    '质量硬约束：中文必须完整清晰，无乱码、错别字或方框；HEX 与 RGB 必须彼此一致；不得重复色；A 区必须 20 色，B 区必须 4 色；除场景化主标题外，不要自行改变栏目名称或网格结构。',
  ].join('\n');
}
