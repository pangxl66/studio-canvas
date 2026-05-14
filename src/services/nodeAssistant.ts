import { assertPromptOutput } from '@/agents/promptAgents';
import { assertStoryboardOutput } from '@/agents/storyboardAgents';
import { assertWritingOutput } from '@/agents/writingAgents';
import { getLlmSettingsFormDefaults, getResolvedPipelineExecutionMode } from '@/config/llmSettings';
import { invokeLlmJsonObject as invokeLlmJsonObjectRaw } from '@/services/llmJsonClient';
import type {
  AssistantHistoryEntry,
  PromptOutput,
  StoryboardOutput,
  StudioNodeData,
  WritingOutput,
} from '@/types/studio';

export type AssistantNodeAction = 'chat' | 'revise_output' | 'update_task' | 'update_preferences';

type AssistantPrecisionLevel = 'surgical' | 'sectional' | 'full';

type NodeAssistantBase = {
  assistantReply: string;
  action: AssistantNodeAction;
  applyChange: boolean;
  taskInstruction: string;
  assistantPreferences: string;
};

type RevisionPlan = NodeAssistantBase & {
  rationale: string;
  precisionLevel: AssistantPrecisionLevel;
  targetSections: string[];
  preservePoints: string[];
  editInstructions: string[];
};

export type NodeAssistantProgress = {
  stage: 'planning' | 'executing';
  text: string;
};

export type NodeAssistantResult =
  | (NodeAssistantBase & {
      targetKind: 'text';
      updatedText: string;
    })
  | (NodeAssistantBase & {
      targetKind: 'writing' | 'storyboard' | 'prompt';
      updatedOutput: WritingOutput | StoryboardOutput | PromptOutput | null;
    });

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function buildHistoryText(history: AssistantHistoryEntry[]): string {
  if (!history.length) return '[]';
  return stringify(history.slice(-12));
}

function normalizeAction(value: unknown): AssistantNodeAction {
  const text = String(value ?? '').trim();
  if (text === 'revise_output' || text === 'update_task' || text === 'update_preferences') {
    return text;
  }
  return 'chat';
}

function normalizePrecisionLevel(value: unknown): AssistantPrecisionLevel {
  const text = String(value ?? '').trim();
  if (text === 'full' || text === 'sectional') return text;
  return 'surgical';
}

function nonEmptyString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 12);
}

function formatShortList(items: string[], fallback: string): string {
  const cleaned = items.filter(Boolean).slice(0, 3);
  return cleaned.length ? cleaned.join('、') : fallback;
}

function buildPlanProgressText(plan: RevisionPlan): string {
  if (plan.action === 'revise_output' && plan.applyChange) {
    const targets = formatShortList(plan.targetSections, '相关内容');
    const preserve = formatShortList(plan.preservePoints, '未点名部分');
    return `模型已完成修改分析：将重点调整 ${targets}，并保留 ${preserve}。`;
  }
  if (plan.action === 'update_task' && plan.applyChange) {
    return '模型已判断这次反馈属于“补充下次执行要求”，正在写入节点要求。';
  }
  if (plan.action === 'update_preferences' && plan.applyChange) {
    return '模型已判断这次反馈属于“长期偏好”，正在写入节点偏好。';
  }
  return '模型已完成本轮意图判断，正在整理回复。';
}

function buildExecutionProgressText(plan: RevisionPlan): string {
  const levelLabel =
    plan.precisionLevel === 'full' ? '整稿级' : plan.precisionLevel === 'sectional' ? '分段级' : '定点级';
  const targets = formatShortList(plan.targetSections, '当前结果');
  return `正在按修改计划执行 ${levelLabel} 调整，重点处理 ${targets}。`;
}

function looksLikeQuestion(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return /[?？]$/.test(normalized) || ['怎么', '如何', '为什么', '是否', '能不能', '可不可以', '是什么', '吗'].some((token) => normalized.includes(token));
}

