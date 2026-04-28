export type WorkflowAgentInputType = 'novel' | 'script' | 'unknown';
export type WorkflowAgentMode = 'standard' | 'quick';
export type WorkflowAgentRoute =
  | 'novel_to_script_to_storyboard_to_prompt'
  | 'script_to_storyboard_to_prompt'
  | 'script_to_prompt_quick';
export type WorkflowAgentState =
  | 'INIT'
  | 'SCRIPT_READY'
  | 'STORYBOARD_GENERATED'
  | 'STORYBOARD_ADJUSTED'
  | 'STORYBOARD_CONFIRMED'
  | 'PROMPT_GENERATED'
  | 'COMPLETED'
  | 'FAILED';

export type WorkflowAgentIntent =
  | 'start'
  | 'continue'
  | 'adjust_storyboard'
  | 'confirm_storyboard'
  | 'complete'
  | 'restart'
  | 'chat';

export type WorkflowAgentSession = {
  id: string;
  inputType: WorkflowAgentInputType;
  mode: WorkflowAgentMode;
  route: WorkflowAgentRoute;
  state: WorkflowAgentState;
  sourceText: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
  writingNodeId?: string;
  storyboardNodeId?: string;
  shotListNodeId?: string;
  promptNodeId?: string;
  createdAt: number;
  updatedAt: number;
};

export function detectWorkflowAgentMode(text: string): WorkflowAgentMode {
  const raw = text.toLowerCase();
  if (
    raw.includes('快速模式') ||
    raw.includes('quick') ||
    raw.includes('直接生成提示词') ||
    raw.includes('直出提示词')
  ) {
    return 'quick';
  }
  return 'standard';
}

export function detectWorkflowAgentInputType(text: string): WorkflowAgentInputType {
  const raw = text.trim();
  if (!raw) return 'unknown';
  if (/这是小说|小说正文|长篇小说|小说片段/.test(raw)) return 'novel';
  if (/这是剧本|剧本文本|分场剧本|场次表/.test(raw)) return 'script';

  const looksLikeScript =
    /(^|\n)\s*[△▲◆]|(屋内|屋外|内景|外景|日|夜|晨|晚)/.test(raw) ||
    /镜头|分镜|场景|场次|对白|台词/.test(raw);
  if (looksLikeScript) return 'script';

  if (raw.length >= 120) return 'novel';
  return 'unknown';
}

export function resolveWorkflowRoute(
  inputType: WorkflowAgentInputType,
  mode: WorkflowAgentMode,
): WorkflowAgentRoute {
  if (inputType === 'novel') return 'novel_to_script_to_storyboard_to_prompt';
  if (mode === 'quick') return 'script_to_prompt_quick';
  return 'script_to_storyboard_to_prompt';
}

export function detectWorkflowAgentIntent(
  text: string,
  session: WorkflowAgentSession | null,
): WorkflowAgentIntent {
  const raw = text.trim();
  if (!raw) return 'chat';

  if (/重新开始|重来|新任务|reset/i.test(raw)) return 'restart';
  if (/完成|结束|收尾|done/i.test(raw)) return 'complete';
  if (/确认分镜|确认当前分镜|就按这个分镜|继续生成提示词|转提示词/.test(raw)) {
    return 'confirm_storyboard';
  }
  if (/调整分镜|修改分镜|改一下分镜|增加一个分镜|删掉一个分镜|补一个分镜/.test(raw)) {
    return 'adjust_storyboard';
  }
  if (/继续|下一步|往下走|生成分镜|开始分镜|生成提示词|开始提示词/.test(raw)) {
    return 'continue';
  }

  if (!session) return 'start';
  return 'chat';
}

export function stageLabel(state: WorkflowAgentState): string {
  switch (state) {
    case 'INIT':
      return '初始化';
    case 'SCRIPT_READY':
      return '剧本就绪';
    case 'STORYBOARD_GENERATED':
      return '分镜已生成';
    case 'STORYBOARD_ADJUSTED':
      return '分镜已调整';
    case 'STORYBOARD_CONFIRMED':
      return '分镜已确认';
    case 'PROMPT_GENERATED':
      return '提示词已生成';
    case 'COMPLETED':
      return '流程完成';
    case 'FAILED':
      return '流程失败';
    default:
      return state;
  }
}

export function routeLabel(route: WorkflowAgentRoute): string {
  switch (route) {
    case 'novel_to_script_to_storyboard_to_prompt':
      return '小说 → 剧本 → 分镜 → 提示词';
    case 'script_to_storyboard_to_prompt':
      return '剧本 → 分镜 → 提示词';
    case 'script_to_prompt_quick':
      return '剧本 → 提示词（快速）';
    default:
      return route;
  }
}

export function buildWorkflowAgentStartMessage(args: {
  inputType: WorkflowAgentInputType;
  route: WorkflowAgentRoute;
  mode: WorkflowAgentMode;
}): string {
  const inputLabel = args.inputType === 'novel' ? '小说/长文本' : '剧本';
  const modeLabel = args.mode === 'quick' ? '快速模式' : '标准模式';
  return `已识别输入为${inputLabel}，Agent 将按「${routeLabel(args.route)}」推进，当前处于${modeLabel}。`;
}

export function buildWorkflowAgentStageHint(session: WorkflowAgentSession): string {
  switch (session.state) {
    case 'SCRIPT_READY':
      return '剧本阶段已经完成。你可以继续让 Agent 进入分镜，或者先人工微调剧本。';
    case 'STORYBOARD_GENERATED':
      return '分镜已经生成。你可以先调整分镜，也可以直接确认并进入提示词阶段。';
    case 'STORYBOARD_ADJUSTED':
      return '分镜已经被人工或聊天修改过。确认后就可以进入提示词阶段。';
    case 'STORYBOARD_CONFIRMED':
      return '分镜已确认，现在可以开始生成提示词。';
    case 'PROMPT_GENERATED':
      return '提示词已经生成完成。你可以继续微调提示词，或者结束这轮流程。';
    case 'COMPLETED':
      return '这一轮流程已经完成。你可以直接开始下一轮任务。';
    case 'FAILED':
      return '流程中断了。你可以重试当前阶段，或者重新开始一轮新的流程。';
    default:
      return 'Agent 已建立流程上下文，接下来会根据你的指令推进节点。';
  }
}
