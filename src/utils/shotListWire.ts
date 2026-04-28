/** 分镜节点底部 → 镜头表子节点（父子绑定连线） */
export const SHOT_LIST_LINK_HANDLE_ID = 'shot-list-link';
/** 镜头表节点顶部接入父分镜 */
export const SHOT_LIST_PARENT_HANDLE_ID = 'shot-list-parent';

/** 镜头表中每一行镜头右侧的独立输出端口前缀 */
export const SHOT_LIST_ITEM_OUTPUT_HANDLE_PREFIX = 'shot-item-out:';

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
