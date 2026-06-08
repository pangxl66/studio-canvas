/**
 * Studio 閻㈣绔烽崗銊ョ湰閻樿埖鈧緤绱橺ustand閿?
 *
 * 閳?閼哄倻鍋?`data` 韫囧懎锝為敍姝ヾ, type, department, status, input, output, review_result, version閿涘牏琚崹瀣剁窗`StudioNodeData`閿?
 * 閳?濞翠焦鎸夌痪璺ㄥЦ閹緤绱癗OT_STARTED 閳?IN_PROGRESS 閳?REVIEWED閿涘牊鈧崵娲冨鏌ユ閿涘矁顕涢幆鍛蓟闁绱氶埆?IN_PROGRESS閿涘牅绱崠鏍嚡娴狅綇绱殀 APPROVED | REJECTED閿涙稒妫悽璇茬娴犲秴褰查崙铏瑰箛 WAITING_REVIEW
 *    - 閺嶏繝鐛欓敍姝歝anTransitionPipelineStatus`閿?/workflow.ts閿? `patchNodeData` 閸愬懎顕?`status` 閻ㄥ嫭鐗庢?
 *    - 娑撳鐖跺鏇犳暏閿涙氨绱崜褑绁禍褌绮涢悽?`getLatestApprovedWritingBundle`閿涙稑鍨庨梹婊堝劥姒涙顓婚悪顒傜彌濞戝牐鍨傞懞鍌滃仯 `input` 缁绢垱鏋冮張顒婄礄閸欘垱甯?TEXT_NODE閿?
 */
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import { createCanvasStoreSlice } from './slices/canvasStore';
import { createPipelineStoreSlice } from './slices/pipelineStore';
import { createProjectStoreSlice } from './slices/projectStore';
import { createPromptReviewStoreSlice } from './slices/promptReviewStore';
import { createShotListStoreSlice } from './slices/shotListStore';
import { createTextStoreSlice } from './slices/textStore';
import {
  cloneStoryboardOutput,
  tryParseStoryboardOutput,
} from '@/agents/storyboardAgents';
import { executeEmployeePhase } from '@/services/agents/executeTask';
import { runNodeAssistant } from '@/services/nodeAssistant';
import { ingestWritingOutputToProjectContext } from '@/services/ProjectContext';
import { mergeDownstreamSkillsFromChain } from '@/services/skillChain';
import { getSkillById, normalizeMountedSkillIdsForKind } from '@/services/skillLoader';
import {
  buildWorkflowAgentStageHint,
  buildWorkflowAgentStartMessage,
  detectWorkflowAgentInputType,
  detectWorkflowAgentIntent,
  detectWorkflowAgentMode,
  routeLabel,
  resolveWorkflowRoute,
  stageLabel,
  type WorkflowAgentSession,
} from '@/services/workflowAgent';
import {
  DEPT_OUTPUT_HANDLE_ID,
  departmentAssetAsInputText,
  mergedTextInputForDepartment,
  mergedUpstreamForPromptReviewNode,
  mergedUpstreamForTextNode,
  resolveDepartmentExecutionInput,
} from '@/services/graphInput';
import {
  SHOT_LIST_LINK_HANDLE_ID,
  SHOT_LIST_PARENT_HANDLE_ID,
  createStoryboardShotWireId,
  isShotListItemOutputHandleId,
  makeShotListItemOutputHandleId,
  parseShotListItemOutputHandleId,
} from '@/utils/shotListWire';
import type { StudioRFNode } from '@/types/reactFlow';
import {
  type AssistantHistoryEntry,
  type ApprovedAsset,
  type ChatMessage,
  type Department,
  type NodeKind,
  type NodeStatus,
  type PromptOutput,
  type StoryboardOutput,
  type StudioNodeData,
  type WritingOutput,
  REVIEW_RESULT_APPROVE_AS_IS,
  REVIEW_RESULT_MANUAL_PASS,
} from '@/types/studio';
import { flushShotListPendingEdits } from '@/utils/shotListPendingEdits';
import {
  normalizeRestoredStudioNode,
  rebindStudioNodeRuntimeHandlers,
  stripFunctionsDeep,
} from '@/utils/studioNodePersistence';
import { formatReviewOptimizationPayload } from '@/utils/pipelineReviewContentPreview';
import { formatPipelineOutputPreview, typewriterStream } from '@/utils/streamPreview';
import { canTransitionPipelineStatus, PIPELINE_INITIAL_STATUS } from './workflow';

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

type PipelineKind = Exclude<
  NodeKind,
  | 'text_node'
  | 'shot_list_node'
  | 'storyboard_file_node'
  | 'prompt_review_node'
  | 'image_node'
  | 'video_node'
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
  | 'script_ai_assets_node'
>;

function kindToDepartment(kind: PipelineKind): Department {
  if (kind === 'writing') return 'WRITING';
  if (kind === 'storyboard') return 'STORYBOARD';
  return 'PROMPT';
}

function deptLabel(d: Department): string {
  if (d === 'WRITING') return '编剧部';
  if (d === 'STORYBOARD') return '分镜部';
  if (d === 'TEXT') return '文本卡片';
  if (d === 'SHOT_LIST') return '镜头表';
  if (d === 'STORYBOARD_FILE') return '分镜表文件';
  if (d === 'PROMPT_REVIEW') return '提示词审核';
  if (d === 'IMAGE') return '图片表格';
  if (d === 'VIDEO') return '视频节点';
  if (d === 'SCRIPT_INPUT') return '剧本输入';
  if (d === 'SCRIPT_SCENE') return '场景拆解';
  if (d === 'SCRIPT_CHARACTER') return '角色分析';
  if (d === 'SCRIPT_PROP') return '道具分析';
  if (d === 'SCRIPT_OUTPUT') return '拆解汇总';
  if (d === 'SCRIPT_REVIEW') return '质量复核';
  if (d === 'SCRIPT_TIMELINE') return '时间线分析';
  if (d === 'SCRIPT_ART') return '美术分析';
  if (d === 'SCRIPT_VFX') return 'VFX分析';
  if (d === 'SCRIPT_WORLD') return '世界观分析';
  if (d === 'SCRIPT_PRODUCTION') return '制片统筹';
  if (d === 'SCRIPT_AI_ASSETS') return 'AI资产生成';
  return 'Prompt部';
}

function summarizeFeedbackPreview(text: string, max = 48): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

/** 閸涙ê浼愮€瑰本鍨氶崥搴ゅ殰閸斻劏袝閸欐垶鈧崵娲冪€光剝鐗抽崜宥囨畱缁涘绶熼敍鍫燁嚑缁夋帪绱?*/
const STOP_TASK_MESSAGE = '当前任务已停止。';
const SHOT_LIST_DEFAULT_WIDTH = 800;
const SHOT_LIST_DEFAULT_HEIGHT = 420;
const DUPLICATED_NODE_VERTICAL_GAP = 36;
const DUPLICATED_NODE_COLLISION_PADDING = 16;
const AUTO_PROMPT_REVIEW_GAP = 96;
const AUTO_PROMPT_REVIEW_COLLISION_STEP = 96;
const AUTO_PROMPT_REVIEW_COLLISION_PADDING = 24;
const UNDO_STACK_LIMIT = 20;
const activeTaskAbortControllers = new Map<string, AbortController>();

type StudioNodeWithMeasuredSize = StudioRFNode & {
  width?: number;
  height?: number;
  measured?: {
    width?: number;
    height?: number;
  };
};

type NodeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function defaultNodeSize(node: StudioRFNode): { width: number; height: number } {
  if (node.type === 'textNode') return { width: 430, height: 420 };
  if (node.type === 'storyboardFile') return { width: 260, height: 190 };
  if (node.type === 'imageNode') return { width: 560, height: 390 };
  if (node.type === 'videoNode') return { width: 620, height: 430 };
  if (node.type === 'scriptInput') return { width: 360, height: 360 };
  if (node.type === 'scriptAnalyzer') return { width: 300, height: 260 };
  if (node.type === 'scriptOutput') return { width: 360, height: 300 };
  if (node.type === 'shotList') {
    return {
      width: positiveNumber(node.data.canvasWidth) ?? SHOT_LIST_DEFAULT_WIDTH,
      height: positiveNumber(node.data.canvasHeight) ?? SHOT_LIST_DEFAULT_HEIGHT,
    };
  }
  if (node.type === 'promptReview') {
    return {
      width: positiveNumber(node.data.canvasWidth) ?? 380,
      height: positiveNumber(node.data.canvasHeight) ?? 640,
    };
  }
  return { width: 244, height: 230 };
}

function getNodeSize(node: StudioRFNode): { width: number; height: number } {
  const sizedNode = node as StudioNodeWithMeasuredSize;
  const fallback = defaultNodeSize(node);
  return {
    width:
      positiveNumber(sizedNode.width) ??
      positiveNumber(sizedNode.measured?.width) ??
      positiveNumber(node.data.canvasWidth) ??
      fallback.width,
    height:
      positiveNumber(sizedNode.height) ??
      positiveNumber(sizedNode.measured?.height) ??
      positiveNumber(node.data.canvasHeight) ??
      fallback.height,
  };
}

function rectsOverlap(a: NodeRect, b: NodeRect, padding = 0): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

function findDuplicatedNodePosition(sourceNode: StudioRFNode, occupiedRects: NodeRect[]): { x: number; y: number } {
  const size = getNodeSize(sourceNode);
  const stepY = size.height + DUPLICATED_NODE_VERTICAL_GAP;
  const rect: NodeRect = {
    x: sourceNode.position.x,
    y: sourceNode.position.y + stepY,
    width: size.width,
    height: size.height,
  };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!occupiedRects.some((occupied) => rectsOverlap(rect, occupied, DUPLICATED_NODE_COLLISION_PADDING))) {
      occupiedRects.push({ ...rect });
      return { x: rect.x, y: rect.y };
    }
    rect.y += stepY;
  }

  occupiedRects.push({ ...rect });
  return { x: rect.x, y: rect.y };
}

/** 闁劑妫梻鏉戞彥闁喐濯虹痪鍖＄窗閸掑棝鏆?閳?Prompt 娑撳秴婀銈夋懠閸愬拑绱欐い鑽ょ病闂€婊冦仈鐞涖劌鐡欓懞鍌滃仯 Output閿涘鈧?*/
function canDeptChain(upstream: PipelineKind, downstream: PipelineKind): boolean {
  if (upstream === 'writing' && downstream === 'storyboard') return true;
  if (upstream === 'writing' && downstream === 'prompt') return true;
  return false;
}

function makeTextNodeData(id: string, text = '', positionLabel?: string): StudioNodeData {
  return {
    id,
    type: 'text_node',
    department: 'TEXT',
    status: 'APPROVED',
    input: text,
    raw_text: text,
    output: null,
    review_result: null,
    version: 0,
    label: positionLabel ?? '文本卡片',
    assistant_preferences: '',
    assistant_task_instruction: '',
  };
}

function makeStoryboardFileNodeData(id: string, positionLabel?: string): StudioNodeData {
  return {
    id,
    type: 'storyboard_file_node',
    department: 'STORYBOARD_FILE',
    status: 'APPROVED',
    input: '',
    output: null,
    review_result: null,
    version: 0,
    label: positionLabel ?? '分镜表文件',
    assistant_preferences: '',
    assistant_task_instruction: '',
  };
}

function makeNodeData(
  id: string,
  kind: PipelineKind,
  input = '',
  positionLabel?: string,
): StudioNodeData {
  const department = kindToDepartment(kind);
  return {
    id,
    type: kind,
    department,
    status: PIPELINE_INITIAL_STATUS,
    input,
    output: null,
    review_result: null,
    version: 0,
    label: positionLabel ?? `${deptLabel(department)} · ${id.slice(-4)}`,
    mounted_skills: normalizeMountedSkillIdsForKind(kind, []),
    assistant_preferences: '',
    assistant_task_instruction: '',
  };
}

function makeShotListNodeData(
  id: string,
  output: StoryboardOutput | null,
  snapshot: StoryboardOutput | null,
  opts?: {
    sourceStoryboardNodeId?: string;
    sourceStoryboardFileNodeId?: string;
    sourceSceneCount?: number;
  },
): StudioNodeData {
  return {
    id,
    type: 'shot_list_node',
    department: 'SHOT_LIST',
    status: 'APPROVED',
    input: '',
    output,
    review_result: null,
    version: 0,
    label: `分镜表 · ${id.slice(-4)}`,
    sourceStoryboardNodeId: opts?.sourceStoryboardNodeId,
    sourceStoryboardFileNodeId: opts?.sourceStoryboardFileNodeId,
    canvasWidth: SHOT_LIST_DEFAULT_WIDTH,
    canvasHeight: SHOT_LIST_DEFAULT_HEIGHT,
    storyboard_ai_snapshot: snapshot,
    sourceSceneCount: opts?.sourceSceneCount,
    mounted_skills: [],
    assistant_preferences: '',
    assistant_task_instruction: '',
  };
}

function makeImageNodeData(
  id: string,
  opts?: {
    label?: string;
    imageDataUrl?: string;
    imageMimeType?: string;
    imageFileName?: string;
  },
): StudioNodeData {
  return {
    id,
    type: 'image_node',
    department: 'IMAGE',
    status: 'APPROVED',
    input: '',
    output: null,
    review_result: null,
    version: 0,
    label: opts?.label?.trim() || `图片节点 · ${id.slice(-4)}`,
    imageDataUrl: opts?.imageDataUrl,
    imageMimeType: opts?.imageMimeType,
    imageFileName: opts?.imageFileName,
    assistant_preferences: '',
    assistant_task_instruction: '',
  };
}

function makeVideoNodeData(
  id: string,
  opts?: {
    label?: string;
    videoDataUrl?: string;
    videoMimeType?: string;
    videoFileName?: string;
    videoFrameDataUrl?: string;
    videoDurationSec?: number;
    videoWidth?: number;
    videoHeight?: number;
  },
): StudioNodeData {
  return {
    id,
    type: 'video_node',
    department: 'VIDEO',
    status: 'APPROVED',
    input: '',
    output: null,
    review_result: null,
    version: 0,
    label: opts?.label?.trim() || `视频节点 · ${id.slice(-4)}`,
    videoDataUrl: opts?.videoDataUrl,
    videoMimeType: opts?.videoMimeType,
    videoFileName: opts?.videoFileName,
    videoFrameDataUrl: opts?.videoFrameDataUrl,
    videoDurationSec: opts?.videoDurationSec,
    videoWidth: opts?.videoWidth,
    videoHeight: opts?.videoHeight,
    assistant_preferences: '',
    assistant_task_instruction: '',
  };
}

function makePromptReviewNodeData(id: string, text = '', positionLabel?: string): StudioNodeData {
  return {
    id,
    type: 'prompt_review_node',
    department: 'PROMPT_REVIEW',
    status: 'APPROVED',
    input: text,
    raw_text: text,
    output: { text },
    review_result: null,
    version: 0,
    canvasWidth: 380,
    canvasHeight: 640,
    prompt_review_history: [],
    label: positionLabel ?? `提示词审核 · ${id.slice(-4)}`,
    assistant_preferences: '',
    assistant_task_instruction: '',
  };
}

type ScriptNodeKind =
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

function scriptDepartmentForKind(kind: ScriptNodeKind): Department {
  if (kind === 'script_input_node') return 'SCRIPT_INPUT';
  if (kind === 'script_scene_node') return 'SCRIPT_SCENE';
  if (kind === 'script_character_node') return 'SCRIPT_CHARACTER';
  if (kind === 'script_prop_node') return 'SCRIPT_PROP';
  if (kind === 'script_review_node') return 'SCRIPT_REVIEW';
  if (kind === 'script_timeline_node') return 'SCRIPT_TIMELINE';
  if (kind === 'script_art_node') return 'SCRIPT_ART';
  if (kind === 'script_vfx_node') return 'SCRIPT_VFX';
  if (kind === 'script_world_node') return 'SCRIPT_WORLD';
  if (kind === 'script_production_node') return 'SCRIPT_PRODUCTION';
  if (kind === 'script_ai_assets_node') return 'SCRIPT_AI_ASSETS';
  return 'SCRIPT_OUTPUT';
}

function scriptLabelForKind(kind: ScriptNodeKind): string {
  if (kind === 'script_input_node') return '剧本输入';
  if (kind === 'script_scene_node') return '场景拆解';
  if (kind === 'script_character_node') return '角色分析';
  if (kind === 'script_prop_node') return '道具分析';
  if (kind === 'script_review_node') return '质量复核';
  if (kind === 'script_timeline_node') return '时间线分析';
  if (kind === 'script_art_node') return '美术分析';
  if (kind === 'script_vfx_node') return 'VFX分析';
  if (kind === 'script_world_node') return '世界观分析';
  if (kind === 'script_production_node') return '制片统筹';
  if (kind === 'script_ai_assets_node') return 'AI资产生成';
  return '拆解汇总';
}

function makeScriptNodeData(id: string, kind: ScriptNodeKind): StudioNodeData {
  const inputLike = kind === 'script_input_node';
  return {
    id,
    type: kind,
    department: scriptDepartmentForKind(kind),
    status: inputLike ? 'APPROVED' : 'NOT_STARTED',
    input: '',
    raw_text: inputLike ? '' : undefined,
    output: null,
    review_result: null,
    version: 0,
    label: `${scriptLabelForKind(kind)} · ${id.slice(-4)}`,
    assistant_preferences: '',
    assistant_task_instruction: '',
  };
}

function cloneStoryboardOutputWithFreshWireIds(output: StoryboardOutput | null): StoryboardOutput | null {
  if (!output) return null;
  const cloned = cloneStoryboardOutput(output);
  return {
    ...cloned,
    shots: cloned.shots.map((shot) => ({
      ...shot,
      wireId: createStoryboardShotWireId(shot.id),
      mergedMembers: shot.mergedMembers?.map((member) => ({
        ...member,
        wireId: createStoryboardShotWireId(member.id),
      })),
    })),
  };
}

function nextProjectName(projectName?: string | null): string {
  const trimmed = projectName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : '未命名项目';
}

function getNodeAssistantHistory(messages: ChatMessage[], nodeId: string): AssistantHistoryEntry[] {
  return messages
    .filter((msg) => msg.nodeId === nodeId && (msg.role === 'user' || msg.role === 'assistant'))
    .slice(-12)
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.text,
    }));
}

