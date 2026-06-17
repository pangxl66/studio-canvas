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

function buildStructuredInstruction(mod: SkillJson): string {
  const blocks: string[] = [];
  const base =
    typeof mod.system_instruction === 'string' ? mod.system_instruction.trim() : '';
  if (base) blocks.push(base);

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
  const m = norm.match(/skills\/(writing|storyboard|prompt)\/([^/]+)\.json$/i);
  if (!m) return null;
  const folder = m[1].toLowerCase() as SkillFolder;
  const base = m[2];
  return { folder, base };
}

function normalizeSkill(mod: SkillJson, id: string, folder: SkillFolder, fileName: string): SkillFileRecord | null {
  const name = typeof mod.name === 'string' ? mod.name.trim() : '';
  const description = typeof mod.description === 'string' ? mod.description.trim() : '';
  const version = typeof mod.version === 'string' ? mod.version.trim() : '';
  const system_instruction = buildStructuredInstruction(mod);
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

export const DEFAULT_PROMPT_STYLE_SKILL_ID = 'prompt/studio_canvas_prompt_spec_v1';
export const DEFAULT_STORYBOARD_SKILL_ID = 'storyboard/xuke_storyboard_v1';

const registry = new Map<string, SkillFileRecord>();
const allSkills: SkillFileRecord[] = [];
const HIDDEN_SKILL_IDS = new Set<string>([
  'prompt/storyboard-to-sd20-prompt',
  'prompt/storyboard_prompt_translator_v1',
  'prompt/jimeng_prompt_generator_v1',
  'prompt/seedance2_segmented_prompt_v1',
]);
const SKILL_ID_ALIASES = new Map<string, string>([
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
  const rec = normalizeSkill(mod.default ?? {}, id, parsed.folder, `${parsed.base}.json`);
  if (rec) {
    registry.set(id, rec);
    allSkills.push(rec);
  }
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
