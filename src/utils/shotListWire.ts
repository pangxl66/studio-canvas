/** 分镜节点底部 → 镜头表子节点（父子绑定连线） */
export const SHOT_LIST_LINK_HANDLE_ID = 'shot-list-link';
/** 镜头表节点顶部接入父分镜 */
export const SHOT_LIST_PARENT_HANDLE_ID = 'shot-list-parent';

/** 镜头表中每一行镜头右侧的独立输出端口前缀 */
export const SHOT_LIST_ITEM_OUTPUT_HANDLE_PREFIX = 'shot-item-out:';

export const SHOT_LIST_CONNECTION_PICKER_EVENT =
  'studio:shot-list-connection-picker';

export type ShotListConnectionPickerDetail = {
  fromNodeId: string;
  fromHandleId: string;
  screenX: number;
  screenY: number;
};

export function requestShotListConnectionPicker(
  detail: ShotListConnectionPickerDetail,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ShotListConnectionPickerDetail>(SHOT_LIST_CONNECTION_PICKER_EVENT, {
      detail,
    }),
  );
}

export function createStoryboardShotWireId(seed?: number | string): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `shotwire_${seed ?? 'x'}_${suffix}`;
}

export function makeShotListItemOutputHandleId(wireId: string): string {
  return `${SHOT_LIST_ITEM_OUTPUT_HANDLE_PREFIX}${wireId}`;
}

export function parseShotListItemOutputHandleId(handleId: string | null | undefined): string | null {
  if (!handleId) return null;
  return handleId.startsWith(SHOT_LIST_ITEM_OUTPUT_HANDLE_PREFIX)
    ? handleId.slice(SHOT_LIST_ITEM_OUTPUT_HANDLE_PREFIX.length)
    : null;
}

export function isShotListItemOutputHandleId(handleId: string | null | undefined): boolean {
  return parseShotListItemOutputHandleId(handleId) != null;
}

function mergedMemberWireSignature(shot: StoryboardShot): string {
  return (shot.mergedMembers ?? [])
    .map((member) => member.wireId ?? '')
    .filter(Boolean)
    .sort()
    .join('|');
}

export function hasSameShotListWireTopology(
  previousShots: StoryboardShot[],
  nextShots: StoryboardShot[],
): boolean {
  if (previousShots.length !== nextShots.length) return false;
  for (let index = 0; index < previousShots.length; index += 1) {
    const previous = previousShots[index];
    const next = nextShots[index];
    if ((previous.wireId ?? '') !== (next.wireId ?? '')) return false;
    if (mergedMemberWireSignature(previous) !== mergedMemberWireSignature(next)) return false;
  }
  return true;
}

export function reconcileShotListOutputEdges(
  edges: Edge[],
  shotListId: string,
  previousShots: StoryboardShot[],
  nextShots: StoryboardShot[],
): { edges: Edge[]; removedCount: number; migratedCount: number } {
  const previousWireIds = new Set(
    previousShots.map((shot) => shot.wireId).filter((wireId): wireId is string => Boolean(wireId)),
  );
  const nextWireIds = new Set(
    nextShots.map((shot) => shot.wireId).filter((wireId): wireId is string => Boolean(wireId)),
  );
  const mergedWireByMember = new Map<string, string>();
  for (const shot of nextShots) {
    if (!shot.wireId || !shot.mergedMembers?.length) continue;
    for (const member of shot.mergedMembers) {
      if (member.wireId) mergedWireByMember.set(member.wireId, shot.wireId);
    }
  }

  let removedCount = 0;
  let migratedCount = 0;
  const nextEdges: Edge[] = [];
  for (const edge of edges) {
    if (edge.source !== shotListId) {
      nextEdges.push(edge);
      continue;
    }
    const wireId = parseShotListItemOutputHandleId(edge.sourceHandle);
    if (!wireId || !previousWireIds.has(wireId) || nextWireIds.has(wireId)) {
      nextEdges.push(edge);
      continue;
    }
    const mergedWireId = mergedWireByMember.get(wireId);
    if (!mergedWireId) {
      removedCount += 1;
      continue;
    }
    const migrated = {
      ...edge,
      sourceHandle: makeShotListItemOutputHandleId(mergedWireId),
    };
    migratedCount += 1;
    nextEdges.push(migrated);
  }
  const seen = new Set<string>();
  const deduplicated = nextEdges.filter((edge) => {
    const signature = [
      edge.source,
      edge.target,
      edge.sourceHandle ?? '',
      edge.targetHandle ?? '',
    ].join('::');
    if (seen.has(signature)) {
      removedCount += 1;
      return false;
    }
    seen.add(signature);
    return true;
  });
  return { edges: deduplicated, removedCount, migratedCount };
}
import type { Edge } from '@xyflow/react';
import type { StoryboardShot } from '@/types/studio';
