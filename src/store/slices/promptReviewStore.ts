import { getResolvedLlmGatewayConfig } from '@/config/llmSettings';
import {
  PROMPT_ADAPTIVE_RULE,
  PROMPT_CARD_HEADER_RULE,
  PROMPT_CARD_SECTION_HEADINGS,
  PROMPT_COPY_CHAR_LIMIT_RULE,
  PROMPT_FIELD_TYPE_RULE,
  PROMPT_FORBIDDEN_RULE,
  PROMPT_LITE_RULE,
  PROMPT_LOCAL_COMPRESSION_RULE,
  PROMPT_MOUNT_TOKEN_RULE,
  PROMPT_NOISE_FILTER_RULE,
  PROMPT_STRUCTURE_RULE,
  PROMPT_TIMING_SYSTEM_RULE,
} from '@/agents/promptDeptSpec';
import { mergedUpstreamForPromptReviewNode } from '@/services/graphInput';
import { requestLLM, requestLLMStream } from '@/services/ModelGateway';
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
    '你是提示词审核节点的 LLM 优化器。',
    '你的任务不是自由润色，而是按 Prompt 节点同一套 seedanceCard 规范修订输入正文。',
    '只输出修订后的完整提示词正文；不要输出 JSON、Markdown 代码块、审核报告、说明文字或“无需修改”。',
    '必须保留原有镜头数量、分镜编号、卡片顺序和字段结构；不得擅自合并、拆分或删除镜头。',
    '可以修正文案密度、字段归类、镜头调度、灯光、构图、连续性、时长规划和禁用参数，但不得改坏原镜头语义。',
    '',
    '【共享 Prompt 节点规范】',
    PROMPT_CARD_HEADER_RULE,
    PROMPT_MOUNT_TOKEN_RULE,
    PROMPT_COPY_CHAR_LIMIT_RULE,
    PROMPT_FORBIDDEN_RULE,
    PROMPT_ADAPTIVE_RULE,
    PROMPT_STRUCTURE_RULE,
    PROMPT_FIELD_TYPE_RULE,
    PROMPT_NOISE_FILTER_RULE,
    PROMPT_LITE_RULE,
    PROMPT_LOCAL_COMPRESSION_RULE,
    PROMPT_TIMING_SYSTEM_RULE,
    `固定字段顺序必须完整保留：${PROMPT_CARD_SECTION_HEADINGS.join('、')}。`,
    '构图锚点必须包含前景、中景、后景和焦点落点。',
    '灯光布置与基调必须写清光源、明暗关系、层次分配和灯光任务。',
    '连续性约束必须使用“必须 / 不能 / 先 / 再 / 最后 / 始终保持”这类硬约束语气。',
    '摄影机动态参数必须包含主镜参数、关键节点参数、动态策略；如果涉及多段镜头，只在本模块写总时长和每段时长分配。',
    '镜头参数必须说明焦段、景深和焦点职责。',
    '插针 / 甩拍 / 慢镜头必须明确“有/无”以及使用瞬间。',
    '表演建议必须写成可执行的最小变化链；无人物镜头不得硬写眼神或表情。',
    '钉子4行必须严格四行，每行一句最高指令。',
  ].join('\n');
}

function buildPromptReviewUserPrompt(task: string, sourceText: string): string {
  return [
    `调整要求：${task}`,
    '',
    '请按上述 Prompt 节点规范修订下面正文。重点检查：字段是否完整、挂载是否为 |@=实体| token、灯光是否可执行、构图是否有前中后景、时长是否按内容估算且只在摄影机动态参数里分配、是否明确禁止背景音乐/字幕/UI。',
    '',
    '待调整提示词正文：',
    sourceText,
  ].join('\n');
}

function buildPromptReviewRepairUserPrompt(
  task: string,
  sourceText: string,
  draftText: string,
  failureReason: string,
): string {
  return [
    `上一轮调整结果仍不符合 Prompt 节点规范：${failureReason}`,
    '',
    `原始调整要求：${task}`,
    '',
    '请基于原文和上一轮结果，重新输出一版合格的完整提示词正文。',
    '必须补齐缺失字段，修正挂载 token、禁用参数、灯光、构图、连续性和时长规则；不要输出解释。',
    '',
    '原始提示词正文：',
    sourceText,
    '',
    '上一轮不合格结果：',
    draftText,
  ].join('\n');
}

function looksLikePromptCard(text: string): boolean {
  const headingHits = PROMPT_CARD_SECTION_HEADINGS.filter((heading) => text.includes(heading)).length;
  return /【分镜/.test(text) || headingHits >= 6;
}

