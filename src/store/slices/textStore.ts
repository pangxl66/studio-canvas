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
    '你是一位中文短剧剧本编辑，负责把文本卡片里的粗糙素材润色成“可继续进入编剧节点、分镜节点和 Prompt 节点”的剧本文本。',
    '本任务参考剧本格式规范，但输出仍然是纯文本正文，不要输出 JSON、Markdown 代码块、解释、审稿意见或标题前缀。',
    '',
    '【忠实改写】',
    '只能润色和整理表达，不得新增原文没有的人物、事件、设定、地点、道具、反转或结局。',
    '保留原文核心信息、叙事顺序、人物姓名、专有名词、重要数字、台词含义、情绪转折和段落意图。',
    '可以修正病句、重复、口水话、错别字、标点、断句和不自然表达；不得把短素材扩写成新剧情。',
    '',
    '【剧本格式】',
    '如果原文已经有场次、集数、镜头或段落结构，必须保留原有编号和顺序，只做格式清理。',
    '如果原文是散文/小说段落，请按内容自然整理成剧本可读格式：场次标题、登场角色、动作/叙事、对白。',
    '动作/叙事行使用短句，写清人物动作、空间关系、情绪变化和关键物件。',
    '对白必须独立成行，优先使用“角色名：台词”。',
    '',
    '【下游友好】',
    '输出要让编剧节点容易识别 episode / scene / characters / coreConflict，让分镜节点容易识别场景、动作、对白和节奏。',
    '不要生成 Prompt、分镜表、镜头参数、seedanceCard 或任何视频模型提示词字段。',
  ].join('\n');
}

function buildTextPolishUserPrompt(sourceText: string): string {
  return [
    '请把下面文本润色为符合剧本阅读习惯的纯文本正文。',
    '要求：忠于原文、结构清楚、场次/动作/对白更容易被后续编剧和分镜节点识别。',
    '',
    '待润色文本：',
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

function buildImageAwareUserPrompt(sourceText: string, references: ImageReference[]): string {
  const referenceLines = references.map((reference, index) => {
    const name = reference.fileName || reference.label;
    const summary = reference.summary ? `\n已知画面分析：${reference.summary}` : '';
    return `图片${index + 1}：${name || '未命名图片'}${summary}`;
  });
  return [
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
      const sourceText = opts?.instruction?.trim() || nodeText;
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
            : 'LLM 正在按剧本格式润色文本...\n\n为避免不支持流式的网关重复等待，本次使用单次快速请求；完成后会自动写回正文。',
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
        const model = (hasImageContext && primaryImage?.imageDataUrl ? imageConfig.model : settings.deepModel)?.trim() || config.model?.trim();
        const finalResult =
          hasImageContext && primaryImage?.imageDataUrl
            ? await requestLLMWithImage(imageConfig, {
                model,
                imageDataUrl: primaryImage.imageDataUrl,
                imageDetail: 'auto',
                systemPrompt: buildImageAwareSystemPrompt(),
                userPrompt: buildImageAwareUserPrompt(sourceText, imageRefs),
                temperature: 0.28,
                jsonMode: false,
                feature: 'image-text-polish',
                maxOutputTokens: 2200,
                signal: controller.signal,
              })
            : await requestLLM(config, {
                systemPrompt: hasImageContext ? buildImageAwareSystemPrompt() : buildTextPolishSystemPrompt(),
                userPrompt: hasImageContext
                  ? buildImageAwareUserPrompt(sourceText, imageRefs)
                  : buildTextPolishUserPrompt(sourceText),
                temperature: hasImageContext ? 0.28 : 0.22,
                jsonMode: false,
                feature: 'text-polish',
                maxOutputTokens: hasImageContext ? 2200 : 4200,
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
          text: hasImageContext ? '文本节点已结合图片生成影视级提示词，并已写回正文。' : '文本节点 LLM 润色已完成，并已写回正文。',
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