function findStoryboardShotListChild(
  nodes: StudioRFNode[],
  edges: Edge[],
  parentNodeId: string,
): StudioRFNode | null {
  const edge = edges.find(
    (e) => e.source === parentNodeId && e.sourceHandle === SHOT_LIST_LINK_HANDLE_ID,
  );
  if (!edge) return null;
  return (
    nodes.find(
      (n) => n.id === edge.target && n.type === 'shotList' && n.data.type === 'shot_list_node',
    ) ?? null
  );
}

export type StudioState = {
  nodes: StudioRFNode[];
  edges: Edge[];
  assets: ApprovedAsset[];
  messages: ChatMessage[];
  currentProjectId: string | null;
  currentProjectName: string;
  activeNodeId: string | null;
  selectedNodeId: string | null;
  detailOpen: boolean;
  requestFitNodeId: string | null;
  shotListSelectedWiresByNodeId: Record<string, string[]>;
  undoStack: UndoSnapshot[];
  workflowAgentSession: WorkflowAgentSession | null;

  onNodesChange: (changes: NodeChange<StudioRFNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  /** 閹?id 缁夊娅庢潻鐐靛殠楠炶泛鍩涢弬棰佺瑓濞撴悂鍎撮梻?/ 閺傚洦婀伴懞鍌滃仯閻ㄥ嫬鎮庨獮鎯扮翻閸?*/
  removeEdges: (edgeIds: string[]) => void;
  onConnect: (c: Connection) => void;
  setShotListSelectedWires: (nodeId: string, wireIds: string[]) => void;
  setSelected: (id: string | null) => void;
  setDetailOpen: (open: boolean) => void;
  setActiveNodeId: (id: string | null) => void;
  consumeFitRequest: () => void;
  pushMessage: (m: Omit<ChatMessage, 'id' | 'ts'> & { id?: string }) => string;
  linkChatMessageToNode: (messageId: string, nodeId: string) => void;
  submitAssistantChat: (text: string, position?: { x: number; y: number }) => Promise<void>;
  submitWorkflowAgentChat: (text: string, position?: { x: number; y: number }) => Promise<void>;
  clearWorkflowAgentSession: () => void;
  registerAsset: (a: ApprovedAsset) => void;
  patchNodeData: (id: string, patch: Partial<StudioNodeData>, bumpVersion?: boolean) => void;
  /** 闂€婊冦仈鐞涖劏濡悙纭呫€冮弽鑲╃椽鏉堟埊绱版稉搴ｅ煑閸掑棝鏆呴懞鍌滃仯 `output` 閸氬本顒為獮璺哄煕閺傞绗呭〒?Prompt 缁涘鎮庨獮鎯扮翻閸?*/
  patchShotListNodeOutput: (shotListId: string, output: StoryboardOutput, bumpVersion?: boolean) => void;
  /** 閸掑棝鏆呴崨妯轰紣娴溠冨毉閺堝鏅ラ梹婊冦仈閸氬函绱伴懛顏勫З閸︺劋绗呴弬鐟板灡瀵ゆ椽鏆呮径纾嬨€冪€涙劘濡悙鐟拌嫙鏉╃偟鍤庨敍灞惧灗閸掗攱鏌婂鍙夋箒鐎涙劘濡悙瑙勬殶閹?*/
  ensureShotListForStoryboard: (storyboardNodeId: string) => void;
  /** 鐏忓棗缍嬮崜宥呭瀻闂€?output 閹恒劑鈧礁鍩屽鑼拨鐎规氨娈戦梹婊冦仈鐞涖劌鐡欓懞鍌滃仯閿涘牅绗夐崘娆忔礀閻栨儼濡悙鐧哥礆 */
  syncShotListNodesFromStoryboard: (storyboardNodeId: string) => void;
  ensureShotListForStoryboardFile: (storyboardFileNodeId: string) => void;
  syncShotListNodesFromStoryboardFile: (storyboardFileNodeId: string) => void;
  setStatus: (id: string, next: NodeStatus) => boolean;
  setCurrentProjectMeta: (projectId: string | null, projectName?: string) => void;
  createNewProject: (projectName?: string) => string;
  addDepartmentNode: (kind: PipelineKind, position?: { x: number; y: number }) => string;
  addTextNode: (text?: string, position?: { x: number; y: number }) => string;
  addStoryboardFileNode: (position?: { x: number; y: number }) => string;
  addPromptReviewNode: (
    position?: { x: number; y: number },
    text?: string,
    opts?: { label?: string },
  ) => string;
  addImageNode: (
    position?: { x: number; y: number },
    opts?: { imageDataUrl?: string; imageMimeType?: string; imageFileName?: string; label?: string },
  ) => string;
  addVideoNode: (
    position?: { x: number; y: number },
    opts?: {
      videoDataUrl?: string;
      videoMimeType?: string;
      videoFileName?: string;
      videoFrameDataUrl?: string;
      videoDurationSec?: number;
      videoWidth?: number;
      videoHeight?: number;
      label?: string;
    },
  ) => string;
  addShotListNode: (
    position?: { x: number; y: number },
    output?: StoryboardOutput | null,
    opts?: {
      importedFileName?: string;
      importedSheetName?: string;
      importedRowCount?: number;
      label?: string;
    },
  ) => string;
  addScriptInputNode: (position?: { x: number; y: number }) => string;
  addScriptCoreAnalyzerNodes: (inputId: string) => {
    sceneId: string;
    characterId: string;
    propId: string;
  };
  addScriptAiAssetsNodeFromSource: (sourceId: string) => string | null;
  addScriptBreakdownTemplate: (position?: { x: number; y: number }) => {
    inputId: string;
    sceneId: string;
    characterId: string;
    propId: string;
    outputId: string;
    reviewId: string;
    timelineId: string;
    artId: string;
    vfxId: string;
    worldId: string;
    productionId: string;
    aiAssetsId: string;
  };
  /** 閸︺劍瀵氱€规艾娼楅弽鍥у灡瀵?TEXT_NODE閿涘苯鑻熸潻鐐插煂闁劑妫?Input閿涘澅argetHandle `in`閿?*/
  createTextNodeLinkedToDepartment: (deptId: string, position: { x: number; y: number }) => string;
  /** 娴犲骸褰為弻鍕缁惧潡鍣撮弨鎯ф躬缁岃櫣娅ф径鍕倵閿涘瞼鏁遍懣婊冨礋闁瀚ㄩ崚娑樼紦閼哄倻鍋ｉ獮鎯板殰閸斻劏绻涚痪?*/
  completeConnectionMenuPick: (p: {
    fromNodeId: string;
    fromHandleId: string | null;
    fromHandleType: 'source' | 'target' | null;
    pick:
      | 'text_node'
      | 'image_node'
      | 'video_node'
      | 'storyboard_file_node'
      | 'prompt_review_node'
      | 'writing'
      | 'storyboard'
      | 'prompt';
    flowPosition: { x: number; y: number };
  }) => string | undefined;
  startWritingPipeline: (text: string, position?: { x: number; y: number }) => string;
  startStoryboardPipeline: (position?: { x: number; y: number }) => string;
  /** 閸掑棝鏆呴悪顒傜彌濡€崇础閿涙艾鐔€娴滃骸缍嬮崜?`input` 閸撗勬拱閺傚洦婀伴幏鍡毿掗梹婊冦仈閿涘苯鐣幋鎰倵鏉╂稑鍙?REVIEWED閿涘牊鍨ㄩ弮褎鈧?WAITING_REVIEW閿?*/
  runStoryboardFromInput: (id: string) => void;
  /** 閻㈣绔烽妴灞惧⒔鐞涘被鈧稄绱伴崗鍫濇値楠?Input 鏉╃偛鍙嗛崘宥堢獓缂傛牕澧介崨妯轰紣 閳?REVIEWED */
  runWritingFromInput: (id: string) => void;
  startPromptPipeline: (brief: string, position?: { x: number; y: number }) => string;
  /** 閻㈣绔烽妴灞惧⒔鐞涘被鈧稄绱伴崗鍫濇値楠?Input 鏉╃偛鍙嗛崘宥堢獓 Prompt 閸涙ê浼?閳?REVIEWED */
  runPromptFromInput: (id: string) => void;
  /**
   * 閺嶇绺鹃幍褑顢戦崗銉ュ經閿涙艾鎮庨獮?Input 閳?IN_PROGRESS 閳?閸涙ê浼?+ 閼奉亜濮╅幀鑽ゆ磧 閳?REVIEWED閿涘牆鎯?ai_review_feedback閿涘鈧?
   * `optimizeFromReviewed`閿涙矮绮庡鏌ユ閹焦瀵滈幇蹇氼潌鏉╊厺鍞妴鍌濇硶闁劑妫潏鎾冲弳娴犲秳绶风挧鏍︾瑐濞?APPROVED 鐠у嫪楠囬妴?
   */
  executeNodeTask: (nodeId: string, opts?: { optimizeFromReviewed?: boolean; force?: boolean }) => Promise<void>;
  stopNodeTask: (nodeId?: string | null) => void;
  /** 瀹告煡妲勯敍姘殺閵嗗本澧界悰?AI 娴兼ê瀵查妴宥呭晸閸忋儱宸婚崣鎻掕嫙闁插秵鏌婄捄鎴濇喅瀹?+ 閹崵娲?*/
  runReviewedOptimization: (nodeId?: string | null) => void;
  /** 瀹告煡妲勯敍姘辨樊閹镐胶骞囬悩鍓佺矒鐎癸繝鈧俺绻冮敍鍫㈢搼閸氬矂鈧銆?B閿?*/
  approveReviewedAsIs: (nodeId?: string | null) => string | undefined;
  /** WAITING_REVIEW / REVIEWED：由用户填写或更新审核意见 */
  submitLeaderReviewFeedback: (nodeId?: string | null, feedback?: string) => string | undefined;
  /** 鏉╂柨娲栭張顒侇偧鐏忔繆鐦€光剝鐗抽惃鍕窗閺嶅洩濡悙?id閿涘牅绌舵禍搴や喊婢垛晜瀵氭禒銈呭彠閼辨柨鐣炬担宥忕礆閿涙稒婀崣鎴ｆ崳鐎光剝鐗抽弮?undefined */
  triggerLeaderReview: (nodeId?: string | null) => Promise<string | undefined>;
  /**
   * REVIEWED閿涙氨鐡戦崥灞烩偓宀€娣幐浣哄箛閻樺爼鈧俺绻冮妴宥忕礄闁銆?B閿涘苯宸婚崣鑼额唶娑撹桨姹夊銉┾偓姘崇箖閿涘鈧?
   * WAITING_REVIEW閿涘牊妫悽璇茬閿涘绱扮捄瀹犵箖娴滃本顐?AI 閹崵娲冮敍宀€娲块幒?APPROVED閿涘畭review_result` 娑?REVIEW_RESULT_MANUAL_PASS閵?
   */
  manualPassLeaderReview: (nodeId?: string | null) => string | undefined;
  focusNode: (id: string, opts?: { openDetail?: boolean }) => void;
  retryPipeline: (id: string) => void;
  regenerateNode: (id: string) => void;
  /** 閸欐牗绉烽幍瀣З鐟曞棛娲婇敍灞肩矤鏉╃偟鍤庨柌宥嗘煀閸氬牆鑻?input */
  syncDepartmentInputFromGraph: (deptId: string) => void;
  syncPromptReviewInputFromGraph: (nodeId: string) => void;
  runTextPolish: (nodeId: string, opts?: { instruction?: string; mode?: 'simple' | 'deep' }) => Promise<void>;
  savePromptReviewSnapshot: (nodeId: string, label?: string) => boolean;
  restorePromptReviewSnapshot: (nodeId: string, snapshotId: string) => boolean;
  runPromptReviewLlm: (nodeId: string, instruction?: string) => Promise<void>;
  refreshPromptInputsFromShotList: (shotListId: string) => string[];
  /** 閹靛綊鍣洪崚鐘绘珟閼哄倻鍋ｉ敍鍫濆礁闁款喗鍨ㄧ粙瀣碍閸栨牭绱?*/
  removeNodesByIds: (ids: string[]) => void;
  duplicateNodesByIds: (ids: string[]) => string[];
  repositionNodes: (
    patches: Record<string, { x: number; y: number; selected?: boolean }>,
  ) => void;
  /** Dagre 閼奉亜濮╃仦鍌滈獓閹烘帒绔?*/
  layoutCanvasWithDagre: () => void;
  undo: () => void;
  /** 娴?.json / 閼奉亜濮╃€涙ɑ銆傛潪钘夊弳閿涙碍娴涢幑?nodes閵嗕躬dges閿涘本绔荤粚楦跨カ娴溠呮鐠佹澘鑻熼崚閿嬫煀閸ユ儳鎮庨獮鎯扮翻閸?*/
  hydrateProject: (
    nodes: StudioRFNode[],
    edges: Edge[],
    opts?: { broadcastText?: string; projectId?: string | null; projectName?: string },
  ) => void;
  /** 妞ょ敻娼伴崝鐘烘祰閹存牗瀵旀稊鍛闁插秷娴囬崥搴窗娑撻缚濡悙?data 闁插秵鏌婇幐鍌濇祰 onExecute / onDelete閿涘湞SON 閺冪姵纭舵穱婵嗙摠閸戣姤鏆熼敍?*/
  ensureRuntimeBindingsOnNodes: () => void;
  /**
   * 閸掗攱鏌?鏉炶棄鍙嗛崥搴窗閹稿鈧苯鍨庨梹婊冪俺娓?閳?闂€婊冦仈鐞涖劑銆婃笟褋鈧秷绻涚痪鍧楀櫢閸?sourceStoryboardNodeId閿涘苯鑻熺€靛綊缍堥悥璺虹摍 output閿?
   * 閺堫偄鐔崚閿嬫煀闁劑妫崥鍫濊嫙鏉堟挸鍙嗛敍鍫濇儓 Prompt 閹恒儵鏆呮径纾嬨€冮敍澶涚礉娣囨繆鐦夋稉搴＄秼閸撳秴娴樻稉鈧懛娣偓?
   */
  reconcileShotListGraphBindings: () => void;
};

const PIPELINE_DECISION_FLASH_MS = 1900;

function schedulePipelineFlashClear(get: () => StudioState, nodeId: string, until: number) {
  window.setTimeout(() => {
    const cur = get().nodes.find((n) => n.id === nodeId)?.data.pipeline_decision_flash;
    if (cur?.until === until) {
      get().patchNodeData(nodeId, { pipeline_decision_flash: null }, false);
    }
  }, PIPELINE_DECISION_FLASH_MS + 120);
}

/** 閹靛濮╂潏鎾冲弳娴兼ê鍘涢敍姘冲閻劍鍩涘鎻掓躬閸欏厖鏅堕棃銏℃緲缁鍒涢敍灞肩瑝鐟曞棛娲婄粩顖氬經閸氬牆鑻熺紒鎾寸亯 */
function shouldPreferManualInput(nodeData: StudioNodeData | undefined): boolean {
  if (!nodeData) return false;
  return nodeData.inputSource === 'manual' && Boolean((nodeData.input ?? '').trim());
}

/** 閸掑棝鏆呴懞鍌滃仯鎼存洑鏅堕崣銉︾労 閳?闂€婊冦仈鐞涖劑銆婃笟褍褰為弻鍕剁窗娑撯偓閺壜ょ珶鐎电懓绨叉稉鈧稉顏嗗煑閸掑棝鏆?id */
function buildStoryboardParentByShotListId(
  nodes: StudioRFNode[],
  edges: Edge[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of edges) {
    if (e.sourceHandle !== SHOT_LIST_LINK_HANDLE_ID) continue;
    if (e.targetHandle != null && e.targetHandle !== SHOT_LIST_PARENT_HANDLE_ID) continue;
    const src = nodes.find((n) => n.id === e.source);
    const tgt = nodes.find((n) => n.id === e.target);
    if (!src || !tgt || tgt.type !== 'shotList' || tgt.data.type !== 'shot_list_node') continue;
    if (
      !(
        (src.type === 'department' && src.data.type === 'storyboard') ||
        src.type === 'storyboardFile'
      )
    ) {
      continue;
    }
    map.set(e.target, e.source);
  }
  return map;
}

function flushIncomingShotListEditsForDepartment(get: () => StudioState, deptId: string): void {
  const { nodes, edges } = get();
  const shotListIds = new Set(
    edges
      .filter((edge) => edge.target === deptId && (edge.targetHandle === 'in' || edge.targetHandle == null))
      .map((edge) => {
        const source = nodes.find((node) => node.id === edge.source);
        return source?.type === 'shotList' && source.data.type === 'shot_list_node' ? source.id : null;
      })
      .filter(Boolean) as string[],
  );
  for (const shotListId of shotListIds) {
    flushShotListPendingEdits(shotListId);
  }
}

function storyboardOutputFingerprint(parsed: ReturnType<typeof tryParseStoryboardOutput>): string {
  if (!parsed) return '';
  try {
    return JSON.stringify({
      shots: parsed.shots,
      beats: parsed.narrativeBeats ?? [],
    });
  } catch {
    return `err:${String(parsed.shots?.length ?? 0)}`;
  }
}

function patchChangesNodeData(
  data: StudioNodeData,
  patch: Partial<StudioNodeData>,
  bumpVersion: boolean,
): boolean {
  if (bumpVersion) return true;
  for (const key of Object.keys(patch) as Array<keyof StudioNodeData>) {
    if (!Object.is(data[key], patch[key])) return true;
  }
  return false;
}

function resyncConsumersAfterEdgeMutation(get: () => StudioState) {
  const { nodes, edges } = get();
  for (const n of nodes) {
    if (n.type === 'department') {
      if (shouldPreferManualInput(n.data)) continue;
      const merged = mergedTextInputForDepartment(n.id, nodes, edges);
      if (merged !== null) {
        get().patchNodeData(n.id, { input: merged, inputSource: 'graph' }, false);
      }
    }
    if (n.type === 'textNode') {
      const m = mergedUpstreamForTextNode(n.id, nodes, edges);
      if (m !== null) {
        get().patchNodeData(n.id, { raw_text: m, input: m }, false);
      }
    }
  }
}

/** 閸掑棝鏆?output 閸欐ɑ娲块崥搴″煕閺傛媽绻涢崷銊ュ礁娓?Output 娑撳﹦娈戞稉瀣埗闁劑妫?/ TEXT 閸氬牆鑻熸潏鎾冲弳 */
function refreshDownstreamAfterDepartmentOutputChange(
  get: () => StudioState,
  departmentId: string,
  options?: { ignoreManualInput?: boolean },
) {
  const { nodes, edges } = get();
  const outgoing = edges.filter(
    (e) =>
      e.source === departmentId &&
      (e.sourceHandle === DEPT_OUTPUT_HANDLE_ID || e.sourceHandle == null),
  );
  const seen = new Set<string>();
  for (const e of outgoing) {
    if (seen.has(e.target)) continue;
    seen.add(e.target);
    const tn = nodes.find((n) => n.id === e.target);
    if (tn?.type === 'department') {
      if (!options?.ignoreManualInput && shouldPreferManualInput(tn.data)) continue;
      const merged = mergedTextInputForDepartment(e.target, nodes, edges);
      if (merged !== null) {
        get().patchNodeData(e.target, { input: merged, inputSource: 'graph' }, false);
      }
    } else if (tn?.type === 'textNode') {
      const m = mergedUpstreamForTextNode(e.target, nodes, edges);
      if (m !== null) {
        get().patchNodeData(e.target, { raw_text: m, input: m }, false);
      }
    }
  }
}

function edgeIdentity(edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>): string {
  return [edge.source, edge.target, edge.sourceHandle ?? '', edge.targetHandle ?? ''].join('::');
}

function addUniqueAnimatedEdges(edges: Edge[], connections: Connection[]): Edge[] {
  const seen = new Set(edges.map(edgeIdentity));
  let next = edges;
  for (const connection of connections) {
    const key = edgeIdentity(connection);
    if (seen.has(key)) continue;
    seen.add(key);
    next = addEdge({ ...connection, animated: true }, next);
  }
  return next;
}

function resolveShotListSourceHandlesForConnect(
  selectionMap: Record<string, string[]>,
  nodeId: string,
  sourceHandle: string | null | undefined,
): string[] {
  const draggedWireId = parseShotListItemOutputHandleId(sourceHandle);
  if (!draggedWireId) return [sourceHandle ?? DEPT_OUTPUT_HANDLE_ID];
  const selectedWireIds = selectionMap[nodeId] ?? [];
  if (selectedWireIds.length >= 2 && selectedWireIds.includes(draggedWireId)) {
    return selectedWireIds.map((wireId) => makeShotListItemOutputHandleId(wireId));
  }
  return [sourceHandle ?? DEPT_OUTPUT_HANDLE_ID];
}

type UndoSnapshot = {
  nodes: StudioRFNode[];
  edges: Edge[];
  assets: ApprovedAsset[];
  shotListSelectedWiresByNodeId: Record<string, string[]>;
  selectedNodeId: string | null;
  activeNodeId: string | null;
  detailOpen: boolean;
};

function makeRuntimeApi(get: () => StudioState) {
  return {
    executeNodeTask: (id: string) => get().executeNodeTask(id),
    focusNode: (id: string, o?: { openDetail?: boolean }) => get().focusNode(id, o),
    removeNodesByIds: (ids: string[]) => get().removeNodesByIds(ids),
  };
}

function snapshotNodesForUndo(nodes: StudioRFNode[]): StudioRFNode[] {
  return stripFunctionsDeep(nodes) as StudioRFNode[];
}

function makeUndoSnapshot(state: Pick<
  StudioState,
  | 'nodes'
  | 'edges'
  | 'assets'
  | 'shotListSelectedWiresByNodeId'
  | 'selectedNodeId'
  | 'activeNodeId'
  | 'detailOpen'
>): UndoSnapshot {
  return {
    nodes: snapshotNodesForUndo(state.nodes),
    edges: stripFunctionsDeep(state.edges) as Edge[],
    assets: stripFunctionsDeep(state.assets) as ApprovedAsset[],
    shotListSelectedWiresByNodeId: stripFunctionsDeep(
      state.shotListSelectedWiresByNodeId,
    ) as Record<string, string[]>,
    selectedNodeId: state.selectedNodeId,
    activeNodeId: state.activeNodeId,
    detailOpen: state.detailOpen,
  };
}

function undoSnapshotSignature(snapshot: UndoSnapshot): string {
  return JSON.stringify(snapshot);
}

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

function pushUndoSnapshot(set: StudioSet) {
  set((state) => {
    const snapshot = makeUndoSnapshot(state);
    const prev = state.undoStack[state.undoStack.length - 1];
    if (prev && undoSnapshotSignature(prev) === undoSnapshotSignature(snapshot)) {
      return state;
    }
    const nextStack =
      state.undoStack.length >= UNDO_STACK_LIMIT
        ? [...state.undoStack.slice(state.undoStack.length - UNDO_STACK_LIMIT + 1), snapshot]
        : [...state.undoStack, snapshot];
    return { undoStack: nextStack };
  });
}

function restoreUndoSnapshot(snapshot: UndoSnapshot, get: () => StudioState): Partial<StudioState> {
  const api = makeRuntimeApi(get);
  const normalized = snapshot.nodes.map(normalizeRestoredStudioNode);
  const rebound = rebindStudioNodeRuntimeHandlers(normalized, api).map((node) => ({
    ...node,
    selected: snapshot.selectedNodeId != null && node.id === snapshot.selectedNodeId,
    dragging: false,
  }));
  return {
    nodes: rebound,
    edges: stripFunctionsDeep(snapshot.edges) as Edge[],
    assets: stripFunctionsDeep(snapshot.assets) as ApprovedAsset[],
    shotListSelectedWiresByNodeId: stripFunctionsDeep(
      snapshot.shotListSelectedWiresByNodeId,
    ) as Record<string, string[]>,
    selectedNodeId: snapshot.selectedNodeId,
    activeNodeId: snapshot.activeNodeId,
    detailOpen: snapshot.detailOpen && snapshot.selectedNodeId != null,
    requestFitNodeId: null,
  };
}

type PromptReviewEnsureResult = { id: string; created: boolean } | null;

function findConnectedPromptReviewNodeId(
  promptNodeId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): string | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    if (edge.source !== promptNodeId) continue;
    if (edge.sourceHandle && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) continue;
    if (edge.targetHandle && edge.targetHandle !== 'in') continue;
    const target = nodeById.get(edge.target);
    if (target?.type === 'promptReview' && target.data.type === 'prompt_review_node') {
      return target.id;
    }
  }
  return null;
}

