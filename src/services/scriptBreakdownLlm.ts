import { invokeLlmJsonObject } from '@/services/llmJsonClient';
import type {
  ScriptCharacterBreakdown,
  ScriptCharactersOutput,
  ScriptConfidence,
  ScriptEvidenceRef,
  ScriptPackageOutput,
  ScriptPropBreakdown,
  ScriptPropsOutput,
  ScriptSceneBreakdown,
  ScriptScenesOutput,
} from '@/types/scriptBreakdown';

type JsonRecord = Record<string, unknown>;

const SCRIPT_PACKAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const scriptPackageCache = new Map<
  string,
  { output?: ScriptPackageOutput; promise?: Promise<ScriptPackageOutput>; ts: number }
>();

const SCRIPT_LLM_SYSTEM_PROMPT = [
  '你是影视工业级剧本拆解统筹系统，不是普通摘要助手。',
  '你的任务是直接依据剧本文本原文做结构化拆解，不要依赖或假设任何本地预处理结果。',
  '必须保留可执行的制片视角：场次、地点、内外景、时间、角色、道具、证据、待确认事项。',
  '显式信息优先；无法确认的内容不要编造，写入 warnings，并把 confidence 设为 low 或 medium。',
  '按剧本原有场次边界拆分；如果场次标题混杂多个时间/内外景标签，必须在 warnings 中说明。',
  '只输出合法 JSON 对象，不要 markdown，不要解释。',
].join('\n');

