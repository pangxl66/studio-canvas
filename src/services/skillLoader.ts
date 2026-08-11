import type {
  SkillExportExtension,
  SkillExportExtensionCapability,
  SkillExportWritingTemplate,
  SkillFileRecord,
  SkillFolder,
  SkillSlotKind,
} from '@/types/skill';

type SkillJson = {
  name?: string;
  description?: string;
  version?: string;
  slot?: unknown;
  prompt_slot?: unknown;
  system_instruction?: string;
  reference_files?: unknown;
  export_extensions?: unknown;
  activation?: {
    when?: unknown;
    avoid?: unknown;
  };
  generation_steps?: unknown;
  fixed_modules?: unknown;
  assembly_contract?: unknown;
  hard_constraints?: unknown;
  anti_patterns?: unknown;
};

const EXPORT_CAPS = new Set<SkillExportExtensionCapability>([
  'writing_download',
  'storyboard_shotlist',
  'prompt_copy_all',
  'prompt_sync_video',
]);

const WRITING_TPL = new Set<SkillExportWritingTemplate>(['standard', 'vertical_short', 'hollywood']);
const PROMPT_STYLE_SLOT_ALIASES = new Set(['style', 'prompt_style', 'prompt-style', 'spec', 'structure', '规范']);
const ENHANCEMENT_SLOT_ALIASES = new Set(['enhancement', 'enhance', 'addon', '增强']);

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function sectionBlock(title: string, lines: string[]): string {
  if (!lines.length) return '';
  return `【${title}】\n${lines.map((line, idx) => `${idx + 1}. ${line}`).join('\n')}`;
}

function buildStructuredInstruction(mod: SkillJson, referencedInstruction = ''): string {
  const blocks: string[] = [];
  const base =
    typeof mod.system_instruction === 'string' ? mod.system_instruction.trim() : '';
  if (base) blocks.push(base);
  if (referencedInstruction) blocks.push(referencedInstruction);

  const when = normalizeStringList(mod.activation?.when);
  const avoid = normalizeStringList(mod.activation?.avoid);
  const generationSteps = normalizeStringList(mod.generation_steps);
  const fixedModules = normalizeStringList(mod.fixed_modules);
  const assemblyContract = normalizeStringList(mod.assembly_contract);
  const hardConstraints = normalizeStringList(mod.hard_constraints);
  const antiPatterns = normalizeStringList(mod.anti_patterns);

  const maybeBlocks = [
    sectionBlock('何时使用', when),
    sectionBlock('不要用于', avoid),
    sectionBlock('生成顺序', generationSteps),
    sectionBlock('固定模块', fixedModules),
    sectionBlock('组装约定', assemblyContract),
    sectionBlock('硬约束', hardConstraints),
    sectionBlock('禁止事项', antiPatterns),
  ].filter(Boolean);

  return [...blocks, ...maybeBlocks].join('\n\n').trim();
}

function parseExportExtensions(raw: unknown): SkillExportExtension[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: SkillExportExtension[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    const cap = o.capability;
    if (!label || typeof cap !== 'string' || !EXPORT_CAPS.has(cap as SkillExportExtensionCapability)) continue;
    let writingTemplate: SkillExportWritingTemplate | undefined;
    if (typeof o.writingTemplate === 'string' && WRITING_TPL.has(o.writingTemplate as SkillExportWritingTemplate)) {
      writingTemplate = o.writingTemplate as SkillExportWritingTemplate;
    }
    out.push({
      label,
      capability: cap as SkillExportExtensionCapability,
      writingTemplate,
    });
  }
  return out.length ? out : undefined;
}

function parseSkillSlot(mod: SkillJson, folder: SkillFolder): SkillSlotKind | undefined {
  const raw =
    typeof mod.slot === 'string'
      ? mod.slot.trim().toLowerCase()
      : typeof mod.prompt_slot === 'string'
        ? mod.prompt_slot.trim().toLowerCase()
        : '';
  if (!raw) return undefined;
  if (folder === 'prompt' && PROMPT_STYLE_SLOT_ALIASES.has(raw)) return 'style';
  if (ENHANCEMENT_SLOT_ALIASES.has(raw)) return 'enhancement';
  return undefined;
}

