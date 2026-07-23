import type { ApprovedAsset } from '@/types/studio';

const INTERNAL_PROMPT_ASSET_ID_RE =
  /^PENDING_(?:CHAR|SCENE)_FROM_ASSET_SYSTEM$/i;
const INTERNAL_PROMPT_MOUNT_TOKEN_RE =
  /\|@=PENDING_(?:CHAR|SCENE)_FROM_ASSET_SYSTEM\|/gi;
const INTERNAL_PROMPT_ASSET_TEXT_RE =
  /PENDING_(?:CHAR|SCENE)_FROM_ASSET_SYSTEM/gi;

export function isInternalPromptAssetPlaceholder(value: unknown): boolean {
  return INTERNAL_PROMPT_ASSET_ID_RE.test(String(value ?? '').trim());
}

export function sanitizePromptAssetIds(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0 && !isInternalPromptAssetPlaceholder(value));
}

export function resolvePromptAssetPlaceholders(
  text: string,
  refs?: { characterNames?: string[]; sceneNames?: string[] },
): string {
  const characterNames = sanitizePromptAssetIds(refs?.characterNames);
  const sceneNames = sanitizePromptAssetIds(refs?.sceneNames);
  const resolved = String(text ?? '')
    .replace(
      /\|@=PENDING_CHAR_FROM_ASSET_SYSTEM\|/gi,
      characterNames.map((name) => `|@=${name}|`).join(' '),
    )
    .replace(
      /\|@=PENDING_SCENE_FROM_ASSET_SYSTEM\|/gi,
      sceneNames.map((name) => `|@=${name}|`).join(' '),
    );
  return sanitizePromptAssetPlaceholders(resolved);
}

/** 旧项目兼容：内部资产占位符不得进入审核文本、剪贴板或下游宫格。 */
export function sanitizePromptAssetPlaceholders(text: string): string {
  return String(text ?? '')
    .replace(INTERNAL_PROMPT_MOUNT_TOKEN_RE, '')
    .replace(INTERNAL_PROMPT_ASSET_TEXT_RE, '')
    .split(/\r?\n/)
    .map((line) => {
      const compact = line.replace(/[ \t]{2,}/g, ' ').trimEnd();
      if (/^\s*挂载[:：]\s*$/.test(compact)) return '挂载：无';
      return compact;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
    character_asset_ids: char,
    scene_asset_ids: scene,
  };
}
