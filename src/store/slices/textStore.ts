import { getResolvedLlmGatewayConfig } from '@/config/llmSettings';
import { requestLLM } from '@/services/ModelGateway';
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

function stripTextPolishWrapper(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```(?:text|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^润色后(?:的)?(?:文本|正文|剧本)?[:：]\s*/i, '').trim();
  text = text.replace(/^修改后(?:的)?(?:文本|正文|剧本)?[:：]\s*/i, '').trim();
  text = text.replace(/^剧本化(?:整理|润色)?后[:：]\s*/i, '').trim();
  return text;
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
    '场次标题建议写成 `第X场｜内/外｜昼/夜｜地点/场景名`；信息不足时不要硬编地点，可用原文已有场景名。',
    '登场角色行写成 `登场：角色A、角色B`，只列原文明确出现或实质参与的人物。',
    '动作/叙事行使用短句，写清人物动作、空间关系、情绪变化和关键物件，避免小说式长心理独白。',
    '对白必须独立成行，优先使用 `角色名：台词`；原文没有明确说话人时可保留引号对白，不要臆造说话人。',
    '每场需要有清晰的“核心冲突/戏剧目的”，但不要写成分析报告；可自然融入动作段或场次开头。',
    '',
    '【下游友好】',
    '输出要让编剧节点容易识别 episode / scene / characters / coreConflict，让分镜节点容易识别场景、动作、对白和节奏。',
    '不要生成 Prompt、分镜表、镜头参数、seedanceCard 或任何视频模型提示词字段。',
    '不要把内容压缩成提纲；如果原文是连续戏，要保留连续动作和对白推进。',
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

export function createTextStoreSlice(
  set: StudioSet,
  get: StudioGet,
  deps: TextSliceDeps,
): TextSlice {
  void set;

  return {
    runTextPolish: async (nodeId) => {
      const node = get().nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== 'textNode') return;
      const sourceText = (node.data.raw_text ?? node.data.input ?? '').trim();
      if (!sourceText) {
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
          streaming_preview: 'LLM 正在按剧本格式润色文本...\n\n为避免不支持流式的网关重复等待，本次使用单次快速请求；完成后会自动写回正文。',
        },
        true,
      );
      get().pushMessage({ role: 'broadcast', text: '文本节点正在调用 LLM 按剧本格式润色正文。', nodeId });

      try {
        const systemPrompt = buildTextPolishSystemPrompt();
        const userPrompt = buildTextPolishUserPrompt(sourceText);
        const requestParams = {
          systemPrompt,
          userPrompt,
          temperature: 0.22,
          jsonMode: false,
          maxOutputTokens: 4200,
          signal: controller.signal,
        };
        const finalResult = await requestLLM(config, requestParams);

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
          },
          true,
        );
        get().pushMessage({ role: 'broadcast', text: '文本节点 LLM 润色已完成，并已写回正文。', nodeId });
      } finally {
        if (deps.activeTaskAbortControllers.get(nodeId) === controller) {
          deps.activeTaskAbortControllers.delete(nodeId);
        }
      }
    },
  };
}