function parseFolderAndBase(pathKey: string): { folder: SkillFolder; base: string } | null {
  const norm = pathKey.replace(/\\/g, '/');
  const m = norm.match(/skills\/(writing|storyboard|prompt|video_prompt)\/([^/]+)\.json$/i);
  if (!m) return null;
  const folder = m[1].toLowerCase() as SkillFolder;
  const base = m[2];
  return { folder, base };
}

function resolveSkillReferencePath(sourcePath: string, referencePath: string): string | null {
  const reference = referencePath.trim().replace(/\\/g, '/');
  if (!reference || reference.startsWith('/') || /^[a-z]+:/i.test(reference)) return null;
  const parts = sourcePath.replace(/\\/g, '/').split('/');
  parts.pop();
  for (const segment of reference.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const resolved = parts.join('/');
  return resolved.startsWith('../skills/') ? resolved : null;
}

function buildReferencedInstruction(mod: SkillJson, sourcePath: string): string {
  const references = normalizeStringList(mod.reference_files);
  if (!references.length) return '';
  const blocks: string[] = [];
  for (const reference of references) {
    const resolved = resolveSkillReferencePath(sourcePath, reference);
    const content = resolved ? rawTextModules[resolved]?.trim() : '';
    if (!content) continue;
    blocks.push(`【技能参考文件：${reference}】\n${content}`);
  }
  return blocks.join('\n\n');
}

function relaxPromptDurationLimits(instruction: string): string {
  const replacements: ReadonlyArray<readonly [string, string]> = [
    [
      '总时长根据动作量、镜头复杂度和情绪停顿合理估算，每张 seedanceCard 必须在15秒以内，不默认铺满15秒。',
      '总时长根据节点指定值、上游镜头总时长、动作量、镜头复杂度和情绪停顿确定；seedanceCard 不设15秒硬上限，也不得无理由拉长。',
    ],
    [
      '只有确有三阶段以上连续变化时才使用12至15秒。',
      '三阶段以上连续变化可以使用12秒以上，最终时长按动作完整性与上游时长确定。',
    ],
    ['禁止无理由填满15秒。', '禁止无理由填满预设时长。'],
    [
      '15秒上限作用于每张 seedanceCard。多个输入分镜可以对应多张卡片，每张分别不超过15秒。',
      'seedanceCard 不设15秒硬上限。多个输入分镜可以对应多张卡片，每张按节点指定值或上游镜头真实时长完整生成。',
    ],
    [
      '只有输入明确要求合并，或多个分镜共同构成同一连续镜头且总时长不超过15秒时才允许合并',
      '只有输入明确要求合并，或多个分镜共同构成同一连续镜头且动作与运镜适合在同一连续时间轴内完成时才允许合并',
    ],
    ['每张卡片是否不超过15秒。', '每张卡片时长是否与节点指定值或上游镜头真实时长一致。'],
    [
      '- 单次输出严格锁定为 15.0 秒，不是 15 秒以内，也不能超出 15 秒。',
      '- 单次输出时长由节点指定值或上游镜头真实时长决定，不设 15 秒硬上限。',
    ],
    [
      '- 时间轴必须从 00.0s 开始，到 15.0s 结束，精度到 0.0s。',
      '- 时间轴必须从 00.0s 开始，到当前卡片实际总时长结束，精度到 0.0s。',
    ],
    [
      '- 必须根据分镜数量与动作密度合理分配每段时长；多分镜组合时，不允许漏镜头、不允许把 15 秒扩写成 30 秒或 50 秒。',
      '- 必须根据分镜数量、上游时长与动作密度合理分配每段时长；多分镜组合时不允许漏镜头或擅自压缩、扩写总时长。',
    ],
    [
      '转译为 Seedance 2.0 可直接读取的 15.0 秒分段式视听提示词。',
      '转译为 Seedance 2.0 可直接读取、按真实总时长组织的分段式视听提示词。',
    ],
  ];
  let relaxed = instruction;
  for (const [legacyRule, replacement] of replacements) {
    relaxed = relaxed.replaceAll(legacyRule, replacement);
  }
  return relaxed.concat(
    '\n\n【运行时时长协议｜最高优先级】当前节点生成的 seedanceCard 不设 15 秒硬上限。优先使用节点明确指定时长；未指定时使用上游镜头或镜头组的真实总时长；两者都不存在时才回退为 15 秒。时间轴必须从 0 开始、连续无重叠无空洞，并准确结束于当前卡片实际总时长。任何旧版“15秒以内”“正好15秒”“单卡不超过15秒”或“合并总时长不超过15秒”规则均已失效。不得为了适配旧限制而删镜头、漏动作、压缩表演或截断落幅。',
  );
}

function applyRuntimeSkillCompatibility(instruction: string, id: string): string {
  let compatible = instruction;
  if (id === 'prompt/seedance_2_5_multimodal_film_prompt_v10') {
    return compatible
      .replaceAll('用户计划一次生成 15 秒以上内容', '用户计划一次生成较长连续内容')
      .replaceAll(
        '仅在完全没有时长信息时回退15秒',
        '完全没有时长信息时按动作预算、对白、表演停顿、运镜复杂度和完整落幅所需时间自主估算，不套用固定默认秒数',
      )
      .concat(
        '\n\n【Seedance 2.5 时长与组合协议｜最终覆盖】不设固定秒数上限，也不使用固定默认秒数。有节点指定时长或上游 durationSec 时严格沿用；完全没有时长信息时，根据动作、对白、表演停顿、运镜复杂度与完整落幅自主估算。多镜头组合不设15秒最低门槛，较短连续段同样可以组合；组合或拆组只由连续性、动作对白、覆盖剪辑与单次生成承载能力决定，不得以总时长阈值决定。不得为套用预设时长压缩、截断、删镜头或漏动作。',
      );
  }
  if (
    id.startsWith('prompt/studio_canvas_prompt_spec_') ||
    id === 'prompt/seedance2_segmented_prompt_v1'
  ) {
    compatible = relaxPromptDurationLimits(compatible);
  }
  if (id !== 'prompt/studio_canvas_prompt_spec_v2_7_camera_matching') return compatible;
  return compatible
    .replace(
      '一般单镜建议挂载5至12项；复杂群像、载具或大型场景可增加至15项',
      '一般单镜建议挂载5至15项；复杂群像、载具或大型场景不设固定数量上限，但每项都必须有明确来源并具有执行价值',
    )
    .concat(
      '\n\n【本地运行时容量修订】Studio Canvas 2.7 单镜挂载不设数量硬上限；本条覆盖技能正文中的旧版数量限制。不得虚构、重复或堆叠不影响执行的装饰项。',
    );
}

function normalizeSkill(
  mod: SkillJson,
  id: string,
  folder: SkillFolder,
  fileName: string,
  sourcePath: string,
): SkillFileRecord | null {
  const name = typeof mod.name === 'string' ? mod.name.trim() : '';
  const description = typeof mod.description === 'string' ? mod.description.trim() : '';
  const version = typeof mod.version === 'string' ? mod.version.trim() : '';
  const system_instruction = applyRuntimeSkillCompatibility(
    buildStructuredInstruction(mod, buildReferencedInstruction(mod, sourcePath)),
    id,
  );
  if (!name || !system_instruction) return null;
  const export_extensions = parseExportExtensions(mod.export_extensions);
  const slot = parseSkillSlot(mod, folder);
  return {
    id,
    folder,
    fileName,
    name,
    description,
    version: version || '0.0.0',
    system_instruction,
    ...(slot ? { slot } : {}),
    ...(export_extensions ? { export_extensions } : {}),
  };
}

const rawModules = import.meta.glob<{ default: SkillJson }>('../skills/**/*.json', { eager: true });
const rawTextModules = import.meta.glob<string>('../skills/**/*.{md,txt}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const STUDIO_CANVAS_PROMPT_V1_SKILL_ID = 'prompt/studio_canvas_prompt_spec_v1';
export const STUDIO_CANVAS_PROMPT_V23_SKILL_ID = 'prompt/studio_canvas_prompt_spec_v2_3_production';
export const STUDIO_CANVAS_PROMPT_V231_SEGMENTS_SKILL_ID =
  'prompt/studio_canvas_prompt_spec_v2_3_1_segments';
export const STUDIO_CANVAS_PROMPT_V25_SKILL_ID =
  'prompt/studio_canvas_prompt_spec_v2_5_validation';
export const STUDIO_CANVAS_PROMPT_V26_SKILL_ID =
  'prompt/studio_canvas_prompt_spec_v2_6_detailed_mount';
export const STUDIO_CANVAS_PROMPT_V27_SKILL_ID =
  'prompt/studio_canvas_prompt_spec_v2_7_camera_matching';
export const SEEDANCE25_MULTIMODAL_PROMPT_V10_SKILL_ID =
  'prompt/seedance_2_5_multimodal_film_prompt_v10';
export const SEEDANCE25_PERFORMANCE_PROMPT_V11_SKILL_ID =
  'prompt/seedance_2_5_multimodal_film_prompt_v11_performance';
export const DEFAULT_PROMPT_STYLE_SKILL_ID = STUDIO_CANVAS_PROMPT_V27_SKILL_ID;
export const DEFAULT_STORYBOARD_SKILL_ID = 'storyboard/xuke_storyboard_v1';
export const DEFAULT_VIDEO_PROMPT_SKILL_ID = 'video_prompt/storyboard_grid_seedance_v1';

const registry = new Map<string, SkillFileRecord>();
const allSkills: SkillFileRecord[] = [];
const HIDDEN_SKILL_IDS = new Set<string>([
  STUDIO_CANVAS_PROMPT_V25_SKILL_ID,
  STUDIO_CANVAS_PROMPT_V26_SKILL_ID,
  'prompt/storyboard-to-sd20-prompt',
  'prompt/storyboard_prompt_translator_v1',
  'prompt/jimeng_prompt_generator_v1',
  'prompt/seedance2_segmented_prompt_v1',
]);
const SKILL_ID_ALIASES = new Map<string, string>([
  // Preserve old projects while upgrading their selected Seedance style to v10.
  [
    'prompt/seedance_2_5_multimodal_film_prompt_v9',
    SEEDANCE25_MULTIMODAL_PROMPT_V10_SKILL_ID,
  ],
  // Previous defaults remain on disk for rollback. Existing Prompt nodes
  // transparently advance to the current Studio Canvas specification.
  [STUDIO_CANVAS_PROMPT_V25_SKILL_ID, DEFAULT_PROMPT_STYLE_SKILL_ID],
  [STUDIO_CANVAS_PROMPT_V26_SKILL_ID, DEFAULT_PROMPT_STYLE_SKILL_ID],
  ['prompt/jimeng_prompt_generator_v1', DEFAULT_PROMPT_STYLE_SKILL_ID],
  ['prompt/storyboard-to-sd20-prompt', DEFAULT_PROMPT_STYLE_SKILL_ID],
  ['prompt/storyboard_prompt_translator_v1', DEFAULT_PROMPT_STYLE_SKILL_ID],
  // Keep the new Seedance/9-grid experiment isolated from legacy Prompt nodes.
  // Existing projects that saved this style are normalized back to the stable default spec.
  ['prompt/seedance2_segmented_prompt_v1', DEFAULT_PROMPT_STYLE_SKILL_ID],
]);

for (const [pathKey, mod] of Object.entries(rawModules)) {
  const parsed = parseFolderAndBase(pathKey.replace(/\\/g, '/'));
  if (!parsed) continue;
  const id = `${parsed.folder}/${parsed.base}`;
  const rec = normalizeSkill(
    mod.default ?? {},
    id,
    parsed.folder,
    `${parsed.base}.json`,
    pathKey.replace(/\\/g, '/'),
  );
  if (rec) {
    registry.set(id, rec);
    allSkills.push(rec);
  }
}

// The eight-dimensional option consumes a frozen v10 base card and returns only
// the replacement bodies for 【表演】 and 【时间轴】. The runtime splices those bodies
// deterministically, so every other v10 section remains byte-for-byte inherited.
const seedance25V10 = registry.get(SEEDANCE25_MULTIMODAL_PROMPT_V10_SKILL_ID);
const seedance25PerformanceV11 = registry.get(SEEDANCE25_PERFORMANCE_PROMPT_V11_SKILL_ID);
if (seedance25V10 && seedance25PerformanceV11) {
  seedance25PerformanceV11.system_instruction = [
    seedance25V10.system_instruction,
    '---',
    seedance25PerformanceV11.system_instruction,
  ].join('\n\n');
}

allSkills.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder.localeCompare(b.folder)));