function looksLikeDirectRevisionRequest(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || looksLikeQuestion(normalized)) return false;
  return [
    '修改',
    '改',
    '调整',
    '优化',
    '细化',
    '详细',
    '丰富',
    '补充',
    '加强',
    '弱化',
    '精简',
    '简化',
    '压缩',
    '增加',
    '减少',
    '删掉',
    '删除',
    '纠正',
    '修正',
    '替换',
    '改为',
    '改掉',
    '错别字',
    '别字',
    '锚点',
    '限制',
    '控制',
    '保留',
    '重写',
    '改成',
    '换成',
    '不够',
    '太',
    '更',
  ].some((token) => normalized.includes(token));
}

function looksLikePreferenceRequest(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || looksLikeQuestion(normalized)) return false;
  return ['以后', '默认', '长期', '记住', '一直', '始终', '固定风格', '都按'].some((token) =>
    normalized.includes(token),
  );
}

function looksLikeFutureTaskRequest(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || looksLikeQuestion(normalized)) return false;
  return ['下次', '后续', '之后', '重新生成时', '执行时', '后面', '下一版', '下一轮'].some((token) =>
    normalized.includes(token),
  );
}

function looksLikeImmediateExecutionCommand(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || looksLikeQuestion(normalized)) return false;
  if (looksLikePreferenceRequest(normalized) || looksLikeFutureTaskRequest(normalized)) return false;
  return true;
}

function shouldForceStructuredRevision(args: {
  currentOutput: WritingOutput | StoryboardOutput | PromptOutput | null;
  userMessage: string;
  action: AssistantNodeAction;
  applyChange: boolean;
}): boolean {
  if (!args.currentOutput) return false;
  if (!(looksLikeDirectRevisionRequest(args.userMessage) || looksLikeImmediateExecutionCommand(args.userMessage))) {
    return false;
  }
  return (
    args.action === 'chat' ||
    args.action === 'update_task' ||
    args.action === 'update_preferences' ||
    !args.applyChange
  );
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('节点助手返回格式错误：顶层必须是 JSON 对象。');
  }
  return value as Record<string, unknown>;
}

function parseAssistantEnvelope(value: unknown) {
  const obj = ensureObject(value);
  const assistantReplyRaw = obj.assistant_reply ?? obj.assistantReply;
  const applyChangeRaw = obj.apply_change ?? obj.applyChange;
  const taskInstructionRaw = obj.task_instruction ?? obj.taskInstruction;
  const assistantPreferencesRaw = obj.assistant_preferences ?? obj.assistantPreferences;
  const updatedOutputRaw = obj.updated_output ?? obj.updatedOutput;
  const updatedTextRaw = obj.updated_text ?? obj.updatedText;
  return {
    assistantReply: nonEmptyString(assistantReplyRaw, '我已经根据你的反馈处理好了。'),
    action: normalizeAction(obj.action),
    applyChange: applyChangeRaw === true || String(applyChangeRaw ?? '').trim().toLowerCase() === 'true',
    taskInstruction: typeof taskInstructionRaw === 'string' ? String(taskInstructionRaw) : '',
    assistantPreferences:
      typeof assistantPreferencesRaw === 'string' ? String(assistantPreferencesRaw) : '',
    updatedOutput: updatedOutputRaw,
    updatedText: typeof updatedTextRaw === 'string' ? String(updatedTextRaw) : '',
  };
}

function parseRevisionPlan(value: unknown): RevisionPlan {
  const obj = ensureObject(value);
  const assistantReplyRaw = obj.assistant_reply ?? obj.assistantReply;
  const applyChangeRaw = obj.apply_change ?? obj.applyChange;
  const taskInstructionRaw = obj.task_instruction ?? obj.taskInstruction;
  const assistantPreferencesRaw = obj.assistant_preferences ?? obj.assistantPreferences;
  const rationaleRaw = obj.rationale;
  const precisionLevelRaw = obj.precision_level ?? obj.precisionLevel;
  const targetSectionsRaw = obj.target_sections ?? obj.targetSections;
  const preservePointsRaw = obj.preserve_points ?? obj.preservePoints;
  const editInstructionsRaw = obj.edit_instructions ?? obj.editInstructions;

  return {
    assistantReply: nonEmptyString(assistantReplyRaw, '我先帮你确认了这次反馈应该怎么改。'),
    action: normalizeAction(obj.action),
    applyChange: applyChangeRaw === true || String(applyChangeRaw ?? '').trim().toLowerCase() === 'true',
    taskInstruction: typeof taskInstructionRaw === 'string' ? String(taskInstructionRaw) : '',
    assistantPreferences:
      typeof assistantPreferencesRaw === 'string' ? String(assistantPreferencesRaw) : '',
    rationale: nonEmptyString(rationaleRaw, '优先按用户最新反馈执行最小必要修改。'),
    precisionLevel: normalizePrecisionLevel(precisionLevelRaw),
    targetSections: normalizeStringArray(targetSectionsRaw),
    preservePoints: normalizeStringArray(preservePointsRaw),
    editInstructions: normalizeStringArray(editInstructionsRaw),
  };
}

