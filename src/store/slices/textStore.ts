import { getLlmSettingsFormDefaults, getResolvedLlmGatewayConfig, getResolvedVisionLlmGatewayConfig } from '@/config/llmSettings';
import { requestLLM, requestLLMWithImage } from '@/services/ModelGateway';
import type { StudioRFNode } from '@/types/reactFlow';
import type { StudioState } from '../useStudioStore';

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

type StudioGet = () => StudioState;

type TextSlice = Pick<StudioState, 'runTextPolish'>;
type TextPolishMode = 'simple' | 'deep';

type TextSliceDeps = {
  activeTaskAbortControllers: Map<string, AbortController>;
  stopTaskMessage: string;
};

type ImageReference = {
  nodeId: string;
  label: string;
  fileName: string;
  imageDataUrl?: string;
  summary?: string;
};

function stripTextPolishWrapper(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```(?:text|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^润色后(?:的)?(?:文本|正文|剧本)?[:：]\s*/i, '').trim();
  text = text.replace(/^修改后(?:的)?(?:文本|正文|剧本)?[:：]\s*/i, '').trim();
  text = text.replace(/^剧本化(?:整理|润色)?后[:：]\s*/i, '').trim();
  text = text.replace(/^结果[:：]\s*/i, '').trim();
  return text;
}

function connectedImageReferences(textId: string, nodes: StudioRFNode[], edges: StudioState['edges']): ImageReference[] {
  const incoming = edges.filter((edge) => edge.target === textId && (edge.targetHandle === 'in' || edge.targetHandle == null));
  return incoming
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is StudioRFNode => Boolean(node))
    .filter((node) => node.type === 'imageNode' && node.data.type === 'image_node')
    .map((node) => ({
      nodeId: node.id,
      label: node.data.label?.trim() || '图片节点',
      fileName: node.data.imageFileName?.trim() || '',
      imageDataUrl: node.data.imageDataUrl,
      summary: node.data.imageAnalysisSummary?.trim() || undefined,
    }));
}

function buildTextPolishSystemPrompt(): string {
  return [
    '你是一位中文影视剧本润色编辑，负责把文本卡片里的粗糙素材真正润色成可拍摄、可表演、可继续进入分镜和 Prompt 节点的剧本文本。',
    '本任务不是格式规范化，也不是大幅扩写。你必须对文本内容进行适度 AI 润色：让表达更顺、更有画面感和表演感，但只围绕原文已有动作与情绪展开。',
    '输出仍然是纯文本正文，不要输出 JSON、Markdown 代码块、解释、审稿意见或标题前缀。',
    '',
    '【内容润色】',
    '保留原文核心人物、事件、地点、叙事顺序、台词含义、情绪转折和结局，不改变剧情事实。',
    '允许在原文事实基础上补足少量必要的环境氛围、人物动作、表情反应、视线关系、场面调度、节奏停顿和镜头化描写。',
    '重点补充：场景发生时间、院线影视级运镜、画面构图、灯光风格，以及真实细腻的大师级表演细节。所有补充都必须贴合原文已有情境，不要脱离原素材另起剧情。',
    '运镜和构图要服务表演与叙事，例如推进、跟随、停顿、压迫性近景、留白、前后景关系、视线方向等；不要写成参数表。',
    '灯光风格要具体但克制，例如自然光、逆光、侧光、低照度、冷暖对比、阴影层次、空气质感等；不要堆砌形容词。',
    '表演描写要真实细腻，关注眼神、呼吸、停顿、微表情、肢体重心和情绪转折，不要夸张成舞台腔或玄幻化表达。',
    '润色幅度要收束：通常控制在原文长度的 1.2-1.8 倍；原文极短时最多扩展到 2.5 倍，不要写成长段新剧情。',
    '可以修正病句、重复、口水话、错别字、标点、断句和不自然表达；不要发明新的关键人物、重大事件、道具反转、背景设定或结局。',
    '避免过度文学化、过多比喻、复杂心理独白、世界观补充、无关环境铺陈和连续新增镜头。',
    '如果原文包含“拍摄方式、镜头、景别”等字段，不要只把它们整理成标签，要把它们自然融入正文的动作、画面和节奏里。',
    '',
    '【剧本格式】',
    '如果原文已有场次、集数、镜头或段落结构，可以保留编号和顺序，但必须润色每一段正文内容，不能只改标题或标签。',
    '如果原文是散文、小说段落或简短提示，请自然整理成剧本可读格式：场景信息、动作/叙事、必要对白。',
    '动作/叙事行使用克制、有画面感的短句，写清人物动作、空间关系、情绪变化和关键视觉焦点即可。',
    '对白如存在，必须独立成行，优先使用“角色名：台词”。没有对白时，不要硬编对白。',
    '',
    '【下游友好】',
    '输出要让编剧节点容易识别 episode / scene / characters / coreConflict，让分镜节点容易识别场景、动作、对白和节奏。',
    '不要生成 Prompt、分镜表、镜头参数、seedanceCard 或任何视频模型提示词字段。',
    '禁止只输出“场次、拍摄方式、镜头说明”这类规范化骨架；最终结果必须是一段已经润色过、但不过度发散的剧本正文。',
  ].join('\n');
}

function buildTextPolishUserPrompt(sourceText: string, instruction = ''): string {
  return [
    ...(instruction.trim() ? ['本次润色指令：', instruction.trim(), ''] : []),
    '请把下面文本进行真正的 AI 内容润色，不要只做规范化处理。',
    '要求：忠于原文核心事实，适度增强画面感、动作细节、情绪层次、场面调度、影视节奏和可拍摄性。',
    '请在原文基础上补充场景时间、院线影视级运镜、构图、灯光风格和真实细腻的大师级表演，但不要新增无关剧情。',
    '请收束润色幅度，不要大幅发散；如果原文很短，只补足最必要的动作和画面，不要写成新剧情。',
    '如果原文有拍摄方式，请把拍摄方式融入正文，而不是只列成字段。',
    '',
    '待润色文本：',
    sourceText,
  ].join('\n');
}

function buildSimpleTextPolishSystemPrompt(): string {
  return [
    '你是一位中文影视文本润色编辑。当前任务是“简单优化”，仍然需要调用你的语言理解与表达能力，但必须贴近原文，不做大幅扩写。',
    '只修正原文中不顺、不清楚、不自然、重复、错别字、标点和语序问题；允许少量补充可直接从原文推出的画面、动作、情绪和节奏。',
    '不要新增原文没有的人物、地点、道具、反转、世界观、结局或大段环境铺陈；不要把一句简单描述改成全新的长剧情。',
    '保持原文核心事实、叙事顺序、语气和重点，长度通常控制在原文的 0.9-1.25 倍；原文非常粗糙时最多到 1.4 倍。',
    '可以轻量补入场景时间、院线影视级运镜、构图、灯光风格和真实细腻的表演，但只在原文已有信息能支撑时补充，不能喧宾夺主。',
    '输出纯正文，不要解释，不要 JSON，不要 Markdown 代码块，不要标题前缀。',
  ].join('\n');
}

function buildSimpleTextPolishUserPrompt(sourceText: string, instruction = ''): string {
  return [
    ...(instruction.trim() ? ['本次简单优化指令：', instruction.trim(), ''] : []),
    '请对下面文本做简单 AI 润色：在原基础上补顺表达，轻量补充场景时间、必要的影视级运镜、构图、灯光风格和真实细腻表演。',
    '请收住，不要发散，不要新增无关剧情，不要大幅改写；让结果比原文更清楚、更有画面感即可。',
    '',
    '待优化文本：',
    sourceText,
  ].join('\n');
}

function buildImageAwareSystemPrompt(): string {
  return [
    '你是一位影视级概念设计提示词导演，负责把“图片画面”与“用户补充提示词/动作/情绪”融合成一段新的中文影视级画面提示词。',
    '图片是后续视频的首帧起幅画面，也是视觉基准；用户文字是首帧之后的动作推进、情绪变化或生成意图。你必须先锁定首帧，再写后续。',
    '输出要可直接进入后续生图、图生视频、视频概念设计或分镜节点。',
    '',
    '【融合规则】',
    '先依据图片确定可见信息：时间氛围、地点空间、画面构图、人物位置、姿态、表情、视线、服化道、道具、光线色彩。',
    '第一步必须写清“起始画面”：把图片作为视频第 1 帧，忠实描述这一帧的时间地点、构图、角色站位、景别、光影和色彩。',
    '第二步再写“后续内容”：把用户输入作为首帧之后发生的动作变化，补足动作路径、表情变化、镜头冲击、情绪递进和视觉重点。',
    '可以把图片中明确可见的视觉信息加入文本；不要编造图片之外的新人物、地点、道具或结局。',
    '如果用户文字与图片冲突，以图片可见事实为准，并用自然方式衔接。',
    '',
    '【提示词必须覆盖】',
    '1. 时间与地点：明确日夜、天气、时代感、具体空间和环境氛围。',
    '2. 画面构图：主体与背景关系、前中后景、视觉焦点、画面层次和留白/压迫感。',
    '3. 角色站位：角色数量、方位、距离、朝向、视线关系、肢体姿态和动作路径。',
    '4. 相机景别：如远景、全景、中景、近景、特写、过肩、低角度、俯拍等，需贴合画面。',
    '5. 运镜与表演：镜头推进/跟拍/环绕/摇移/手持感，以及角色表情、动作节奏、情绪爆发点。',
    '6. 影视级光影：主光、逆光、轮廓光、环境光、阴影质感、明暗反差和空气透视。',
    '7. 色彩风格：主色调、冷暖关系、饱和度、质感、类型片气质和概念设计美术方向。',
    '',
    '【输出格式】',
    '只输出最终中文提示词，不要解释，不要分析过程，不要 JSON，不要 Markdown 表格。',
    '使用两段文字：第一段必须以“起始画面：”开头，第二段必须以“后续内容：”开头。',
    '起始画面只能描述图片首帧已经呈现或可合理推断的视觉事实；后续内容才承接用户输入进行动作和运镜发展。',
    '不要出现模型名、参数、负面词、seed、比例、分辨率或平台专属语法。',
  ].join('\n');
}

function buildImageAwareUserPrompt(sourceText: string, references: ImageReference[], instruction = ''): string {
  const referenceLines = references.map((reference, index) => {
    const name = reference.fileName || reference.label;
    const summary = reference.summary ? `\n已知画面分析：${reference.summary}` : '';
    return `图片${index + 1}：${name || '未命名图片'}${summary}`;
  });
  return [
    ...(instruction.trim() ? ['【本次补充/修改要求】', instruction.trim(), ''] : []),
    '请结合图片画面与用户输入，生成一段新的影视级中文提示词。',
    '图片内容是视频首帧起幅画面，必须先写起始内容，再写后续内容。',
    '用户输入不要被简单照抄，要作为首帧之后的动作、情绪或镜头发展，与图片中的时间地点、画面构图、角色站位、相机景别、运镜表演、光影构图和色彩风格融合。',
    '如果图片已经呈现“角色看向镜头/带笑/夜晚/屋顶/武器/建筑/天气”等信息，要把这些可见信息自然写入。',
    '最终提示词必须足够具体，能指导概念设计师或生图模型复现画面并推进用户补充的动作变化。',
    '',
    '【图片参考】',
    referenceLines.join('\n\n') || '无文字分析，直接读取随请求附带的图片。',
    '',
    '【用户补充提示词 / 首帧之后的动作意图】',
    sourceText || '用户未补充后续动作，请只生成起始画面提示词，并在后续内容中保持为轻微镜头延续，不新增剧情。',
  ].join('\n');
}

export function createTextStoreSlice(
  set: StudioSet,
  get: StudioGet,
  deps: TextSliceDeps,
): TextSlice {
  void set;

  return {
    runTextPolish: async (nodeId, opts) => {
      const node = get().nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== 'textNode') return;
      const nodeText = (node.data.raw_text ?? node.data.input ?? '').trim();
      const instruction = opts?.instruction?.trim() || '';
      const mode: TextPolishMode = opts?.mode === 'simple' ? 'simple' : node.data.text_polish_mode === 'simple' ? 'simple' : 'deep';
      const sourceText = nodeText || instruction;
      const instructionForPrompt = nodeText ? instruction : '';
      const imageRefs = connectedImageReferences(nodeId, get().nodes, get().edges);
      const primaryImage = imageRefs.find((reference) => reference.imageDataUrl);
      const hasImageContext = imageRefs.length > 0;

      if (!sourceText && !hasImageContext) {
        get().pushMessage({ role: 'system', text: '文本卡片没有可润色的内容。', nodeId });
        return;
      }
      const config = getResolvedLlmGatewayConfig();
      if (!config) {
        get().pushMessage({
          role: 'system',
          text: '未配置可用模型网关。请先在设置里填写代理 URL 或 Base URL / API Key。',
          nodeId,
        });
        return;
      }

      deps.activeTaskAbortControllers.get(nodeId)?.abort();
      const controller = new AbortController();
      deps.activeTaskAbortControllers.set(nodeId, controller);
      get().setActiveNodeId(nodeId);
      get().patchNodeData(
        nodeId,
        {
          status: 'IN_PROGRESS',
          generation_error: undefined,
          streaming_preview: hasImageContext
            ? 'LLM 正在读取连接的图片节点，并生成影视级画面提示词...'
            : mode === 'simple'
              ? 'LLM 正在以简单模式轻量优化文本...\n\n完成后会自动写回正文。'
              : 'LLM 正在以深度模式按影视剧本规范润色文本...\n\n完成后会自动写回正文。',
        },
        true,
      );
      get().pushMessage({
        role: 'broadcast',
        text: hasImageContext ? '文本节点正在结合图片节点调用 LLM 生成影视级提示词。' : '文本节点正在调用 LLM 按剧本格式润色正文。',
        nodeId,
      });

      try {
        const settings = getLlmSettingsFormDefaults();
        const imageConfig = hasImageContext && primaryImage?.imageDataUrl ? getResolvedVisionLlmGatewayConfig() ?? config : config;
        const textModel = mode === 'simple' ? config.model?.trim() : settings.deepModel?.trim();
        const model = (hasImageContext && primaryImage?.imageDataUrl ? imageConfig.model : textModel)?.trim() || config.model?.trim();
        const finalResult =
          hasImageContext && primaryImage?.imageDataUrl
            ? await requestLLMWithImage(imageConfig, {
                model,
                imageDataUrl: primaryImage.imageDataUrl,
                imageDetail: 'auto',
                systemPrompt: buildImageAwareSystemPrompt(),
                userPrompt: buildImageAwareUserPrompt(sourceText, imageRefs, instructionForPrompt),
                temperature: 0.28,
                jsonMode: false,
                feature: 'image-text-polish',
                maxOutputTokens: 2200,
                signal: controller.signal,
              })
            : await requestLLM(config, {
                model,
                systemPrompt: hasImageContext
                  ? buildImageAwareSystemPrompt()
                  : mode === 'simple'
                    ? buildSimpleTextPolishSystemPrompt()
                    : buildTextPolishSystemPrompt(),
                userPrompt: hasImageContext
                  ? buildImageAwareUserPrompt(sourceText, imageRefs, instructionForPrompt)
                  : mode === 'simple'
                    ? buildSimpleTextPolishUserPrompt(sourceText, instructionForPrompt)
                    : buildTextPolishUserPrompt(sourceText, instructionForPrompt),
                temperature: hasImageContext ? 0.28 : mode === 'simple' ? 0.18 : 0.32,
                jsonMode: false,
                feature: hasImageContext ? 'image-text-polish' : mode === 'simple' ? 'text-polish-simple' : 'text-polish',
                maxOutputTokens: hasImageContext ? 2200 : mode === 'simple' ? 2200 : 4200,
                signal: controller.signal,
              });

        if (!finalResult.ok) {
          if (finalResult.error.code === 'USER_ABORT') {
            get().patchNodeData(
              nodeId,
              {
                status: 'APPROVED',
                generation_error: undefined,
                streaming_preview: undefined,
              },
              true,
            );
            get().pushMessage({ role: 'system', text: deps.stopTaskMessage, nodeId });
            return;
          }
          get().patchNodeData(
            nodeId,
            {
              status: 'APPROVED',
              generation_error: finalResult.error.message,
              streaming_preview: undefined,
            },
            true,
          );
          get().pushMessage({ role: 'system', text: finalResult.error.message, nodeId });
          return;
        }

        if (controller.signal.aborted) {
          get().patchNodeData(
            nodeId,
            {
              status: 'APPROVED',
              generation_error: undefined,
              streaming_preview: undefined,
            },
            true,
          );
          get().pushMessage({ role: 'system', text: deps.stopTaskMessage, nodeId });
          return;
        }

        const polished = stripTextPolishWrapper(finalResult.content);
        if (!polished) {
          get().patchNodeData(
            nodeId,
            {
              status: 'APPROVED',
              generation_error: '模型没有返回可写入的润色正文，请稍后重试。',
              streaming_preview: undefined,
            },
            true,
          );
          get().pushMessage({ role: 'system', text: '模型没有返回可写入的润色正文。', nodeId });
          return;
        }

        get().patchNodeData(
          nodeId,
          {
            status: 'APPROVED',
            input: polished,
            raw_text: polished,
            generation_error: undefined,
            streaming_preview: undefined,
            review_result: hasImageContext ? `已结合 ${imageRefs.length} 个图片节点生成影视级提示词。` : undefined,
          },
          true,
        );
        get().pushMessage({
          role: 'broadcast',
          text: hasImageContext
            ? '文本节点已结合图片生成影视级提示词，并已写回正文。'
            : `文本节点 LLM ${mode === 'simple' ? '简单优化' : '深度优化'}已完成，并已写回正文。`,
          nodeId,
        });
      } finally {
        if (deps.activeTaskAbortControllers.get(nodeId) === controller) {
          deps.activeTaskAbortControllers.delete(nodeId);
        }
      }
    },
  };
}
