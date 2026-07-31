import { getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';
import { normalizeLightingPaletteSceneName } from '@/services/shipLightingPaletteContract';

export async function identifyLightingPaletteScene(params: {
  imageDataUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const gateway = getResolvedVisionLlmGatewayConfig();
  if (!gateway) {
    throw new Error('未配置可用的视觉模型，无法先识别色表对应的场景。');
  }

  const { requestLLMWithImage } = await import('@/services/ModelGateway');
  const result = await requestLLMWithImage(gateway, {
    model: gateway.model?.trim(),
    imageDataUrl: params.imageDataUrl,
    imageDetail: 'high',
    systemPrompt: [
      '你是影视场景识别助手。',
      '只依据图片中可见的环境与空间类型，给出一个简短、可用作资产名称的中文场景名。',
      '名称应包含空间类型或环境，例如“飞船内景”“古寺大殿”“雨夜街道”“现代客厅”。',
      '不要写人物、动作、镜头景别、情绪、色彩、形容句或无法确认的专有地名。',
      '输出严格为 JSON：{"sceneName":"场景名"}。',
    ].join('\n'),
    userPrompt: '识别这张参考图的场景。场景名控制在 2–8 个汉字，禁止包含“色表”或“灯光色表”。',
    temperature: 0.05,
    jsonMode: true,
    feature: 'image-palette-scene-identify',
    maxOutputTokens: 120,
    signal: params.signal,
  });

  if (!result.ok) throw new Error(`场景识别失败：${result.error.message}`);
  const sceneName = normalizeLightingPaletteSceneName(result.content);
  if (sceneName === '场景') throw new Error('视觉模型没有返回可用的场景名称。');
  return sceneName;
}