function buildPlannerPrompt(args: {
  roleLabel: string;
  targetLabel: string;
  currentOutputText: string;
  currentTaskInstruction: string;
  currentPreferences: string;
  history: AssistantHistoryEntry[];
  userMessage: string;
  extraRules: string[];
}) {
  return [
    `你是一个由高精度 API 模型驱动的${args.roleLabel}节点助手。你的改稿质量必须高于本地规则，优先做准确、克制、可落库的编辑。`,
    '你这一步不是直接生成最终结果，而是先判断用户意图并制定一个精确编辑计划。',
    '',
    '你必须先判断 action，只能是以下四种之一：chat / revise_output / update_task / update_preferences。',
    '当用户是在针对当前节点结果提反馈、要求修改、要求更精确地调整时，应优先选择 revise_output。',
    '当用户只是提问或讨论，才使用 chat。',
    '当用户是在补充下次执行要求时，使用 update_task。',
    '当用户是在声明长期偏好时，使用 update_preferences。',
    '',
    '严格输出一个 JSON 对象，不要 markdown，不要解释文字。',
    'JSON 只能包含这些字段：assistant_reply, action, apply_change, task_instruction, assistant_preferences, rationale, precision_level, target_sections, preserve_points, edit_instructions。',
    '',
    '字段要求：',
    '- assistant_reply：一句自然的中文短回复。',
    '- action：四选一。',
    '- apply_change：布尔值。',
    '- rationale：一句说明为什么这么判定。',
    '- precision_level：只能是 surgical / sectional / full。',
    '- target_sections：列出这次真正要动的模块、字段或局部内容，避免泛泛而谈。',
    '- preserve_points：列出必须保留、不应误伤的内容。',
    '- edit_instructions：列出 1 到 6 条原子级编辑指令，每条都必须明确、可执行、可验证。',
    '',
    '硬约束：',
    '- 不要把“聊天”和“改稿”混在一起。',
    '- 不要因为用户语气简短就回避 revise_output。',
    '- 不要建议性的泛答，要尽量把用户反馈转成可执行修改计划。',
    '- 如果用户要的是精确调整，precision_level 优先用 surgical 或 sectional，除非用户明确要求重写。',
    '- target_sections 和 preserve_points 必须具体到当前节点真实结构，而不是空话。',
    ...args.extraRules,
    '',
    `当前目标节点：${args.targetLabel}`,
    `当前节点内容：\n${args.currentOutputText}`,
    '',
    `当前任务补充要求：\n${args.currentTaskInstruction || '（当前无额外任务要求）'}`,
    '',
    `当前长期偏好：\n${args.currentPreferences || '（当前无长期偏好）'}`,
    '',
    `历史对话：\n${buildHistoryText(args.history)}`,
    '',
    `本轮用户消息：\n${args.userMessage.trim()}`,
  ].join('\n');
}