function getVisibleSkills(): SkillFileRecord[] {
  return allSkills.filter((skill) => !HIDDEN_SKILL_IDS.has(skill.id));
}

function resolveSkillAlias(id: string): string {
  return SKILL_ID_ALIASES.get(id) ?? id;
}

/**
 * 扫描 `src/skills` 下 JSON，返回全部技能元数据（构建期打包进 bundle）。
 */
export function listAllSkills(): SkillFileRecord[] {
  return [...getVisibleSkills()];
}

/**
 * @param folder 相对 `src/skills` 的子目录；不传则返回全部。
 */
export function listSkillsInFolder(folder?: SkillFolder): SkillFileRecord[] {
  if (!folder) return listAllSkills();
  return getVisibleSkills().filter((s) => s.folder === folder);
}

/** 流水线节点可选技能：严格按节点部门目录分类，避免跨部门技能混入选择框。 */
export function listSkillsForPipelineKind(kind: 'writing' | 'storyboard' | 'prompt'): SkillFileRecord[] {
  return getVisibleSkills().filter((s) => s.folder === kind);
}

export function getSkillById(id: string): SkillFileRecord | undefined {
  return registry.get(resolveSkillAlias(id));
}

export function isSkillAllowedForPipelineKind(kind: PipelineKindForSkills, id: string | null | undefined): boolean {
  const rawId = typeof id === 'string' ? id.trim() : '';
  if (!rawId) return false;
  const resolvedId = resolveSkillAlias(rawId);
  return listSkillsForPipelineKind(kind).some((skill) => skill.id === resolvedId);
}

