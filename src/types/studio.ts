import type { ScriptBreakdownOutput } from '@/types/scriptBreakdown';

export type Department =
  | 'WRITING'
  | 'STORYBOARD'
  | 'PROMPT'
  | 'TEXT'
  | 'SHOT_LIST'
  | 'STORYBOARD_FILE'
  | 'PROMPT_REVIEW'
  | 'IMAGE'
  | 'SCRIPT_INPUT'
  | 'SCRIPT_SCENE'
  | 'SCRIPT_CHARACTER'
  | 'SCRIPT_PROP'
  | 'SCRIPT_OUTPUT'
  | 'SCRIPT_REVIEW'
  | 'SCRIPT_TIMELINE'
  | 'SCRIPT_ART'
  | 'SCRIPT_VFX'
  | 'SCRIPT_WORLD'
  | 'SCRIPT_PRODUCTION'
  | 'SCRIPT_AI_ASSETS';

/** 部门流水线为 writing | storyboard | prompt；TEXT_NODE 为基础长文本源节点；shot_list_node 为分镜子节点 */
export type NodeKind =
  | 'writing'
  | 'storyboard'
  | 'prompt'
  | 'text_node'
  | 'shot_list_node'
  | 'storyboard_file_node'
  | 'prompt_review_node'
  | 'image_node'
  | 'script_input_node'
  | 'script_scene_node'
  | 'script_character_node'
  | 'script_prop_node'
  | 'script_output_node'
  | 'script_review_node'
  | 'script_timeline_node'
  | 'script_art_node'
  | 'script_vfx_node'
  | 'script_world_node'
  | 'script_production_node'
  | 'script_ai_assets_node';

export type NodeStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'WAITING_REVIEW'
  /** AI 总监已出具意见，等待用户选择「优化迭代」或「维持现状通过」 */
  | 'REVIEWED'
  | 'APPROVED'
  | 'REJECTED';

/** 旧版：用户在未改版终裁态手动通过 */
export const REVIEW_RESULT_MANUAL_PASS = '用户手动通过';

/** 已阅态：用户选择无视 AI 建议、维持当前产出并终审通过 */
export const REVIEW_RESULT_APPROVE_AS_IS = '维持现状通过（人工终审）';

/** AI 总监倾向通过且未附长文时的默认展示 */
export const DEFAULT_AI_REVIEW_PASS_SUMMARY =
  'AI 总监：整体建议通过。您可任选：按意见执行「优化迭代」重新生成，或「维持现状通过」直接激活下游。';

export type PipelineResolutionKind = 'ai_optimize' | 'human_approve_as_is';

export interface PipelineResolutionHistoryEntry {
  at: number;
  kind: PipelineResolutionKind;
  /** 简短说明，如「执行 AI 优化迭代」「维持现状通过」 */
  summary: string;
}

export interface PromptReviewHistoryEntry {
  id: string;
  at: number;
  label: string;
  text: string;
  charCount: number;
}

export interface EpisodeOutline {
  id: string;
  /** 集数，从 1 起 */
  episodeNo?: number;
  title: string;
  summary: string;
}

export interface SceneRow {
  episodeId: string;
  /** 集数（与分集一致），便于场次表展示与校验 */
  episodeNo?: number;
  sceneNo: number;
  /** 场景名称 */
  title: string;
  /** 核心冲突（本场戏张力） */
  coreConflict?: string;
  /** 登场角色 */
  characters?: string[];
  /**
   * 节拍/补充说明（旧版字段；与 coreConflict 二选一或并存均可）
   */
  beat?: string;
  /** 编剧详情预览区用户微调后的正文；若存在则优先于 coreConflict/beat 拼接展示与导出 */
  narrativeDraft?: string;
  /** AI 可填：本场「钩子/悬念」摘要；缺省时由 beat 文本启发式提取 */
  storyHook?: string;
  /** 可选：供导出时写入「分镜建议」注释（用户勾选后优先使用，否则导出器可生成启发式一句） */
  storyboardSuggestion?: string;
}

export interface WritingOutput {
  /** 规划总集数（如 12 / 24 / 100） */
  plannedEpisodeCount?: number;
  episodes: EpisodeOutline[];
  scenes: SceneRow[];
}

/**
 * 分镜部镜头行（AI 协议）：与员工 JSON 数组元素一一对应，供表格与下游 Prompt 消费。
 */
export interface StoryboardShot {
  /** 镜头号（协议字段 id） */
  id: number;
  /** 源表格里的原始镜头号，如 LCFR_01_0540 */
  shotNo?: string;
  /** 画布内镜头行稳定标识：用于逐镜头 Output 端口连线 */
  wireId?: string;
  /** 景别（协议字段 type） */
  type: string;
  /** 运镜（协议字段 movement） */
  movement: string;
  /** 画面描述（协议字段 description） */
  description: string;
  /** 台词/对白（协议字段 content；无对白为 ""） */
  content: string;
  /** 回溯场次/场记（可选） */
  sceneRef?: string;
  /** 画内动作调度（可选，与 movement 区分） */
  action?: string;
  sound?: string;
  /** 建议时长（秒）；同场合并与 Seedance 卡片渲染可消费 */
  durationSec?: number;
  /** 该镜头的执行备注 / 节奏说明 */
  note?: string;
  /** 同场连续镜头合并后保留的原始成员列表 */
  mergedMembers?: StoryboardShot[];
}

export interface StoryboardOutput {
  /** 镜头对象数组（主载荷；AI 可仅返回该数组，解析时包装为本结构） */
  shots: StoryboardShot[];
  /** 场次节拍摘要；若模型未返回则由解析器根据镜头推导，供总监对齐与侧栏展示 */
  narrativeBeats: string[];
}

