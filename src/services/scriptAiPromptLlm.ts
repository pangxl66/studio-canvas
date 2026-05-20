import { invokeLlmJsonObject } from '@/services/llmJsonClient';
import { applyScriptAiPromptQuality } from '@/services/scriptBreakdownEngine';
import type {
  ScriptAiAssetKind,
  ScriptAiAssetPlatform,
  ScriptAiAssetsOutput,
  ScriptAiPromptAsset,
  ScriptBreakdownOutput,
  ScriptCharactersOutput,
  ScriptEvidenceRef,
  ScriptPropsOutput,
  ScriptScenesOutput,
} from '@/types/scriptBreakdown';

type JsonRecord = Record<string, unknown>;
type PromptTargetKind = 'scene_prompt' | 'character_prompt' | 'prop_prompt';

const AI_PROMPT_PLATFORMS: ScriptAiAssetPlatform[] = ['midjourney', 'gpt_image_2', 'nanobanana'];
const PROMPT_KIND_LABELS: Record<PromptTargetKind, string> = {
  scene_prompt: '场景',
  character_prompt: '角色',
  prop_prompt: '道具',
};

const SCRIPT_AI_PROMPT_SYSTEM = [
  '你是影视级 AI 概念设计 Prompt 总监，不是普通提示词模板助手。',
  '你必须基于输入的剧本拆解 JSON，为 Midjourney / GPT Image 2 / Nano Banana 生成可直接用于生图的影视概念设计提示词。',
  'Prompt 必须服务影视前期视觉开发：production design、concept design、visual development、空间、材质、光线、镜头、服装、道具、连续性。',
  '不要生成营销海报、片名字、字幕、UI、logo、水印、泛 AI 美图或空泛形容词堆叠。',
  '每条 Prompt 必须依据输入证据，不得编造未出现的角色、道具、时代或场景。',
  '只输出合法 JSON 对象，不要 markdown，不要解释。',
].join('\n');

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
  if (Array.isArray(value)) return value.map((item) => stringValue(item)).filter(Boolean);
  const text = stringValue(value);
  if (!text) return [];
  return text
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const parsed = Number.parseInt(stringValue(value), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

function normalizePlatform(value: unknown, fallback: ScriptAiAssetPlatform): ScriptAiAssetPlatform {
  const text = stringValue(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (text === 'midjourney' || text === 'mj') return 'midjourney';
  if (text === 'gpt_image_2' || text === 'gpt_image2' || text === 'gpt-image-2') return 'gpt_image_2';
  if (text === 'nanobanana' || text === 'nano_banana' || text === 'nano-banana') return 'nanobanana';
  return fallback;
}

function normalizePromptKind(value: unknown, fallback: PromptTargetKind): PromptTargetKind {
  const text = stringValue(value).toLowerCase();
  if (text === 'scene_prompt') return 'scene_prompt';
  if (text === 'character_prompt') return 'character_prompt';
  if (text === 'prop_prompt') return 'prop_prompt';
  return fallback;
}

function normalizeEvidence(value: unknown, fallback: ScriptEvidenceRef[]): ScriptEvidenceRef[] {
  const records = asArray(value)
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        const excerpt = stringValue(item);
        return excerpt ? { excerpt } : null;
      }
      const excerpt = stringValue(record.excerpt);
      if (!excerpt) return null;
      const sceneNo = numberValue(record.sceneNo);
      return sceneNo ? { sceneNo, excerpt } : { excerpt };
    })
    .filter((item): item is ScriptEvidenceRef => Boolean(item));
  return records.length ? records : fallback;
}

function platformLabel(platform: ScriptAiAssetPlatform): string {
  if (platform === 'midjourney') return 'Midjourney';
  if (platform === 'gpt_image_2') return 'GPT Image 2';
  return 'Nano Banana';
}

