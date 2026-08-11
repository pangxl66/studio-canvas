import type { Connection, Edge } from '@xyflow/react';
import type { ConnectionDragStart, NodePickerState } from '@/components/ConnectEndBinder';
import {
  DEPT_INPUT_HANDLE_ID,
  DEPT_INPUT_PULL_HANDLE_ID,
  DEPT_OUTPUT_HANDLE_ID,
} from '@/utils/departmentInputWire';
import { FILM_INPUT_HANDLE_ID, FILM_OUTPUT_HANDLE_ID } from '@/store/slices/aiFilmmakingStore';
import type { StudioRFNode } from '@/types/reactFlow';
import {
  IMAGE_NODE_INPUT_HANDLE_ID,
  IMAGE_NODE_OUTPUT_HANDLE_ID,
  VIDEO_NODE_OUTPUT_HANDLE_ID,
} from '@/utils/mediaNodeHandles';
import {
  TEXT_NODE_INPUT_HANDLE_ID,
  TEXT_NODE_OUTPUT_HANDLE_ID,
} from '@/utils/textNodeHandles';
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

function shotListParentIsReady(node: StudioRFNode, nodes: StudioRFNode[]): boolean {
  if (node.type !== 'shotList' || node.data.type !== 'shot_list_node') return false;
  const parentId = node.data.sourceStoryboardNodeId;
  if (!parentId) return true;
  const parent = nodes.find(
    (candidate) =>
      candidate.id === parentId &&
      candidate.type === 'department' &&
      candidate.data.type === 'storyboard',
  );
  return parent?.data.status === 'APPROVED';
}

function upstreamConnectionPicksForNode(node: StudioRFNode): ConnectionMenuPick[] {
  if (node.type === 'textNode') {
    return ['image_node', 'video_node', 'text_node'];
  }

  if (node.type === 'imageNode') {
    return ['storyboard_file_node', 'storyboard'];
  }

  if (node.type === 'department') {
    const kind = node.data.type;
    if (kind === 'writing') return ['text_node'];
    if (kind === 'storyboard') return ['text_node', 'image_node'];
    if (kind === 'prompt') return ['text_node', 'storyboard_file_node', 'image_node'];
  }

  if (node.type === 'aiFilmCharacter') {
    return ['image_node', 'text_node'];
  }

  if (node.type === 'aiFilmStoryboard') {
    return ['prompt', 'image_node', 'text_node', 'storyboard_file_node', 'storyboard'];
  }

  if (node.type === 'aiFilmVideoPrompt') {
    return ['film_character_node', 'film_storyboard_node', 'image_node', 'text_node'];
  }

  return [];
}

