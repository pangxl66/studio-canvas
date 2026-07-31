import type { StudioProjectFilePayload } from './studioProjectPersistence.ts';

export const STUDIO_SESSION_RECOVERY_DRAFT_KEY =
  'studio-canvas:session-recovery-draft:v1';

const INLINE_VISUAL_KEYS = new Set([
  'imageDataUrl',
  'imageEditBaseDataUrl',
  'imagePaletteSourceDataUrl',
  'videoDataUrl',
  'videoFrameDataUrl',
]);
const MAX_INLINE_DRAFT_BYTES = 1_500_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inlineVisualBytes(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + inlineVisualBytes(item), 0);
  }
  if (!isRecord(value)) return 0;
  let total = 0;
  for (const [key, child] of Object.entries(value)) {
    if (INLINE_VISUAL_KEYS.has(key) && typeof child === 'string') {
      total += child.length;
    } else {
      total += inlineVisualBytes(child);
    }
    if (total > MAX_INLINE_DRAFT_BYTES) return total;
  }
  return total;
}

function stripInlineVisuals(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInlineVisuals);
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (INLINE_VISUAL_KEYS.has(key) && typeof child === 'string') continue;
    output[key] = stripInlineVisuals(child);
  }
  return output;
}

export function compactStudioRecoveryDraft(
  payload: StudioProjectFilePayload,
): StudioProjectFilePayload {
  return stripInlineVisuals(payload) as StudioProjectFilePayload;
}

export function writeStudioRecoveryDraft(
  payload: StudioProjectFilePayload,
): 'full' | 'compact' | 'failed' {
  if (typeof sessionStorage === 'undefined') return 'failed';
  const compact = inlineVisualBytes(payload) > MAX_INLINE_DRAFT_BYTES;
  const candidate = compact ? compactStudioRecoveryDraft(payload) : payload;
  try {
    sessionStorage.setItem(
      STUDIO_SESSION_RECOVERY_DRAFT_KEY,
      JSON.stringify(candidate),
    );
    return compact ? 'compact' : 'full';
  } catch {
    if (compact) return 'failed';
    try {
      sessionStorage.setItem(
        STUDIO_SESSION_RECOVERY_DRAFT_KEY,
        JSON.stringify(compactStudioRecoveryDraft(payload)),
      );
      return 'compact';
    } catch {
      return 'failed';
    }
  }
}

export function readStudioRecoveryDraft(): unknown {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(STUDIO_SESSION_RECOVERY_DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    sessionStorage.removeItem(STUDIO_SESSION_RECOVERY_DRAFT_KEY);
    return null;
  }
}

export function clearStudioRecoveryDraft(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(STUDIO_SESSION_RECOVERY_DRAFT_KEY);
}

function restoreVisualFields(
  draftData: Record<string, unknown>,
  baseData: Record<string, unknown>,
): Record<string, unknown> {
  const output = { ...draftData };
  for (const key of INLINE_VISUAL_KEYS) {
    if (typeof output[key] !== 'string' && typeof baseData[key] === 'string') {
      output[key] = baseData[key];
    }
  }

  const draftPages = output.storyboardGridImages;
  const basePages = baseData.storyboardGridImages;
  if (Array.isArray(draftPages) && Array.isArray(basePages)) {
    output.storyboardGridImages = draftPages.map((page, index) => {
      if (!isRecord(page)) return page;
      const basePage = basePages[index];
      return isRecord(basePage) ? restoreVisualFields(page, basePage) : page;
    });
  }
  return output;
}

/**
 * 紧凑恢复稿不复制大型图片；恢复时按节点 id 从正式快照补回视觉字段，
 * 同时以恢复稿中的节点、连线、文本和位置为准。
 */
export function mergeStudioRecoveryDraftVisuals(
  draft: StudioProjectFilePayload,
  bases: Array<StudioProjectFilePayload | null | undefined>,
): StudioProjectFilePayload {
  const baseNodes = new Map(
    bases
      .flatMap((base) => base?.nodes ?? [])
      .map((node) => [node.id, node] as const),
  );
  return {
    ...draft,
    nodes: draft.nodes.map((node) => {
      const base = baseNodes.get(node.id);
      if (!base) return node;
      return {
        ...node,
        data: restoreVisualFields(
          node.data as unknown as Record<string, unknown>,
          base.data as unknown as Record<string, unknown>,
        ) as typeof node.data,
      };
    }),
  };
}