function platformParameters(platform: ScriptAiAssetPlatform, kind: ScriptAiAssetKind): string[] {
  const aspect = kind === 'character_prompt' ? '3:4' : kind === 'prop_prompt' ? '4:3' : '16:9';
  if (platform === 'midjourney') {
    return [
      `--ar ${aspect}`,
      '--raw',
      kind === 'character_prompt' || kind === 'prop_prompt' ? '--s 80' : '--s 120',
      '--c 5',
      '--no text, watermark, logo, extra fingers, distorted anatomy',
    ];
  }
  if (platform === 'gpt_image_2') {
    return [
      'model=gpt-image-2',
      kind === 'character_prompt' ? 'size=1024x1536' : kind === 'prop_prompt' ? 'size=1536x1152' : 'size=1536x1024',
      'quality=high',
      'output_format=png',
      'background=opaque',
    ];
  }
  return [
    'model=gemini-3.1-flash-image-preview',
    `response_format.image.aspect_ratio=${aspect}`,
    'response_format.image.image_size=2K',
    'response_modalities=["Image"]',
    'preserve continuity when references are provided',
  ];
}

function negativePromptForPlatform(platform: ScriptAiAssetPlatform): string {
  const common = 'low quality, blurry, distorted anatomy, inconsistent face, extra limbs, unreadable text, watermark, logo';
  if (platform === 'midjourney') return `Use --no for: ${common}, flat lighting, plastic skin`;
  if (platform === 'gpt_image_2') return `${common}, captions, UI overlay, poster typography, fake credits`;
  return `${common}, captions, UI overlay, broken continuity, altered character identity`;
}

type PromptTarget = {
  targetId: string;
  kind: PromptTargetKind;
  title: string;
  sceneNo?: number;
  characterName?: string;
  evidence: ScriptEvidenceRef[];
  payload: JsonRecord;
};

function sceneTargets(output: ScriptScenesOutput): PromptTarget[] {
  return output.scenes.map((scene) => ({
    targetId: `scene:${scene.sceneNo}`,
    kind: 'scene_prompt',
    title: `场${scene.sceneNo} ${scene.location}`,
    sceneNo: scene.sceneNo,
    evidence: [{ sceneNo: scene.sceneNo, excerpt: scene.sourceText || scene.summary }],
    payload: {
      sceneNo: scene.sceneNo,
      title: scene.title,
      location: scene.location,
      interiorExterior: scene.interiorExterior,
      timeOfDay: scene.timeOfDay,
      characters: scene.characters,
      props: scene.props,
      summary: scene.summary,
      sourceText: scene.sourceText,
      warnings: scene.warnings,
    },
  }));
}

function characterTargets(output: ScriptCharactersOutput): PromptTarget[] {
  return output.characters.map((character) => ({
    targetId: `character:${character.name}`,
    kind: 'character_prompt',
    title: character.name,
    characterName: character.name,
    evidence: character.evidence,
    payload: {
      name: character.name,
      aliases: character.aliases,
      firstSceneNo: character.firstSceneNo,
      sceneNos: character.sceneNos,
      actionHints: character.actionHints,
      dialogueCount: character.dialogueCount,
      evidence: character.evidence,
      warnings: character.warnings,
    },
  }));
}

function propTargets(output: ScriptPropsOutput): PromptTarget[] {
  return output.props.map((prop) => ({
    targetId: `prop:${prop.name}`,
    kind: 'prop_prompt',
    title: prop.name,
    evidence: prop.evidence,
    payload: {
      name: prop.name,
      category: prop.category,
      sceneNos: prop.sceneNos,
      notes: prop.notes,
      evidence: prop.evidence,
      warnings: prop.warnings,
    },
  }));
}

