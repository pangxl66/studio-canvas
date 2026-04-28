import type { Edge } from '@xyflow/react';
import { PROMPT_DEPT_AGENT_SYSTEM } from '@/agents/promptDeptSpec';
import { STORYBOARD_DEPT_AGENT_SYSTEM } from '@/agents/storyboardDeptSpec';
import { WRITING_DEPT_AGENT_SYSTEM } from '@/agents/writingDeptSpec';
import {
  getResolvedLlmGatewayConfig,
  getResolvedPipelineExecutionMode,
  type PipelineExecutionMode,
} from '@/config/llmSettings';
import { resolveDepartmentExecutionInput } from '@/services/graphInput';
import { appendProjectContextForConsumer } from '@/services/ProjectContext';
import { PromptAgent } from '@/services/agents/PromptAgent';
import { PromptLeaderAgent } from '@/services/agents/PromptLeaderAgent';
import { StoryboardAgent } from '@/services/agents/StoryboardAgent';
import { StoryboardLeaderAgent } from '@/services/agents/StoryboardLeaderAgent';
import { WritingAgent } from '@/services/agents/WritingAgent';
import { WritingLeaderAgent } from '@/services/agents/WritingLeaderAgent';
import {
  runRulePromptFromStoryboard,
  runRulePromptLeaderReview,
  runRuleStoryboardFromText,
  runRuleStoryboardLeaderReview,
} from '@/services/rulePipeline';
import { resolveAndComposeMountedSkills } from '@/services/skillLoader';
import type { StudioRFNode } from '@/types/reactFlow';
import type { ApprovedAsset, PromptOutput, StoryboardOutput, WritingOutput } from '@/types/studio';

export type DepartmentPipelineKind = 'writing' | 'storyboard' | 'prompt';

export type ExecuteTaskParams = {
  kind: DepartmentPipelineKind;
  assets: ApprovedAsset[];
  nodeId?: string;
  nodes?: StudioRFNode[];
  edges?: Edge[];
  fallbackInput?: string;
  inputText?: string;
  sourceSceneCount?: number;
  mountedSkills?: string[];
  taskInstruction?: string;
  reviewIterationFeedback?: string;
  reviewOptimization?: {
    feedback: string;
    currentVersionContent: string;
  };
  onModelStreamChunk?: (delta: string, accumulated: string) => void;
  signal?: AbortSignal;
};

export type ExecuteTaskSuccess = {
  ok: true;
  inputUsed: string;
  output: WritingOutput | StoryboardOutput | PromptOutput;
  status: 'REVIEWED' | 'WAITING_REVIEW' | 'REJECTED';
  review_result: string | null;
  narrativeBeatCount?: number;
};

export type ExecuteTaskFailure = {
  ok: false;
  reason: 'empty_input' | 'storyboard_no_beats' | 'exception';
  message?: string;
};

export type ExecuteTaskResult = ExecuteTaskSuccess | ExecuteTaskFailure;

export type EmployeePhaseResult =
  | {
      ok: true;
      inputUsed: string;
      output: WritingOutput | StoryboardOutput | PromptOutput;
      narrativeBeatCount?: number;
      skillWarnings?: string[];
    }
  | ExecuteTaskFailure;

export type LeaderPhaseResult = {
  approved: boolean;
  feedback: string | null;
};

function applyReviewIterationPrefix(base: string, feedback?: string): string {
  const trimmed = feedback?.trim();
  if (!trimmed) return base;
  return `【总监审核意见 - 本次必须落实】\n${trimmed}\n\n---\n\n${base}`;
}

function resolveBaseTaskInput(params: ExecuteTaskParams): string {
  if (params.inputText != null && params.inputText !== '') {
    return params.inputText.trim();
  }
  if (params.nodeId != null && params.nodes != null && params.edges != null) {
    return resolveDepartmentExecutionInput(
      params.nodeId,
      params.nodes,
      params.edges,
      params.fallbackInput ?? '',
    );
  }
  return (params.fallbackInput ?? '').trim();
}

export function buildReviewOptimizationUserPrompt(
  originalInput: string,
  currentVersionContent: string,
  feedback: string,
): string {
  const oi =
    originalInput.trim() || '（未提供独立原始输入，请主要依据下方“当前版本内容”与审核意见完成优化。）';
  const cv = currentVersionContent.trim() || '（当前版本内容为空）';
  const fb = feedback.trim() || '（无审核意见）';
  return [
    '# 原始输入',
    oi,
    '',
    '# 当前版本内容',
    cv,
    '',
    '# AI 审核意见',
    fb,
    '',
    '# 执行指令',
    '请参考以上审核意见，对“当前版本内容”进行优化，返回可直接替换节点 output 的完整新版本，不要只返回说明、摘要或 diff。',
  ].join('\n');
}

