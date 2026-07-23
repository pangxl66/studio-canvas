import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import type { PromptOutput, PromptShotPack, PromptShotSegment, StoryboardShot } from '@/types/studio';
import type { StoryboardGridShotSource, StoryboardGridSource } from '@/services/storyboardGridImage';

const STUDIO_CARD_HEADINGS = [
  '挂载',
  '相机位置',
  '相机朝向',
  '角色朝向',
  '构图锚点',
  '灯光布置与基调',
  '起幅',
  '落幅',
  '连续性约束',
  '提示词',
  '摄影机动态参数',
  '镜头参数',
  '插针 / 甩拍 / 慢镜头',
  '表演建议',
  '主体钉子',
  '连续性钉子',
  '镜头钉子',
  '结果钉子',
  '钉子4行',
] as const;

export type StoryboardPromptSource = {
  sourceNodeIds: string[];
  sourceLabels: string[];
  shotPrompts: PromptShotPack[];
  entries: PromptPackWithSource[];
  sourceSignature: string;
};

export type StoryboardPromptMatchMode = 'id' | 'order' | 'missing' | 'ambiguous';

export type StoryboardPromptMatch = {
  shotSource: StoryboardGridShotSource;
  promptPack?: PromptShotPack;
  promptSourceNodeId?: string;
  mode: StoryboardPromptMatchMode;
  visualPrompt: string;
};

export type StoryboardPromptResolution = {
  matches: StoryboardPromptMatch[];
  matchedCount: number;
  missingShotIds: string[];
  unmatchedPromptIds: string[];
  duplicatePromptIds: string[];
  orderFallbackCount: number;
  signature: string;
};

export type PromptPackWithSource = {
  pack: PromptShotPack;
  sourceNodeId: string;
  segment?: PromptShotSegment;
  parentPromptShotId?: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeStoryboardPromptShotId(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/^分镜/u, '')
    .replace(/\s+/gu, '')
    .replace(/_/gu, '-')
    .replace(/[—–]/gu, '-');
  return normalized.replace(/\d+/gu, (digits) => String(Number(digits)));
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function promptPacksFromOutput(output: unknown): PromptShotPack[] {
  if (!output || typeof output !== 'object') return [];
  const shotPrompts = (output as PromptOutput).shotPrompts;
  if (!Array.isArray(shotPrompts)) return [];
  return shotPrompts.filter((pack): pack is PromptShotPack =>
    Boolean(
      pack &&
      typeof pack === 'object' &&
      text(pack.shot_id) &&
      (text(pack.prompt) || text(pack.seedanceCard)),
    ),
  );
}

function isPromptSourceNode(node: StudioRFNode): boolean {
  return (
    (node.type === 'department' && node.data.type === 'prompt') ||
    node.type === 'promptReview'
  );
}

function promptEntriesFromPack(pack: PromptShotPack, sourceNodeId: string): PromptPackWithSource[] {
  const segments = Array.isArray(pack.shotSegments) ? pack.shotSegments : [];
  if (!segments.length) return [{ pack, sourceNodeId }];
  return segments.map((segment) => ({
    sourceNodeId,
    segment,
    parentPromptShotId: pack.shot_id,
    pack: {
      ...pack,
      shot_id: segment.shot_id,
      prompt: segment.image_prompt,
      seedanceCard: '',
      shotSegments: undefined,
    },
  }));
}

export function resolveStoryboardPromptSource(
  storyboardNodeId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): StoryboardPromptSource {
  const sourceNodeIds: string[] = [];
  const sourceLabels: string[] = [];
  const shotPrompts: PromptShotPack[] = [];
  const entries: PromptPackWithSource[] = [];
  const signatureParts: string[] = [];

  for (const edge of edges) {
    if (edge.target !== storyboardNodeId) continue;
    const node = nodes.find((item) => item.id === edge.source);
    if (!node || !isPromptSourceNode(node)) continue;
    if (!sourceNodeIds.includes(node.id)) {
      sourceNodeIds.push(node.id);
      sourceLabels.push(node.data.label?.trim() || '提示词节点');
    }
    const packs = promptPacksFromOutput(node.data.output);
    signatureParts.push(node.id, String(node.data.version ?? 0));
    if (!packs.length) continue;
    shotPrompts.push(...packs);
    packs.forEach((pack) => entries.push(...promptEntriesFromPack(pack, node.id)));
    signatureParts.push(
      ...packs.flatMap((pack) => [
        pack.shot_id,
        pack.prompt,
        pack.seedanceCard ?? '',
        JSON.stringify(pack.shotSegments ?? []),
      ]),
    );
  }

  return {
    sourceNodeIds,
    sourceLabels,
    shotPrompts,
    entries,
    sourceSignature: hashText(signatureParts.join('\u001f')),
  };
}

function parseStudioCardFields(seedanceCard: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = seedanceCard.replace(/\r/g, '').split('\n');
  let currentHeading = '';
  let currentBody: string[] = [];
  const flush = () => {
    if (!currentHeading) return;
    fields.set(currentHeading, currentBody.join('\n').trim());
  };

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = STUDIO_CARD_HEADINGS.find((candidate) =>
      trimmed === candidate ||
      trimmed === `【${candidate}】` ||
      trimmed.startsWith(`${candidate}：`) ||
      trimmed.startsWith(`${candidate}:`),
    );
    if (heading) {
      flush();
      currentHeading = heading;
      const plainPrefix = trimmed.startsWith(`${heading}：`)
        ? `${heading}：`
        : trimmed.startsWith(`${heading}:`)
          ? `${heading}:`
          : '';
      currentBody = plainPrefix ? [trimmed.slice(plainPrefix.length).trim()].filter(Boolean) : [];
      continue;
    }
    if (currentHeading) currentBody.push(trimmed);
  }
  flush();
  return fields;
}

