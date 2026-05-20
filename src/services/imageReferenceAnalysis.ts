import { getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';
import { requestLLMWithImage } from '@/services/ModelGateway';

function stripWrapper(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```(?:text|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  return text
    .replace(/^画面分析[:：]\s*/i, '')
    .replace(/^图片分析[:：]\s*/i, '')
    .trim();
}

function buildImageReferenceSystemPrompt(): string {
  return [
    '你是影视画面分析师，专门为中文短剧、分镜和视觉动作描述提供画面依据。',
    '请只依据图片中可见的信息分析，不要编造图片外的剧情。',
    '输出必须是中文纯文本，不要 JSON，不要 Markdown，不要分点编号。',
    '请重点覆盖：时间/环境、空间位置、景别与构图、人物数量与姿态、表情与视线、服化道、光线色彩、氛围、可用于后续动作续写的视觉约束。',
  ].join('\n');
}

function buildImageReferenceUserPrompt(): string {
  return [
    '请分析这张图片，生成一段 120-220 字的影视画面说明。',
    '说明要能被文本润色节点直接引用，用来把用户输入的动作/情绪扩写成更贴合图片的描述。',
    '不要写“我看到”“图片中显示”等元叙述，直接描述画面。',
  ].join('\n');
}

export async function analyzeImageReference(params: {
  imageDataUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const gateway = getResolvedVisionLlmGatewayConfig();
  if (!gateway) {
    throw new Error('未配置可用模型网关。请先在设置里填写代理 URL，或配置 Base URL 与 API Key。');
  }

  const model = gateway.model?.trim();
  const result = await requestLLMWithImage(gateway, {
    model,
    imageDataUrl: params.imageDataUrl,
    imageDetail: 'auto',
    systemPrompt: buildImageReferenceSystemPrompt(),
    userPrompt: buildImageReferenceUserPrompt(),
    temperature: 0.16,
    jsonMode: false,
    feature: 'image-text-polish',
    maxOutputTokens: 900,
    signal: params.signal,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  const summary = stripWrapper(result.content);
  if (!summary) {
    throw new Error('模型没有返回可用的画面分析。');
  }
  return summary;
}