function targetsFromOutputs(outputs: ScriptBreakdownOutput[], promptKind?: PromptTargetKind): PromptTarget[] {
  const targets: PromptTarget[] = [];
  for (const output of outputs) {
    if (output.module === 'script_scenes' || output.module === 'script_package') {
      if (!promptKind || promptKind === 'scene_prompt') {
        targets.push(...sceneTargets({ ...output, module: 'script_scenes' }));
      }
    }
    if (output.module === 'script_characters' || output.module === 'script_package') {
      if (!promptKind || promptKind === 'character_prompt') {
        targets.push(...characterTargets({ ...output, module: 'script_characters' }));
      }
    }
    if (output.module === 'script_props' || output.module === 'script_package') {
      if (!promptKind || promptKind === 'prop_prompt') {
        targets.push(...propTargets({ ...output, module: 'script_props' }));
      }
    }
  }
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.kind}:${target.targetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildPromptUserPrompt(targets: PromptTarget[], promptKind?: PromptTargetKind): string {
  const kindLabel = promptKind ? PROMPT_KIND_LABELS[promptKind] : '场景/角色/道具';
  return [
    `请为以下${kindLabel}拆解结果生成 AI 生图 Prompt。`,
    '',
    '【平台要求】',
    '1. 每个 target 必须分别生成 Midjourney、GPT Image 2、Nano Banana 三条 Prompt。',
    '2. Midjourney：单行 prompt，包含 --ar、--raw、--s、--c、--no；不得混入 model= 参数。',
    '3. GPT Image 2：完整自然语言指令，参数放入 parameters，必须包含 model=gpt-image-2；不得混入 Midjourney 参数。',
    '4. Nano Banana：中文或中英混合的完整自然语言画面描述，强调参考图/连续性保持；参数必须包含 gemini-3.1-flash-image-preview。',
    '5. 所有 Prompt 都必须是影视级概念设计，不是海报、不是普通插画、不是泛 AI 美图。',
    '',
    '【返回 JSON Schema】',
    JSON.stringify(
      {
        assets: [
          {
            targetId: '必须等于输入 targetId',
            kind: promptKind ?? 'scene_prompt|character_prompt|prop_prompt',
            platform: 'midjourney|gpt_image_2|nanobanana',
            title: '中文标题',
            prompt: '可直接复制使用的完整 Prompt',
            negativePrompt: '负面提示词或排除说明',
            usage: '用途说明',
            sceneNo: 1,
            characterName: '角色名，仅角色提示词使用',
            parameters: ['平台参数'],
            evidence: [{ sceneNo: 1, excerpt: '输入证据摘录' }],
            warnings: ['需要人工确认的问题'],
          },
        ],
        summary: '生成摘要',
        warnings: ['全局待确认问题'],
      },
      null,
      2,
    ),
    '',
    '【输入 targets】',
    JSON.stringify(targets, null, 2),
  ].join('\n');
}

function targetFallback(targets: PromptTarget[], targetId: string, kind: PromptTargetKind): PromptTarget | undefined {
  return targets.find((target) => target.targetId === targetId && target.kind === kind) ?? targets.find((target) => target.kind === kind);
}

function normalizeAsset(
  value: unknown,
  index: number,
  targets: PromptTarget[],
  fallbackKind: PromptTargetKind,
): ScriptAiPromptAsset | null {
  const record = asRecord(value);
  if (!record) return null;
  const kind = normalizePromptKind(record.kind, fallbackKind);
  const platform = normalizePlatform(record.platform, AI_PROMPT_PLATFORMS[index % AI_PROMPT_PLATFORMS.length]);
  const targetId = stringValue(record.targetId);
  const target = targetFallback(targets, targetId, kind);
  const sceneNo = numberValue(record.sceneNo) ?? target?.sceneNo;
  const characterName = stringValue(record.characterName, target?.characterName ?? '');
  const title = stringValue(record.title, target ? `${target.title} · ${platformLabel(platform)} 概念设计` : `${platformLabel(platform)} 概念设计`);
  const prompt = stringValue(record.prompt);
  if (!prompt) return null;
  const warnings = stringArray(record.warnings);
  const asset: ScriptAiPromptAsset = {
    id: `llm_ai_asset_${kind}_${platform}_${targetId || index}`.replace(/[^\w\u4e00-\u9fa5-]+/g, '_'),
    kind,
    platform,
    title,
    prompt,
    negativePrompt: stringValue(record.negativePrompt, negativePromptForPlatform(platform)),
    usage: stringValue(record.usage, `${platformLabel(platform)} 生图 / 影视级概念设计`),
    sceneNo,
    characterName: characterName || undefined,
    parameters: stringArray(record.parameters).length ? stringArray(record.parameters) : platformParameters(platform, kind),
    evidence: normalizeEvidence(record.evidence, target?.evidence ?? []),
    warnings,
    status: warnings.length ? 'needs_revision' : 'needs_review',
  };
  return applyScriptAiPromptQuality(asset);
}

function normalizeAiPromptOutput(raw: unknown, targets: PromptTarget[], fallbackKind: PromptTargetKind): ScriptAiAssetsOutput {
  const record = asRecord(raw);
  if (!record) throw new Error('AI 提示词生成返回异常：必须是 JSON 对象。');
  const assets = asArray(record.assets)
    .map((item, index) => normalizeAsset(item, index, targets, fallbackKind))
    .filter((item): item is ScriptAiPromptAsset => Boolean(item));

  if (assets.length === 0) {
    throw new Error('AI 提示词生成返回异常：没有有效 assets。');
  }

  const missingWarnings: string[] = [];
  for (const target of targets) {
    for (const platform of AI_PROMPT_PLATFORMS) {
      const looseHit = assets.some((asset) => {
        if (asset.kind !== target.kind || asset.platform !== platform) return false;
        if (target.sceneNo && asset.sceneNo === target.sceneNo) return true;
        if (target.characterName && asset.characterName === target.characterName) return true;
        return asset.title.includes(target.title);
      });
      if (!looseHit) missingWarnings.push(`${target.title} 缺少 ${platformLabel(platform)} 提示词。`);
    }
  }

  const qualityIssueCount = assets.reduce((total, asset) => total + (asset.qualityIssues?.length ?? 0), 0);
  const warnings = [
    ...new Set([
      ...stringArray(record.warnings),
      ...missingWarnings,
      ...assets.flatMap((asset) => [...asset.warnings, ...(asset.qualityIssues ?? [])]),
    ]),
  ];
  const scenePromptCount = assets.filter((asset) => asset.kind === 'scene_prompt').length;
  const characterPromptCount = assets.filter((asset) => asset.kind === 'character_prompt').length;
  const propPromptCount = assets.filter((asset) => asset.kind === 'prop_prompt').length;
  const cinematicPromptCount = assets.filter((asset) => asset.kind === 'cinematic_prompt').length;
  const platformCount = AI_PROMPT_PLATFORMS.filter((platform) => assets.some((asset) => asset.platform === platform)).length;

  return {
    module: 'script_ai_assets',
    createdAt: Date.now(),
    assets,
    summary:
      stringValue(record.summary) ||
      `LLM 已生成 ${assets.length} 条影视级 AI 提示词，覆盖 ${platformCount} 个平台，质检${qualityIssueCount ? `发现 ${qualityIssueCount} 个问题` : '通过'}。`,
    warnings,
    stats: {
      sourceLength: JSON.stringify(targets).length,
      assetCount: assets.length,
      scenePromptCount,
      characterPromptCount,
      propPromptCount,
      cinematicPromptCount,
      platformCount,
      qualityIssueCount,
      warningCount: warnings.length,
    },
  };
}

export async function generateScriptAiPromptsWithLlm(params: {
  outputs: ScriptBreakdownOutput[];
  promptKind?: PromptTargetKind;
}): Promise<ScriptAiAssetsOutput> {
  const targets = targetsFromOutputs(params.outputs, params.promptKind);
  if (targets.length === 0) {
    throw new Error('没有可生成提示词的场景、角色或道具结果。');
  }
  const fallbackKind = params.promptKind ?? targets[0]?.kind ?? 'scene_prompt';
  const raw = await invokeLlmJsonObject({
    systemPrompt: SCRIPT_AI_PROMPT_SYSTEM,
    userPrompt: buildPromptUserPrompt(targets, params.promptKind),
    temperature: 0.55,
    feature: 'script-ai-prompts',
    preferProxy: true,
  });
  return normalizeAiPromptOutput(raw, targets, fallbackKind);
}
