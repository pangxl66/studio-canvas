import type { ApprovedAsset } from '@/types/studio';

const INTERNAL_PROMPT_ASSET_ID_RE =
  /^PENDING_(?:CHAR|SCENE)_FROM_ASSET_SYSTEM$/i;
const INTERNAL_PROMPT_MOUNT_TOKEN_RE =
  /\|@=PENDING_(?:CHAR|SCENE)_FROM_ASSET_SYSTEM\|/gi;
const INTERNAL_PROMPT_ASSET_TEXT_RE =
  /PENDING_(?:CHAR|SCENE)_FROM_ASSET_SYSTEM/gi;
const PROMPT_MOUNT_LINE_RE = /^(\s*挂载[:：]\s*)(.*)$/;
const PROMPT_MOUNT_TOKEN_RE = /\|@=([^|]+)\|/g;

export type PromptAssetNameRefs = {
  characterNames?: string[];
  propNames?: string[];
  sceneNames?: string[];
};

function uniquePromptAssetNames(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0 && !isInternalPromptAssetPlaceholder(value)),
    ),
  );
}

/** 从模型的结构维度中保守恢复角色名；只取实体短名，不把身份/动作描述写入挂载。 */
export function inferPromptCharacterNames(value: unknown): string[] {
  const subject = String(value ?? '')
    .split(/[，,；;。]/, 1)[0]
    .replace(/(可见|身份|人数|保持|稳定|相对|位置|画面|镜头|角色).*$/, '')
    .trim();
  if (!subject || /^(无|无人|无角色|无人物)$/.test(subject)) return [];
  return uniquePromptAssetNames(
    subject
      .split(/、|与|及|\//)
      .map((item) =>
        item
          .trim()
          .replace(/[（(：:].*$/, '')
          .replace(
            /(隔|相对|面对|背对|朝向|位于|站在|坐在|跪坐|对坐|交谈|行走|下行|上行|落地|抬头|观察|看向|面向|转身|进入|离开|保持).*$/,
            '',
          )
          .trim(),
      )
      .filter((item) => item.length > 0 && item.length <= 12),
  );
}

/** 从模型的结构维度中保守恢复场景名；场景只取首个短实体。 */
export function inferPromptSceneNames(value: unknown): string[] {
  const scene = String(value ?? '')
    .split(/[，,；;。]/, 1)[0]
    .replace(/[（(：:].*$/, '')
    .trim();
  if (!scene || /^(无|无场景|当前场景)$/.test(scene) || scene.length > 20) return [];
  return uniquePromptAssetNames([scene]);
}

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
  refs?: PromptAssetNameRefs,
): string {
  const characterNames = sanitizePromptAssetIds(refs?.characterNames);
  const propNames = sanitizePromptAssetIds(refs?.propNames);
  const sceneNames = sanitizePromptAssetIds(refs?.sceneNames);
  const fallbackMountNames = uniquePromptAssetNames([
    ...characterNames,
    ...propNames,
    ...sceneNames,
  ]);
  const resolved = String(text ?? '')
    .replace(
      /\|@=PENDING_CHAR_FROM_ASSET_SYSTEM\|/gi,
      characterNames.map((name) => `|@=${name}|`).join(' '),
    )
    .replace(
      /\|@=PENDING_SCENE_FROM_ASSET_SYSTEM\|/gi,
      sceneNames.map((name) => `|@=${name}|`).join(' '),
    )
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(PROMPT_MOUNT_LINE_RE);
      if (!match) return line;
      const existingNames = Array.from(match[2].matchAll(PROMPT_MOUNT_TOKEN_RE))
        .map((tokenMatch) => tokenMatch[1]?.trim())
        .filter((name): name is string => Boolean(name));
      const mountNames = uniquePromptAssetNames([
        ...existingNames,
        ...fallbackMountNames,
      ]);
      return mountNames.length > 0
        ? `${match[1]}${mountNames.map((name) => `|@=${name}|`).join(' ')}`
        : line;
    })
    .join('\n');
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