function buildStructuredRevisionPrompt(args: {
  roleLabel: string;
  targetLabel: string;
  currentOutputText: string;
  currentTaskInstruction: string;
  currentPreferences: string;
  userMessage: string;
  outputInstruction: string;
  plan: RevisionPlan;
  extraRules: string[];
}) {
  const targetSections = args.plan.targetSections.length ? args.plan.targetSections.join('；') : '按用户反馈相关的最小必要范围';
  const preservePoints = args.plan.preservePoints.length ? args.plan.preservePoints.join('；') : '未被用户点名要求修改的内容';
  const editInstructions = args.plan.editInstructions.length
    ? args.plan.editInstructions.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : `1. 按用户反馈做最小必要修改。\n2. 不改动未被点名的结构和字段。`;

  return [
    `你是一个由高精度 API 模型驱动的${args.roleLabel}节点助手，现在进入“精确改稿执行”阶段。`,
    '你的目标不是重写一份大而化之的新结果，而是以当前节点结果为底稿，按编辑计划做最小必要、最精准的修改。',
    '',
    '严格输出一个 JSON 对象，不要 markdown，不要解释文字。',
    'JSON 只能包含这些字段：assistant_reply, action, apply_change, updated_output, updated_text, task_instruction, assistant_preferences。',
    '',
    '硬约束：',
    '- action 必须是 revise_output。',
    '- apply_change 必须是 true。',
    '- 必须返回完整 updated_output，不能只返回建议、摘要或局部 diff。',
    '- 除非 precision_level=full 或用户明确要求“重写全部”，否则必须尽量保留原结构和未修改内容。',
    '- 优先按用户这次反馈执行；当前任务要求和长期偏好继续保留，但如果与本轮明确反馈冲突，以本轮反馈为准。',
    '- 不要把本地规则模板强压回去，要尽量发挥 API 的精确编辑能力。',
    '- 不要扩写成泛泛的新版本，重点是“按反馈改准”。',
    ...args.extraRules,
    '',
    `当前目标节点：${args.targetLabel}`,
    `当前节点内容：\n${args.currentOutputText}`,
    '',
    `当前任务补充要求：\n${args.currentTaskInstruction || '（当前无额外任务要求）'}`,
    '',
    `当前长期偏好：\n${args.currentPreferences || '（当前无长期偏好）'}`,
    '',
    `本轮用户反馈：\n${args.userMessage.trim()}`,
    '',
    '编辑计划：',
    `- precision_level：${args.plan.precisionLevel}`,
    `- rationale：${args.plan.rationale}`,
    `- target_sections：${targetSections}`,
    `- preserve_points：${preservePoints}`,
    `- edit_instructions：\n${editInstructions}`,
    '',
    `updated_output 的结构要求：\n${args.outputInstruction}`,
  ].join('\n');
}

function buildTextRevisionPrompt(args: {
  currentText: string;
  currentTaskInstruction: string;
  currentPreferences: string;
  userMessage: string;
  plan: RevisionPlan;
}) {
  const editInstructions = args.plan.editInstructions.length
    ? args.plan.editInstructions.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : `1. 按用户反馈做最小必要修改。`;

  return [
    '你是一个由高精度 API 模型驱动的文本节点助手，现在进入“精确改稿执行”阶段。',
    '请以当前文本为底稿，按编辑计划返回一份完整的新文本。',
    '',
    '严格输出一个 JSON 对象，不要 markdown，不要解释文字。',
    'JSON 只能包含这些字段：assistant_reply, action, apply_change, updated_output, updated_text, task_instruction, assistant_preferences。',
    '',
    '硬约束：',
    '- action 必须是 revise_output。',
    '- apply_change 必须是 true。',
    '- updated_output 必须为 null。',
    '- updated_text 必须是完整的新文本，不是摘要，不是 diff，不是点评。',
    '- 除非用户明确要求重写全文，否则优先做最小必要修改。',
    '',
    `当前文本：\n${args.currentText || '（当前为空文本）'}`,
    '',
    `当前任务补充要求：\n${args.currentTaskInstruction || '（当前无额外任务要求）'}`,
    '',
    `当前长期偏好：\n${args.currentPreferences || '（当前无长期偏好）'}`,
    '',
    `本轮用户反馈：\n${args.userMessage.trim()}`,
    '',
    '编辑计划：',
    `- precision_level：${args.plan.precisionLevel}`,
    `- rationale：${args.plan.rationale}`,
    `- edit_instructions：\n${editInstructions}`,
  ].join('\n');
}

function buildAssistantSystemPrompt(roleLabel: string): string {
  return `你是负责${roleLabel}节点改稿的专业助手。你必须优先精确理解用户反馈，做最小必要、可验证、可落库的编辑，不要空谈，不要回避明确修改请求。`;
}

function isGatewayUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(上游服务|网络异常|Failed to fetch|fetch failed|网关|超时|timeout|temporarily unavailable|unavailable|503|504|ECONN|socket)/i.test(
    message,
  );
}