function compact(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(normalized);
  if (characters.length <= limit) return normalized;
  const candidate = characters.slice(0, limit).join('');
  const punctuationIndex = Math.max(
    candidate.lastIndexOf('。'),
    candidate.lastIndexOf('；'),
    candidate.lastIndexOf('，'),
  );
  return punctuationIndex >= Math.floor(limit * 0.6)
    ? candidate.slice(0, punctuationIndex + 1).trim()
    : candidate.trim();
}

function usableField(fields: Map<string, string>, heading: string): string {
  const value = fields.get(heading)?.trim() ?? '';
  return value === '无' ? '' : value;
}

/** Compile a Studio Card into one decisive static frame. Video timing and audio are intentionally omitted. */
export function compilePromptPackForStoryboardImage(pack: PromptShotPack): string {
  const fields = parseStudioCardFields(text(pack.seedanceCard));
  const enginePrompt = usableField(fields, '提示词') || text(pack.prompt);
  const parts = [
    enginePrompt ? `画面执行=${compact(enginePrompt, 800)}` : '',
    usableField(fields, '相机位置') ? `机位=${compact(usableField(fields, '相机位置'), 220)}` : '',
    usableField(fields, '相机朝向') ? `朝向=${compact(usableField(fields, '相机朝向'), 180)}` : '',
    usableField(fields, '构图锚点') ? `构图=${compact(usableField(fields, '构图锚点'), 360)}` : '',
    usableField(fields, '灯光布置与基调') ? `灯光=${compact(usableField(fields, '灯光布置与基调'), 300)}` : '',
    usableField(fields, '镜头参数') ? `镜头=${compact(usableField(fields, '镜头参数'), 220)}` : '',
    usableField(fields, '表演建议') ? `可见表演=${compact(usableField(fields, '表演建议'), 220)}` : '',
    usableField(fields, '落幅') ? `目标关键帧=${compact(usableField(fields, '落幅'), 300)}` : '',
    usableField(fields, '主体钉子') ? `主体验收=${compact(usableField(fields, '主体钉子'), 160)}` : '',
    usableField(fields, '镜头钉子') ? `镜头验收=${compact(usableField(fields, '镜头钉子'), 160)}` : '',
    usableField(fields, '结果钉子') ? `结果验收=${compact(usableField(fields, '结果钉子'), 160)}` : '',
    usableField(fields, '钉子4行') ? `验收钉子=${compact(usableField(fields, '钉子4行'), 320)}` : '',
  ].filter(Boolean);
  return parts.join('；');
}

