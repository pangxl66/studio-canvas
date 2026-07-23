export const IMAGE_NODE_DEFAULT_WIDTH = 560;
export const IMAGE_NODE_DEFAULT_MEDIA_HEIGHT = 315;

export type ImageNodeLayout = {
  nodeWidth: number;
  mediaHeight: number;
  sourceAspectRatio: number;
  preservesSourceRatio: boolean;
};

function validDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * 按图片真实比例决定节点尺寸。常见横、竖、方图保持原比例；极端长图只限制画布占用。
 */
export function imageNodeLayout(width: unknown, height: unknown): ImageNodeLayout {
  if (!validDimension(width) || !validDimension(height)) {
    return {
      nodeWidth: IMAGE_NODE_DEFAULT_WIDTH,
      mediaHeight: IMAGE_NODE_DEFAULT_MEDIA_HEIGHT,
      sourceAspectRatio: 16 / 9,
      preservesSourceRatio: true,
    };
  }

  const ratio = width / height;
  const nodeWidth =
    ratio < 0.72 ? 360 : ratio < 0.92 ? 420 : ratio <= 1.15 ? 480 : ratio <= 1.8 ? 560 : 640;
  const idealHeight = nodeWidth / ratio;
  const mediaHeight = Math.round(Math.min(680, Math.max(220, idealHeight)));

  return {
    nodeWidth,
    mediaHeight,
    sourceAspectRatio: ratio,
    preservesSourceRatio: Math.abs(mediaHeight - idealHeight) < 1,
  };
}
