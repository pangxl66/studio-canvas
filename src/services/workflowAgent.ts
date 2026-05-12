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

const QUICK_PROMPT_HINT =
  /快速模式|quick|直接生成提示词|直出提示词|单镜头|单条提示词|只做提示词|不做分镜|跳过分镜|prompt/i;
const STORYBOARD_HINT = /分镜|镜头表|多镜头|组合镜头|连续动作|镜头组|先拆镜头|先做镜头/i;
const SCRIPT_HINT = /这是剧本|剧本文本|分场剧本|场次表|台词|对白|场景|镜头|分镜|内景|外景/i;
const NOVEL_HINT = /这是小说|小说正文|长篇小说|小说片段|原文|正文|章节/i;

export function detectWorkflowAgentMode(text: string): WorkflowAgentMode {
  const raw = text.trim();
  if (!raw) return 'standard';
  if (QUICK_PROMPT_HINT.test(raw)) return 'quick';

  // Short scene ideas are usually better handled as a single prompt first.
  if (raw.length <= 80 && !STORYBOARD_HINT.test(raw)) return 'quick';

  return 'standard';
}

export function detectWorkflowAgentInputType(text: string): WorkflowAgentInputType {
  const raw = text.trim();
  if (!raw) return 'unknown';
  if (SCRIPT_HINT.test(raw)) return 'script';
  if (NOVEL_HINT.test(raw)) return 'novel';

  const looksLikeSceneText = /[\u4e00-\u9fff]{2,}/.test(raw) || /[，。！？；、,.!?;]/.test(raw) || raw.length >= 6;
  if (looksLikeSceneText) return 'script';

  return 'unknown';
}

export function resolveWorkflowRoute(
  _inputType: WorkflowAgentInputType,
  mode: WorkflowAgentMode,
): WorkflowAgentRoute {
  if (mode === 'quick') return 'script_to_prompt_quick';

  // The current product hides the writing department from normal use, so the
  // global agent now routes long text directly into storyboard/shot-list first.
  return 'script_to_storyboard_to_prompt';
}

export function detectWorkflowAgentIntent(
  text: string,
  session: WorkflowAgentSession | null,
): WorkflowAgentIntent {
  const raw = text.trim();
  if (!raw) return 'chat';

  if (/重新开始|重来|新任务|清空流程|reset/i.test(raw)) return 'restart';
  if (/完成|结束|收尾|done/i.test(raw)) return 'complete';
  if (/确认分镜|确认当前分镜|就按这个分镜|进入提示词|继续生成提示词|转提示词|生成\s*prompt/i.test(raw)) {
    return 'confirm_storyboard';
  }
  if (/调整分镜|修改分镜|改一下分镜|增加一个分镜|删掉一个分镜|补一个分镜|更新镜头表/.test(raw)) {
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
      return '文本就绪';
    case 'STORYBOARD_GENERATED':
      return '分镜已生成';
    case 'STORYBOARD_ADJUSTED':
      return '分镜已调整';
    case 'STORYBOARD_CONFIRMED':
      return '分镜已确认';
    case 'PROMPT_GENERATED':
      return 'Prompt 已生成';
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
      return '长文本 -> 分镜/镜头表 -> Prompt';
    case 'script_to_storyboard_to_prompt':
      return '文本 -> 分镜/镜头表 -> Prompt';
    case 'script_to_prompt_quick':
      return '文本 -> 单镜头 Prompt';
    default:
      return route;
  }
}

export function buildWorkflowAgentStartMessage(args: {
  inputType: WorkflowAgentInputType;
  route: WorkflowAgentRoute;
  mode: WorkflowAgentMode;
}): string {
  const inputLabel =
    args.inputType === 'novel' ? '长文本/故事素材' : args.inputType === 'script' ? '镜头文本/剧本文本' : '未分类文本';
  const modeLabel = args.mode === 'quick' ? '单镜头快速模式' : '分镜标准模式';
  return `已识别输入为${inputLabel}，Agent 将按「${routeLabel(args.route)}」推进，当前处于${modeLabel}。`;
}

export function buildWorkflowAgentStageHint(session: WorkflowAgentSession): string {
  switch (session.state) {
    case 'SCRIPT_READY':
      return '文本已经进入流程。下一步可以生成分镜/镜头表，也可以改走单镜头 Prompt。';
    case 'STORYBOARD_GENERATED':
      return '分镜/镜头表已经生成。你可以先调整镜头表，也可以确认后进入 Prompt 节点。';
    case 'STORYBOARD_ADJUSTED':
      return '镜头表已经调整过。确认后就可以让 Prompt 节点读取最新镜头内容。';
    case 'STORYBOARD_CONFIRMED':
      return '分镜已确认，现在可以开始生成 Prompt。';
    case 'PROMPT_GENERATED':
      return 'Prompt 已生成完成。你可以继续用审核节点微调，或者结束这一轮流程。';
    case 'COMPLETED':
      return '这一轮流程已经完成。你可以直接开始下一轮任务。';
    case 'FAILED':
      return '流程中断了。你可以重试当前阶段，或者重新开始一轮新的流程。';
    default:
      return 'Agent 已建立流程上下文，接下来会根据你的指令推进节点。';
  }
}
