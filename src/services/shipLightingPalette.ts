import {
  prepareImageEditReference,
  type StoryboardGridImageResult,
  type StoryboardGridReferenceImage,
} from '@/services/storyboardGridImage';
import {
  SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT,
  SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH,
} from '@/services/shipLightingPaletteContract';

export {
  buildShipLightingPalettePrompt,
  lightingPaletteTitle,
  normalizeLightingPaletteSceneName,
  SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT,
  SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH,
  SHIP_LIGHTING_PALETTE_REQUEST_SIZE,
  SHIP_LIGHTING_PALETTE_SKILL_ID,
} from '@/services/shipLightingPaletteContract';

const layoutReferenceUrl = new URL(
  '../assets/ship-lighting-palette-layout-reference.png',
  import.meta.url,
).href;

let layoutReferenceDataUrlPromise: Promise<string> | null = null;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('色表版式参考图读取失败。'));
    reader.readAsDataURL(blob);
  });
}

async function loadLayoutReferenceDataUrl(): Promise<string> {
  if (!layoutReferenceDataUrlPromise) {
    layoutReferenceDataUrlPromise = fetch(layoutReferenceUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`色表版式参考图加载失败（HTTP ${response.status}）。`);
        return response.blob();
      })
      .then(blobToDataUrl)
      .catch((error) => {
        layoutReferenceDataUrlPromise = null;
        throw error;
      });
  }
  return layoutReferenceDataUrlPromise;
}

export async function prepareShipLightingPaletteReferences(
  sourceDataUrl: string,
  sourceLabel: string,
): Promise<StoryboardGridReferenceImage[]> {
  const [sourceReference, layoutDataUrl] = await Promise.all([
    prepareImageEditReference(sourceDataUrl, `颜色来源：${sourceLabel}`),
    loadLayoutReferenceDataUrl(),
  ]);
  return [
    sourceReference,
    {
      dataUrl: layoutDataUrl,
      name: '固定色表版式模板（只参考布局，禁止复制颜色数据）',
      kind: 'layout',
    },
  ];
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('色表图片读取失败，无法校正为 1920×1080。'));
    image.src = dataUrl;
  });
}

export async function normalizeShipLightingPaletteImage(
  result: StoryboardGridImageResult,
): Promise<StoryboardGridImageResult> {
  const image = await loadImage(result.imageDataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error('色表图片没有有效尺寸。');

  const canvas = document.createElement('canvas');
  canvas.width = SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH;
  canvas.height = SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法校正色表画布。');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = 'rgb(5, 10, 7)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const targetWidth = Math.round(sourceWidth * scale);
  const targetHeight = Math.round(sourceHeight * scale);
  const targetX = Math.round((canvas.width - targetWidth) / 2);
  const targetY = Math.round((canvas.height - targetHeight) / 2);
  context.drawImage(image, targetX, targetY, targetWidth, targetHeight);

  return {
    ...result,
    imageDataUrl: canvas.toDataURL('image/png'),
    size: `${SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH}x${SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT}`,
    width: SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH,
    height: SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT,
  };
}