function downstreamConnectionPicksForNode(node: StudioRFNode): ConnectionMenuPick[] {
  if (node.type === 'textNode') {
    return ['text_node', 'storyboard', 'prompt'];
  }

  if (node.type === 'imageNode') {
    return [
      'text_node',
      'image_node',
      'storyboard',
      'prompt',
      'film_character_node',
      'film_storyboard_node',
      'film_video_prompt_node',
    ];
  }

  if (node.type === 'videoNode') {
    return ['text_node'];
  }

  if (node.type === 'shotList') {
    return ['image_node', 'prompt', 'film_storyboard_node'];
  }

  if (node.type === 'storyboardFile') {
    return ['image_node', 'prompt', 'film_storyboard_node'];
  }

  if (node.type === 'department') {
    const kind = node.data.type;
    if (kind === 'writing') return ['storyboard', 'prompt'];
    if (kind === 'storyboard') return ['image_node', 'film_storyboard_node'];
    if (kind === 'prompt') return ['film_storyboard_node', 'prompt_review_node'];
  }

  if (node.type === 'promptReview') {
    return ['film_storyboard_node', 'text_node', 'prompt_review_node', 'film_video_prompt_node'];
  }

  if (node.type === 'aiFilmCharacter' || node.type === 'aiFilmStoryboard') {
    return node.type === 'aiFilmStoryboard'
      ? ['image_node', 'film_video_prompt_node', 'text_node']
      : ['film_video_prompt_node', 'text_node'];
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
  const groupedIds = picker.fromNodeIds?.filter(Boolean) ?? [];
  if (groupedIds.length > 1) {
    const groupedNodes = groupedIds.flatMap((id) => {
      const node = nodes.find((item) => item.id === id);
      return node ? [node] : [];
    });
    if (groupedNodes.length !== groupedIds.length) return [];
    const [first, ...rest] = groupedNodes.map((node) => downstreamConnectionPicksForNode(node));
    return uniqueConnectionMenuPicks(
      first.filter((pick) => rest.every((picks) => picks.includes(pick))),
    );
  }
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

function wouldCreateTextChainCycle(
  sourceId: string,
  targetId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): boolean {
  const textNodeIds = new Set(
    nodes.filter((node) => node.type === 'textNode').map((node) => node.id),
  );
  if (!textNodeIds.has(sourceId) || !textNodeIds.has(targetId)) return false;

  const outgoing = new Map<string, string[]>();
  for (const current of edges) {
    if (!textNodeIds.has(current.source) || !textNodeIds.has(current.target)) continue;
    const targets = outgoing.get(current.source) ?? [];
    targets.push(current.target);
    outgoing.set(current.source, targets);
  }

  const pending = [targetId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === sourceId) return true;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

export function isStudioConnectionAllowed(
  edge: ConnectionCandidate,
  nodes: StudioRFNode[],
  edges: Edge[] = [],
): boolean {
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
    if (wouldCreateTextChainCycle(src, tgt, nodes, edges)) return false;
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

  if (a.type === 'department' && a.data.type === 'prompt' && b.type === 'aiFilmStoryboard') {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'promptReview' && (b.type === 'textNode' || b.type === 'promptReview')) {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'promptReview' && b.type === 'aiFilmStoryboard') {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'imageNode' && b.type === 'textNode') {
    if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'imageNode' && b.type === 'imageNode') {
    if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== IMAGE_NODE_INPUT_HANDLE_ID) return false;
    const pending = [b.id];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || visited.has(current)) continue;
      if (current === a.id) return false;
      visited.add(current);
      pending.push(
        ...edges
          .filter((candidate) => candidate.source === current)
          .map((candidate) => candidate.target),
      );
    }
    return true;
  }

  if (a.type === 'imageNode' && b.type === 'department' && b.data.type === 'storyboard') {
    if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'imageNode' && b.type === 'department' && b.data.type === 'prompt') {
    if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (
    a.type === 'imageNode' &&
    (b.type === 'aiFilmCharacter' || b.type === 'aiFilmStoryboard' || b.type === 'aiFilmVideoPrompt')
  ) {
    if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'storyboardFile' && b.type === 'imageNode') {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== IMAGE_NODE_INPUT_HANDLE_ID) return false;
    return true;
  }

  if (a.type === 'department' && a.data.type === 'storyboard' && b.type === 'imageNode') {
    if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== IMAGE_NODE_INPUT_HANDLE_ID) return false;
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

  if (a.type === 'aiFilmStoryboard' && b.type === 'imageNode') {
    if (edge.sourceHandle != null && edge.sourceHandle !== FILM_OUTPUT_HANDLE_ID) return false;
    if (edge.targetHandle != null && edge.targetHandle !== IMAGE_NODE_INPUT_HANDLE_ID) return false;
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
    (a.type === 'scriptAnalyzer' || a.type === 'scriptOutput') &&
    b.type === 'aiFilmStoryboard' &&
    (a.data.type === 'script_scene_node' ||
      a.data.type === 'script_character_node' ||
      a.data.type === 'script_prop_node' ||
      a.data.type === 'script_output_node')
  ) {
    if (edge.sourceHandle != null && edge.sourceHandle !== 'out') return false;
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
    if (!shotListParentIsReady(a, nodes)) return false;
    return true;
  }

  if (a.type === 'shotList' && b.type === 'aiFilmStoryboard') {
    if (!isShotListItemOutputHandleId(edge.sourceHandle)) return false;
    if (edge.targetHandle != null && edge.targetHandle !== FILM_INPUT_HANDLE_ID) return false;
    if (a.data.type !== 'shot_list_node') return false;
    if (!shotListParentIsReady(a, nodes)) return false;
    return true;
  }

  if (a.type === 'shotList' && b.type === 'imageNode') {
    if (!isShotListItemOutputHandleId(edge.sourceHandle)) return false;
    if (edge.targetHandle != null && edge.targetHandle !== IMAGE_NODE_INPUT_HANDLE_ID) return false;
    if (a.data.type !== 'shot_list_node') return false;
    if (!shotListParentIsReady(a, nodes)) return false;
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

export function preferredSourceHandleForNode(node: StudioRFNode): string | null {
  if (node.type === 'textNode') return TEXT_NODE_OUTPUT_HANDLE_ID;
  if (node.type === 'department') return DEPT_OUTPUT_HANDLE_ID;
  if (node.type === 'promptReview') return DEPT_OUTPUT_HANDLE_ID;
  if (node.type === 'storyboardFile') return DEPT_OUTPUT_HANDLE_ID;
  if (node.type === 'imageNode') return IMAGE_NODE_OUTPUT_HANDLE_ID;
  if (node.type === 'videoNode') return VIDEO_NODE_OUTPUT_HANDLE_ID;
  if (node.type === 'aiFilmCharacter' || node.type === 'aiFilmStoryboard' || node.type === 'aiFilmVideoPrompt') {
    return FILM_OUTPUT_HANDLE_ID;
  }
  if (node.type === 'scriptAnalyzer' || node.type === 'scriptOutput') return 'out';
  return null;
}

function preferredTargetHandleForNode(node: StudioRFNode): string | null {
  if (node.type === 'textNode') return TEXT_NODE_INPUT_HANDLE_ID;
  if (node.type === 'imageNode') return IMAGE_NODE_INPUT_HANDLE_ID;
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