export function normalizeSkillIdForPipelineKind(
  kind: PipelineKindForSkills,
  id: string | null | undefined,
): string | undefined {
  const rawId = typeof id === 'string' ? id.trim() : '';
  if (!rawId) return undefined;
  const resolvedId = resolveSkillAlias(rawId);
  return isSkillAllowedForPipelineKind(kind, resolvedId) ? resolvedId : undefined;
}

export function normalizeFilmStoryboardSkillId(id: string | null | undefined): string {
  const fallback =
    normalizeSkillIdForPipelineKind('storyboard', DEFAULT_STORYBOARD_SKILL_ID) ??
    listSkillsForPipelineKind('storyboard')[0]?.id;
  return normalizeSkillIdForPipelineKind('storyboard', id) ?? fallback ?? DEFAULT_STORYBOARD_SKILL_ID;
}

export function normalizeFilmVideoPromptSkillId(id: string | null | undefined): string {
  const available = listSkillsInFolder('video_prompt');
  const rawId = typeof id === 'string' ? id.trim() : '';
  if (rawId && available.some((skill) => skill.id === rawId)) return rawId;
  if (available.some((skill) => skill.id === DEFAULT_VIDEO_PROMPT_SKILL_ID)) {
    return DEFAULT_VIDEO_PROMPT_SKILL_ID;
  }
  return available[0]?.id ?? DEFAULT_VIDEO_PROMPT_SKILL_ID;
}