function validatePromptReviewText(text: string, sourceText: string): string | null {
  if (!looksLikePromptCard(sourceText) && !looksLikePromptCard(text)) return null;

  if (!/^【分镜[^】]*\d+(?:\.\d+)?\s*秒[^】]*】/m.test(text)) {
    return '缺少带真实秒数的结构化分镜标题。';
  }

  const missing = PROMPT_CARD_SECTION_HEADINGS.filter((heading) => !text.includes(heading));
  if (missing.length > 0) {
    return `缺少固定字段：${missing.join('、')}。`;
  }

  const mountLine =
    text.match(/(?:^|\n)挂载\s*\n([^\n]+)/)?.[1] ??
    text.match(/(?:^|\n)挂载[:：]\s*([^\n]+)/)?.[1] ??
    '';
  if (mountLine && !/\|@=/.test(mountLine)) {
    return '挂载字段没有使用 |@=实体| token 格式。';
  }

  if (!/(禁止背景音乐|禁背景音乐|background music|bgm)/i.test(text)) {
    return '缺少禁止背景音乐 / BGM 参数。';
  }
  if (!/(禁止字幕|禁字幕|subtitle|subtitles|text overlay)/i.test(text)) {
    return '缺少禁止字幕 / text overlay 参数。';
  }
  if (!/(禁止\s*UI|禁\s*UI|ui|hud|interface overlay)/i.test(text)) {
    return '缺少禁止 UI / HUD 参数。';
  }

  return null;
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
      const task =
        instruction?.trim() ||
        '请审核并优化这份视频生成提示词，必须遵循 Prompt 节点的完整字段规范，只修正不清晰、不连贯或不符合视频生成执行性的表达。';
      deps.activeTaskAbortControllers.get(nodeId)?.abort();
      const controller = new AbortController();
      deps.activeTaskAbortControllers.set(nodeId, controller);
      get().setActiveNodeId(nodeId);
      get().patchNodeData(
        nodeId,
        {
          status: 'IN_PROGRESS',
          generation_error: undefined,
          streaming_preview: 'LLM 正在审核并调整提示词...',
        },
        true,
      );
      get().pushMessage({ role: 'broadcast', text: '提示词审核节点正在调用 LLM 调整内容。', nodeId });
      try {
        const systemPrompt = buildPromptReviewSystemPrompt();
        const userPrompt = buildPromptReviewUserPrompt(task, sourceText);
        const requestParams = {
          systemPrompt,
          userPrompt,
          temperature: 0.25,
          jsonMode: false,
          maxOutputTokens: 3500,
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
        let revised = stripPromptReviewLlmWrapper(finalResult.content);
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

        let specFailure = validatePromptReviewText(revised, sourceText);
        if (specFailure && !controller.signal.aborted) {
          let repairRequestFailure: string | null = null;
          get().patchNodeData(
            nodeId,
            {
              streaming_preview: `LLM 初稿未完全符合提示词规范，正在自动修复：${specFailure}`,
            },
            false,
          );
          const repairResult = await requestLLM(config, {
            ...requestParams,
            userPrompt: buildPromptReviewRepairUserPrompt(task, sourceText, revised, specFailure),
            temperature: 0.15,
          });
          if (repairResult.ok) {
            const repaired = stripPromptReviewLlmWrapper(repairResult.content);
            if (repaired) revised = repaired;
          } else if (repairResult.error.code === 'USER_ABORT') {
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
          } else {
            repairRequestFailure = repairResult.error.message;
          }
          const repairedSpecFailure = validatePromptReviewText(revised, sourceText);
          specFailure = repairRequestFailure
            ? `${repairedSpecFailure ?? specFailure} 自动修复失败：${repairRequestFailure}`
            : repairedSpecFailure;
        }

        if (specFailure) {
          get().patchNodeData(
            nodeId,
            {
              status: 'APPROVED',
              generation_error: `LLM 调整结果未通过提示词规范：${specFailure}`,
              streaming_preview: undefined,
            },
            true,
          );
          get().pushMessage({
            role: 'system',
            text: `LLM 调整结果未通过提示词规范，已保留原稿：${specFailure}`,
            nodeId,
          });
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
        get().pushMessage({ role: 'broadcast', text: '提示词审核节点已完成 LLM 调整。', nodeId });
      } finally {
        if (deps.activeTaskAbortControllers.get(nodeId) === controller) {
          deps.activeTaskAbortControllers.delete(nodeId);
        }
      }
    },
  };
}
