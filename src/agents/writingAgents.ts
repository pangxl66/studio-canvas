import type { WritingOutput } from '@/types/studio';
import {
  WRITING_DEPT_AGENT_SYSTEM,
  WRITING_DEPT_OUTPUT_SHAPE,
  WRITING_LEADER_SPEC,
} from '@/agents/writingDeptSpec';
import { invokeLlmJsonObjectStream, invokeLlmLeaderReview } from '@/services/llmJsonClient';

export {
  WRITING_DEPT_AGENT_SYSTEM,
  WRITING_DEPT_OUTPUT_SHAPE,
  WRITING_LEADER_SPEC,
} from '@/agents/writingDeptSpec';

/** 接入真实 LLM 时取此字符串作为 system prompt */
export function getWritingDeptSystemPrompt(): string {
  return WRITING_DEPT_AGENT_SYSTEM;
}

/** 将结构化剧本序列化为格式化 JSON 字符串 */
export function writingOutputToJson(output: WritingOutput): string {
  return JSON.stringify(output, null, 2);
}

export function assertWritingOutput(x: unknown): WritingOutput {
  if (!x || typeof x !== 'object') {
    throw new Error('编剧模型返回：顶层必须是 JSON 对象。');
  }
  const o = x as Record<string, unknown>;
  if (typeof o.plannedEpisodeCount !== 'number' || !Number.isFinite(o.plannedEpisodeCount)) {
    throw new Error('编剧模型返回：缺少合法 plannedEpisodeCount。');
  }
  if (!Array.isArray(o.episodes) || o.episodes.length === 0) {
    throw new Error('编剧模型返回：episodes 必须为非空数组。');
  }
  if (!Array.isArray(o.scenes) || o.scenes.length === 0) {
    throw new Error('编剧模型返回：scenes 必须为非空数组。');
  }
  return o as unknown as WritingOutput;
}

/**
 * 员工 AI：经 OpenAI 兼容 API 生成结构化剧本 JSON（不再使用本地模板冒充模型）。
 * system = executionSystemPrompt（部门 + 挂载技能），user = 原文。
 */
export async function runWritingEmployee(
  novelText: string,
  executionSystemPrompt: string,
  onDelta?: (delta: string, accumulated: string) => void,
  signal?: AbortSignal,
): Promise<WritingOutput> {
  if (!novelText.trim()) {
    return {
      plannedEpisodeCount: 1,
      episodes: [{ id: 'empty_ep1', episodeNo: 1, title: '待补充', summary: '（素材为空，请提供小说或 IP 文本后重新生成）' }],
      scenes: [
        {
          episodeId: 'empty_ep1',
          episodeNo: 1,
          sceneNo: 1,
          title: '占位场次',
          coreConflict: '等待有效输入后再生成核心冲突',
          characters: ['—'],
          beat: '等待有效输入',
        },
      ],
    };
  }

  const system = `${executionSystemPrompt.trim()}\n\n【输出 JSON 形状参考】\n${WRITING_DEPT_OUTPUT_SHAPE}`;
  const user = `以下为待结构化的原文。请严格依据原文人物与情节，勿编造原文未出现的关键设定：\n\n${novelText}`;

  const parsed = await invokeLlmJsonObjectStream({
    systemPrompt: system,
    userPrompt: user,
    temperature: 0.35,
    onDelta,
    signal,
  });
  return assertWritingOutput(parsed);
}

export type LeaderDecision = { approved: true } | { approved: false; feedback: string };

/**
 * 编剧总监（Leader）：忠于原著与节奏；打回须指明需重写的集数。
 * 规范全文见 WRITING_LEADER_SPEC。通过 LLM API 接入真实审核。
 */
export async function runWritingLeaderReview(
  output: WritingOutput,
  signal?: AbortSignal,
): Promise<LeaderDecision> {
  const res = await invokeLlmLeaderReview({
    systemPrompt: WRITING_LEADER_SPEC,
    userPrompt: `以下为员工产出的剧本 JSON，请按编剧总监规范审核，输出通过或打回及反馈：\n\n${JSON.stringify(output, null, 2)}`,
    temperature: 0.2,
    signal,
  });
  return res.approved ? { approved: true } : { approved: false, feedback: res.feedback ?? '请根据审核维度给出具体修改建议。' };
}