function findAutoPromptReviewPosition(promptNode: StudioRFNode, nodes: StudioRFNode[]): { x: number; y: number } {
  const promptSize = getNodeSize(promptNode);
  const reviewSize = defaultNodeSize({
    ...promptNode,
    type: 'promptReview',
    data: makePromptReviewNodeData('promptreview-preview'),
  });
  const occupiedRects = nodes
    .filter((node) => node.id !== promptNode.id)
    .map((node) => {
      const size = getNodeSize(node);
      return {
        x: node.position.x,
        y: node.position.y,
        width: size.width,
        height: size.height,
      };
    });
  const rect: NodeRect = {
    x: promptNode.position.x + promptSize.width + AUTO_PROMPT_REVIEW_GAP,
    y: promptNode.position.y,
    width: reviewSize.width,
    height: reviewSize.height,
  };

  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (
      !occupiedRects.some((occupied) =>
        rectsOverlap(rect, occupied, AUTO_PROMPT_REVIEW_COLLISION_PADDING),
      )
    ) {
      return { x: rect.x, y: rect.y };
    }
    rect.y += AUTO_PROMPT_REVIEW_COLLISION_STEP;
  }
  return { x: rect.x, y: rect.y };
}

function ensurePromptReviewNodeForPromptOutput(
  get: () => StudioState,
  set: StudioSet,
  promptNodeId: string,
): PromptReviewEnsureResult {
  const { nodes, edges } = get();
  const promptNode = nodes.find((node) => node.id === promptNodeId);
  if (!promptNode || promptNode.type !== 'department' || promptNode.data.type !== 'prompt') {
    return null;
  }

  const text = departmentAssetAsInputText(promptNode.data, 'prompt_review_node')?.trim() ?? '';
  if (!text) return null;

  const existingId = findConnectedPromptReviewNodeId(promptNodeId, nodes, edges);
  if (existingId) {
    get().syncPromptReviewInputFromGraph(existingId);
    get().focusNode(existingId, { openDetail: false });
    return { id: existingId, created: false };
  }

  const reviewId = get().addPromptReviewNode(findAutoPromptReviewPosition(promptNode, nodes), text);
  set((state) => ({
    edges: addUniqueAnimatedEdges(state.edges, [
      {
        source: promptNodeId,
        target: reviewId,
        sourceHandle: DEPT_OUTPUT_HANDLE_ID,
        targetHandle: 'in',
      },
    ]),
  }));
  get().syncPromptReviewInputFromGraph(reviewId);
  get().focusNode(reviewId, { openDetail: false });
  return { id: reviewId, created: true };
}