function getAssistantModelOverride(): string | undefined {
  const deepModel = getLlmSettingsFormDefaults().deepModel.trim();
  return deepModel || undefined;
}

async function invokeAssistantJsonObject(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}): Promise<unknown> {
  if (getResolvedPipelineExecutionMode() !== 'model') {
    throw new Error('节点助手需要 API 模型才能精确改稿，请先在模型设置中配置可用 API。');
  }

  const modelOverride = getAssistantModelOverride();
  let lastError: unknown;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await invokeLlmJsonObjectRaw({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        temperature: params.temperature ?? 0.18,
        model: modelOverride,
      });
    } catch (error) {
      lastError = error;
      if (!isGatewayUnavailableError(error) || attempt >= maxAttempts) {
        if (attempt >= maxAttempts && isGatewayUnavailableError(error)) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)} 节点助手已自动重试 ${maxAttempts} 轮，但本次模型调用仍未成功。`,
          );
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '节点助手调用失败。'));
}

async function planAssistantAction(args: {
  roleLabel: string;
  targetLabel: string;
  currentOutputText: string;
  currentTaskInstruction: string;
  currentPreferences: string;
  history: AssistantHistoryEntry[];
  userMessage: string;
  extraRules: string[];
}): Promise<RevisionPlan> {
  return parseRevisionPlan(
    await invokeAssistantJsonObject({
      systemPrompt: buildAssistantSystemPrompt(args.roleLabel),
      userPrompt: buildPlannerPrompt(args),
      temperature: 0.12,
    }),
  );
}

export async function runTextNodeAssistant(params: {
  data: StudioNodeData;
  history: AssistantHistoryEntry[];
  userMessage: string;
  onProgress?: (progress: NodeAssistantProgress) => void;
}): Promise<NodeAssistantResult> {
  const currentText = params.data.raw_text ?? params.data.input ?? '';
  const plan = await planAssistantAction({
    roleLabel: '文本创作',
    targetLabel: `${params.data.label}（文本卡片）`,
    currentOutputText: currentText || '（当前为空文本）',
    currentTaskInstruction: params.data.assistant_task_instruction ?? '',
    currentPreferences: params.data.assistant_preferences ?? '',
    history: params.history,
    userMessage: params.userMessage,
    extraRules: [
      '- 文本卡片的 revise_output 必须返回完整 updated_text。',
      '- 如果用户是在补充下次写作方向，而不是要立刻改当前文本，可以使用 update_task。',
    ],
  });

  params.onProgress?.({ stage: 'planning', text: buildPlanProgressText(plan) });

  if (
    shouldForceStructuredRevision({
      currentOutput: currentText ? ({ text: currentText } as unknown as WritingOutput) : null,
      userMessage: params.userMessage,
      action: plan.action,
      applyChange: plan.applyChange,
    })
  ) {
    plan.action = 'revise_output';
    plan.applyChange = true;
    if (!plan.editInstructions.length) {
      plan.editInstructions = [`按用户反馈精确修改当前文本：${params.userMessage.trim()}`];
    }
  }

  if (plan.action !== 'revise_output' || !plan.applyChange) {
    return {
      targetKind: 'text',
      assistantReply: plan.assistantReply,
      action: plan.action,
      applyChange: plan.applyChange,
      updatedText: currentText,
      taskInstruction: plan.taskInstruction || (params.data.assistant_task_instruction ?? ''),
      assistantPreferences: plan.assistantPreferences || (params.data.assistant_preferences ?? ''),
    };
  }

  params.onProgress?.({ stage: 'executing', text: buildExecutionProgressText(plan) });

  const revised = parseAssistantEnvelope(
    await invokeAssistantJsonObject({
      systemPrompt: buildAssistantSystemPrompt('文本创作'),
      userPrompt: buildTextRevisionPrompt({
        currentText,
        currentTaskInstruction: params.data.assistant_task_instruction ?? '',
        currentPreferences: params.data.assistant_preferences ?? '',
        userMessage: params.userMessage,
        plan,
      }),
      temperature: plan.precisionLevel === 'full' ? 0.18 : 0.1,
    }),
  );

  return {
    targetKind: 'text',
    assistantReply: revised.assistantReply,
    action: 'revise_output',
    applyChange: true,
    updatedText: revised.updatedText || currentText,
    taskInstruction: revised.taskInstruction || plan.taskInstruction || (params.data.assistant_task_instruction ?? ''),
    assistantPreferences:
      revised.assistantPreferences || plan.assistantPreferences || (params.data.assistant_preferences ?? ''),
  };
}

async function runStructuredNodeAssistant<T extends 'writing' | 'storyboard' | 'prompt'>(params: {
  kind: T;
  data: StudioNodeData;
  currentOutput: WritingOutput | StoryboardOutput | PromptOutput | null;
  history: AssistantHistoryEntry[];
  userMessage: string;
  onProgress?: (progress: NodeAssistantProgress) => void;
}): Promise<NodeAssistantResult> {
  const roleLabel =
    params.kind === 'writing' ? '编剧策划' : params.kind === 'storyboard' ? '分镜设计' : 'Prompt 设计';
  const targetLabel =
    params.kind === 'writing'
      ? `${params.data.label}（编剧节点）`
      : params.kind === 'storyboard'
        ? `${params.data.label}（分镜 / 镜头表节点）`
        : `${params.data.label}（Prompt 节点）`;

  const outputInstruction =
    params.kind === 'writing'
      ? 'updated_output 必须是完整 WritingOutput JSON，包含 plannedEpisodeCount、episodes、scenes。'
      : params.kind === 'storyboard'
        ? 'updated_output 必须是完整 StoryboardOutput JSON，优先包含 narrativeBeats 和 shots；shots 中每项至少要有 id、type、movement、description、content，可选 sceneRef、action、durationSec、note、mergedMembers。'
        : 'updated_output 必须是完整 PromptOutput JSON，包含 system、userTemplate、negative、parameters、shotPrompts；shotPrompts 每项都必须有 shot_id、prompt、negative_prompt、dimensions、character_asset_ids、scene_asset_ids、seedanceCard。修改 Prompt 时必须保留完整工业模板结构，不得把 seedanceCard 压缩成普通段落。';

  const extraRules =
    params.kind === 'writing'
      ? [
          '- 编剧节点在 revise_output 时，要尽量按用户反馈局部修改，不要无故重写整套剧集结构。',
          '- 如果当前还没有 output，而用户只是补充要求，优先使用 update_task。',
        ]
      : params.kind === 'storyboard'
        ? [
            '- 分镜节点在 revise_output 时，要尽量基于当前镜头表做局部编辑，保留未被点名的镜头和字段。',
            '- 除非用户明确要求新增、删除或重排镜头，否则必须保持 shots 数量、id、顺序与镜头对应关系不变。',
            '- 修改某个词、角色、道具、场景或动作时，只改命中的镜头字段，不要把整张镜头表重新生成成另一套方案。',
            '- 如果镜头表里已有时长，不要主动放大总时长；如需调整，只能在用户要求范围内小幅重分配。',
            '- 如果当前还没有分镜结果，而用户只是补充方向，优先使用 update_task。',
          ]
        : [
            '- Prompt 节点在 revise_output 时，必须保留完整工业模板和 seedanceCard 结构。',
            '- 修改 Prompt 时优先按用户反馈精确改动对应模块，不要把整份 Prompt 重新洗成另一种风格。',
            '- 除非用户明确要求改变镜头数量，否则必须保持 shotPrompts 数量、shot_id 与原镜头对应关系不变。',
            '- 除非用户明确要求调整时长，否则必须保持原有总时长和各镜头时长表达，不得自行扩展到 15 秒以上或生成离谱长时长。',
            '- 若用户要求局部替换，例如“毒雾改红雾”，必须在所有相关字段同步替换，并避免残留旧词。',
            '- 如果当前还没有 Prompt 输出，而用户只是补充方向，优先使用 update_task。',
          ];

  const plan = await planAssistantAction({
    roleLabel,
    targetLabel,
    currentOutputText: params.currentOutput ? stringify(params.currentOutput) : '（当前节点尚无 output）',
    currentTaskInstruction: params.data.assistant_task_instruction ?? '',
    currentPreferences: params.data.assistant_preferences ?? '',
    history: params.history,
    userMessage: params.userMessage,
    extraRules,
  });

  params.onProgress?.({ stage: 'planning', text: buildPlanProgressText(plan) });

  if (
    shouldForceStructuredRevision({
      currentOutput: params.currentOutput,
      userMessage: params.userMessage,
      action: plan.action,
      applyChange: plan.applyChange,
    })
  ) {
    plan.action = 'revise_output';
    plan.applyChange = true;
    if (!plan.editInstructions.length) {
      plan.editInstructions = [`按用户反馈精确修改当前结果：${params.userMessage.trim()}`];
    }
  }

  if (plan.action !== 'revise_output' || !plan.applyChange || !params.currentOutput) {
    return {
      targetKind: params.kind,
      assistantReply: plan.assistantReply,
      action: plan.action,
      applyChange: plan.applyChange,
      updatedOutput: params.currentOutput,
      taskInstruction: plan.taskInstruction || (params.data.assistant_task_instruction ?? ''),
      assistantPreferences: plan.assistantPreferences || (params.data.assistant_preferences ?? ''),
    };
  }

  params.onProgress?.({ stage: 'executing', text: buildExecutionProgressText(plan) });

  const revised = parseAssistantEnvelope(
    await invokeAssistantJsonObject({
      systemPrompt: buildAssistantSystemPrompt(roleLabel),
      userPrompt: buildStructuredRevisionPrompt({
        roleLabel,
        targetLabel,
        currentOutputText: stringify(params.currentOutput),
        currentTaskInstruction: params.data.assistant_task_instruction ?? '',
        currentPreferences: params.data.assistant_preferences ?? '',
        userMessage: params.userMessage,
        outputInstruction,
        plan,
        extraRules,
      }),
      temperature: plan.precisionLevel === 'full' ? 0.18 : 0.08,
    }),
  );

  let updatedOutput = params.currentOutput;
  if (params.kind === 'writing') updatedOutput = assertWritingOutput(revised.updatedOutput);
  if (params.kind === 'storyboard') updatedOutput = assertStoryboardOutput(revised.updatedOutput);
  if (params.kind === 'prompt') updatedOutput = assertPromptOutput(revised.updatedOutput);

  return {
    targetKind: params.kind,
    assistantReply: revised.assistantReply,
    action: 'revise_output',
    applyChange: true,
    updatedOutput,
    taskInstruction: revised.taskInstruction || plan.taskInstruction || (params.data.assistant_task_instruction ?? ''),
    assistantPreferences:
      revised.assistantPreferences || plan.assistantPreferences || (params.data.assistant_preferences ?? ''),
  };
}

export async function runNodeAssistant(params: {
  data: StudioNodeData;
  history: AssistantHistoryEntry[];
  userMessage: string;
  currentOutput?: WritingOutput | StoryboardOutput | PromptOutput | null;
  onProgress?: (progress: NodeAssistantProgress) => void;
}): Promise<NodeAssistantResult> {
  if (params.data.type === 'text_node') {
    return runTextNodeAssistant({
      data: params.data,
      history: params.history,
      userMessage: params.userMessage,
      onProgress: params.onProgress,
    });
  }
  if (params.data.type === 'writing') {
    return runStructuredNodeAssistant({
      kind: 'writing',
      data: params.data,
      currentOutput: (params.currentOutput as WritingOutput | null | undefined) ?? null,
      history: params.history,
      userMessage: params.userMessage,
      onProgress: params.onProgress,
    });
  }
  if (params.data.type === 'storyboard' || params.data.type === 'shot_list_node') {
    return runStructuredNodeAssistant({
      kind: 'storyboard',
      data: params.data,
      currentOutput: (params.currentOutput as StoryboardOutput | null | undefined) ?? null,
      history: params.history,
      userMessage: params.userMessage,
      onProgress: params.onProgress,
    });
  }
  if (params.data.type === 'prompt') {
    return runStructuredNodeAssistant({
      kind: 'prompt',
      data: params.data,
      currentOutput: (params.currentOutput as PromptOutput | null | undefined) ?? null,
      history: params.history,
      userMessage: params.userMessage,
      onProgress: params.onProgress,
    });
  }
  throw new Error('当前节点类型暂不支持节点助手。');
}