function isPromptStyleSkillRecord(skill: SkillFileRecord | undefined): boolean {
  return skill?.folder === 'prompt' && skill.slot === 'style';
}

export function isPromptStyleSkillId(id: string): boolean {
  return isPromptStyleSkillRecord(registry.get(resolveSkillAlias(id)));
}

export function listPromptStyleSkills(): SkillFileRecord[] {
  return getVisibleSkills().filter(isPromptStyleSkillRecord);
}

function getDefaultPromptStyleSkillId(): string | undefined {
  if (registry.has(DEFAULT_PROMPT_STYLE_SKILL_ID)) return DEFAULT_PROMPT_STYLE_SKILL_ID;
  return allSkills.find(isPromptStyleSkillRecord)?.id;
}

/** 按节点上 `mounted_skills` 顺序拼接各技能的 system_instruction */
export function buildMountedSkillsInstructionBlock(orderedIds: string[]): string {
  if (!orderedIds.length) return '';
  const parts: string[] = [];
  for (const rawId of orderedIds) {
    const id = resolveSkillAlias(rawId);
    const s = registry.get(id);
    if (!s) continue;
    parts.push(`【${s.name} · v${s.version}】\n${s.system_instruction}`);
  }
  return parts.join('\n\n');
}

export type PipelineKindForSkills = 'writing' | 'storyboard' | 'prompt';