const REVIEW_OPTIMIZATION_SYSTEM_APPEND = `

[优化迭代模式]
用户消息已按“原始输入 / 当前版本内容 / AI 审核意见 / 执行指令”分段提供。你必须输出完整的结构化结果，用于直接替换当前节点 output；不要只返回说明、摘要、diff 或残缺字段。
`;

function appendOptimizationSystemSuffix(systemPrompt: string, enabled: boolean): string {
  return enabled ? `${systemPrompt}${REVIEW_OPTIMIZATION_SYSTEM_APPEND}` : systemPrompt;
}

function resolveInputUsed(params: ExecuteTaskParams): string {
  const raw = resolveBaseTaskInput(params);
  const taskInstruction = params.taskInstruction?.trim() ?? '';
  if (params.reviewOptimization) {
    return buildReviewOptimizationUserPrompt(
      raw,
      params.reviewOptimization.currentVersionContent,
      params.reviewOptimization.feedback,
    ).trim();
  }
  const prefixed = applyReviewIterationPrefix(raw, params.reviewIterationFeedback).trim();
  if (!taskInstruction) return prefixed;
  if (!prefixed) {
    return `【当前任务补充要求】\n${taskInstruction}`;
  }
  return `${prefixed}\n\n【当前任务补充要求】\n${taskInstruction}`.trim();
}

function resolveExecutionModeForKind(kind: DepartmentPipelineKind): PipelineExecutionMode {
  void kind;
  return getResolvedPipelineExecutionMode();
}

function isGatewayReady(): boolean {
  return getResolvedLlmGatewayConfig() != null;
}

function requireDeepModeGateway(kindLabel: string): ExecuteTaskFailure {
  return {
    ok: false,
    reason: 'exception',
    message: `当前为 Deep 模式：${kindLabel}需要通过 API 执行，但当前未配置可用 API。请先在设置中填写 Base URL 和 API Key。`,
  };
}

function requireDeepModeForWriting(): ExecuteTaskFailure {
  return {
    ok: false,
    reason: 'exception',
    message: '当前为 Fast 本地模式：编剧节点暂不支持本地执行，请切换到 Deep 后再运行。',
  };
}