export const useStudioStore = create<StudioState>((set, get) => ({
  nodes: [],
  edges: [],
  assets: [],
  messages: [],
  currentProjectId: null,
  currentProjectName: '未命名项目',
  activeNodeId: null,
  selectedNodeId: null,
  detailOpen: false,
  requestFitNodeId: null,
  shotListSelectedWiresByNodeId: {},
  undoStack: [],
  workflowAgentSession: null,

  ...createCanvasStoreSlice(set, get),
  ...createProjectStoreSlice(set, get, {
    uid,
    nextProjectName,
    pushUndoSnapshot,
  }),
  ...createPipelineStoreSlice(set, get, {
    activeTaskAbortControllers,
    stopTaskMessage: STOP_TASK_MESSAGE,
    deptLabel,
    kindToDepartment,
  }),
  ...createShotListStoreSlice(set, get),
  ...createTextStoreSlice(set, get, {
    activeTaskAbortControllers,
    stopTaskMessage: STOP_TASK_MESSAGE,
  }),
  ...createPromptReviewStoreSlice(set, get, {
    activeTaskAbortControllers,
    stopTaskMessage: STOP_TASK_MESSAGE,
  }),

  onNodesChange: (changes) => {
    if (
      changes.some(
        (change) =>
          change.type === 'remove' ||
          change.type === 'dimensions' ||
          (change.type === 'position' && change.dragging !== true),
      )
    ) {
      pushUndoSnapshot(set);
    }
    set((s) => {
      let toApply = changes as NodeChange<StudioRFNode>[];
      for (const c of changes) {
        if (c.type === 'remove') {
          const n = s.nodes.find((x) => x.id === c.id);
          if (n?.type === 'department' && n.data.type === 'storyboard') {
            for (const m of s.nodes) {
              if (m.type === 'shotList' && m.data.sourceStoryboardNodeId === c.id) {
                if (!toApply.some((t) => t.type === 'remove' && 'id' in t && t.id === m.id)) {
                  toApply = [...toApply, { type: 'remove', id: m.id } as NodeChange<StudioRFNode>];
                }
              }
            }
          }
          if (n?.type === 'storyboardFile') {
            for (const m of s.nodes) {
              if (m.type === 'shotList' && m.data.sourceStoryboardFileNodeId === c.id) {
                if (!toApply.some((t) => t.type === 'remove' && 'id' in t && t.id === m.id)) {
                  toApply = [...toApply, { type: 'remove', id: m.id } as NodeChange<StudioRFNode>];
                }
              }
            }
          }
        }
      }

      const removedIds = toApply
        .filter((c): c is NodeChange<StudioRFNode> & { type: 'remove'; id: string } => c.type === 'remove')
        .map((c) => c.id);

      const nextNodes = applyNodeChanges(toApply, s.nodes) as StudioRFNode[];

      let nextEdges = s.edges;
      let nextShotListSelectedWiresByNodeId = s.shotListSelectedWiresByNodeId;
      if (removedIds.length > 0) {
        const gone = new Set(removedIds);
        nextEdges = s.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target));
        nextShotListSelectedWiresByNodeId = Object.fromEntries(
          Object.entries(s.shotListSelectedWiresByNodeId).filter(([nodeId]) => !gone.has(nodeId)),
        );
      }

      const sel = nextNodes.find((n) => n.selected)?.id ?? null;

      let activeNodeId = s.activeNodeId;
      if (activeNodeId && removedIds.includes(activeNodeId)) {
        activeNodeId = null;
      }

      const detailOpen = sel != null ? s.detailOpen : false;

      return {
        nodes: nextNodes,
        edges: nextEdges,
        selectedNodeId: sel,
        activeNodeId,
        detailOpen,
        shotListSelectedWiresByNodeId: nextShotListSelectedWiresByNodeId,
      };
    });
  },

  onEdgesChange: (changes) => {
    if (changes.some((change) => change.type === 'remove')) {
      pushUndoSnapshot(set);
    }
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
    if (changes.some((ch) => ch.type === 'remove')) {
      get().reconcileShotListGraphBindings();
    } else {
      resyncConsumersAfterEdgeMutation(get);
    }
  },

  removeEdges: (edgeIds) => {
    if (edgeIds.length === 0) return;
    pushUndoSnapshot(set);
    const drop = new Set(edgeIds);
    set((s) => ({ edges: s.edges.filter((e) => !drop.has(e.id)) }));
    get().reconcileShotListGraphBindings();
    get().pushMessage({
      role: 'system',
      text: `已删除 ${edgeIds.length} 条连线。`,
    });
  },

  onConnect: (c) => {
    flushShotListPendingEdits(c.source);
    pushUndoSnapshot(set);
    const sourceNodeId = c.source;
    const sourceHandles =
      sourceNodeId != null
        ? resolveShotListSourceHandlesForConnect(
            get().shotListSelectedWiresByNodeId,
            sourceNodeId,
            c.sourceHandle,
          )
        : [c.sourceHandle ?? DEPT_OUTPUT_HANDLE_ID];
    set((s) => ({
      edges: addUniqueAnimatedEdges(
        s.edges,
        sourceHandles.map((sourceHandle) => ({ ...c, sourceHandle })),
      ),
    }));
    const { nodes, edges } = get();
    const tgt = c.target;
    if (!tgt) return;
    const targetNode = nodes.find((n) => n.id === tgt);
    if (targetNode?.type === 'department' && !shouldPreferManualInput(targetNode.data)) {
      const merged = mergedTextInputForDepartment(tgt, nodes, edges);
      if (merged !== null) {
        get().patchNodeData(tgt, { input: merged, inputSource: 'graph' }, false);
      }
    }
    if (targetNode?.type === 'textNode') {
      const m = mergedUpstreamForTextNode(tgt, nodes, edges);
      if (m !== null) {
        get().patchNodeData(tgt, { raw_text: m, input: m }, false);
      }
    }
    if (targetNode?.type === 'promptReview') {
      const m = mergedUpstreamForPromptReviewNode(tgt, nodes, edges);
      if (m !== null) {
        get().patchNodeData(tgt, { raw_text: m, input: m, output: { text: m } }, false);
      }
    }
    get().reconcileShotListGraphBindings();
  },

  clearWorkflowAgentSession: () => set({ workflowAgentSession: null }),

  pushMessage: (m) => {
    const msg: ChatMessage = {
      id: m.id ?? uid('msg'),
      role: m.role,
      text: m.text,
      nodeId: m.nodeId,
      ts: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, msg] }));
    return msg.id;
  },

  linkChatMessageToNode: (messageId, nodeId) => {
    set((s) => ({
      messages: s.messages.map((x) => (x.id === messageId ? { ...x, nodeId } : x)),
    }));
  },

  submitWorkflowAgentChat: async (text, position) => {
    const raw = text.trim();
    if (!raw) return;

    const now = Date.now();
    const flowPos = position ?? { x: 360, y: 260 };
    const currentSession = get().workflowAgentSession;
    const intent = detectWorkflowAgentIntent(raw, currentSession);

    get().pushMessage({ role: 'user', text: raw });

    if (intent === 'restart') {
      set({ workflowAgentSession: null });
      get().pushMessage({
        role: 'assistant',
        text: '好的，当前流程已重新开始。你可以继续粘贴小说正文、剧本、分镜描述，或直接告诉 Agent “继续 / 确认分镜 / 重新开始”。',
      });
      return;
    }

    if (!currentSession || intent === 'start') {
      const inputType = detectWorkflowAgentInputType(raw);
      if (inputType === 'unknown') {
        get().pushMessage({
          role: 'assistant',
          text: '我还没识别出你这次想走哪条流程。你可以直接粘贴小说正文、剧本文本，或者告诉我“继续生成分镜 / 继续生成提示词 / 重新开始”。',
        });
        return;
      }

      const mode = detectWorkflowAgentMode(raw);
      const route = resolveWorkflowRoute(inputType, mode);
      const intro = buildWorkflowAgentStartMessage({ inputType, route, mode });
      const session: WorkflowAgentSession = {
        id: uid('agent'),
        inputType,
        mode,
        route,
        state: 'INIT',
        sourceText: raw,
        lastUserMessage: raw,
        lastAssistantMessage: intro,
        createdAt: now,
        updatedAt: now,
      };

      if (route === 'novel_to_script_to_storyboard_to_prompt') {
        const writingNodeId = get().startWritingPipeline(raw, flowPos);
        session.writingNodeId = writingNodeId;
      } else if (route === 'script_to_storyboard_to_prompt') {
        const storyboardNodeId = get().addDepartmentNode('storyboard', flowPos);
        get().patchNodeData(storyboardNodeId, { input: raw }, false);
        get().focusNode(storyboardNodeId, { openDetail: true });
        void get().executeNodeTask(storyboardNodeId);
        session.storyboardNodeId = storyboardNodeId;
      } else {
        const promptNodeId = get().startPromptPipeline(raw, flowPos);
        session.promptNodeId = promptNodeId;
      }

      set({ workflowAgentSession: session });
      get().pushMessage({
        role: 'assistant',
        text: `${intro}\n\n${buildWorkflowAgentStageHint(session)}`,
      });
      return;
    }

    const updateSession = (patch: Partial<WorkflowAgentSession>) => {
      set((state) => {
        if (!state.workflowAgentSession || state.workflowAgentSession.id !== currentSession.id) {
          return state;
        }
        return {
          workflowAgentSession: {
            ...state.workflowAgentSession,
            ...patch,
            updatedAt: Date.now(),
          },
        };
      });
    };

    if (intent === 'continue') {
      if (
        currentSession.route === 'novel_to_script_to_storyboard_to_prompt' &&
        currentSession.state === 'SCRIPT_READY'
      ) {
        const writingNode = currentSession.writingNodeId
          ? get().nodes.find((node) => node.id === currentSession.writingNodeId)
          : null;
        const writingInput =
          writingNode?.type === 'department' && writingNode.data.output
            ? JSON.stringify(writingNode.data.output, null, 2)
            : currentSession.sourceText;
        const storyboardNodeId = get().addDepartmentNode('storyboard', {
          x: flowPos.x + 180,
          y: flowPos.y + 60,
        });
        get().patchNodeData(storyboardNodeId, { input: writingInput }, false);
        get().focusNode(storyboardNodeId, { openDetail: true });
        void get().executeNodeTask(storyboardNodeId);
        updateSession({
          storyboardNodeId,
          lastUserMessage: raw,
          lastAssistantMessage: '已根据当前编剧结果继续进入分镜阶段。',
        });
        get().pushMessage({
          role: 'assistant',
          text: '已根据当前编剧结果新建分镜节点，并开始生成镜头表。你可以等它完成，或稍后继续调整分镜。',
          nodeId: storyboardNodeId,
        });
        return;
      }

      if (
        currentSession.promptNodeId &&
        (currentSession.state === 'STORYBOARD_CONFIRMED' ||
          currentSession.state === 'PROMPT_GENERATED')
      ) {
        get().focusNode(currentSession.promptNodeId, { openDetail: true });
        updateSession({
          lastUserMessage: raw,
          lastAssistantMessage: '已定位到 Prompt 节点，可以继续生成或修改提示词。',
        });
        get().pushMessage({
          role: 'assistant',
          text: '已帮你定位到 Prompt 节点。你可以继续生成提示词，或直接提出修改要求。',
          nodeId: currentSession.promptNodeId,
        });
        return;
      }

      if (
        (currentSession.state === 'STORYBOARD_CONFIRMED' ||
          currentSession.state === 'STORYBOARD_GENERATED' ||
          currentSession.state === 'STORYBOARD_ADJUSTED') &&
        currentSession.route !== 'novel_to_script_to_storyboard_to_prompt' &&
        currentSession.route !== 'script_to_storyboard_to_prompt'
      ) {
        // no-op: quick route handled at start
      }
    }

    if (intent === 'adjust_storyboard') {
      const targetId = currentSession.shotListNodeId ?? currentSession.storyboardNodeId ?? null;
      if (!targetId) {
        get().pushMessage({
          role: 'assistant',
          text: '当前还没有可调整的分镜结果。请先完成分镜生成，或选中已有分镜/镜头表节点。',
        });
        return;
      }
      get().focusNode(targetId, { openDetail: true });
      updateSession({
        state:
          currentSession.state === 'STORYBOARD_GENERATED' ? 'STORYBOARD_ADJUSTED' : currentSession.state,
        lastUserMessage: raw,
        lastAssistantMessage: '已切换到当前分镜结果，你可以直接提出要修改的镜头、节奏或构图要求。',
      });
      get().pushMessage({
        role: 'assistant',
        text: '已切换到当前分镜结果。你可以直接补充“增加一个镜头 / 调整节奏 / 改成更克制的运镜”这类要求，我会继续基于当前结果处理。',
        nodeId: targetId,
      });
      return;
    }

    if (intent === 'confirm_storyboard') {
      const storyboardCarrierId = currentSession.shotListNodeId ?? currentSession.storyboardNodeId ?? null;
      const storyboardCarrier = storyboardCarrierId
        ? get().nodes.find((node) => node.id === storyboardCarrierId)
        : null;
      const storyboardPayload =
        storyboardCarrier?.data.output != null
          ? JSON.stringify(storyboardCarrier.data.output, null, 2)
          : '';
      if (!storyboardPayload) {
        get().pushMessage({
          role: 'assistant',
          text: '当前还没有可确认的分镜结果。请先生成分镜或镜头表，再继续到 Prompt 阶段。',
        });
        return;
      }
      const promptNodeId = get().startPromptPipeline(storyboardPayload, {
        x: flowPos.x + 220,
        y: flowPos.y + 80,
      });
      updateSession({
        state: 'STORYBOARD_CONFIRMED',
        promptNodeId,
        lastUserMessage: raw,
        lastAssistantMessage: '分镜已确认，已继续进入 Prompt 阶段。',
      });
      get().pushMessage({
        role: 'assistant',
        text: '已根据当前分镜新建 Prompt 节点，并开始生成提示词。',
        nodeId: promptNodeId,
      });
      return;
    }

    if (intent === 'complete') {
      updateSession({
        state: 'COMPLETED',
        lastUserMessage: raw,
        lastAssistantMessage: '当前流程已完成。',
      });
      get().pushMessage({
        role: 'assistant',
        text: '当前流程 Agent 已结束。你可以继续修改已有节点，或重新开始新流程。',
      });
      return;
    }

    get().pushMessage({
      role: 'assistant',
      text: `当前路线：${routeLabel(currentSession.route)}\n当前阶段：${stageLabel(currentSession.state)}\n\n${buildWorkflowAgentStageHint(currentSession)}`,
    });
  },

  submitAssistantChat: async (text) => {
    const raw = text.trim();
    if (!raw) return;

    const selectedId = get().selectedNodeId ?? get().activeNodeId;
    if (!selectedId) {
      get().pushMessage({
        role: 'system',
        text: '当前没有选中节点。请先在画布中选中一个节点，再发送修改要求。',
      });
      return;
    }

    const selectedNode = get().nodes.find((n) => n.id === selectedId);
    if (!selectedNode) {
      get().pushMessage({ role: 'system', text: '当前选中的节点不存在或已被删除。' });
      return;
    }

    if (
      selectedNode.type !== 'department' &&
      selectedNode.type !== 'shotList' &&
      selectedNode.type !== 'textNode'
    ) {
      get().pushMessage({
        role: 'system',
        text: '当前选中的节点还不支持节点助手。请先选择文本卡片、编剧、分镜、镜头表或 Prompt 节点。',
        nodeId: selectedId,
      });
      return;
    }

    const instructionNode =
      selectedNode.type === 'shotList' && selectedNode.data.sourceStoryboardNodeId
        ? get().nodes.find((n) => n.id === selectedNode.data.sourceStoryboardNodeId) ?? selectedNode
        : selectedNode;

    const outputNode =
      selectedNode.type === 'department' && selectedNode.data.type === 'storyboard'
        ? (findStoryboardShotListChild(get().nodes, get().edges, selectedNode.id) ?? selectedNode)
        : selectedNode;

    const contextData: StudioNodeData = {
      ...selectedNode.data,
      assistant_preferences: instructionNode.data.assistant_preferences ?? '',
      assistant_task_instruction: instructionNode.data.assistant_task_instruction ?? '',
    };

    const currentOutput =
      outputNode.type === 'department' && outputNode.data.type === 'writing'
        ? ((outputNode.data.output as WritingOutput | null) ?? null)
        : outputNode.type === 'department' && outputNode.data.type === 'prompt'
          ? ((outputNode.data.output as PromptOutput | null) ?? null)
          : outputNode.data.output
            ? (tryParseStoryboardOutput(outputNode.data.output) ?? null)
            : null;

    get().pushMessage({ role: 'user', text: raw, nodeId: selectedId });
    get().pushMessage({
      role: 'assistant',
      text: currentOutput
        ? '已收到修改要求，正在调用模型直接调整当前节点结果...'
        : '已收到要求，正在调用模型分析并执行...',
      nodeId: selectedId,
    });

    try {
      const result = await runNodeAssistant({
        data: contextData,
        history: getNodeAssistantHistory(get().messages, selectedId),
        userMessage: raw,
        currentOutput,
        onProgress: (progress) => {
          get().pushMessage({
            role: 'assistant',
            text: progress.text,
            nodeId: selectedId,
          });
        },
      });

      let changed = false;
      let resultTargetLabel = '当前选中的节点结果';
      let noVisibleOutputChange = false;

      if (result.action === 'update_task' && result.applyChange) {
        get().patchNodeData(
          instructionNode.id,
          { assistant_task_instruction: result.taskInstruction },
          false,
        );
        changed = true;
      }

      if (result.action === 'update_preferences' && result.applyChange) {
        get().patchNodeData(
          instructionNode.id,
          { assistant_preferences: result.assistantPreferences },
          false,
        );
        changed = true;
      }

      if (result.targetKind === 'text' && result.action === 'revise_output' && result.applyChange) {
        get().patchNodeData(
          outputNode.id,
          {
            raw_text: result.updatedText,
            input: result.updatedText,
            assistant_preferences: result.assistantPreferences,
            assistant_task_instruction: result.taskInstruction,
          },
          true,
        );
        changed = true;
      }

      if (
        result.targetKind === 'writing' &&
        result.action === 'revise_output' &&
        result.applyChange &&
        result.updatedOutput
      ) {
        get().patchNodeData(
          outputNode.id,
          {
            output: result.updatedOutput,
            assistant_preferences: result.assistantPreferences,
            assistant_task_instruction: result.taskInstruction,
          },
          true,
        );
        changed = true;
      }

      if (
        result.targetKind === 'prompt' &&
        result.action === 'revise_output' &&
        result.applyChange &&
        result.updatedOutput
      ) {
        get().patchNodeData(
          outputNode.id,
          {
            output: result.updatedOutput,
            assistant_preferences: result.assistantPreferences,
            assistant_task_instruction: result.taskInstruction,
          },
          true,
        );
        changed = true;
      }

      if (
        result.targetKind === 'storyboard' &&
        result.action === 'revise_output' &&
        result.applyChange &&
        result.updatedOutput
      ) {
        const previousStoryboardKey = storyboardOutputFingerprint(
          currentOutput ? (currentOutput as StoryboardOutput) : null,
        );
        const nextStoryboardKey = storyboardOutputFingerprint(result.updatedOutput as StoryboardOutput);
        const hasStoryboardDiff = previousStoryboardKey !== nextStoryboardKey;

        if (outputNode.type === 'shotList') {
          resultTargetLabel = '当前镜头表，并同步回上层分镜节点';
          if (hasStoryboardDiff) {
            get().pushMessage({
              role: 'assistant',
              text: '模型已返回分镜修改结果，正在写回当前镜头表，并同步到上层分镜节点...',
              nodeId: selectedId,
            });
            get().patchShotListNodeOutput(outputNode.id, result.updatedOutput as StoryboardOutput, true);
          } else {
            noVisibleOutputChange = true;
          }
          get().patchNodeData(
            instructionNode.id,
            {
              assistant_preferences: result.assistantPreferences,
              assistant_task_instruction: result.taskInstruction,
            },
            false,
          );
        } else {
          resultTargetLabel = '当前分镜节点';
          if (hasStoryboardDiff) {
            get().pushMessage({
              role: 'assistant',
              text: '模型已返回分镜修改结果，正在写回当前分镜节点...',
              nodeId: selectedId,
            });
            get().patchNodeData(
              outputNode.id,
              {
                output: result.updatedOutput,
                assistant_preferences: result.assistantPreferences,
                assistant_task_instruction: result.taskInstruction,
              },
              true,
            );
          } else {
            noVisibleOutputChange = true;
            get().patchNodeData(
              outputNode.id,
              {
                assistant_preferences: result.assistantPreferences,
                assistant_task_instruction: result.taskInstruction,
              },
              false,
            );
          }
        }
        changed = hasStoryboardDiff;
      }

      if (
        result.action !== 'revise_output' &&
        (result.taskInstruction !== (instructionNode.data.assistant_task_instruction ?? '') ||
          result.assistantPreferences !== (instructionNode.data.assistant_preferences ?? ''))
      ) {
        get().patchNodeData(
          instructionNode.id,
          {
            assistant_task_instruction: result.taskInstruction,
            assistant_preferences: result.assistantPreferences,
          },
          false,
        );
      }

      const workflowSession = get().workflowAgentSession;
      if (workflowSession && changed) {
        const relevantIds = new Set(
          [
            workflowSession.writingNodeId,
            workflowSession.storyboardNodeId,
            workflowSession.shotListNodeId,
            workflowSession.promptNodeId,
            instructionNode.id,
            outputNode.id,
            selectedId,
          ].filter((value): value is string => Boolean(value)),
        );
        if (
          result.targetKind === 'storyboard' &&
          relevantIds.has(selectedId) &&
          (workflowSession.state === 'STORYBOARD_GENERATED' ||
            workflowSession.state === 'STORYBOARD_ADJUSTED')
        ) {
          set((state) =>
            state.workflowAgentSession?.id === workflowSession.id
              ? {
                  workflowAgentSession: {
                    ...state.workflowAgentSession,
                    state: 'STORYBOARD_ADJUSTED',
                    lastAssistantMessage: '已根据你的反馈调整当前分镜结果。',
                    updatedAt: Date.now(),
                  },
                }
              : state,
          );
        }
        if (result.targetKind === 'prompt' && relevantIds.has(selectedId)) {
          set((state) =>
            state.workflowAgentSession?.id === workflowSession.id
              ? {
                  workflowAgentSession: {
                    ...state.workflowAgentSession,
                    state: 'PROMPT_GENERATED',
                    lastAssistantMessage: '已根据你的反馈调整当前提示词结果。',
                    updatedAt: Date.now(),
                  },
                }
              : state,
          );
        }
      }

      const suffix =
        result.action === 'update_task' && result.applyChange
          ? '\n\n我已经记住这条节点要求，后续再次执行这个节点时会自动带上。'
          : result.action === 'update_preferences' && result.applyChange
            ? '\n\n我已经记住这条长期偏好，后面会持续按这个方向帮你调整。'
            : noVisibleOutputChange
              ? '\n\n这次模型确实执行了分镜修改，但返回结果与当前内容相比没有可见变化。你可以更明确地说“新增哪一条镜头、删除哪一条镜头、替换哪一段动作”。'
            : changed
              ? `\n\n我已经把修改直接写回${resultTargetLabel}。`
              : '\n\n这次我理解了你的反馈，但模型没有返回可落库的新结果。你可以更明确地说“直接修改当前提示词”，我会继续执行。';

      get().pushMessage({
        role: 'assistant',
        text: `${result.assistantReply}${suffix}`.trim(),
        nodeId: selectedId,
      });
    } catch (e) {
      const errMsg =
        e instanceof Error && e.message.trim()
          ? e.message.trim()
          : '节点助手执行失败，请稍后重试。';
      get().pushMessage({
        role: 'system',
        text: errMsg,
        nodeId: selectedId,
      });
    }
  },

  registerAsset: (a) => {
    const createdAt = a.createdAt ?? Date.now();
    const snapshot: ApprovedAsset = {
      ...a,
      createdAt,
      snapshotId: a.snapshotId ?? `snapshot_${a.nodeId}_${createdAt}`,
    };
    set((s) => ({ assets: [...s.assets, snapshot] }));
  },

  patchNodeData: (id, patch, bumpVersion = false) => {
    const targetPre = get().nodes.find((n) => n.id === id);
    let patchEff: Partial<StudioNodeData> = patch;
    if (targetPre?.type === 'textNode') {
      if (patch.raw_text !== undefined && patch.input === undefined) {
        patchEff = { ...patch, input: patch.raw_text };
      } else if (patch.input !== undefined && patch.raw_text === undefined) {
        patchEff = { ...patch, raw_text: patch.input };
      }
    }
    if (
      targetPre?.type === 'department' &&
      patchEff.mounted_skills !== undefined &&
      (targetPre.data.type === 'writing' ||
        targetPre.data.type === 'storyboard' ||
        targetPre.data.type === 'prompt')
    ) {
      patchEff = {
        ...patchEff,
        mounted_skills: normalizeMountedSkillIdsForKind(targetPre.data.type, patchEff.mounted_skills),
      };
    }

    if (targetPre && !patchChangesNodeData(targetPre.data, patchEff, bumpVersion)) {
      return;
    }

    set((s) => {
      const target = s.nodes.find((n) => n.id === id);
      if (!target) return s;
      if (
        patchEff.status !== undefined &&
        target.data.type !== 'text_node' &&
        target.data.type !== 'shot_list_node' &&
        target.data.type !== 'storyboard_file_node' &&
        target.data.type !== 'prompt_review_node' &&
        target.data.type !== 'script_input_node' &&
        target.data.type !== 'script_scene_node' &&
        target.data.type !== 'script_character_node' &&
        target.data.type !== 'script_prop_node' &&
        target.data.type !== 'script_output_node' &&
        target.data.type !== 'script_review_node' &&
        target.data.type !== 'script_timeline_node' &&
        target.data.type !== 'script_art_node' &&
        target.data.type !== 'script_vfx_node' &&
        target.data.type !== 'script_world_node' &&
        target.data.type !== 'script_production_node' &&
        target.data.type !== 'script_ai_assets_node'
      ) {
        if (!canTransitionPipelineStatus(target.data.status, patchEff.status, target.data.type)) {
          return s;
        }
      }
      if (!patchChangesNodeData(target.data, patchEff, bumpVersion)) {
        return s;
      }
      return {
        nodes: s.nodes.map((n) => {
          if (n.id !== id) return n;
          const nextVersion = bumpVersion ? n.data.version + 1 : n.data.version;
          const nextData: StudioNodeData = { ...n.data, ...patchEff, version: nextVersion };
          if (bumpVersion) {
            nextData.lastUpdatedAt = Date.now();
          }
          return { ...n, data: nextData };
        }),
      };
    });

    const updated = get().nodes.find((n) => n.id === id);
    if (updated?.type === 'textNode') {
      const { nodes, edges } = get();
      const targets = [...new Set(edges.filter((e) => e.source === id).map((e) => e.target))];
      for (const tid of targets) {
        const t = nodes.find((n) => n.id === tid);
        if (t?.type === 'department' && shouldPreferManualInput(t.data)) continue;
        const merged = mergedTextInputForDepartment(tid, nodes, edges);
        if (merged !== null) {
          get().patchNodeData(tid, { input: merged, inputSource: 'graph' }, false);
        }
      }
    }
    // 娴犲懎缍?output 閸欐ê瀵查弮璺哄煕閺?Output 鏉╃偟鍤庢稉瀣畱閸氬牆鑻熸潏鎾冲弳閿涙稓鍑?input 閺囧瓨鏌婇懟銉ょ瘍閸掗攱鏌婃导姘遍獓閼?patchNodeTask閳壊eact 閹?Maximum update depth
    const outputTouched = 'output' in patchEff;
    if ((updated?.type === 'department' || updated?.type === 'storyboardFile') && outputTouched) {
      refreshDownstreamAfterDepartmentOutputChange(get, id);
    }

    if (
      updated?.type === 'department' &&
      updated.data.type === 'storyboard' &&
      patchEff.output !== undefined &&
      updated.data.status !== 'IN_PROGRESS'
    ) {
      get().syncShotListNodesFromStoryboard(id);
    }
    if (updated?.type === 'storyboardFile' && patchEff.output !== undefined) {
      get().ensureShotListForStoryboardFile(id);
    }
  },

  syncShotListNodesFromStoryboard: (storyboardId) => {
    const sb = get().nodes.find((n) => n.id === storyboardId);
    if (!sb || sb.type !== 'department' || sb.data.type !== 'storyboard') return;
    if (sb.data.status === 'IN_PROGRESS') return;
    const out = sb.data.output;
    const parsed = out ? tryParseStoryboardOutput(out) : null;
    if (!parsed?.shots?.length) return;
    const snap = sb.data.storyboard_ai_snapshot
      ? cloneStoryboardOutput(sb.data.storyboard_ai_snapshot)
      : cloneStoryboardOutput(parsed);
    const childIds = get()
      .edges.filter(
        (e) => e.source === storyboardId && e.sourceHandle === SHOT_LIST_LINK_HANDLE_ID,
      )
      .map((e) => e.target);
    if (childIds.length === 0) return;
    const parsedKey = storyboardOutputFingerprint(parsed);
    const hasAnyDiff = get().nodes.some((n) => {
      if (!childIds.includes(n.id) || n.type !== 'shotList') return false;
      const childParsed = n.data.output ? tryParseStoryboardOutput(n.data.output) : null;
      return storyboardOutputFingerprint(childParsed) !== parsedKey;
    });
    if (!hasAnyDiff) return;
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (!childIds.includes(n.id) || n.type !== 'shotList') return n;
        return {
          ...n,
          data: {
            ...n.data,
            output: cloneStoryboardOutput(parsed),
            storyboard_ai_snapshot: snap,
            sourceStoryboardFileNodeId: undefined,
            sourceSceneCount: sb.data.sourceSceneCount,
          },
        };
      }),
    }));
  },

  ensureShotListForStoryboard: (storyboardNodeId) => {
    const sb = get().nodes.find((n) => n.id === storyboardNodeId);
    if (!sb || sb.type !== 'department' || sb.data.type !== 'storyboard') return;
    if (sb.data.status === 'IN_PROGRESS') return;
    const out = sb.data.output;
    const parsed = out ? tryParseStoryboardOutput(out) : null;
    if (!parsed?.shots?.length) return;

    const existing = get().edges.find(
      (e) =>
        e.source === storyboardNodeId && e.sourceHandle === SHOT_LIST_LINK_HANDLE_ID,
    );
    if (existing) {
      get().syncShotListNodesFromStoryboard(storyboardNodeId);
      return;
    }

    const slId = uid('shotlist');
    const snap = sb.data.storyboard_ai_snapshot
      ? cloneStoryboardOutput(sb.data.storyboard_ai_snapshot)
      : cloneStoryboardOutput(parsed);
    const data = makeShotListNodeData(
      slId,
      cloneStoryboardOutput(parsed),
      snap,
      {
        sourceStoryboardNodeId: storyboardNodeId,
        sourceSceneCount: typeof sb.data.sourceSceneCount === 'number' ? sb.data.sourceSceneCount : undefined,
      },
    );
    const pos = { x: sb.position.x, y: sb.position.y + 200 };
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id: slId,
          type: 'shotList',
          position: pos,
          selected: false,
          data,
        },
      ],
      edges: addEdge(
        {
          source: storyboardNodeId,
          target: slId,
          sourceHandle: SHOT_LIST_LINK_HANDLE_ID,
          targetHandle: SHOT_LIST_PARENT_HANDLE_ID,
          animated: true,
          style: { strokeDasharray: '6 4' },
        },
        s.edges,
      ),
    }));
    get().pushMessage({
      role: 'broadcast',
      text: '已根据当前分镜自动生成镜头表节点，可以继续编辑后再连接 Prompt。',
      nodeId: slId,
    });
  },

  syncShotListNodesFromStoryboardFile: (storyboardFileId) => {
    const fileNode = get().nodes.find((n) => n.id === storyboardFileId);
    if (!fileNode || fileNode.type !== 'storyboardFile') return;
    const parsed = fileNode.data.output ? tryParseStoryboardOutput(fileNode.data.output) : null;
    if (!parsed?.shots?.length) return;
    const childIds = get()
      .edges.filter(
        (e) => e.source === storyboardFileId && e.sourceHandle === SHOT_LIST_LINK_HANDLE_ID,
      )
      .map((e) => e.target);
    if (childIds.length === 0) return;
    const parsedKey = storyboardOutputFingerprint(parsed);
    const hasAnyDiff = get().nodes.some((n) => {
      if (!childIds.includes(n.id) || n.type !== 'shotList') return false;
      const childParsed = n.data.output ? tryParseStoryboardOutput(n.data.output) : null;
      return storyboardOutputFingerprint(childParsed) !== parsedKey;
    });
    if (!hasAnyDiff) return;
    const snap = cloneStoryboardOutput(parsed);
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (!childIds.includes(n.id) || n.type !== 'shotList') return n;
        return {
          ...n,
          data: {
            ...n.data,
            output: cloneStoryboardOutput(parsed),
            storyboard_ai_snapshot: snap,
            sourceStoryboardNodeId: undefined,
            sourceStoryboardFileNodeId: storyboardFileId,
            sourceSceneCount: undefined,
          },
        };
      }),
    }));
  },

  ensureShotListForStoryboardFile: (storyboardFileId) => {
    const fileNode = get().nodes.find((n) => n.id === storyboardFileId);
    if (!fileNode || fileNode.type !== 'storyboardFile') return;
    const parsed = fileNode.data.output ? tryParseStoryboardOutput(fileNode.data.output) : null;
    if (!parsed?.shots?.length) return;

    const existing = get().edges.find(
      (e) => e.source === storyboardFileId && e.sourceHandle === SHOT_LIST_LINK_HANDLE_ID,
    );
    if (existing) {
      get().syncShotListNodesFromStoryboardFile(storyboardFileId);
      return;
    }

    const slId = uid('shotlist');
    const data = makeShotListNodeData(
      slId,
      cloneStoryboardOutput(parsed),
      cloneStoryboardOutput(parsed),
      { sourceStoryboardFileNodeId: storyboardFileId },
    );
    const pos = { x: fileNode.position.x, y: fileNode.position.y + 200 };
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id: slId,
          type: 'shotList',
          position: pos,
          selected: false,
          data,
        },
      ],
      edges: addEdge(
        {
          source: storyboardFileId,
          target: slId,
          sourceHandle: SHOT_LIST_LINK_HANDLE_ID,
          targetHandle: SHOT_LIST_PARENT_HANDLE_ID,
          animated: true,
          style: { strokeDasharray: '6 4' },
        },
        s.edges,
      ),
    }));
    get().pushMessage({
      role: 'broadcast',
      text: '已根据导入的分镜文件自动生成分镜表节点，可以继续编辑后再连接 Prompt。',
      nodeId: slId,
    });
  },

  patchShotListNodeOutput: (shotListId, output, bumpVersion = true) => {
    if (bumpVersion) {
      pushUndoSnapshot(set);
    }
    const sl = get().nodes.find((n) => n.id === shotListId);
    if (!sl || sl.type !== 'shotList' || sl.data.type !== 'shot_list_node') return;
    const storyboardParentId = sl.data.sourceStoryboardNodeId;
    const storyboardFileParentId = sl.data.sourceStoryboardFileNodeId;
    const now = Date.now();
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id === shotListId) {
          const v = bumpVersion ? n.data.version + 1 : n.data.version;
          return {
            ...n,
            data: {
              ...n.data,
              output,
              version: v,
              ...(bumpVersion ? { lastUpdatedAt: now } : {}),
            },
          };
        }
        if (storyboardParentId && n.id === storyboardParentId && n.type === 'department') {
          const v = bumpVersion ? n.data.version + 1 : n.data.version;
          return {
            ...n,
            data: {
              ...n.data,
              output,
              version: v,
              ...(bumpVersion ? { lastUpdatedAt: now } : {}),
            },
          };
        }
        if (storyboardFileParentId && n.id === storyboardFileParentId && n.type === 'storyboardFile') {
          const v = bumpVersion ? n.data.version + 1 : n.data.version;
          return {
            ...n,
            data: {
              ...n.data,
              output,
              version: v,
              ...(bumpVersion ? { lastUpdatedAt: now } : {}),
            },
          };
        }
        return n;
      }),
    }));
    if (storyboardParentId) {
      refreshDownstreamAfterDepartmentOutputChange(get, storyboardParentId);
    }
    if (storyboardFileParentId) {
      refreshDownstreamAfterDepartmentOutputChange(get, storyboardFileParentId);
    }
    // 閻㈣绔?鐠囷附鍎忛幍瀣暭闂€婊冦仈鐞涖劌鎮楅敍宀勩€忕拋鈺勭箾閸︺劑鏆呮径纾嬨€?Output 娑撳﹦娈?Prompt 婵绮撻崥鍐ㄥ煂閺堚偓閺?JSON閿涘牅绗夐崶鐘绘桨閺夎￥鈧本澧滈崝銊ㄧ翻閸忋儯鈧秷鈧苯宕辨担蹇ョ礆
    refreshDownstreamAfterDepartmentOutputChange(get, shotListId, { ignoreManualInput: true });
  },

  setStatus: (id, next) => {
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return false;
    if (!canTransitionPipelineStatus(n.data.status, next, n.data.type)) return false;
    get().patchNodeData(id, { status: next }, true);
    get().pushMessage({
      role: 'broadcast',
      text: `已将 ${n.data.label} 的状态更新为 ${next}。`,
      nodeId: id,
    });
    return true;
  },

  addDepartmentNode: (kind, position) => {
    pushUndoSnapshot(set);
    const id = uid('node');
    const pos = position ?? { x: 280, y: 220 };
    const data = makeNodeData(id, kind);
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'department',
          position: pos,
          selected: false,
          data,
        },
      ],
    }));
    get().pushMessage({
      role: 'system',
      text: `已创建 ${deptLabel(kindToDepartment(kind))} 节点。`,
      nodeId: id,
    });
    return id;
  },

  addTextNode: (text = '', position) => {
    pushUndoSnapshot(set);
    const id = uid('text');
    const pos = position ?? { x: 320, y: 240 };
    const data = makeTextNodeData(id, text);
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'textNode',
          position: pos,
          selected: false,
          data,
        },
      ],
    }));
    get().pushMessage({
      role: 'system',
      text: '已创建文本卡片。右侧 Output 可连接部门 Input，左侧 Input 可接上游。',
      nodeId: id,
    });
    return id;
  },

  addStoryboardFileNode: (position) => {
    pushUndoSnapshot(set);
    const id = uid('storyfile');
    const pos = position ?? { x: 320, y: 240 };
    const data = makeStoryboardFileNodeData(id);
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'storyboardFile',
          position: pos,
          selected: false,
          data,
        },
      ],
    }));
    get().pushMessage({
      role: 'system',
      text: '已创建分镜表文件节点。导入 Excel 分镜表后，可直接连接 Prompt 节点。',
      nodeId: id,
    });
    return id;
  },

  addPromptReviewNode: (position, text = '', opts) => {
    pushUndoSnapshot(set);
    const id = uid('promptreview');
    const pos = position ?? { x: 360, y: 260 };
    const data = makePromptReviewNodeData(id, text, opts?.label);
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'promptReview',
          position: pos,
          selected: false,
          data,
        },
      ],
    }));
    get().pushMessage({
      role: 'system',
      text: '已创建提示词审核节点。可编辑正文，或填写调整要求后调用 LLM。',
      nodeId: id,
    });
    return id;
  },

  createTextNodeLinkedToDepartment: (deptId, position) => {
    pushUndoSnapshot(set);
    const id = uid('text');
    const data = makeTextNodeData(id, '');
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'textNode',
          position,
          selected: false,
          data,
        },
      ],
      edges: addEdge(
        {
          source: id,
          target: deptId,
          sourceHandle: 'out',
          targetHandle: 'in',
          animated: true,
        },
        s.edges,
      ),
    }));
    const { nodes, edges } = get();
    const deptNode = nodes.find((n) => n.id === deptId);
    if (!shouldPreferManualInput(deptNode?.data)) {
      const merged = mergedTextInputForDepartment(deptId, nodes, edges);
      if (merged !== null) {
        get().patchNodeData(deptId, { input: merged, inputSource: 'graph' }, false);
      }
    }
    get().pushMessage({
      role: 'system',
      text: '已创建文本卡片，并自动连接到当前部门节点。',
      nodeId: id,
    });
    return id;
  },

  completeConnectionMenuPick: (p) => {
    const from = get().nodes.find((n) => n.id === p.fromNodeId);
    if (!from) return undefined;
    if (from.type === 'shotList' && from.data.type === 'shot_list_node') {
      flushShotListPendingEdits(from.id);
    }

    const hid = p.fromHandleId ?? '';
    const ht = p.fromHandleType;
    const fp = p.flowPosition;
    const upstreamPos = { x: fp.x - 300, y: fp.y - 70 };
    const downstreamPos = { x: fp.x + 56, y: fp.y - 70 };

    const pushErr = (text: string) => {
      get().pushMessage({ role: 'system', text, nodeId: p.fromNodeId });
      return undefined;
    };

    const syncDeptIn = (deptId: string) => {
      const { nodes, edges } = get();
      const dept = nodes.find((n) => n.id === deptId);
      if (shouldPreferManualInput(dept?.data)) return;
      const merged = mergedTextInputForDepartment(deptId, nodes, edges);
      if (merged !== null) {
        get().patchNodeData(deptId, { input: merged, inputSource: 'graph' }, false);
      }
    };

    const syncTextIn = (textId: string) => {
      const { nodes, edges } = get();
      const m = mergedUpstreamForTextNode(textId, nodes, edges);
      if (m !== null) {
        get().patchNodeData(textId, { raw_text: m, input: m }, false);
      }
    };

    const INPUT_PULL = 'input-pull';

    const feedingDept =
      from.type === 'department' &&
      ((hid === INPUT_PULL && ht === 'source') || (hid === 'in' && ht === 'target'));

    const feedingText = from.type === 'textNode' && hid === 'in' && ht === 'target';

    const fromDownstreamOut =
      ht === 'source' &&
      (hid === 'out' || (from.type === 'shotList' && isShotListItemOutputHandleId(hid)));

    if (feedingDept) {
      const dk = from.data.type as PipelineKind;
      if (p.pick === 'image_node' || p.pick === 'video_node') {
        return pushErr('图片/视频节点目前作为文本卡片的视觉参考使用，请连接到文本卡片。');
      }
      if (p.pick === 'text_node') {
        const id = uid('text');
        const data = makeTextNodeData(id, '');
        set((s) => ({
          nodes: [
            ...s.nodes,
            {
              id,
              type: 'textNode',
              position: upstreamPos,
              selected: false,
              data,
            },
          ],
          edges: addEdge(
            {
              source: id,
              target: from.id,
              sourceHandle: 'out',
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        syncDeptIn(from.id);
        get().pushMessage({
          role: 'system',
          text: '已创建文本卡片，并自动连接到当前部门节点输入。',
          nodeId: id,
        });
        return id;
      }
      if (p.pick === 'storyboard_file_node') {
        if (dk !== 'prompt') {
          return pushErr('只有 Prompt 节点才支持从上游新建分镜表文件节点。');
        }
        const id = get().addStoryboardFileNode(upstreamPos);
        set((s) => ({
          edges: addEdge(
            {
              source: id,
              target: from.id,
              sourceHandle: DEPT_OUTPUT_HANDLE_ID,
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        syncDeptIn(from.id);
        return id;
      }
      if (p.pick === 'prompt_review_node') {
        return pushErr('提示词审核节点只能从 Prompt 节点右侧 Output 创建。');
      }
      const upKind = p.pick as PipelineKind;
      if (!canDeptChain(upKind, dk)) {
        return pushErr('当前部门不支持这种上游输入链路，请检查节点类型和 Input 方向。');
      }
      const id = get().addDepartmentNode(upKind, upstreamPos);
      set((s) => ({
        edges: addEdge(
          {
            source: id,
            target: from.id,
            sourceHandle: DEPT_OUTPUT_HANDLE_ID,
            targetHandle: 'in',
            animated: true,
          },
          s.edges,
        ),
      }));
      syncDeptIn(from.id);
      return id;
    }

    if (feedingText) {
      if (p.pick === 'text_node') {
        const id = uid('text');
        const data = makeTextNodeData(id, '');
        set((s) => ({
          nodes: [
            ...s.nodes,
            {
              id,
              type: 'textNode',
              position: upstreamPos,
              selected: false,
              data,
            },
          ],
          edges: addEdge(
            {
              source: id,
              target: from.id,
              sourceHandle: 'out',
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        syncTextIn(from.id);
        get().pushMessage({ role: 'system', text: '已创建文本卡片，并自动接入当前节点。', nodeId: id });
        return id;
      }
      if (p.pick === 'storyboard_file_node') {
        const id = get().addStoryboardFileNode(upstreamPos);
        set((s) => ({
          edges: addEdge(
            {
              source: id,
              target: from.id,
              sourceHandle: DEPT_OUTPUT_HANDLE_ID,
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        syncTextIn(from.id);
        return id;
      }
      if (p.pick === 'image_node') {
        const id = get().addImageNode(upstreamPos);
        set((s) => ({
          edges: addEdge(
            {
              source: id,
              target: from.id,
              sourceHandle: 'out',
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        get().pushMessage({ role: 'system', text: '已创建图片节点，并接入当前文本卡片。', nodeId: id });
        return id;
      }
      if (p.pick === 'video_node') {
        const id = get().addVideoNode(upstreamPos);
        set((s) => ({
          edges: addEdge(
            {
              source: id,
              target: from.id,
              sourceHandle: 'out',
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        get().pushMessage({ role: 'system', text: '已创建视频节点，并接入当前文本卡片。', nodeId: id });
        return id;
      }
      if (p.pick === 'prompt_review_node') {
        return pushErr('提示词审核节点只能从 Prompt 节点右侧 Output 创建。');
      }
      const upKind = p.pick as PipelineKind;
      const id = get().addDepartmentNode(upKind, upstreamPos);
      set((s) => ({
        edges: addEdge(
          {
            source: id,
            target: from.id,
            sourceHandle: DEPT_OUTPUT_HANDLE_ID,
            targetHandle: 'in',
            animated: true,
          },
          s.edges,
        ),
      }));
      syncTextIn(from.id);
      return id;
    }

    if (fromDownstreamOut) {
      if (from.type === 'imageNode' || from.type === 'videoNode') {
        if (p.pick !== 'text_node') {
          return pushErr('图片/视频节点 Output 目前只支持连接到文本卡片。');
        }
        const id = uid('text');
        const data = makeTextNodeData(id, '');
        set((s) => ({
          nodes: [
            ...s.nodes,
            {
              id,
              type: 'textNode',
              position: downstreamPos,
              selected: false,
              data,
            },
          ],
          edges: addEdge(
            {
              source: from.id,
              target: id,
              sourceHandle: 'out',
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        get().pushMessage({ role: 'system', text: '已创建文本卡片，并接入当前视觉参考。', nodeId: id });
        return id;
      }

      if (from.type === 'textNode') {
        if (p.pick === 'image_node' || p.pick === 'video_node') {
          return pushErr('文本卡片 Output 暂不连接到图片/视频节点；请把图片/视频节点 Output 接到文本卡片 Input。');
        }
        if (p.pick === 'text_node') {
          const id = uid('text');
          const data = makeTextNodeData(id, '');
          set((s) => ({
            nodes: [
              ...s.nodes,
              {
                id,
                type: 'textNode',
                position: downstreamPos,
                selected: false,
                data,
              },
            ],
            edges: addEdge(
              {
                source: from.id,
                target: id,
                sourceHandle: 'out',
                targetHandle: 'in',
                animated: true,
              },
              s.edges,
            ),
          }));
          syncTextIn(id);
          get().pushMessage({ role: 'system', text: '已创建文本卡片，并接到当前文本卡片的输出。', nodeId: id });
          return id;
        }
        if (p.pick === 'storyboard_file_node') {
          return pushErr('文本卡片不能直接创建分镜表文件节点作为下游，请手动新建后再导入文件。');
        }
        if (p.pick === 'prompt_review_node') {
          return pushErr('提示词审核节点只能从 Prompt 节点右侧 Output 创建。');
        }
        const tk = p.pick as PipelineKind;
        const id = get().addDepartmentNode(tk, downstreamPos);
        set((s) => ({
          edges: addEdge(
            {
              source: from.id,
              target: id,
              sourceHandle: 'out',
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        syncDeptIn(id);
        return id;
      }

      if (from.type === 'shotList') {
        if (from.data.type !== 'shot_list_node') return pushErr('当前镜头表节点类型不支持该操作。');
        if (p.pick !== 'prompt') {
          return pushErr('镜头表节点的整表 Output 或逐镜头 Output 只能连接到 Prompt 节点。');
        }
        const id = get().addDepartmentNode('prompt', downstreamPos);
        const sourceHandles = resolveShotListSourceHandlesForConnect(
          get().shotListSelectedWiresByNodeId,
          from.id,
          hid,
        );
        set((s) => ({
          edges: addUniqueAnimatedEdges(
            s.edges,
            sourceHandles.map((sourceHandle) => ({
              source: from.id,
              target: id,
              sourceHandle,
              targetHandle: 'in',
            })),
          ),
        }));
        syncDeptIn(id);
        get().pushMessage({
          role: 'broadcast',
          text:
            hid && hid !== DEPT_OUTPUT_HANDLE_ID
              ? '已创建 Prompt 节点，并按当前选中的镜头输出自动连线。'
              : '已创建 Prompt 节点，并按整表输出自动连线。',
          nodeId: id,
        });
        return id;
      }

      if (from.type === 'storyboardFile') {
        if (p.pick !== 'prompt') {
          return pushErr('分镜表文件节点的 Output 只能连接到 Prompt 节点。');
        }
        const id = get().addDepartmentNode('prompt', downstreamPos);
        set((s) => ({
          edges: addEdge(
            {
              source: from.id,
              target: id,
              sourceHandle: DEPT_OUTPUT_HANDLE_ID,
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        syncDeptIn(id);
        get().pushMessage({
          role: 'broadcast',
          text: '已创建 Prompt 节点，并接入当前分镜文件输出。',
          nodeId: id,
        });
        return id;
      }

      if (from.type === 'department') {
        const fk = from.data.type as PipelineKind;
        if (p.pick === 'image_node' || p.pick === 'video_node') {
          return pushErr('部门 Output 暂不连接到图片/视频节点；请把图片/视频节点 Output 接到文本卡片 Input。');
        }
        if (p.pick === 'prompt_review_node') {
          if (fk !== 'prompt') {
            return pushErr('只有 Prompt 节点的 Output 可以创建提示词审核节点。');
          }
          const text = departmentAssetAsInputText(from.data, 'prompt_review_node') ?? '';
          const id = get().addPromptReviewNode(downstreamPos, text);
          set((s) => ({
            edges: addEdge(
              {
                source: from.id,
                target: id,
                sourceHandle: DEPT_OUTPUT_HANDLE_ID,
                targetHandle: 'in',
                animated: true,
              },
              s.edges,
            ),
          }));
          get().syncPromptReviewInputFromGraph(id);
          get().pushMessage({
            role: 'broadcast',
            text: '已从 Prompt 输出创建提示词审核节点，并载入当前卡片提示词。',
            nodeId: id,
          });
          return id;
        }
        if (p.pick === 'text_node') {
          const id = uid('text');
          const data = makeTextNodeData(id, '');
          set((s) => ({
            nodes: [
              ...s.nodes,
              {
                id,
                type: 'textNode',
                position: downstreamPos,
                selected: false,
                data,
              },
            ],
            edges: addEdge(
              {
                source: from.id,
                target: id,
                sourceHandle: DEPT_OUTPUT_HANDLE_ID,
                targetHandle: 'in',
                animated: true,
              },
              s.edges,
            ),
          }));
          syncTextIn(id);
          get().pushMessage({ role: 'system', text: '已创建文本卡片，并接到当前部门节点的输出。', nodeId: id });
          return id;
        }
        if (p.pick === 'storyboard_file_node') {
          return pushErr('部门节点不能直接创建分镜表文件节点作为下游。');
        }
        const tk = p.pick as PipelineKind;
        if (!canDeptChain(fk, tk)) {
          return pushErr('当前部门 Output 不能直接连接到这个下游部门。');
        }
        const id = get().addDepartmentNode(tk, downstreamPos);
        set((s) => ({
          edges: addEdge(
            {
              source: from.id,
              target: id,
              sourceHandle: DEPT_OUTPUT_HANDLE_ID,
              targetHandle: 'in',
              animated: true,
            },
            s.edges,
          ),
        }));
        syncDeptIn(id);
        const upstreamMounted = Array.isArray(from.data.mounted_skills) ? from.data.mounted_skills : [];
        const chained = mergeDownstreamSkillsFromChain(upstreamMounted, fk, tk);
        if (chained.length > 0) {
          get().patchNodeData(id, { mounted_skills: chained }, false);
          const labels = chained.map((sid) => getSkillById(sid)?.name ?? sid);
          get().pushMessage({
            role: 'system',
            text: `Skill Chain 已同步挂载到当前节点：${labels.join('、')}`,
            nodeId: id,
          });
        }
        return id;
      }

      if (from.type === 'promptReview') {
        if (p.pick === 'image_node' || p.pick === 'video_node') {
          return pushErr('提示词审核节点 Output 暂不连接到图片/视频节点；请把图片/视频节点 Output 接到文本卡片 Input。');
        }
        if (p.pick === 'text_node') {
          const id = uid('text');
          const data = makeTextNodeData(id, '');
          set((s) => ({
            nodes: [
              ...s.nodes,
              {
                id,
                type: 'textNode',
                position: downstreamPos,
                selected: false,
                data,
              },
            ],
            edges: addEdge(
              {
                source: from.id,
                target: id,
                sourceHandle: DEPT_OUTPUT_HANDLE_ID,
                targetHandle: 'in',
                animated: true,
              },
              s.edges,
            ),
          }));
          syncTextIn(id);
          return id;
        }
        if (p.pick === 'prompt_review_node') {
          const text = departmentAssetAsInputText(from.data, 'prompt_review_node') ?? '';
          const id = get().addPromptReviewNode(downstreamPos, text);
          set((s) => ({
            edges: addEdge(
              {
                source: from.id,
                target: id,
                sourceHandle: DEPT_OUTPUT_HANDLE_ID,
                targetHandle: 'in',
                animated: true,
              },
              s.edges,
            ),
          }));
          get().syncPromptReviewInputFromGraph(id);
          return id;
        }
        return pushErr('提示词审核节点 Output 目前只支持继续接文本卡片或审核节点。');
      }
    }

    return pushErr('当前连接不支持该节点类型，请检查起点和终点的组合。');
  },

  executeNodeTask: async (nodeId, opts) => {
    const fromReviewed = opts?.optimizeFromReviewed === true;
    const force = opts?.force === true;
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== 'department') return;
    if (node.data.type === 'prompt') {
      flushIncomingShotListEditsForDepartment(get, nodeId);
    }
    const kind = node.data.type;
    if (kind !== 'writing' && kind !== 'storyboard' && kind !== 'prompt') return;
    if (fromReviewed) {
      if (node.data.status !== 'REVIEWED') {
        get().pushMessage({
          role: 'system',
          text: '当前节点还没有进入已审核状态，暂时不能基于审核意见继续优化。',
          nodeId,
        });
        return;
      }
    } else if (!force && node.data.status !== 'NOT_STARTED' && node.data.status !== 'REJECTED') {
      get().pushMessage({
        role: 'system',
        text: `当前节点状态是 ${node.data.status}，只有未开始或已驳回的节点才能重新执行。`,
        nodeId,
      });
      return;
    }
    const optimizeFb = fromReviewed ? (node.data.ai_review_feedback?.trim() ?? '') : '';
    // 1. 娴犺濮熼弬鍥ㄦ拱閿涙碍婀?Input 鏉╃偟鍤庨弮璺侯潗缂佸牆鎮庨獮鍓侇伂閸欙絼鏅堕張鈧弬鐗堟瀮閺堫剨绱欓崥?TEXT_NODE.raw_text閿涘绱濋崘宥呭晸閸忋儴濡悙?input 娓氭稑鐫嶇粈?
    const { nodes: n0, edges: e0 } = get();
    const merged0 = mergedTextInputForDepartment(nodeId, n0, e0);
    if (merged0 !== null && merged0.trim() !== '') {
      get().patchNodeData(nodeId, { input: merged0.trim(), inputSource: 'graph' }, false);
    }
    const deptRow = get().nodes.find((n) => n.id === nodeId);
    const inputText = resolveDepartmentExecutionInput(
      nodeId,
      get().nodes,
      get().edges,
      deptRow?.data.input ?? '',
    );
    if (!inputText && !fromReviewed) {
        const msg =
          kind === 'writing'
            ? '当前没有可执行的输入。请先粘贴文本，或把文本卡片连接到编剧节点。'
            : kind === 'storyboard'
            ? '当前没有可执行的输入。请先提供剧本文本、编剧结果，或把上游内容连接到分镜节点。'
            : '当前没有可执行的输入。请先提供分镜结果、镜头表，或把上游内容连接到 Prompt 节点。';
      get().pushMessage({ role: 'system', text: msg, nodeId });
      return;
    }
    // 2. 鏉╂稑鍙嗛幍褑顢戦敍娆糔_PROGRESS + 濞翠礁绱℃０鍕潔鐎涙顔?+ 閽冩繆澹婂ù浣稿帨閿涘牐顫?DepartmentNode閿?
    get().patchNodeData(
      nodeId,
      {
        status: 'IN_PROGRESS',
        ...(fromReviewed
          ? {}
          : {
              output: null,
              review_result: null,
              ai_review_feedback: null,
              leader_review_suggested_pass: undefined,
              ...(kind === 'storyboard' ? { storyboard_ai_snapshot: null } : {}),
            }),
        generation_error: undefined,
        output_stale_reason: null,
        streaming_preview: '',
        generation_phase: 'employee',
      },
      true,
    );
    get().setActiveNodeId(nodeId);
    const broadcastText = fromReviewed
      ? `${deptLabel(kindToDepartment(kind))} 正在按审核意见重新优化。`
      : kind === 'writing'
        ? '编剧节点正在读取输入并生成结果。'
        : kind === 'storyboard'
          ? '分镜节点正在读取输入并生成镜头表。'
          : 'Prompt 节点正在读取输入并生成提示词。';
    get().pushMessage({ role: 'broadcast', text: broadcastText, nodeId });
    activeTaskAbortControllers.get(nodeId)?.abort();
    const controller = new AbortController();
    activeTaskAbortControllers.set(nodeId, controller);
    const ensureNotStopped = () => {
      if (controller.signal.aborted) {
        throw new Error(STOP_TASK_MESSAGE);
      }
    };

    try {
      const src = get().nodes.find((n) => n.id === nodeId);
      const reviewOptimization =
        fromReviewed && src
          ? {
              feedback: optimizeFb || '请根据当前审核意见继续优化本节点结果。',
              currentVersionContent: formatReviewOptimizationPayload(src.data),
            }
          : undefined;
      const taskParams = {
        kind,
        nodeId,
        nodes: get().nodes,
        edges: get().edges,
        fallbackInput: src?.data.input ?? '',
        assets: get().assets,
        sourceSceneCount:
          kind === 'storyboard' && typeof src?.data.sourceSceneCount === 'number'
            ? src.data.sourceSceneCount
            : undefined,
        mountedSkills: Array.isArray(src?.data.mounted_skills) ? src.data.mounted_skills : [],
        taskInstruction:
          typeof src?.data.assistant_task_instruction === 'string'
            ? src.data.assistant_task_instruction
            : '',
        reviewOptimization,
        signal: controller.signal,
        onModelStreamChunk: (_delta: string, accumulated: string) => {
          get().patchNodeData(
            nodeId,
            {
              streaming_preview: accumulated.trim()
                ? `模型正在返回结构化结果，请稍候...\n\n${accumulated}`
                : '模型已连接，正在等待首段输出...',
              generation_phase: 'employee',
            },
            false,
          );
        },
      };

      get().patchNodeData(
        nodeId,
        { streaming_preview: '模型已启动，正在生成内容...', generation_phase: 'employee' },
        false,
      );

      const emp = await executeEmployeePhase(taskParams);
      ensureNotStopped();

      if (emp.ok && emp.skillWarnings?.length) {
        for (const w of emp.skillWarnings) {
          get().pushMessage({ role: 'system', text: w, nodeId });
        }
      }

      if (!emp.ok) {
        const stoppedByUser = (emp.message ?? '') === STOP_TASK_MESSAGE;
        const failMsg = emp.message ?? `${deptLabel(kindToDepartment(kind))} 执行失败，请稍后重试。`;
        get().patchNodeData(
          nodeId,
          {
            status: stoppedByUser && fromReviewed ? 'REVIEWED' : 'NOT_STARTED',
            streaming_preview: undefined,
            generation_phase: undefined,
            generation_error: failMsg,
          },
          true,
        );
        const workflowSession = get().workflowAgentSession;
        if (
          workflowSession &&
          (workflowSession.writingNodeId === nodeId ||
            workflowSession.storyboardNodeId === nodeId ||
            workflowSession.promptNodeId === nodeId)
        ) {
          set((state) =>
            state.workflowAgentSession?.id === workflowSession.id
              ? {
                  workflowAgentSession: {
                    ...state.workflowAgentSession,
                    state: stoppedByUser ? state.workflowAgentSession.state : 'FAILED',
                    lastAssistantMessage: stoppedByUser
                      ? '当前流程任务已停止。'
                      : `${stageLabel(state.workflowAgentSession.state)} 执行失败，请调整后重试。`,
                    updatedAt: Date.now(),
                  },
                }
              : state,
          );
        }
        get().pushMessage({
          role: 'system',
          text: failMsg,
          nodeId,
        });
        return;
      }

      if (kind === 'writing') {
        ingestWritingOutputToProjectContext(nodeId, emp.output as WritingOutput);
        get().pushMessage({
          role: 'system',
          text: 'ProjectContext 已同步更新：编剧结果中的角色、场景与设定会参与后续分镜与 Prompt 生成。',
          nodeId,
        });
      }

      const previewBody = formatPipelineOutputPreview(kind, emp.output);
      await typewriterStream(
        previewBody,
        (acc) => get().patchNodeData(nodeId, { streaming_preview: acc, generation_phase: 'employee' }, false),
        { chunkChars: 40, delayMs: 20, signal: controller.signal },
      );
      ensureNotStopped();

      const afterEmployee: Partial<StudioNodeData> = {
        output: emp.output,
        input: emp.inputUsed,
        streaming_preview: undefined,
        generation_phase: 'leader',
        generation_error: undefined,
        output_stale_reason: null,
      };
      if (kind === 'storyboard' && emp.narrativeBeatCount != null) {
        afterEmployee.sourceSceneCount = emp.narrativeBeatCount;
      }
      if (kind === 'storyboard' && emp.output) {
        afterEmployee.storyboard_ai_snapshot = cloneStoryboardOutput(emp.output as StoryboardOutput);
      }
      get().patchNodeData(nodeId, afterEmployee, true);

      const finalStatus: NodeStatus = kind === 'prompt' ? 'APPROVED' : 'WAITING_REVIEW';
      get().patchNodeData(
        nodeId,
        {
          status: finalStatus,
          ai_review_feedback: null,
          leader_review_suggested_pass: undefined,
          review_result: null,
          streaming_preview: undefined,
          generation_phase: undefined,
          generation_error: undefined,
          output_stale_reason: null,
        },
        true,
      );
      if (kind === 'storyboard') {
        get().ensureShotListForStoryboard(nodeId);
        get().syncShotListNodesFromStoryboard(nodeId);
      }
      let autoPromptReview: PromptReviewEnsureResult = null;
      if (kind === 'prompt') {
        const version = get().nodes.find((x) => x.id === nodeId)?.data.version ?? 1;
        get().registerAsset({
          nodeId,
          department: 'PROMPT',
          version,
          payload: emp.output as PromptOutput,
          createdAt: Date.now(),
        });
        autoPromptReview = ensurePromptReviewNodeForPromptOutput(get, set, nodeId);
      }

      get().pushMessage({
        role: 'broadcast',
        text:
          kind === 'prompt'
            ? autoPromptReview?.created
              ? 'Prompt 节点已生成完成，已自动创建并连接提示词审核节点。'
              : autoPromptReview
                ? 'Prompt 节点已生成完成，已同步到已连接的提示词审核节点。'
                : 'Prompt 节点已生成完成，可直接使用。'
            : `${deptLabel(kindToDepartment(kind))} 已生成完成，请填写审核意见。`,
        nodeId,
      });

      const workflowSession = get().workflowAgentSession;
      if (workflowSession) {
        if (kind === 'writing' && workflowSession.writingNodeId === nodeId) {
          set((state) =>
            state.workflowAgentSession?.id === workflowSession.id
              ? {
                  workflowAgentSession: {
                    ...state.workflowAgentSession,
                    state: 'SCRIPT_READY',
                    lastAssistantMessage: '编剧结果已生成，请先填写审核意见，再决定是否继续进入分镜阶段。',
                    updatedAt: Date.now(),
                  },
                }
              : state,
          );
          get().pushMessage({
            role: 'assistant',
            text: 'Agent：编剧结果已完成。请先填写审核意见，再决定继续生成分镜或修改当前内容。',
            nodeId,
          });
        }
        if (kind === 'storyboard' && workflowSession.storyboardNodeId === nodeId) {
          const shotListChild = findStoryboardShotListChild(get().nodes, get().edges, nodeId);
          set((state) =>
            state.workflowAgentSession?.id === workflowSession.id
              ? {
                  workflowAgentSession: {
                    ...state.workflowAgentSession,
                    state: 'STORYBOARD_GENERATED',
                    shotListNodeId: shotListChild?.id,
                    lastAssistantMessage: '分镜结果已生成，请先填写审核意见，再决定优化或通过。',
                    updatedAt: Date.now(),
                  },
                }
              : state,
          );
          get().pushMessage({
            role: 'assistant',
            text: 'Agent：分镜结果已完成，镜头表也已同步生成。请先填写审核意见，再决定继续优化或生成 Prompt。',
            nodeId: shotListChild?.id ?? nodeId,
          });
        }
        if (kind === 'prompt' && workflowSession.promptNodeId === nodeId) {
          set((state) =>
            state.workflowAgentSession?.id === workflowSession.id
              ? {
                  workflowAgentSession: {
                    ...state.workflowAgentSession,
                    state: 'PROMPT_GENERATED',
                    lastAssistantMessage: '提示词已生成，可直接复制、导出或继续重新生成。',
                    updatedAt: Date.now(),
                  },
                }
              : state,
          );
          get().pushMessage({
            role: 'assistant',
            text: 'Agent：Prompt 已生成，可直接使用；如需调整，可以重新生成或修改输入后再生成。',
            nodeId,
          });
        }
      }
    } catch (e) {
      const stoppedByUser =
        e instanceof Error && e.message.trim() === STOP_TASK_MESSAGE;
      const errMsg =
        e instanceof Error && e.message.trim()
          ? e.message.trim()
          : `${deptLabel(kindToDepartment(kind))} 任务执行失败，请稍后重试。`;
      get().patchNodeData(
        nodeId,
        {
          status: stoppedByUser && fromReviewed ? 'REVIEWED' : 'NOT_STARTED',
          streaming_preview: undefined,
          generation_phase: undefined,
          generation_error: errMsg,
          output_stale_reason: null,
        },
        true,
      );
      const workflowSession = get().workflowAgentSession;
      if (
        workflowSession &&
        (workflowSession.writingNodeId === nodeId ||
          workflowSession.storyboardNodeId === nodeId ||
          workflowSession.promptNodeId === nodeId)
      ) {
        set((state) =>
          state.workflowAgentSession?.id === workflowSession.id
            ? {
                workflowAgentSession: {
                    ...state.workflowAgentSession,
                    state: stoppedByUser ? state.workflowAgentSession.state : 'FAILED',
                    lastAssistantMessage: stoppedByUser
                      ? '当前流程任务已停止。'
                      : `${stageLabel(state.workflowAgentSession.state)} 执行失败，请调整后重试。`,
                    updatedAt: Date.now(),
                  },
              }
            : state,
        );
      }
      get().pushMessage({
        role: 'system',
        text: errMsg,
        nodeId,
      });
    } finally {
      if (activeTaskAbortControllers.get(nodeId) === controller) {
        activeTaskAbortControllers.delete(nodeId);
      }
    }
  },

  runReviewedOptimization: (nodeId) => {
    const id = nodeId ?? get().activeNodeId ?? get().selectedNodeId;
    if (!id) {
      get().pushMessage({ role: 'system', text: '当前没有选中节点，请先在画布中选择一个已审核节点。' });
      return;
    }
    const node = get().nodes.find((n) => n.id === id);
    if (!node || node.type !== 'department') return;
    if (node.data.status !== 'REVIEWED') {
      get().pushMessage({
        role: 'system',
        text: `当前节点状态是 ${node.data.status}，只有已审核节点才能进入优化。`,
        nodeId: id,
      });
      return;
    }
    const prev = node.data.pipeline_resolution_history ?? [];
    const flashUntil = Date.now() + PIPELINE_DECISION_FLASH_MS;
    get().patchNodeData(
      id,
      {
        pipeline_resolution_history: [
          ...prev,
          { at: Date.now(), kind: 'ai_optimize', summary: '按审核意见继续优化' },
        ],
        pipeline_decision_flash: { kind: 'optimize', until: flashUntil },
      },
      true,
    );
    schedulePipelineFlashClear(get, id, flashUntil);
    get().pushMessage({
      role: 'broadcast',
      text: '已开始按审核意见重新生成当前节点，接下来会直接覆盖本轮结果。',
      nodeId: id,
    });
    void get().executeNodeTask(id, { optimizeFromReviewed: true });
  },

  approveReviewedAsIs: (nodeId) => {
    const id = nodeId ?? get().activeNodeId ?? get().selectedNodeId;
    if (!id) {
      get().pushMessage({ role: 'system', text: '当前没有选中节点，请先在画布中选择一个已审核节点。' });
      return undefined;
    }
    const node = get().nodes.find((n) => n.id === id);
    if (!node || node.type !== 'department') return undefined;
    if (node.data.status !== 'REVIEWED') {
      get().pushMessage({
        role: 'system',
        text: `当前节点状态是 ${node.data.status}，只有已审核节点才能直接通过。`,
        nodeId: id,
      });
      return id;
    }
    const prev = node.data.pipeline_resolution_history ?? [];
    const hist = [
      ...prev,
      { at: Date.now(), kind: 'human_approve_as_is' as const, summary: '人工确认本轮结果可直接通过' },
    ];
    const flashUntil = Date.now() + PIPELINE_DECISION_FLASH_MS;
    if (node.data.type === 'writing') {
      const out = node.data.output as WritingOutput | null;
      if (!out) {
        get().pushMessage({ role: 'system', text: '编剧节点当前没有可归档的输出结果。', nodeId: id });
        return id;
      }
      get().patchNodeData(
        id,
        {
          status: 'APPROVED',
          review_result: REVIEW_RESULT_APPROVE_AS_IS,
          pipeline_resolution_history: hist,
          ai_review_feedback: null,
          leader_review_suggested_pass: undefined,
          pipeline_decision_flash: { kind: 'approve', until: flashUntil },
        },
        true,
      );
      schedulePipelineFlashClear(get, id, flashUntil);
      const v = get().nodes.find((x) => x.id === id)?.data.version ?? node.data.version;
      get().registerAsset({
        nodeId: id,
        department: 'WRITING',
        version: v,
        payload: out,
        createdAt: Date.now(),
      });
      get().pushMessage({
        role: 'broadcast',
        text: '编剧节点已按当前结果直接通过，并归档为可用资产。',
        nodeId: id,
      });
      return id;
    }
    if (node.data.type === 'storyboard') {
      const out = node.data.output as StoryboardOutput | null;
      if (!out) {
        get().pushMessage({ role: 'system', text: '分镜节点当前没有可归档的输出结果。', nodeId: id });
        return id;
      }
      get().patchNodeData(
        id,
        {
          status: 'APPROVED',
          review_result: REVIEW_RESULT_APPROVE_AS_IS,
          pipeline_resolution_history: hist,
          ai_review_feedback: null,
          leader_review_suggested_pass: undefined,
          pipeline_decision_flash: { kind: 'approve', until: flashUntil },
        },
        true,
      );
      schedulePipelineFlashClear(get, id, flashUntil);
      const v = get().nodes.find((x) => x.id === id)?.data.version ?? node.data.version;
      get().registerAsset({
        nodeId: id,
        department: 'STORYBOARD',
        version: v,
        payload: out,
        createdAt: Date.now(),
      });
      get().pushMessage({
        role: 'broadcast',
        text: '分镜节点已按当前结果直接通过，并归档为可用资产。',
        nodeId: id,
      });
      return id;
    }
    if (node.data.type === 'prompt') {
      const out = node.data.output as PromptOutput | null;
      if (!out) {
        get().pushMessage({ role: 'system', text: 'Prompt 节点当前没有可归档的输出结果。', nodeId: id });
        return id;
      }
      get().patchNodeData(
        id,
        {
          status: 'APPROVED',
          review_result: REVIEW_RESULT_APPROVE_AS_IS,
          pipeline_resolution_history: hist,
          ai_review_feedback: null,
          leader_review_suggested_pass: undefined,
          pipeline_decision_flash: { kind: 'approve', until: flashUntil },
        },
        true,
      );
      schedulePipelineFlashClear(get, id, flashUntil);
      const v = get().nodes.find((x) => x.id === id)?.data.version ?? node.data.version;
      get().registerAsset({
        nodeId: id,
        department: 'PROMPT',
        version: v,
        payload: out,
        createdAt: Date.now(),
      });
      get().pushMessage({
        role: 'broadcast',
        text: 'Prompt 节点已按当前结果直接通过，并归档为可用资产。',
        nodeId: id,
      });
      return id;
    }
    return id;
  },

  submitLeaderReviewFeedback: (nodeId, feedback) => {
    const id = nodeId ?? get().activeNodeId ?? get().selectedNodeId;
    const feedbackText = feedback?.trim() ?? '';
    if (!id) {
      get().pushMessage({ role: 'system', text: '当前没有选中节点，请先选择一个待审核节点。' });
      return undefined;
    }
    if (!feedbackText) {
      get().pushMessage({ role: 'system', text: '审核意见不能为空。', nodeId: id });
      return id;
    }
    const node = get().nodes.find((n) => n.id === id);
    if (!node || node.type !== 'department') return undefined;
    if (node.data.status !== 'WAITING_REVIEW' && node.data.status !== 'REVIEWED') {
      get().pushMessage({
        role: 'system',
        text: `当前节点状态是 ${node.data.status}，只有待审核或已审核节点才能填写审核意见。`,
        nodeId: id,
      });
      return id;
    }
    get().patchNodeData(
      id,
      {
        status: 'REVIEWED',
        ai_review_feedback: feedbackText,
        leader_review_suggested_pass: false,
        review_result: null,
        generation_phase: undefined,
        streaming_preview: undefined,
      },
      true,
    );
    get().pushMessage({
      role: 'broadcast',
      text:
        node.data.status === 'REVIEWED'
          ? `审核意见已更新：${summarizeFeedbackPreview(feedbackText)}。现在可以执行优化，或维持现状通过。`
          : `审核意见已记录：${summarizeFeedbackPreview(feedbackText)}。现在可以执行优化，或维持现状通过。`,
      nodeId: id,
    });
    return id;
  },

  addImageNode: (position, opts) => {
    pushUndoSnapshot(set);
    const id = uid('image');
    const pos = position ?? { x: 320, y: 240 };
    const data = makeImageNodeData(id, opts);
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'imageNode',
          position: pos,
          selected: false,
          data,
        },
      ],
    }));
    get().pushMessage({
      role: 'system',
      text: opts?.imageDataUrl
        ? '已创建图片节点。连接到文本卡片后，可参与 LLM 润色。'
        : '已创建图片节点。上传或粘贴图片后，可作为文本润色的视觉参考。',
      nodeId: id,
    });
    return id;
  },

  addVideoNode: (position, opts) => {
    pushUndoSnapshot(set);
    const id = uid('video');
    const pos = position ?? { x: 340, y: 260 };
    const data = makeVideoNodeData(id, opts);
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'videoNode',
          position: pos,
          selected: false,
          data,
        },
      ],
    }));
    get().pushMessage({
      role: 'system',
      text: opts?.videoDataUrl
        ? '已创建视频节点。连接到文本卡片后，可分析构图、元素和运镜。'
        : '已创建视频节点。上传视频后，可作为文本卡片的视频参考。',
      nodeId: id,
    });
    return id;
  },

  addShotListNode: (position, output, opts) => {
    pushUndoSnapshot(set);
    const id = uid('shotlist');
    const pos = position ?? { x: 360, y: 260 };
    const normalizedOutput = cloneStoryboardOutputWithFreshWireIds(output ?? null);
    const data = makeShotListNodeData(id, normalizedOutput, normalizedOutput, undefined);
    data.label = opts?.label?.trim() || `分镜表 · ${id.slice(-4)}`;
    data.importedFileName = opts?.importedFileName;
    data.importedSheetName = opts?.importedSheetName;
    data.importedRowCount = opts?.importedRowCount ?? normalizedOutput?.shots.length;
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'shotList',
          position: pos,
          selected: false,
          data,
        },
      ],
    }));
    get().pushMessage({
      role: 'system',
      text: normalizedOutput?.shots.length
        ? `已创建独立分镜表节点，共载入 ${normalizedOutput.shots.length} 条镜头。`
        : '已创建独立分镜表节点。',
      nodeId: id,
    });
    return id;
  },

  addScriptInputNode: (position) => {
    pushUndoSnapshot(set);
    const id = uid('scriptinput');
    const pos = position ?? { x: 260, y: 220 };
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id,
          type: 'scriptInput',
          position: pos,
          selected: false,
          data: makeScriptNodeData(id, 'script_input_node'),
        },
      ],
    }));
    get().pushMessage({
      role: 'system',
      text: '已创建剧本输入节点。粘贴剧本后点击“剧本拆解”，会通过 API 生成场景、角色、道具三个节点。',
      nodeId: id,
    });
    return id;
  },

  addScriptCoreAnalyzerNodes: (inputId) => {
    pushUndoSnapshot(set);
    let result = {
      sceneId: '',
      characterId: '',
      propId: '',
    };

    set((s) => {
      const inputNode = s.nodes.find((node) => node.id === inputId);
      if (!inputNode || inputNode.type !== 'scriptInput') return s;
      const origin = inputNode?.position ?? { x: 260, y: 220 };
      const findDownstreamAnalyzer = (kind: ScriptNodeKind): string | null => {
        const visited = new Set<string>([inputId]);
        const queue = s.edges.filter((edge) => edge.source === inputId).map((edge) => edge.target);
        while (queue.length > 0) {
          const currentId = queue.shift();
          if (!currentId || visited.has(currentId)) continue;
          visited.add(currentId);
          const node = s.nodes.find((item) => item.id === currentId);
          if (node?.type === 'scriptAnalyzer' && node.data.type === kind) return node.id;
          for (const edge of s.edges.filter((item) => item.source === currentId)) {
            if (!visited.has(edge.target)) queue.push(edge.target);
          }
        }
        return null;
      };
      const makeAnalyzer = (
        currentId: string | null,
        prefix: string,
        kind: 'script_scene_node' | 'script_character_node' | 'script_prop_node',
        position: { x: number; y: number },
      ): { id: string; node: StudioRFNode | null } => {
        if (currentId) return { id: currentId, node: null };
        const id = uid(prefix);
        return {
          id,
          node: {
            id,
            type: 'scriptAnalyzer',
            position,
            selected: false,
            data: makeScriptNodeData(id, kind),
          },
        };
      };

      const scene = makeAnalyzer(findDownstreamAnalyzer('script_scene_node'), 'scriptscene', 'script_scene_node', {
        x: origin.x + 440,
        y: origin.y - 280,
      });
      const character = makeAnalyzer(findDownstreamAnalyzer('script_character_node'), 'scriptcast', 'script_character_node', {
        x: origin.x + 440,
        y: origin.y,
      });
      const prop = makeAnalyzer(findDownstreamAnalyzer('script_prop_node'), 'scriptprop', 'script_prop_node', {
        x: origin.x + 440,
        y: origin.y + 280,
      });

      result = {
        sceneId: scene.id,
        characterId: character.id,
        propId: prop.id,
      };

      let edges = s.edges;
      for (const targetId of [scene.id, character.id, prop.id]) {
        if (!edges.some((edge) => edge.source === inputId && edge.target === targetId)) {
          edges = addEdge({ source: inputId, target: targetId, sourceHandle: 'out', targetHandle: 'in', animated: true }, edges);
        }
      }

      return {
        nodes: [...s.nodes, ...[scene.node, character.node, prop.node].filter((node): node is StudioRFNode => Boolean(node))],
        edges,
      };
    });

    return result;
  },

  addScriptAiAssetsNodeFromSource: (sourceId) => {
    pushUndoSnapshot(set);
    let result: string | null = null;

    set((s) => {
      const sourceNode = s.nodes.find((node) => node.id === sourceId);
      if (!sourceNode || (sourceNode.type !== 'scriptAnalyzer' && sourceNode.type !== 'scriptOutput')) return s;

      const existingEdge = s.edges.find((edge) => {
        if (edge.source !== sourceId) return false;
        const target = s.nodes.find((node) => node.id === edge.target);
        return target?.type === 'scriptAnalyzer' && target.data.type === 'script_ai_assets_node';
      });
      if (existingEdge) {
        result = existingEdge.target;
        return s;
      }

      const id = uid('scriptasset');
      result = id;
      const node: StudioRFNode = {
        id,
        type: 'scriptAnalyzer',
        position: { x: sourceNode.position.x + 390, y: sourceNode.position.y },
        selected: false,
        data: makeScriptNodeData(id, 'script_ai_assets_node'),
      };
      const edge: Connection = { source: sourceId, target: id, sourceHandle: 'out', targetHandle: 'in' };
      return {
        nodes: [...s.nodes, node],
        edges: addEdge({ ...edge, animated: true }, s.edges),
      };
    });

    return result;
  },

  addScriptBreakdownTemplate: (position) => {
    pushUndoSnapshot(set);
    const origin = position ?? { x: 260, y: 220 };
    const inputId = uid('scriptinput');
    const sceneId = uid('scriptscene');
    const characterId = uid('scriptcast');
    const propId = uid('scriptprop');
    const outputId = uid('scriptout');
    const reviewId = uid('scriptreview');
    const timelineId = uid('scripttime');
    const artId = uid('scriptart');
    const vfxId = uid('scriptvfx');
    const worldId = uid('scriptworld');
    const productionId = uid('scriptprod');
    const aiAssetsId = uid('scriptasset');
    const nodesToAdd: StudioRFNode[] = [
      {
        id: inputId,
        type: 'scriptInput',
        position: origin,
        selected: false,
        data: makeScriptNodeData(inputId, 'script_input_node'),
      },
      {
        id: sceneId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 420, y: origin.y - 24 },
        selected: false,
        data: makeScriptNodeData(sceneId, 'script_scene_node'),
      },
      {
        id: characterId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 790, y: origin.y - 150 },
        selected: false,
        data: makeScriptNodeData(characterId, 'script_character_node'),
      },
      {
        id: propId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 790, y: origin.y + 118 },
        selected: false,
        data: makeScriptNodeData(propId, 'script_prop_node'),
      },
      {
        id: outputId,
        type: 'scriptOutput',
        position: { x: origin.x + 1160, y: origin.y - 18 },
        selected: false,
        data: makeScriptNodeData(outputId, 'script_output_node'),
      },
      {
        id: reviewId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 1570, y: origin.y - 286 },
        selected: false,
        data: makeScriptNodeData(reviewId, 'script_review_node'),
      },
      {
        id: timelineId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 1570, y: origin.y - 18 },
        selected: false,
        data: makeScriptNodeData(timelineId, 'script_timeline_node'),
      },
      {
        id: worldId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 1570, y: origin.y + 250 },
        selected: false,
        data: makeScriptNodeData(worldId, 'script_world_node'),
      },
      {
        id: artId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 1980, y: origin.y - 150 },
        selected: false,
        data: makeScriptNodeData(artId, 'script_art_node'),
      },
      {
        id: vfxId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 1980, y: origin.y + 118 },
        selected: false,
        data: makeScriptNodeData(vfxId, 'script_vfx_node'),
      },
      {
        id: productionId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 2390, y: origin.y - 18 },
        selected: false,
        data: makeScriptNodeData(productionId, 'script_production_node'),
      },
      {
        id: aiAssetsId,
        type: 'scriptAnalyzer',
        position: { x: origin.x + 2800, y: origin.y - 18 },
        selected: false,
        data: makeScriptNodeData(aiAssetsId, 'script_ai_assets_node'),
      },
    ];

    const templateEdges: Connection[] = [
      { source: inputId, target: sceneId, sourceHandle: 'out', targetHandle: 'in' },
      { source: sceneId, target: characterId, sourceHandle: 'out', targetHandle: 'in' },
      { source: sceneId, target: propId, sourceHandle: 'out', targetHandle: 'in' },
      { source: sceneId, target: outputId, sourceHandle: 'out', targetHandle: 'in' },
      { source: characterId, target: outputId, sourceHandle: 'out', targetHandle: 'in' },
      { source: propId, target: outputId, sourceHandle: 'out', targetHandle: 'in' },
      { source: outputId, target: reviewId, sourceHandle: 'out', targetHandle: 'in' },
      { source: outputId, target: timelineId, sourceHandle: 'out', targetHandle: 'in' },
      { source: outputId, target: worldId, sourceHandle: 'out', targetHandle: 'in' },
      { source: outputId, target: artId, sourceHandle: 'out', targetHandle: 'in' },
      { source: outputId, target: vfxId, sourceHandle: 'out', targetHandle: 'in' },
      { source: outputId, target: productionId, sourceHandle: 'out', targetHandle: 'in' },
      { source: outputId, target: aiAssetsId, sourceHandle: 'out', targetHandle: 'in' },
    ];

    set((s) => {
      let edges = s.edges;
      for (const edge of templateEdges) {
        edges = addEdge({ ...edge, animated: true }, edges);
      }
      return {
        nodes: [...s.nodes, ...nodesToAdd],
        edges,
      };
    });

    get().pushMessage({
      role: 'system',
      text: '已创建节点式剧本拆解模板：剧本输入 → 场景拆解 → 角色/道具分析 → 拆解汇总 → 质量复核/时间线/世界观 → 美术/VFX/制片统筹 → AI资产生成。',
      nodeId: inputId,
    });
    return {
      inputId,
      sceneId,
      characterId,
      propId,
      outputId,
      reviewId,
      timelineId,
      artId,
      vfxId,
      worldId,
      productionId,
      aiAssetsId,
    };
  },

  triggerLeaderReview: async (nodeId) => {
    const id = nodeId ?? get().activeNodeId ?? get().selectedNodeId;
    if (!id) {
      get().pushMessage({ role: 'system', text: '当前没有选中节点，请先选择一个待审核节点。' });
      return undefined;
    }
    get().pushMessage({
      role: 'system',
      text: '当前版本已改为用户手动填写审核意见。请使用“填写审核意见”提交反馈。',
      nodeId: id,
    });
    return id;
  },

  manualPassLeaderReview: (nodeId) => {
    const id = nodeId ?? get().activeNodeId ?? get().selectedNodeId;
    if (!id) {
      get().pushMessage({ role: 'system', text: '当前没有选中节点，请先选择一个待处理节点。' });
      return undefined;
    }
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return undefined;
    if (node.data.status === 'REVIEWED') {
      return get().approveReviewedAsIs(id);
    }
    if (node.data.status !== 'WAITING_REVIEW') {
      get().pushMessage({
        role: 'system',
        text: `当前节点状态是 ${node.data.status}，只有等待审核或已审核节点才能继续处理。`,
        nodeId: id,
      });
      return id;
    }

    if (node.data.type === 'writing') {
      const out = node.data.output as WritingOutput | null;
      if (!out) {
        get().pushMessage({ role: 'system', text: '编剧节点当前没有可直接通过的输出结果。', nodeId: id });
        return id;
      }
      get().patchNodeData(id, { status: 'APPROVED', review_result: REVIEW_RESULT_MANUAL_PASS }, true);
      const v = get().nodes.find((x) => x.id === id)?.data.version ?? node.data.version;
      get().registerAsset({
        nodeId: id,
        department: 'WRITING',
        version: v,
        payload: out,
        createdAt: Date.now(),
      });
      get().pushMessage({
        role: 'broadcast',
        text: '编剧节点已直接通过当前结果，并归档为可用资产。',
        nodeId: id,
      });
      return id;
    }

    if (node.data.type === 'storyboard') {
      const out = node.data.output as StoryboardOutput | null;
      if (!out) {
        get().pushMessage({ role: 'system', text: '分镜节点当前没有可直接通过的输出结果。', nodeId: id });
        return id;
      }
      get().patchNodeData(id, { status: 'APPROVED', review_result: REVIEW_RESULT_MANUAL_PASS }, true);
      const v = get().nodes.find((x) => x.id === id)?.data.version ?? node.data.version;
      get().registerAsset({
        nodeId: id,
        department: 'STORYBOARD',
        version: v,
        payload: out,
        createdAt: Date.now(),
      });
      get().pushMessage({
        role: 'broadcast',
        text: '分镜节点已直接通过当前结果，并归档为可用资产。',
        nodeId: id,
      });
      return id;
    }

    if (node.data.type === 'prompt') {
      const out = node.data.output as PromptOutput | null;
      if (!out) {
        get().pushMessage({ role: 'system', text: 'Prompt 节点当前没有可直接通过的输出结果。', nodeId: id });
        return id;
      }
      get().patchNodeData(id, { status: 'APPROVED', review_result: REVIEW_RESULT_MANUAL_PASS }, true);
      const v = get().nodes.find((x) => x.id === id)?.data.version ?? node.data.version;
      get().registerAsset({
        nodeId: id,
        department: 'PROMPT',
        version: v,
        payload: out,
        createdAt: Date.now(),
      });
      get().pushMessage({
        role: 'broadcast',
        text: 'Prompt 节点已直接通过当前结果，并归档为可用资产。',
        nodeId: id,
      });
      return id;
    }

    get().pushMessage({
      role: 'system',
      text: '当前节点类型不支持直接通过。',
      nodeId: id,
    });
    return id;
  },

  syncDepartmentInputFromGraph: (deptId) => {
    const { nodes, edges } = get();
    const merged = mergedTextInputForDepartment(deptId, nodes, edges);
    get().patchNodeData(deptId, { inputSource: 'graph' }, false);
    if (merged !== null) {
      get().patchNodeData(deptId, { input: merged, inputSource: 'graph' }, false);
    }
  },

  removeNodesByIds: (ids) => {
    if (ids.length === 0) return;
    const changes = ids.map((id) => ({ type: 'remove' as const, id }));
    get().onNodesChange(changes);
    get().pushMessage({
      role: 'system',
      text: `已删除 ${ids.length} 个节点。`,
    });
  },

  duplicateNodesByIds: (ids) => {
    const sourceNodes = get().nodes.filter((node) => ids.includes(node.id));
    if (sourceNodes.length === 0) return [];
    pushUndoSnapshot(set);
    const duplicatedIds: string[] = [];
    set((state) => {
      const nextNodes = state.nodes.map((node) => ({ ...node, selected: false }));
      const occupiedRects = state.nodes.map((node) => {
        const size = getNodeSize(node);
        return {
          x: node.position.x,
          y: node.position.y,
          width: size.width,
          height: size.height,
        };
      });
      for (const sourceNode of sourceNodes) {
        const rawData = stripFunctionsDeep(sourceNode.data) as StudioNodeData;
        const duplicatedId =
          sourceNode.type === 'textNode'
            ? uid('text')
            : sourceNode.type === 'storyboardFile'
              ? uid('storyfile')
              : sourceNode.type === 'imageNode'
                ? uid('image')
              : sourceNode.type === 'videoNode'
                ? uid('video')
              : sourceNode.type === 'shotList'
                ? uid('shotlist')
                : uid('node');
        const duplicatedData: StudioNodeData = {
          ...rawData,
          id: duplicatedId,
          label: `${deptLabel(rawData.department)} · ${duplicatedId.slice(-4)}`,
          version: 0,
          onDelete: undefined,
          onExecute: undefined,
        };

        if (sourceNode.type === 'shotList') {
          duplicatedData.output = cloneStoryboardOutputWithFreshWireIds(
            duplicatedData.output ? tryParseStoryboardOutput(duplicatedData.output) : null,
          );
          duplicatedData.storyboard_ai_snapshot = cloneStoryboardOutputWithFreshWireIds(
            duplicatedData.storyboard_ai_snapshot
              ? tryParseStoryboardOutput(duplicatedData.storyboard_ai_snapshot)
              : null,
          );
          duplicatedData.sourceStoryboardNodeId = undefined;
          duplicatedData.sourceStoryboardFileNodeId = undefined;
        }

        duplicatedIds.push(duplicatedId);
        const duplicatedPosition = findDuplicatedNodePosition(sourceNode, occupiedRects);
        nextNodes.push({
          ...sourceNode,
          id: duplicatedId,
          position: duplicatedPosition,
          selected: true,
          dragging: false,
          data: duplicatedData,
        });
      }
      return {
        nodes: rebindStudioNodeRuntimeHandlers(nextNodes, makeRuntimeApi(get)),
      };
    });
    get().pushMessage({
      role: 'system',
      text: `已复制 ${duplicatedIds.length} 个节点。`,
    });
    return duplicatedIds;
  },

  undo: () => {
    const snapshot = get().undoStack[get().undoStack.length - 1];
    if (!snapshot) {
      get().pushMessage({ role: 'system', text: '当前没有可撤销的操作。' });
      return;
    }
    for (const controller of activeTaskAbortControllers.values()) {
      controller.abort();
    }
    activeTaskAbortControllers.clear();
    set((state) => {
      const restored = restoreUndoSnapshot(snapshot, get);
      return {
        ...restored,
        undoStack: state.undoStack.slice(0, -1),
      };
    });
    get().reconcileShotListGraphBindings();
    get().pushMessage({
      role: 'system',
      text: '已撤销上一步操作。',
    });
  },

  reconcileShotListGraphBindings: () => {
    const { nodes, edges } = get();
    const parentByShotList = buildStoryboardParentByShotListId(nodes, edges);

    let nextNodes = nodes;
    for (const n of nodes) {
      if (n.type !== 'shotList' || n.data.type !== 'shot_list_node') continue;
      const wiredParent = parentByShotList.get(n.id);
      const wiredParentNode = wiredParent ? nodes.find((x) => x.id === wiredParent) : undefined;
      const nextStoryboardParentId =
        wiredParentNode?.type === 'department' && wiredParentNode.data.type === 'storyboard'
          ? wiredParent
          : undefined;
      const nextStoryboardFileParentId = wiredParentNode?.type === 'storyboardFile' ? wiredParent : undefined;
      if (
        nextStoryboardParentId === n.data.sourceStoryboardNodeId &&
        nextStoryboardFileParentId === n.data.sourceStoryboardFileNodeId
      ) {
        continue;
      }
      nextNodes = nextNodes.map((x) =>
        x.id === n.id
          ? {
              ...x,
              data: {
                ...x.data,
                sourceStoryboardNodeId: nextStoryboardParentId,
                sourceStoryboardFileNodeId: nextStoryboardFileParentId,
              },
            }
          : x,
      );
    }
    if (nextNodes !== nodes) {
      set({ nodes: nextNodes });
    }

    const snap = get();
    const parentMap = buildStoryboardParentByShotListId(snap.nodes, snap.edges);
    const syncParents = new Set<string>();
    const pushShotListIds: string[] = [];

    for (const n of snap.nodes) {
      if (n.type !== 'shotList' || n.data.type !== 'shot_list_node') continue;
      const parentId = n.data.sourceStoryboardNodeId;
      if (!parentId || parentMap.get(n.id) !== parentId) continue;
      const parent = snap.nodes.find(
        (x) => x.id === parentId && x.type === 'department' && x.data.type === 'storyboard',
      );
      if (!parent) continue;
      // 閻栬泛鍨庨梹婊勵劀閸︺劎鏁撻幋鎰閸曞灝顕?output閿涘苯鎯侀崚?onConnect 缁涘袝閸欐垹娈?reconcile 娴兼俺顩惄鏍ㄧウ瀵繋鑵戦惃?output閿涘本妲楃€佃壈鍤ч悩鑸碘偓渚€鏁婃稊杈╂晪閼疯櫕瑕嗛弻鎾崇磽鐢?
      if (parent.data.status === 'IN_PROGRESS') continue;

      const slParsed = n.data.output ? tryParseStoryboardOutput(n.data.output) : null;
      const paParsed = parent.data.output ? tryParseStoryboardOutput(parent.data.output) : null;
      const slKey = storyboardOutputFingerprint(slParsed);
      const paKey = storyboardOutputFingerprint(paParsed);
      if (slKey === paKey) continue;

      if (!slParsed?.shots?.length && paParsed?.shots?.length) {
        syncParents.add(parentId);
      } else if (slParsed?.shots?.length) {
        pushShotListIds.push(n.id);
      }
    }

    for (const sb of syncParents) {
      get().syncShotListNodesFromStoryboard(sb);
    }

    for (const n of snap.nodes) {
      if (n.type !== 'shotList' || n.data.type !== 'shot_list_node') continue;
      const parentId = n.data.sourceStoryboardFileNodeId;
      if (!parentId || parentMap.get(n.id) !== parentId) continue;
      const parent = snap.nodes.find((x) => x.id === parentId && x.type === 'storyboardFile');
      if (!parent) continue;

      const slParsed = n.data.output ? tryParseStoryboardOutput(n.data.output) : null;
      const paParsed = parent.data.output ? tryParseStoryboardOutput(parent.data.output) : null;
      const slKey = storyboardOutputFingerprint(slParsed);
      const paKey = storyboardOutputFingerprint(paParsed);
      if (slKey === paKey) continue;

      if (!slParsed?.shots?.length && paParsed?.shots?.length) {
        get().syncShotListNodesFromStoryboardFile(parentId);
      }
    }

    const afterSync = get();
    const parentMap2 = buildStoryboardParentByShotListId(afterSync.nodes, afterSync.edges);
    for (const slId of pushShotListIds) {
      const n = afterSync.nodes.find((x) => x.id === slId);
      if (!n || n.type !== 'shotList' || n.data.type !== 'shot_list_node') continue;
      const parentId = n.data.sourceStoryboardNodeId;
      if (!parentId || parentMap2.get(slId) !== parentId) continue;
      const parent = afterSync.nodes.find(
        (x) => x.id === parentId && x.type === 'department' && x.data.type === 'storyboard',
      );
      if (!parent) continue;
      if (parent.data.status === 'IN_PROGRESS') continue;
      const slParsed = n.data.output ? tryParseStoryboardOutput(n.data.output) : null;
      const paParsed = parent.data.output ? tryParseStoryboardOutput(parent.data.output) : null;
      if (storyboardOutputFingerprint(slParsed) === storyboardOutputFingerprint(paParsed)) continue;
      if (!slParsed?.shots?.length) continue;
      get().patchShotListNodeOutput(slId, slParsed, false);
    }

    resyncConsumersAfterEdgeMutation(get);
  },

  ensureRuntimeBindingsOnNodes: () => {
    const { nodes } = get();
    if (nodes.length === 0) return;
    // 瀹告彃鐢?onDelete 閸掓瑨顕╅弰?hydrate/rebind 鏉╁浄绱遍柆鍨帳濮ｅ繑顐?set 閺傛澘鍤遍弫鏉跨穿閻劏袝閸?React Flow 閸欐甯堕懞鍌滃仯閸欏秴顦查崥灞绢劄 閳?閺冪娀妾洪弴瀛樻煀
    if (nodes.every((n) => typeof n.data.onDelete === 'function')) return;
    const api = {
      executeNodeTask: (id: string) => get().executeNodeTask(id),
      focusNode: (id: string, o?: { openDetail?: boolean }) => get().focusNode(id, o),
      removeNodesByIds: (ids: string[]) => get().removeNodesByIds(ids),
    };
    set({ nodes: rebindStudioNodeRuntimeHandlers(nodes, api) });
  },
}));

export { getLatestApprovedWritingAsset, getLatestApprovedWritingBundle } from './workflow';
export { canTransitionPipelineStatus, PIPELINE_INITIAL_STATUS } from './workflow';