function scriptTextCacheKey(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${hash >>> 0}:${text.slice(0, 160)}:${text.slice(-160)}`;
}

function clonePackageOutput(output: ScriptPackageOutput): ScriptPackageOutput {
  return {
    ...output,
    createdAt: Date.now(),
    scenes: output.scenes.map((scene) => ({
      ...scene,
      characters: [...scene.characters],
      props: [...scene.props],
      warnings: [...scene.warnings],
    })),
    characters: output.characters.map((character) => ({
      ...character,
      aliases: [...character.aliases],
      sceneNos: [...character.sceneNos],
      actionHints: [...character.actionHints],
      evidence: character.evidence.map((item) => ({ ...item })),
      warnings: [...character.warnings],
    })),
    props: output.props.map((prop) => ({
      ...prop,
      sceneNos: [...prop.sceneNos],
      notes: [...prop.notes],
      evidence: prop.evidence.map((item) => ({ ...item })),
      warnings: [...prop.warnings],
    })),
    warnings: [...output.warnings],
    stats: { ...output.stats },
  };
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item)).filter(Boolean);
  }
  const text = stringValue(value);
  if (!text) return [];
  return text
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const parsed = Number.parseInt(stringValue(value), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function confidenceValue(value: unknown, fallback: ScriptConfidence = 'medium'): ScriptConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : fallback;
}

function interiorExteriorValue(value: unknown): ScriptSceneBreakdown['interiorExterior'] {
  const text = stringValue(value);
  if (/内外/.test(text)) return '内外景待确认';
  if (/外|EXT/i.test(text)) return '外景';
  if (/内|INT/i.test(text)) return '内景';
  return '内外景待确认';
}

function normalizeEvidence(value: unknown, fallbackSceneNo?: number): ScriptEvidenceRef[] {
  const items = asArray(value);
  const evidence: ScriptEvidenceRef[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (record) {
      const excerpt = stringValue(record.excerpt);
      if (!excerpt) continue;
      const sceneNo = numberValue(record.sceneNo, fallbackSceneNo ?? 0) || undefined;
      evidence.push(sceneNo ? { sceneNo, excerpt } : { excerpt });
      continue;
    }
    const excerpt = stringValue(item);
    if (excerpt) evidence.push(fallbackSceneNo ? { sceneNo: fallbackSceneNo, excerpt } : { excerpt });
  }
  return evidence;
}

function buildUserPrompt(scriptText: string): string {
  const sourceText =
    scriptText.length > 70_000
      ? `${scriptText.slice(0, 55_000)}\n\n[中段略，请依据前后文保持场次编号连续]\n\n${scriptText.slice(-15_000)}`
      : scriptText;
  return [
    '请直接分析下面的剧本文本，并返回完整结构化 JSON。',
    '',
    '【返回 JSON Schema】',
    JSON.stringify(
      {
        scenes: [
          {
            sceneNo: 1,
            title: '原场次标题或稳定标题',
            location: '主场景地点',
            interiorExterior: '内景|外景|内外景待确认',
            timeOfDay: '白天/夜晚/清晨/深夜/待确认等',
            characters: ['角色名'],
            props: ['关键道具'],
            summary: '本场可执行剧情摘要',
            sourceText: '本场原文或关键原文摘录',
            confidence: 'high|medium|low',
            warnings: ['待确认问题'],
          },
        ],
        characters: [
          {
            name: '角色名',
            aliases: ['别名'],
            firstSceneNo: 1,
            sceneNos: [1],
            actionHints: ['动作/关系/身份线索'],
            dialogueCount: 0,
            evidence: [{ sceneNo: 1, excerpt: '原文证据' }],
            confidence: 'high|medium|low',
            warnings: ['待确认问题'],
          },
        ],
        props: [
          {
            name: '道具名',
            category: '武器/生活道具/置景陈设/服化饰品/特效元素/交通工具/其他',
            sceneNos: [1],
            notes: ['用途或连续性说明'],
            evidence: [{ sceneNo: 1, excerpt: '原文证据' }],
            confidence: 'high|medium|low',
            warnings: ['待确认问题'],
          },
        ],
        warnings: ['全局待确认问题'],
      },
      null,
      2,
    ),
    '',
    '【硬性要求】',
    '1. 不要输出 schema 之外的字段。',
    '2. sceneNo 必须是数字，按剧本出现顺序递增。',
    '3. characters / props 只能使用剧本证据支持的内容；推断必须写入 warnings。',
    '4. sourceText 和 evidence.excerpt 尽量使用原文短摘录。',
    '5. 场景、角色、道具都必须基于原文证据；不要凭类型模板补造内容。',
    '',
    '【剧本文本】',
    sourceText,
  ].join('\n');
}

function normalizeScene(item: unknown, index: number, ruleScenes: ScriptSceneBreakdown[]): ScriptSceneBreakdown {
  const record = asRecord(item) ?? {};
  const fallback = ruleScenes[index] ?? ruleScenes.find((scene) => scene.sceneNo === numberValue(record.sceneNo, index + 1));
  const sceneNo = numberValue(record.sceneNo, fallback?.sceneNo ?? index + 1) || index + 1;
  const warnings = stringArray(record.warnings);
  return {
    id: `llm_scene_${sceneNo}`,
    sceneNo,
    title: stringValue(record.title, fallback?.title ?? `场${sceneNo}`),
    location: stringValue(record.location, fallback?.location ?? '地点待确认'),
    interiorExterior: interiorExteriorValue(record.interiorExterior ?? fallback?.interiorExterior),
    timeOfDay: stringValue(record.timeOfDay, fallback?.timeOfDay ?? '时间待确认'),
    characters: stringArray(record.characters).length ? stringArray(record.characters) : fallback?.characters ?? [],
    props: stringArray(record.props).length ? stringArray(record.props) : fallback?.props ?? [],
    summary: stringValue(record.summary, fallback?.summary ?? ''),
    sourceText: stringValue(record.sourceText, fallback?.sourceText ?? ''),
    confidence: confidenceValue(record.confidence, fallback?.confidence ?? 'medium'),
    warnings,
  };
}

function normalizeCharacter(
  item: unknown,
  index: number,
  ruleCharacters: ScriptCharacterBreakdown[],
): ScriptCharacterBreakdown {
  const record = asRecord(item) ?? {};
  const name = stringValue(record.name, ruleCharacters[index]?.name ?? `角色${index + 1}`);
  const fallback = ruleCharacters.find((character) => character.name === name) ?? ruleCharacters[index];
  const sceneNos = stringArray(record.sceneNos).map((value) => numberValue(value, 0)).filter(Boolean);
  const finalSceneNos = sceneNos.length ? sceneNos : fallback?.sceneNos ?? [];
  return {
    id: `llm_character_${name}`.replace(/\s+/g, '_'),
    name,
    aliases: stringArray(record.aliases),
    firstSceneNo: numberValue(record.firstSceneNo, fallback?.firstSceneNo ?? finalSceneNos[0] ?? 1),
    sceneNos: finalSceneNos,
    actionHints: stringArray(record.actionHints).length ? stringArray(record.actionHints) : fallback?.actionHints ?? [],
    dialogueCount: numberValue(record.dialogueCount, fallback?.dialogueCount ?? 0),
    evidence: normalizeEvidence(record.evidence, finalSceneNos[0]).length
      ? normalizeEvidence(record.evidence, finalSceneNos[0])
      : fallback?.evidence ?? [],
    confidence: confidenceValue(record.confidence, fallback?.confidence ?? 'medium'),
    warnings: stringArray(record.warnings),
  };
}

function normalizeProp(item: unknown, index: number, ruleProps: ScriptPropBreakdown[]): ScriptPropBreakdown {
  const record = asRecord(item) ?? {};
  const name = stringValue(record.name, ruleProps[index]?.name ?? `道具${index + 1}`);
  const fallback = ruleProps.find((prop) => prop.name === name) ?? ruleProps[index];
  const sceneNos = stringArray(record.sceneNos).map((value) => numberValue(value, 0)).filter(Boolean);
  const finalSceneNos = sceneNos.length ? sceneNos : fallback?.sceneNos ?? [];
  return {
    id: `llm_prop_${name}`.replace(/\s+/g, '_'),
    name,
    category: stringValue(record.category, fallback?.category ?? '其他'),
    sceneNos: finalSceneNos,
    notes: stringArray(record.notes).length ? stringArray(record.notes) : fallback?.notes ?? [],
    evidence: normalizeEvidence(record.evidence, finalSceneNos[0]).length
      ? normalizeEvidence(record.evidence, finalSceneNos[0])
      : fallback?.evidence ?? [],
    confidence: confidenceValue(record.confidence, fallback?.confidence ?? 'medium'),
    warnings: stringArray(record.warnings),
  };
}

function buildPackageFromModel(parsed: unknown, sourceLength: number, fallbackPackage?: ScriptPackageOutput): ScriptPackageOutput {
  const fallbackScenes = fallbackPackage?.scenes ?? [];
  const fallbackCharactersSource = fallbackPackage?.characters ?? [];
  const fallbackPropsSource = fallbackPackage?.props ?? [];
  const record = asRecord(parsed);
  if (!record) throw new Error('模型返回结构异常：根节点必须是 JSON 对象。');
  const scenes = asArray(record.scenes).map((item, index) => normalizeScene(item, index, fallbackScenes));
  if (scenes.length === 0) throw new Error('模型返回结构异常：scenes 为空。');
  const characters = asArray(record.characters).map((item, index) =>
    normalizeCharacter(item, index, fallbackCharactersSource),
  );
  const props = asArray(record.props).map((item, index) => normalizeProp(item, index, fallbackPropsSource));
  const fallbackCharacters = characters.length ? characters : fallbackCharactersSource;
  const fallbackProps = props.length ? props : fallbackPropsSource;
  const warnings = [
    ...stringArray(record.warnings),
    ...scenes.flatMap((scene) => scene.warnings),
    ...fallbackCharacters.flatMap((character) => character.warnings),
    ...fallbackProps.flatMap((prop) => prop.warnings),
  ];
  const uniqWarnings = [...new Set(warnings)];
  return {
    module: 'script_package',
    createdAt: Date.now(),
    scenes,
    characters: fallbackCharacters,
    props: fallbackProps,
    warnings: uniqWarnings,
    stats: {
      sourceLength,
      sceneCount: scenes.length,
      characterCount: fallbackCharacters.length,
      propCount: fallbackProps.length,
      warningCount: uniqWarnings.length,
    },
  };
}

export function splitScriptPackageOutput(
  output: ScriptPackageOutput,
  sourceNodeId?: string,
): {
  scenesOutput: ScriptScenesOutput;
  charactersOutput: ScriptCharactersOutput;
  propsOutput: ScriptPropsOutput;
} {
  return {
    scenesOutput: {
      module: 'script_scenes',
      createdAt: output.createdAt,
      sourceNodeId,
      scenes: output.scenes,
      warnings: [...new Set(output.scenes.flatMap((scene) => scene.warnings))],
      stats: {
        sourceLength: output.stats.sourceLength,
        sceneCount: output.scenes.length,
        warningCount: output.scenes.reduce((total, scene) => total + scene.warnings.length, 0),
      },
    },
    charactersOutput: {
      module: 'script_characters',
      createdAt: output.createdAt,
      sourceNodeId,
      characters: output.characters,
      warnings: [...new Set(output.characters.flatMap((character) => character.warnings))],
      stats: {
        sourceLength: output.stats.sourceLength,
        characterCount: output.characters.length,
        warningCount: output.characters.reduce((total, character) => total + character.warnings.length, 0),
      },
    },
    propsOutput: {
      module: 'script_props',
      createdAt: output.createdAt,
      sourceNodeId,
      props: output.props,
      warnings: [...new Set(output.props.flatMap((prop) => prop.warnings))],
      stats: {
        sourceLength: output.stats.sourceLength,
        propCount: output.props.length,
        warningCount: output.props.reduce((total, prop) => total + prop.warnings.length, 0),
      },
    },
  };
}

export async function analyzeScriptPackageWithLlm(params: { scriptText: string }): Promise<ScriptPackageOutput> {
  const key = scriptTextCacheKey(params.scriptText);
  const cached = scriptPackageCache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < SCRIPT_PACKAGE_CACHE_TTL_MS) {
    if (cached.output) return clonePackageOutput(cached.output);
    if (cached.promise) return clonePackageOutput(await cached.promise);
  }

  const promise = invokeLlmJsonObject({
    systemPrompt: SCRIPT_LLM_SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(params.scriptText),
    temperature: 0.15,
    feature: 'script-breakdown-analyze',
    preferProxy: true,
  }).then((parsed) => buildPackageFromModel(parsed, params.scriptText.length));

  scriptPackageCache.set(key, { promise, ts: now });
  try {
    const output = await promise;
    scriptPackageCache.set(key, { output: clonePackageOutput(output), ts: Date.now() });
    return clonePackageOutput(output);
  } catch (error) {
    const latest = scriptPackageCache.get(key);
    if (latest?.promise === promise) scriptPackageCache.delete(key);
    throw error;
  }
}