/** Compile one V2.3.1 segment without leaking its video timing or audio into image generation. */
export function compilePromptSegmentForStoryboardImage(segment: PromptShotSegment): string {
  return [
    `画面执行=${compact(segment.image_prompt, 900)}`,
    `景别=${compact(segment.shot_type, 100)}`,
    `机位=${compact(segment.camera, 260)}`,
    `构图=${compact(segment.composition, 360)}`,
    `灯光=${compact(segment.lighting, 300)}`,
    `可见动作=${compact(segment.action, 260)}`,
    `目标关键帧=${compact(segment.keyframe, 320)}`,
  ].filter((part) => !part.endsWith('=')).join('；');
}

function compilePromptEntryForStoryboardImage(entry: PromptPackWithSource): string {
  return entry.segment
    ? compilePromptSegmentForStoryboardImage(entry.segment)
    : compilePromptPackForStoryboardImage(entry.pack);
}

function promptEntityNames(value: unknown): string[] | undefined {
  const names = text(value)
    .split(/[、,，/|]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return names.length ? [...new Set(names)] : undefined;
}

function storyboardShotFromPromptEntry(entry: PromptPackWithSource, index: number): StoryboardShot {
  const { pack, segment } = entry;
  const fields = segment ? new Map<string, string>() : parseStudioCardFields(text(pack.seedanceCard));
  const dimensions = pack.dimensions;
  const shotId = text(pack.shot_id) || String(index + 1);
  const description = segment
    ? text(segment.keyframe) || text(segment.image_prompt) || text(segment.action)
    : usableField(fields, '落幅') || usableField(fields, '提示词') || text(pack.prompt);

  return {
    id: index + 1,
    shotNo: shotId,
    wireId: shotId,
    type: text(segment?.shot_type) || text(dimensions?.镜头) || '关键帧',
    movement: text(segment?.camera) || text(dimensions?.运镜) || '按提示词构图',
    description: description || `提示词镜头 ${shotId}`,
    content: '',
    sceneRef: text(dimensions?.场景) || undefined,
    characters: promptEntityNames(dimensions?.角色),
    action: text(segment?.action) || text(dimensions?.动作) || undefined,
    note: '由提示词节点直接生成分镜关键帧。',
  };
}

/**
 * Build virtual storyboard shots when the grid has Prompt inputs but no storyboard/shot-list input.
 * Prompt segments are expanded one-to-one, so the existing grid, reference, and caption pipeline can be reused.
 */
export function buildStoryboardGridSourceFromPromptSource(
  promptSource: StoryboardPromptSource,
): StoryboardGridSource {
  const labelByNodeId = new Map(
    promptSource.sourceNodeIds.map((nodeId, index) => [
      nodeId,
      promptSource.sourceLabels[index] || '提示词节点',
    ]),
  );
  const shotSources = promptSource.entries.map((entry, index) => ({
    shot: storyboardShotFromPromptEntry(entry, index),
    sourceNodeId: entry.sourceNodeId,
    sourceLabel: labelByNodeId.get(entry.sourceNodeId) || '提示词节点',
  }));
  const sourceNodeIds = [...new Set(shotSources.map((item) => item.sourceNodeId))];

  return {
    shots: shotSources.map((item) => item.shot),
    shotSources,
    sourceNodeIds,
    sourceLabels: sourceNodeIds.map((nodeId) => labelByNodeId.get(nodeId) || '提示词节点'),
    totalAvailable: shotSources.length,
    duplicateCount: 0,
  };
}

function shotCandidateKeys(source: StoryboardGridShotSource): string[] {
  return [...new Set([
    normalizeStoryboardPromptShotId(source.shot.wireId),
    normalizeStoryboardPromptShotId(source.shot.shotNo),
    normalizeStoryboardPromptShotId(source.shot.id),
  ].filter(Boolean))];
}

function shotDisplayId(source: StoryboardGridShotSource): string {
  return source.shot.shotNo || source.shot.wireId || String(source.shot.id);
}

export function matchStoryboardPrompts(
  shotSources: StoryboardGridShotSource[],
  promptSource: StoryboardPromptSource,
): StoryboardPromptResolution {
  const packs = promptSource.entries;

  const byKey = new Map<string, number[]>();
  packs.forEach(({ pack }, index) => {
    const key = normalizeStoryboardPromptShotId(pack.shot_id);
    const indices = byKey.get(key) ?? [];
    indices.push(index);
    byKey.set(key, indices);
  });
  const duplicatePromptIds = [...byKey.entries()]
    .filter(([, indices]) => indices.length > 1)
    .map(([key]) => key);
  const used = new Set<number>();
  const matches: StoryboardPromptMatch[] = shotSources.map((shotSource) => {
    const candidateIndices = [...new Set(
      shotCandidateKeys(shotSource).flatMap((key) => byKey.get(key) ?? []),
    )].filter((index) => !used.has(index));
    if (candidateIndices.length === 1) {
      const index = candidateIndices[0];
      used.add(index);
      const match = packs[index];
      return {
        shotSource,
        promptPack: match.pack,
        promptSourceNodeId: match.sourceNodeId,
        mode: 'id',
        visualPrompt: compilePromptEntryForStoryboardImage(match),
      };
    }
    return {
      shotSource,
      mode: candidateIndices.length > 1 ? 'ambiguous' : 'missing',
      visualPrompt: '',
    };
  });

  let orderFallbackCount = 0;
  if (
    promptSource.sourceNodeIds.length === 1 &&
    packs.length === shotSources.length &&
    duplicatePromptIds.length === 0
  ) {
    matches.forEach((match, index) => {
      if (match.mode !== 'missing' || used.has(index)) return;
      const fallback = packs[index];
      if (!fallback) return;
      used.add(index);
      matches[index] = {
        shotSource: match.shotSource,
        promptPack: fallback.pack,
        promptSourceNodeId: fallback.sourceNodeId,
        mode: 'order',
        visualPrompt: compilePromptEntryForStoryboardImage(fallback),
      };
      orderFallbackCount += 1;
    });
  }

  const matchedCount = matches.filter((match) => Boolean(match.promptPack)).length;
  const missingShotIds = matches
    .filter((match) => !match.promptPack)
    .map((match) => shotDisplayId(match.shotSource));
  const unmatchedPromptIds = packs
    .filter((_, index) => !used.has(index))
    .map(({ pack }) => pack.shot_id);
  const signature = hashText([
    promptSource.sourceSignature,
    ...matches.flatMap((match) => [
      match.shotSource.sourceNodeId,
      shotDisplayId(match.shotSource),
      match.shotSource.shot.type,
      match.shotSource.shot.movement,
      match.shotSource.shot.description,
      match.shotSource.shot.content,
      match.shotSource.shot.sceneRef ?? '',
      (match.shotSource.shot.characters ?? []).join('|'),
      (match.shotSource.shot.props ?? []).join('|'),
      match.shotSource.shot.action ?? '',
      match.shotSource.shot.note ?? '',
      match.promptPack?.shot_id ?? '',
      match.visualPrompt,
      match.mode,
    ]),
  ].join('\u001f'));

  return {
    matches,
    matchedCount,
    missingShotIds,
    unmatchedPromptIds,
    duplicatePromptIds,
    orderFallbackCount,
    signature,
  };
}
