import { getResolvedLlmGatewayConfig } from '@/config/llmSettings';
import { mergedUpstreamForPromptReviewNode } from '@/services/graphInput';
import type { PromptReviewHistoryEntry, StudioNodeData } from '@/types/studio';
import type { StudioState } from '../useStudioStore';

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

type StudioGet = () => StudioState;

type PromptReviewSlice = Pick<
  StudioState,
  | 'syncPromptReviewInputFromGraph'
  | 'savePromptReviewSnapshot'
  | 'restorePromptReviewSnapshot'
  | 'runPromptReviewLlm'
>;

type PromptReviewSliceDeps = {
  activeTaskAbortControllers: Map<string, AbortController>;
  stopTaskMessage: string;
};

const PROMPT_REVIEW_HISTORY_LIMIT = 12;

function stripPromptReviewLlmWrapper(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```(?:text|markdown|md|json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  text = text.replace(/^修订后(?:的)?提示词[:：]\s*/i, '').trim();
  text = text.replace(/^调整后(?:的)?提示词[:：]\s*/i, '').trim();
  return text;
}

function promptReviewTextFromData(data: StudioNodeData): string {
  return data.raw_text ?? data.input ?? '';
}

function promptReviewCharCount(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function normalizePromptReviewHistory(value: unknown): PromptReviewHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is PromptReviewHistoryEntry => {
      return (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as PromptReviewHistoryEntry).id === 'string' &&
        typeof (entry as PromptReviewHistoryEntry).text === 'string'
      );
    })
    .map((entry) => ({
      id: entry.id,
      at: typeof entry.at === 'number' ? entry.at : Date.now(),
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : '历史版本',
      text: entry.text,
      charCount:
        typeof entry.charCount === 'number'
          ? entry.charCount
          : promptReviewCharCount(entry.text),
    }))
    .slice(0, PROMPT_REVIEW_HISTORY_LIMIT);
}

function appendPromptReviewHistory(
  data: StudioNodeData,
  label: string,
): PromptReviewHistoryEntry[] {
  const text = promptReviewTextFromData(data);
  const normalized = normalizePromptReviewHistory(data.prompt_review_history);
  if (!text.trim()) return normalized;
  if (normalized[0]?.text === text) return normalized;
  const at = Date.now();
  return [
    {
      id: `prompt_review_history_${at}_${Math.random().toString(36).slice(2, 7)}`,
      at,
      label,
      text,
      charCount: promptReviewCharCount(text),
    },
    ...normalized,
  ].slice(0, PROMPT_REVIEW_HISTORY_LIMIT);
}

function buildPromptReviewSystemPrompt(): string {
  return [
    '你是直接编辑当前内容的 GPT 助手。',
    '只依据本轮用户消息中提供的“调整指令”和“当前内容”完成工作。',
    '不得加载、推断或套用任何外部 Skill、项目默认规范、提示词模板、审核规则、旧版本要求或隐藏格式约束。',
    '用户的调整指令是本轮唯一修改依据；没有被要求修改的内容尽量原样保留。',
    '只输出调整后的完整正文，不要输出解释、审核报告、修改清单、JSON 或 Markdown 代码块。',
  ].join('\n');
}

function buildPromptReviewUserPrompt(task: string, sourceText: string): string {
  return [
    '【调整指令】',
    task,
    '',
    '【当前内容】',
    sourceText,
    '',
    '严格按本轮调整指令处理当前内容，不要引用或补入本消息之外的规范。只返回调整后的完整正文。',
  ].join('\n');
}

export function createPromptReviewStoreSlice(
  set: StudioSet,
  get: StudioGet,
  deps: PromptReviewSliceDeps,
): PromptReviewSlice {
  void set;

  return {
    syncPromptReviewInputFromGraph: (nodeId) => {
      const { nodes, edges } = get();
      const node = nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== 'promptReview') return;
      const merged = mergedUpstreamForPromptReviewNode(nodeId, nodes, edges);
      if (merged !== null) {
        get().patchNodeData(
          nodeId,
          {
            input: merged,
            raw_text: merged,
            output: { text: merged },
            inputSource: 'graph',
            generation_error: undefined,
            ...(promptReviewTextFromData(node.data) !== merged
              ? { prompt_review_history: appendPromptReviewHistory(node.data, '同步上游前') }
              : {}),
          },
          false,
        );
        get().pushMessage({
          role: 'system',
          text: '已同步上游 Prompt 卡片提示词到审核节点。',
          nodeId,
        });
        return;
      }
      get().pushMessage({
        role: 'system',
        text: '没有读取到上游 Prompt 卡片提示词。请确认审核节点左侧 Input 已连接 Prompt 节点右侧 Output，且 Prompt 节点已有输出。',
        nodeId,
      });
    },

    savePromptReviewSnapshot: (nodeId, label) => {
      const node = get().nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== 'promptReview') return false;
      const text = promptReviewTextFromData(node.data);
      if (!text.trim()) {
        get().pushMessage({ role: 'system', text: '当前审核节点没有可保存的提示词内容。', nodeId });
        return false;
      }
      const previousHistory = normalizePromptReviewHistory(node.data.prompt_review_history);
      const history = appendPromptReviewHistory(node.data, label?.trim() || '手动保存');
      const changed =
        history.length !== previousHistory.length || history[0]?.id !== previousHistory[0]?.id;
      if (!changed) {
        get().pushMessage({ role: 'system', text: '当前版本已在历史顶部，无需重复保存。', nodeId });
        return false;
      }
      get().patchNodeData(nodeId, { prompt_review_history: history }, false);
      get().pushMessage({ role: 'system', text: '已保存当前提示词版本，可随时一键回退。', nodeId });
      return true;
    },

    restorePromptReviewSnapshot: (nodeId, snapshotId) => {
      const node = get().nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== 'promptReview') return false;
      const history = normalizePromptReviewHistory(node.data.prompt_review_history);
      const snapshot = history.find((entry) => entry.id === snapshotId);
      if (!snapshot) {
        get().pushMessage({ role: 'system', text: '没有找到这个历史版本，可能已被清理。', nodeId });
        return false;
      }
      const currentText = promptReviewTextFromData(node.data);
      const nextHistory =
        currentText === snapshot.text ? history : appendPromptReviewHistory(node.data, '回退前');
      get().patchNodeData(
        nodeId,
        {
          status: 'APPROVED',
          input: snapshot.text,
          raw_text: snapshot.text,
          output: { text: snapshot.text },
          generation_error: undefined,
          streaming_preview: undefined,
          prompt_review_history: nextHistory,
        },
        true,
      );
      get().pushMessage({ role: 'broadcast', text: '已回退到选中的提示词历史版本。', nodeId });
      return true;
    },

    runPromptReviewLlm: async (nodeId, instruction) => {
      const node = get().nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== 'promptReview') return;
      const sourceText = (node.data.raw_text ?? node.data.input ?? '').trim();
      if (!sourceText) {
        get().pushMessage({ role: 'system', text: '审核节点当前没有可调整的提示词内容。', nodeId });
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
      const task = instruction?.trim() ?? '';
      if (!task) {
        get().pushMessage({ role: 'system', text: '请先输入本轮要让 GPT 完成的调整指令。', nodeId });
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
          streaming_preview: 'GPT 正在按照本轮指令直接调整当前内容...',
        },
        true,
      );
      get().pushMessage({ role: 'broadcast', text: '提示词审核节点正在进行自由对话调整。', nodeId });
      try {
        const { requestLLM, requestLLMStream } = await import('@/services/ModelGateway');
        const systemPrompt = buildPromptReviewSystemPrompt();
        const userPrompt = buildPromptReviewUserPrompt(task, sourceText);
        const requestParams = {
          systemPrompt,
          userPrompt,
          temperature: 0.3,
          jsonMode: false,
          maxOutputTokens: 8000,
          signal: controller.signal,
        };
        const result = await requestLLMStream(config, {
          ...requestParams,
          onDelta: (_delta, accumulated) => {
            if (controller.signal.aborted) return;
            get().patchNodeData(
              nodeId,
              {
                streaming_preview: accumulated.trim()
                  ? stripPromptReviewLlmWrapper(accumulated)
                  : 'LLM 已连接，正在等待调整结果...',
              },
              false,
            );
          },
        });
        const finalResult =
          result.ok || result.error.code === 'USER_ABORT'
            ? result
            : await requestLLM(config, requestParams);
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
        const revised = stripPromptReviewLlmWrapper(finalResult.content);
        if (!revised) {
          get().patchNodeData(
            nodeId,
            {
              status: 'APPROVED',
              generation_error: '模型没有返回可写入的提示词正文，请稍后重试或补充更明确的调整要求。',
              streaming_preview: undefined,
            },
            true,
          );
          get().pushMessage({ role: 'system', text: '模型没有返回可写入的提示词正文。', nodeId });
          return;
        }

        const latestNode = get().nodes.find((item) => item.id === nodeId);
        const latestData = latestNode?.type === 'promptReview' ? latestNode.data : node.data;
        get().patchNodeData(
          nodeId,
          {
            status: 'APPROVED',
            input: revised,
            raw_text: revised,
            output: { text: revised },
            generation_error: undefined,
            streaming_preview: undefined,
            ...(promptReviewTextFromData(latestData) !== revised
              ? { prompt_review_history: appendPromptReviewHistory(latestData, 'LLM 调整前') }
              : {}),
          },
          true,
        );
        get().pushMessage({ role: 'broadcast', text: 'GPT 已按照本轮指令完成当前内容调整。', nodeId });
      } finally {
        if (deps.activeTaskAbortControllers.get(nodeId) === controller) {
          deps.activeTaskAbortControllers.delete(nodeId);
        }
      }
    },
  };
}