export async function executeEmployeePhase(params: ExecuteTaskParams): Promise<EmployeePhaseResult> {
  const inputUsed = resolveInputUsed(params);
  if (!inputUsed) {
    return {
      ok: false,
      reason: 'empty_input',
      message: '缺少任务文本，请连接输入节点或填写节点 input。',
    };
  }

  const mounted = params.mountedSkills ?? [];
  const executionMode = resolveExecutionModeForKind(params.kind);
  const deepGatewayReady = isGatewayReady();
  const isReviewOptimization = Boolean(params.reviewOptimization);

  try {
    switch (params.kind) {
      case 'writing': {
        if (executionMode !== 'model') {
          return requireDeepModeForWriting();
        }
        if (!deepGatewayReady) {
          return requireDeepModeGateway('编剧节点');
        }

        const resolved = resolveAndComposeMountedSkills('writing', WRITING_DEPT_AGENT_SYSTEM, mounted);
        const skillWarnings =
          resolved.invalidIds.length > 0
            ? [`以下挂载技能未找到或与编剧节点不匹配，已忽略：${resolved.invalidIds.join('、')}`]
            : undefined;
        const systemPrompt = appendOptimizationSystemSuffix(resolved.systemPrompt, isReviewOptimization);
        const output = await WritingAgent.execute(
          inputUsed,
          systemPrompt,
          params.onModelStreamChunk,
          params.signal,
        );
        return { ok: true, inputUsed, output, skillWarnings };
      }

      case 'storyboard': {
        const resolved = resolveAndComposeMountedSkills(
          'storyboard',
          STORYBOARD_DEPT_AGENT_SYSTEM,
          mounted,
        );
        const skillWarnings: string[] = [];
        if (resolved.invalidIds.length > 0) {
          skillWarnings.push(
            `以下挂载技能未找到或与分镜节点不匹配，已忽略：${resolved.invalidIds.join('、')}`,
          );
        }

        if (executionMode === 'rule') {
          skillWarnings.push('当前为 Fast 本地模式：分镜节点按本地规则执行，不调用 API。');
          const output = runRuleStoryboardFromText(inputUsed);
          return {
            ok: true,
            inputUsed,
            output,
            narrativeBeatCount: output.narrativeBeats.length,
            skillWarnings,
          };
        }

        if (!deepGatewayReady) {
          return requireDeepModeGateway('分镜节点');
        }

        const systemPrompt = appendOptimizationSystemSuffix(
          appendProjectContextForConsumer(resolved.systemPrompt, 'storyboard'),
          isReviewOptimization,
        );
        const output = await StoryboardAgent.execute(
          inputUsed,
          systemPrompt,
          params.onModelStreamChunk,
          params.signal,
        );

        if (!output.shots?.length) {
          return {
            ok: false,
            reason: 'storyboard_no_beats',
            message: '分镜输出为空：没有解析到有效 shots，请检查输入文本或模型返回结果。',
          };
        }

        return {
          ok: true,
          inputUsed,
          output,
          narrativeBeatCount: output.narrativeBeats.length,
          skillWarnings: skillWarnings.length ? skillWarnings : undefined,
        };
      }

      case 'prompt': {
        const resolved = resolveAndComposeMountedSkills('prompt', PROMPT_DEPT_AGENT_SYSTEM, mounted);
        const skillWarnings: string[] = [];
        if (resolved.invalidIds.length > 0) {
          skillWarnings.push(`以下挂载技能未找到或不可用，已忽略：${resolved.invalidIds.join('、')}`);
        }

        if (executionMode === 'rule') {
          skillWarnings.push('当前为 Fast 本地模式：提示词节点按本地规则执行，不调用 API。');
          const output = runRulePromptFromStoryboard(inputUsed);
          return { ok: true, inputUsed, output, skillWarnings };
        }

        if (!deepGatewayReady) {
          return requireDeepModeGateway('提示词节点');
        }

        const systemPrompt = appendOptimizationSystemSuffix(
          appendProjectContextForConsumer(resolved.systemPrompt, 'prompt'),
          isReviewOptimization,
        );
        const output = await PromptAgent.execute(
          inputUsed,
          params.assets,
          systemPrompt,
          params.onModelStreamChunk,
          params.signal,
        );
        return {
          ok: true,
          inputUsed,
          output,
          skillWarnings: skillWarnings.length ? skillWarnings : undefined,
        };
      }
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'exception',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeLeaderPhase(args: {
  kind: DepartmentPipelineKind;
  output: WritingOutput | StoryboardOutput | PromptOutput;
  sourceSceneCount?: number;
  mountedSkills?: string[];
  signal?: AbortSignal;
}): Promise<LeaderPhaseResult> {
  const executionMode = resolveExecutionModeForKind(args.kind);

  try {
    switch (args.kind) {
      case 'writing': {
        if (executionMode !== 'model') {
          return {
            approved: false,
            feedback: '当前为 Fast 本地模式：编剧审核暂不支持本地执行，请切换到 Deep 后再运行。',
          };
        }
        if (!isGatewayReady()) {
          return {
            approved: false,
            feedback: '当前为 Deep 模式：编剧审核需要通过 API 执行，但当前未配置可用 API。',
          };
        }
        const decision = await WritingLeaderAgent.selfReview(args.output as WritingOutput, args.signal);
        return {
          approved: decision.approved,
          feedback: decision.approved ? null : decision.feedback,
        };
      }

      case 'storyboard': {
        const output = args.output as StoryboardOutput;
        if (executionMode === 'rule') {
          return runRuleStoryboardLeaderReview(output);
        }
        if (!isGatewayReady()) {
          return {
            approved: false,
            feedback: '当前为 Deep 模式：分镜审核需要通过 API 执行，但当前未配置可用 API。',
          };
        }
        try {
          const decision = await StoryboardLeaderAgent.selfReview(
            output,
            args.sourceSceneCount ?? output.narrativeBeats.length,
            args.signal,
          );
          return {
            approved: decision.approved,
            feedback: decision.approved ? null : decision.feedback,
          };
        } catch (error) {
          return {
            approved: false,
            feedback: `Deep 模式下分镜审核调用 API 失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      case 'prompt': {
        const output = args.output as PromptOutput;
        if (executionMode === 'rule') {
          return runRulePromptLeaderReview(output);
        }
        if (!isGatewayReady()) {
          return {
            approved: false,
            feedback: '当前为 Deep 模式：提示词审核需要通过 API 执行，但当前未配置可用 API。',
          };
        }
        try {
          const decision = await PromptLeaderAgent.selfReview(
            output,
            args.mountedSkills ?? [],
            args.signal,
          );
          return {
            approved: decision.approved,
            feedback: decision.approved ? null : decision.feedback,
          };
        } catch (error) {
          return {
            approved: false,
            feedback: `Deep 模式下提示词审核调用 API 失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    }
  } catch (error) {
    return {
      approved: false,
      feedback: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeTask(params: ExecuteTaskParams): Promise<ExecuteTaskResult> {
  const employee = await executeEmployeePhase(params);
  if (!employee.ok) {
    return employee;
  }

  const leader = await executeLeaderPhase({
    kind: params.kind,
    output: employee.output,
    sourceSceneCount: employee.narrativeBeatCount ?? params.sourceSceneCount,
    mountedSkills: params.mountedSkills,
    signal: params.signal,
  });

  return {
    ok: true,
    inputUsed: employee.inputUsed,
    output: employee.output,
    status: 'REVIEWED',
    review_result: leader.approved ? null : leader.feedback,
    narrativeBeatCount: employee.narrativeBeatCount,
  };
}
