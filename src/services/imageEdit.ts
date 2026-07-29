import type { StudioRFNode } from '@/types/reactFlow';
import type { StoryboardGridImageSize } from '@/services/storyboardGridImage';

export type ImageEditAspectRatio = 'source' | '16:9' | '9:16' | '1:1';

export type ImageEditSource = {
  nodeId: string;
  label: string;
  dataUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  signature: string;
};

export type ImageEditSourceContext = {
  source: ImageEditSource | null;
};

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function resolveImageEditSource(
  imageNodeId: string,
  nodes: StudioRFNode[],
): ImageEditSourceContext {
  const sourceNode = nodes.find(
    (node) =>
      node.id === imageNodeId &&
      node.type === 'imageNode' &&
      node.data.type === 'image_node',
  );
  if (!sourceNode) return { source: null };

  const dataUrl = sourceNode.data.imageDataUrl?.trim() || undefined;
  return {
    source: {
      nodeId: sourceNode.id,
      label: sourceNode.data.imageFileName?.trim() || sourceNode.data.label?.trim() || '当前图片',
      dataUrl,
      mimeType: sourceNode.data.imageMimeType?.trim() || undefined,
      width: sourceNode.data.imageWidth,
      height: sourceNode.data.imageHeight,
      signature: [
        sourceNode.id,
        sourceNode.data.version,
        sourceNode.data.imageGenerationCompletedAt ?? '',
        dataUrl?.length ?? 0,
        dataUrl ? hashText(dataUrl) : 'empty',
      ].join(':'),
    },
  };
}

export function imageEditOutputSize(
  aspectRatio: ImageEditAspectRatio,
  sourceWidth?: number,
  sourceHeight?: number,
): StoryboardGridImageSize {
  if (aspectRatio === '16:9') return '1536x864';
  if (aspectRatio === '9:16') return '864x1536';
  if (aspectRatio === '1:1') return '1536x1536';

  const width = Number(sourceWidth);
  const height = Number(sourceHeight);
  if (!(width > 0) || !(height > 0)) return '1536x1536';
  const ratio = width / height;
  if (ratio >= 1.5) return '1536x864';
  if (ratio >= 1.12) return '1536x1024';
  if (ratio <= 2 / 3) return '864x1536';
  if (ratio <= 0.9) return '1024x1536';
  return '1536x1536';
}
