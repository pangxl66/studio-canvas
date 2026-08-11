import { getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';

export const IMAGE_REFERENCE_ANALYSIS_VERSION = 2;

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
    '必须额外识别场景的动态潜力，并明确区分：持续环境动态、由剧情触发的物理/灯光变化、必须保持稳定的静态结构。',
    '持续环境动态只写有可见来源或物理依据的内容，例如烟雾/薄雾的缓慢漂移、蒸汽喷吐、尘粒沉降、水面波纹、雨雪、布料摆动、风扇/机械运转、反射随运动变化；同时写清来源、方向、速度、密度、重力/气流影响和遮挡反馈。',
    '灯光默认稳定。只有画面可见故障灯、警示灯、旋转灯、火焰、电弧，或剧情明确包含断电、报警、冲击、设备启动等触发时，才允许提出闪烁/扫动/明暗变化候选；必须说明触发条件与结束状态。不得用无依据随机闪烁制造电影感。',
    '镜头耀斑与灯具闪烁不是一回事：耀斑只能随摄影机、遮挡物和直射光源相对位置变化。',
  ].join('\n');
}

function buildImageReferenceUserPrompt(): string {
  return [
    '请分析这张图片，生成一段 220-360 字的影视场景说明。',
    '说明要能被文本润色节点直接引用，用来把用户输入的动作/情绪扩写成更贴合图片的描述。',
    '正文中必须包含三个紧凑标签：“持续动态：”“情节触发：”“静态锁定：”。',
    '持续动态写1至3项低强度背景运动；情节触发只列具有物理依据的候选变化；静态锁定写不得无因漂移的空间、主光方向和固定结构。',
    '如果图中没有烟雾、风、液体、机械或可变灯光的依据，就明确写“未见可确认的动态源”，不要凭空补特效。',
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
  const { requestLLMWithImage } = await import('@/services/ModelGateway');
  const result = await requestLLMWithImage(gateway, {
    model,
    imageDataUrl: params.imageDataUrl,
    imageDetail: 'auto',
    systemPrompt: buildImageReferenceSystemPrompt(),
    userPrompt: buildImageReferenceUserPrompt(),
    temperature: 0.16,
    jsonMode: false,
    feature: 'image-text-polish',
    maxOutputTokens: 1200,
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
