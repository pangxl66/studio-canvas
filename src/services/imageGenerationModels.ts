export const IMAGE_GENERATION_MODELS = [
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    description: '推荐 · 快速生成与图片编辑',
    latencyLabel: '约 10s',
    badge: '推荐',
  },
  {
    id: 'image2',
    label: 'image2',
    description: '图片编辑与灯光色表生成',
    latencyLabel: '约 20s',
    badge: '可选',
  },
] as const;

export const STORYBOARD_GRID_IMAGE_MODELS = [
  IMAGE_GENERATION_MODELS[0],
  {
    ...IMAGE_GENERATION_MODELS[1],
    description: '九宫格分镜 · 版式与参考图生成',
    badge: '九宫格',
  },
] as const;

export type ImageGenerationModelId = (typeof STORYBOARD_GRID_IMAGE_MODELS)[number]['id'];

export const DEFAULT_IMAGE_GENERATION_MODEL: ImageGenerationModelId = 'gemini-3.1-flash-image';

export function isImageGenerationModelId(value: unknown): value is ImageGenerationModelId {
  return STORYBOARD_GRID_IMAGE_MODELS.some((model) => model.id === value);
}

export function resolveImageGenerationModel(value: unknown): ImageGenerationModelId {
  return isImageGenerationModelId(value) ? value : DEFAULT_IMAGE_GENERATION_MODEL;
}

export function imageGenerationModelOption(value: unknown) {
  const resolved = resolveImageGenerationModel(value);
  return (
    STORYBOARD_GRID_IMAGE_MODELS.find((model) => model.id === resolved)
    ?? STORYBOARD_GRID_IMAGE_MODELS[0]
  );
}

export function imageNodeModelOption(value: unknown) {
  const resolved = resolveImageGenerationModel(value);
  return (
    IMAGE_GENERATION_MODELS.find((model) => model.id === resolved)
    ?? IMAGE_GENERATION_MODELS[0]
  );
}