const FIXED_SKILLS_BY_KIND: Partial<Record<PipelineKindForSkills, readonly string[]>> = {};

export function getFixedSkillIdsForPipelineKind(kind: PipelineKindForSkills): string[] {
  const ids = FIXED_SKILLS_BY_KIND[kind] ?? [];
  return ids
    .map((id) => resolveSkillAlias(id))
    .filter((id) => registry.has(id));
}

export function normalizeMountedSkillIdsForKind(
  kind: PipelineKindForSkills,
  orderedSkillIds: string[],
): string[] {
  const allowed = new Set(listSkillsForPipelineKind(kind).map((s) => s.id));
  const fixed = getFixedSkillIdsForPipelineKind(kind);
  const requested = orderedSkillIds
    .map((raw) => (typeof raw === 'string' ? resolveSkillAlias(raw.trim()) : ''))
    .filter(Boolean);
  const source =
    kind === 'prompt'
      ? (() => {
          const styleIds = requested.filter(isPromptStyleSkillId);
          const selectedStyle = styleIds.length ? styleIds[styleIds.length - 1] : getDefaultPromptStyleSkillId();
          return [
            ...(selectedStyle ? [selectedStyle] : []),
            ...fixed,
            ...requested.filter((id) => !isPromptStyleSkillId(id)),
          ];
        })()
      : [...fixed, ...requested];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of source) {
    if (!id || seen.has(id) || !registry.has(id) || !allowed.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type MountedSkillsResolution = {
  /** 已注入 System Prompt 的全文（部门基底 + 挂载块） */
  systemPrompt: string;
  /** 实际参与拼接的技能 id（顺序与节点挂载一致） */
  resolvedIds: string[];
  /** 未在 bundle 中注册或与当前部门不允许的挂载 id */
  invalidIds: string[];
};

/**
 * 执行前解析挂载：仅保留在 `src/skills` 注册且允许挂到本部门的技能，再拼接各条 `system_instruction`。
 */
export function resolveAndComposeMountedSkills(
  kind: PipelineKindForSkills,
  baseDepartmentSystem: string,
  orderedSkillIds: string[],
): MountedSkillsResolution {
  const allowed = new Set(listSkillsForPipelineKind(kind).map((s) => s.id));
  const invalidIds: string[] = [];
  for (const raw of orderedSkillIds) {
    const rawId = typeof raw === 'string' ? raw.trim() : '';
    if (!rawId) continue;
    const id = resolveSkillAlias(rawId);
    if (!registry.has(id) || !allowed.has(id)) {
      invalidIds.push(rawId);
    }
  }
  const validIds = normalizeMountedSkillIdsForKind(kind, orderedSkillIds);
  const block = buildMountedSkillsInstructionBlock(validIds);
  const systemPrompt = block.trim()
    ? `${baseDepartmentSystem}\n\n--- 挂载技能（src/skills · 已解析 ${validIds.length} 项）---\n${block}`
    : baseDepartmentSystem;
  return { systemPrompt, resolvedIds: validIds, invalidIds };
}

/** 部门基础 system + 挂载片段（供 LLM 调用） */
export function composeExecutionSystemPrompt(baseDepartmentSystem: string, orderedSkillIds: string[]): string {
  const block = buildMountedSkillsInstructionBlock(orderedSkillIds);
  if (!block.trim()) return baseDepartmentSystem;
  return `${baseDepartmentSystem}\n\n--- 挂载技能 ---\n${block}`;
}

export function skillToDownloadPayload(skill: SkillFileRecord): Record<string, string> {
  const base: Record<string, string> = {
    name: skill.name,
    description: skill.description,
    version: skill.version,
    system_instruction: skill.system_instruction,
  };
  if (skill.slot) {
    base.slot = skill.slot;
  }
  if (skill.export_extensions?.length) {
    base.export_extensions = JSON.stringify(skill.export_extensions);
  }
  return base;
}
