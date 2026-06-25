import type { Connection } from '@xyflow/react';
import type { ConnectionDragStart, NodePickerState } from '@/components/ConnectEndBinder';
import {
  DEPT_INPUT_HANDLE_ID,
  DEPT_INPUT_PULL_HANDLE_ID,
  DEPT_OUTPUT_HANDLE_ID,
} from '@/components/DepartmentNode';
import { IMAGE_NODE_OUTPUT_HANDLE_ID } from '@/components/ImageTableNode';
import { TEXT_NODE_INPUT_HANDLE_ID, TEXT_NODE_OUTPUT_HANDLE_ID } from '@/components/TextNode';
import { VIDEO_NODE_OUTPUT_HANDLE_ID } from '@/components/VideoNode';
import { FILM_INPUT_HANDLE_ID, FILM_OUTPUT_HANDLE_ID } from '@/store/slices/aiFilmmakingStore';
import type { StudioRFNode } from '@/types/reactFlow';
import {
  SHOT_LIST_LINK_HANDLE_ID,
  SHOT_LIST_PARENT_HANDLE_ID,
  isShotListItemOutputHandleId,
} from '@/utils/shotListWire';

export type ConnectionCandidate = {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type CreateNodeKind =
  | 'text_node'
  | 'image_node'
  | 'video_node'
  | 'film_character_node'
  | 'film_storyboard_node'
  | 'film_video_prompt_node'
  | 'storyboard_file_node'
  | 'prompt_review_node'
  | 'shot_list_node'
  | 'writing'
  | 'storyboard'
  | 'prompt';

export type ConnectionMenuPick = Exclude<CreateNodeKind, 'shot_list_node'>;

export const CONNECTION_MENU_LABELS: Record<ConnectionMenuPick, string> = {
  text_node: '创建文本卡片',
  image_node: '创建图片节点',
  video_node: '创建视频节点',
  film_character_node: '创建角色设定',
  film_storyboard_node: '创建分镜宫格',
  film_video_prompt_node: '创建分镜提示词',
  storyboard_file_node: '创建分镜表文件',
  prompt_review_node: '创建提示词审核',
  writing: '创建编剧部',
  storyboard: '创建分镜部',
  prompt: '创建提示词部',
};

export function focusDetailForConnectionPick(kind: ConnectionMenuPick): boolean {
  return kind === 'text_node' || kind === 'writing' || kind === 'storyboard' || kind === 'prompt';
}

function uniqueConnectionMenuPicks(kinds: ConnectionMenuPick[]): ConnectionMenuPick[] {
  return Array.from(new Set(kinds));
}

function upstreamConnectionPicksForNode(node: StudioRFNode): ConnectionMenuPick[] {
  if (node.type === 'textNode') {
    return ['image_node', 'video_node', 'text_node'];
  }

  if (node.type === 'department') {
    const kind = node.data.type;
    if (kind === 'writing') return ['text_node'];
    if (kind === 'storyboard') return ['text_node', 'image_node'];
    if (kind === 'prompt') return ['text_node', 'storyboard_file_node'];
  }

  if (node.type === 'aiFilmCharacter') {
    return ['image_node', 'text_node'];
  }

  if (node.type === 'aiFilmStoryboard') {
    return ['text_node'];
  }

  if (node.type === 'aiFilmVideoPrompt') {
    return ['film_character_node', 'film_storyboard_node', 'image_node', 'text_node'];
  }

  return [];
}

function downstreamConnectionPicksForNode(node: StudioRFNode): ConnectionMenuPick[] {
  if (node.type === 'textNode') {
    return ['storyboard', 'prompt'];
  }

  if (node.type === 'imageNode') {
    return ['text_node', 'storyboard', 'film_character_node', 'film_video_prompt_node'];
  }

  if (node.type === 'videoNode') {
    return ['text_node'];
  }

  if (node.type === 'shotList') {
    return ['prompt', 'film_storyboard_node'];
  }

  if (node.type === 'storyboardFile') {
    return ['prompt', 'film_storyboard_node'];
  }

  if (node.type === 'department') {
    const kind = node.data.type;
    if (kind === 'writing') return ['storyboard', 'prompt'];
    if (kind === 'storyboard') return ['film_storyboard_node'];
    if (kind === 'prompt') return ['prompt_review_node'];
  }

  if (node.type === 'promptReview') {
    return ['text_node', 'prompt_review_node', 'film_video_prompt_node'];
  }

  if (node.type === 'aiFilmCharacter' || node.type === 'aiFilmStoryboard') {
    return ['film_video_prompt_node', 'text_node'];
  }

  if (node.type === 'aiFilmVideoPrompt') {
    return ['text_node'];
  }

  return [];
}

export function connectionMenuPicksForPicker(
  picker: NodePickerState | null,
  nodes: StudioRFNode[],
): ConnectionMenuPick[] {
  if (!picker) return [];
  const node = nodes.find((item) => item.id === picker.fromNodeId);
  if (!node) return [];

  const handleId = picker.fromHandleId ?? '';
  const handleType = picker.fromHandleType;

  if (handleType === 'source' && handleId === DEPT_INPUT_PULL_HANDLE_ID) {
    return uniqueConnectionMenuPicks(upstreamConnectionPicksForNode(node));
  }

  if (handleType === 'target') {
    return uniqueConnectionMenuPicks(upstreamConnectionPicksForNode(node));
  }

  if (handleType === 'source') {
    return uniqueConnectionMenuPicks(downstreamConnectionPicksForNode(node));
  }

  return [];
}

export function isStudioConnectionAllowed(edge: ConnectionCandidate, nodes: StudioRFNode[]): boolean {
  const src = edge.source;
  const tgt = edge.target;
  if (!src || !tgt || src === tgt) return false;
  const a = nodes.find((x) => x.id === src);
  const b = nodes.find((x) => x.id === tgt);
  if (!a || !b) return false;

  if (a.type === 'department' && edge.sourceHandle === DEPT_INPUT_PULL_HANDLE_ID) return false;

  if (a.type === 'textNode' && b.type === 'department') {
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    if (edge.sourceHandle != null && edge.sourceHandle !== TEXT_NODE_OUTPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'textNode' && b.type === 'textNode') {
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    if (edge.sourceHandle != null && edge.sourceHandle !== TEXT_NODE_OUTPUT_HANDLE_ID) return false;
    return true;
  }

  if (
    a.type === 'textNode' &&
    (b.type === 'aiFilmCharacter' || b.type === 'aiFilmStoryboard' || b.type === 'aiFilmVideoPrompt')
  ) {
    if (edge.sourceHandle != null && edge.sourceHandle !== TEXT_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'department' && b.type === 'textNode') {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'department' && b.type === 'promptReview') {
    if (a.data.type !== 'prompt') return false;
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'promptReview' && (b.type === 'textNode' || b.type === 'promptReview')) {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'imageNode' && b.type === 'textNode') {
    if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'imageNode' && b.type === 'department' && b.data.type === 'storyboard') {
    if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'imageNode' && (b.type === 'aiFilmCharacter' || b.type === 'aiFilmVideoPrompt')) {
    if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'videoNode' && b.type === 'textNode') {
    if (edge.sourceHandle != null && edge.sourceHandle !== VIDEO_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if ((a.type === 'aiFilmCharacter' || a.type === 'aiFilmStoryboard') && b.type === 'aiFilmVideoPrompt') {
    if (edge.sourceHandle != null && edge.sourceHandle !== FILM_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'department' && a.data.type === 'storyboard' && b.type === 'aiFilmStoryboard') {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'storyboardFile' && b.type === 'aiFilmStoryboard') {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (
    (a.type === 'aiFilmCharacter' || a.type === 'aiFilmStoryboard' || a.type === 'aiFilmVideoPrompt') &&
    b.type === 'textNode'
  ) {
    if (edge.sourceHandle != null && edge.sourceHandle !== FILM_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'department' && b.type === 'department') {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    const ak = a.data.type;
    const bk = b.data.type;
    if (ak === 'writing' && bk === 'storyboard') return true;
    if (ak === 'writing' && bk === 'prompt') return true;
    return false;
  }

  if (a.type === 'shotList' && b.type === 'department') {
    if (b.data.type !== 'prompt') return false;
    if (!isShotListItemOutputHandleId(edge.sourceHandle)) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    if (a.data.type !== 'shot_list_node') return false;
    return true;
  }

  if (a.type === 'shotList' && b.type === 'aiFilmStoryboard') {
    if (!isShotListItemOutputHandleId(edge.sourceHandle)) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    if (a.data.type !== 'shot_list_node') return false;
    return true;
  }

  if (a.type === 'department' && b.type === 'shotList') {
    if (a.data.type !== 'storyboard') return false;
    if (edge.sourceHandle !== SHOT_LIST_LINK_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== SHOT_LIST_PARENT_HANDLE_ID) return false;
    return true;
  }

  return false;
}

function preferredSourceHandleForNode(node: StudioRFNode): string | null {
  if (node.type === 'textNode') return TEXT_NODE_OUTPUT_HANDLE_ID;
  if (node.type === 'department') return DEPT_OUTPUT_HANDLE_ID;
  if (node.type === 'promptReview') return DEPT_OUTPUT_HANDLE_ID;
  if (node.type === 'storyboardFile') return DEPT_OUTPUT_HANDLE_ID;
  if (node.type === 'imageNode') return IMAGE_NODE_OUTPUT_HANDLE_ID;
  if (node.type === 'videoNode') return VIDEO_NODE_OUTPUT_HANDLE_ID;
  if (node.type === 'aiFilmCharacter' || node.type === 'aiFilmStoryboard' || node.type === 'aiFilmVideoPrompt') {
    return FILM_OUTPUT_HANDLE_ID;
  }
  return null;
}

function preferredTargetHandleForNode(node: StudioRFNode): string | null {
  if (node.type === 'textNode') return TEXT_NODE_INPUT_HANDLE_ID;
  if (node.type === 'department') return DEPT_INPUT_HANDLE_ID;
  if (node.type === 'promptReview') return DEPT_INPUT_HANDLE_ID;
  if (node.type === 'shotList') return SHOT_LIST_PARENT_HANDLE_ID;
  if (node.type === 'aiFilmCharacter' || node.type === 'aiFilmStoryboard' || node.type === 'aiFilmVideoPrompt') {
    return FILM_INPUT_HANDLE_ID;
  }
  return null;
}

export function buildMagnetConnection(
  started: ConnectionDragStart | null,
  hoverNodeId: string | null,
  nodes: StudioRFNode[],
): Connection | null {
  if (!started?.nodeId || !hoverNodeId || started.nodeId === hoverNodeId) return null;
  const startedNode = nodes.find((node) => node.id === started.nodeId);
  const hoverNode = nodes.find((node) => node.id === hoverNodeId);
  if (!startedNode || !hoverNode) return null;

  if (started.handleType === 'target') {
    const sourceHandle = preferredSourceHandleForNode(hoverNode);
    const targetHandle = started.handleId ?? preferredTargetHandleForNode(startedNode);
    if (!sourceHandle || !targetHandle) return null;
    return {
      source: hoverNode.id,
      target: startedNode.id,
      sourceHandle,
      targetHandle,
    };
  }

  const sourceHandle = started.handleId ?? preferredSourceHandleForNode(startedNode);
  const targetHandle = preferredTargetHandleForNode(hoverNode);
  if (!sourceHandle || !targetHandle) return null;
  return {
    source: startedNode.id,
    target: hoverNode.id,
    sourceHandle,
    targetHandle,
  };
}
