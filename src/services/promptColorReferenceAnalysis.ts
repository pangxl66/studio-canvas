import { getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';

function stripWrapper(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```(?:text|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  return text
    .replace(/^色彩表分析[:：]\s*/i, '')
    .replace(/^色彩分析[:：]\s*/i, '')
    .trim();
}

function buildSystemPrompt(): string {
  return [
    '你是影视摄影与调色分析师，负责把色彩表、电影截图、灯光参考图转换成可执行的灯光与色彩约束。',
    '只分析图片中可见的色彩和光影关系，不编造人物、剧情、地点、时代或图片外光源。',
    '这张图片只作为色彩与灯光参考，不是角色、场景或道具资产。',
    '输出中文纯文本，不要 JSON，不要 Markdown，不要编号。',
    '必须依次写出：主色底、辅助色、点睛色、整体色温、明暗与对比、高光与暗部、光源方向与软硬、饱和度与质感、应用规则、禁止偏移。',
    '若无法从图片确定真实光源，只描述可见的受光结果，不虚构灯具位置、色温数值或光比数值。',
    '不要给出无来源的 RGB、HEX、色温、光比、百分比等伪精确数字。',
  ].join('\n');
}

function buildUserPrompt(): string {
  return [
    '请读取这张色彩表图片，生成一段 180-320 字的影视色彩与灯光分析。',
    '结果将直接注入分镜提示词的“灯光布置与基调”字段。',
    '要描述颜色之间的层级关系、冷暖关系、主体与背景的明暗分配、暗部是否保留细节、高光如何滚降，以及应该避免的色偏。',
    '不要描述或复述图片中的具体人物身份、场景名称、道具内容和构图事件。',
  ].join('\n');
}

export async function analyzePromptColorReference(params: {
  imageDataUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const gateway = getResolvedVisionLlmGatewayConfig();
  if (!gateway) {
    throw new Error('未配置可用视觉模型网关。请先在设置里填写代理 URL，或配置 Base URL 与 API Key。');
  }

  const { requestLLMWithImage } = await import('@/services/ModelGateway');
  const result = await requestLLMWithImage(gateway, {
    model: gateway.model?.trim(),
    imageDataUrl: params.imageDataUrl,
    imageDetail: 'high',
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt(),
    temperature: 0.1,
    jsonMode: false,
    feature: 'prompt-color-reference',
    maxOutputTokens: 1100,
    signal: params.signal,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  const summary = stripWrapper(result.content);
  if (!summary) {
    throw new Error('模型没有返回可用的色彩表分析。');
  }
  return summary;
}
