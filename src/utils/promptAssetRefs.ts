import type { ApprovedAsset } from '@/types/studio';

/** 从已通过资产列表推导 Prompt 部可绑定的角色/场景引用 ID（避免 store ↔ agents 循环依赖） */
export function promptAssetRefsFromApproved(assets: ApprovedAsset[]): {
  character_asset_ids: string[];
  scene_asset_ids: string[];
} {
  const char: string[] = [];
  const scene: string[] = [];
  for (const a of assets) {
    if (a.department === 'WRITING') {
      char.push(`approved_writing:${a.nodeId}:v${a.version}`);
    }
    if (a.department === 'STORYBOARD') {
      scene.push(`approved_storyboard:${a.nodeId}:v${a.version}`);
    }
  }
  return {
    character_asset_ids: char.length ? char : ['PENDING_CHAR_FROM_ASSET_SYSTEM'],
    scene_asset_ids: scene.length ? scene : ['PENDING_SCENE_FROM_ASSET_SYSTEM'],
  };
}