/** 单镜头视频提示词的十维结构化（与主 prompt 字符串互补） */
export interface PromptShotDimensions {
  场景?: string;
  角色?: string;
  动作?: string;
  情感?: string;
  镜头?: string;
  运镜?: string;
  灯光?: string;
  风格?: string;
  构图?: string;
  连贯性?: string;
}

/** 单镜头输出：适配 AI 视频引擎（如 Seeddance / SVD） */
export interface PromptShotPack {
  shot_id: string;
  prompt: string;
  negative_prompt: string;
  dimensions?: PromptShotDimensions;
  /** Asset System 角色 ID，用于跨镜一致 */
  character_asset_ids?: string[];
  /** Asset System 场景 ID */
  scene_asset_ids?: string[];
  /** 可选：直接面向 Seedance 的卡片文本 */
  seedanceCard?: string;
}

export interface PromptOutput {
  system: string;
  userTemplate: string;
  negative?: string;
  parameters: Record<string, string>;
  /** 按镜头的最终提示词包；与 userTemplate 摘要并存 */
  shotPrompts?: PromptShotPack[];
}

export interface AssistantHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 节点业务数据（Zustand / React Flow `data`）必填字段：
 * id, type, department, status, input, output, review_result, version
 * `label` 为画布展示用扩展字段。
 */
export type StudioNodeData = {
  id: string;
  type: NodeKind;
  department: Department;
  status: NodeStatus;
  input: string;
  output: WritingOutput | StoryboardOutput | PromptOutput | ScriptBreakdownOutput | Record<string, unknown> | null;
  review_result: string | null;
  version: number;
  label: string;
  /** TEXT_NODE：用户粘贴/编辑的原始长文本；与 `input` 保持同步，供连线写入部门节点 */
  raw_text?: string;
  /** 分镜节点：生成时依据的剧本场次数，供分镜 Leader 与场次对齐校验 */
  sourceSceneCount?: number;
  /** 分镜：员工 AI 首次写入 `output` 时的深拷贝，供「重置为 AI 原始生成」 */
  storyboard_ai_snapshot?: StoryboardOutput | null;
  /** manual=用户右侧面板粘贴，优先于端口输入；graph=从连线合并 */
  inputSource?: 'manual' | 'graph';
  /** 通过左侧智能助手补充的长期偏好 */
  assistant_preferences?: string;
  /** 通过左侧智能助手补充的当前任务要求；下次执行时自动并入任务文本 */
  assistant_task_instruction?: string;
  /**
   * 挂载的技能 id 列表（与 `SkillLoader` 中 id 一致，如 `writing/daily_skit_v1`）。
   * 执行时 LLM system = 部门基础指令 + 各技能 system_instruction + 用户数据侧由 user 承载。
   */
  mounted_skills?: string[];
  /** 员工阶段失败（含 JSON 解析失败）时的友好说明；成功进入产出或重新执行时清除 */
  generation_error?: string;
  /** 上游镜头表已更新，当前输出可能过期；用于提示用户重新生成 */
  output_stale_reason?: string | null;
  /** 执行中：详情面板流式展示的文本（员工生成 JSON 打字机 / 等待提示） */
  streaming_preview?: string;
  /** 流水线子阶段：员工生成 vs 总监审核（均为 IN_PROGRESS 时用于文案与流光） */
  generation_phase?: 'employee' | 'leader';
  /** 详情页 Footer：累计 Token（由执行管线可选写入） */
  usageTokensTotal?: number;
  /** 详情页 Footer：`version` 递增时由 store 自动刷新 */
  lastUpdatedAt?: number;
  /** REVIEWED：AI 总监审核全文，供用户决策前阅读 */
  ai_review_feedback?: string | null;
  /** REVIEWED：最近一次自动总监是否倾向通过（仅 UI 提示） */
  leader_review_suggested_pass?: boolean;
    /** 审核相关操作审计：AI 优化 / 人工维持通过 */
    pipeline_resolution_history?: PipelineResolutionHistoryEntry[];
    /** 提示词审核节点：被同步 / LLM / 手动保存覆盖前的可回退版本 */
    prompt_review_history?: PromptReviewHistoryEntry[];
  /**
   * 瞬时 UI：用户在已阅态点击「采纳重算 / 忽略通过」后画布节点边框高亮，到期自动清除。
   */
  pipeline_decision_flash?: { kind: 'approve' | 'optimize'; until: number } | null;
  /** shot_list_node：绑定的分镜部门节点 id（父子连线） */
  sourceStoryboardNodeId?: string;
  /** shot_list_node：绑定的分镜文件节点 id（父子连线） */
  sourceStoryboardFileNodeId?: string;
  importedFileName?: string;
  importedSheetName?: string;
  importedRowCount?: number;
  imageDataUrl?: string;
  imageMimeType?: string;
  imageFileName?: string;
  imageAnalysisSummary?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  /**
   * 仅运行时：打开项目 / 首次挂载后由 store 注入；JSON 持久化会丢弃，须在载入后重新绑定。
   * 部门节点：执行任务（等同画布播放 + 打开详情）。
   */
  onExecute?: () => void | Promise<void>;
  /** 仅运行时：删除本节点（等同右键「删除节点」） */
  onDelete?: () => void;
} & Record<string, unknown>;

export type ChatRole = 'user' | 'assistant' | 'system' | 'broadcast';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  nodeId?: string;
  ts: number;
}

export interface ApprovedAsset {
  nodeId: string;
  department: Department;
  version: number;
  payload: unknown;
  /** 登记时间戳；每次 APPROVED 创建一个带时间戳的快照 */
  createdAt: number;
  /** 快照唯一标识，格式：snapshot_{nodeId}_{createdAt} */
  snapshotId?: string;
}
