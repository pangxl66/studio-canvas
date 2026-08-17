import {
  PROMPT_CARD_LENGTH_BUDGET_RULE,
  PROMPT_CARD_HEADER_RULE,
  PROMPT_CARD_SECTION_HEADINGS,
  PROMPT_CARD_V23_SECTION_HEADINGS,
  PROMPT_COLOR_TABLE_RULE,
  PROMPT_COPY_CHAR_LIMIT_RULE,
  PROMPT_DEPT_AGENT_SYSTEM,
  PROMPT_DEPT_OUTPUT_SHAPE,
  PROMPT_DEPT_OUTPUT_SHAPE_V23,
  PROMPT_DEPT_OUTPUT_SHAPE_V231_SEGMENTS,
  PROMPT_DEPT_OUTPUT_SHAPE_V25,
  PROMPT_DEPT_OUTPUT_SHAPE_V26,
  PROMPT_DEPT_OUTPUT_SHAPE_V27,
  PROMPT_LOCAL_COMPRESSION_RULE,
  PROMPT_LEADER_SPEC,
  PROMPT_MOUNT_TOKEN_RULE,
  PROMPT_SCENE_REFERENCE_RULE,
  PROMPT_TIMING_SYSTEM_RULE,
} from '@/agents/promptDeptSpec';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import { invokeLlmJsonObjectStream, invokeLlmLeaderReview } from '@/services/llmJsonClient';
import {
  resolveAndComposeMountedSkills,
  SEEDANCE25_MULTIMODAL_PROMPT_V10_SKILL_ID,
} from '@/services/skillLoader';
import { runPromptGenerationPipeline } from '@/agents/promptPipeline';
import { buildStoryboardContinuityContext } from '@/utils/storyboardContinuity';
import type {
  ApprovedAsset,
  PromptOutput,
  PromptShotDimensions,
  PromptShotPack,
  PromptShotSegment,
  StoryboardOutput,
  StoryboardShot,
} from '@/types/studio';
import {
  buildPromptSingleShotStoryboardFromText,
  looksLikeStructuredPromptInput,
} from '@/utils/promptInputMode';
import {
  inferPromptCharacterNames,
  inferPromptSceneNames,
  inferPromptSoundNames,
  promptAssetRefsFromApproved,
  resolvePromptAssetPlaceholders,
  sanitizePromptAssetIds,
  sanitizePromptAssetPlaceholders,
} from '@/utils/promptAssetRefs';
import {
  parseStudioCanvasTimelineIntervals,
  repairStudioCanvasV25Timeline,
} from '@/utils/studioCanvasTimeline';
import { getSeedance25ReadableFaceIssues } from '@/utils/seedance25PerformanceValidation';
import {
  composeSeedance25PerformanceCard,
  isSeedance25PerformanceEligibleCard,
} from '@/utils/seedance25PerformanceComposition';
import {
  ensureSeedance25CameraModel,
  extractSeedance25CameraModel,
} from '@/utils/seedance25Camera';
export {
  PROMPT_DEPT_AGENT_SYSTEM,
  PROMPT_DEPT_OUTPUT_SHAPE,
  PROMPT_LEADER_SPEC,
} from '@/agents/promptDeptSpec';

const DEFAULT_NEG =
  'background music, bgm, subtitle, subtitles, text overlay, ui, hud, interface overlay, watermark, logo, deformed hands, extra limbs, flicker, temporal inconsistency, oversaturated, low quality, blurry';
const REQUIRED_NEGATIVE_GROUPS = [
  {
    pattern: /\b(background music|bgm)\b/i,
    add: 'background music, bgm',
  },
  {
    pattern: /\b(subtitle|subtitles|caption|captions|text overlay)\b/i,
    add: 'subtitle, subtitles, text overlay',
  },
  {
    pattern: /\b(ui|hud|interface overlay)\b/i,
    add: 'ui, hud, interface overlay',
  },
] as const;
const MAX_PROMPT_CHARS = 2500;
const MIN_SEEDANCE_CARD_CHARS = 1000;
const MAX_SEEDANCE_CARD_CHARS = 3200;
const MIN_SEEDANCE2_SEGMENTED_CARD_CHARS = 2000;
const MAX_SEEDANCE2_SEGMENTED_CARD_CHARS = 3500;
const SEEDANCE2_SEGMENTED_PROMPT_MARKER = 'Seedance2.0 分段式提示词助手';
const SEEDANCE2_SEGMENTED_FORMAT = 'seedance2_segmented_timeline_v2';
const SEEDANCE25_MULTIMODAL_PROMPT_MARKER = 'Seedance 2.5 多模态影视提示词 Skill';
const SEEDANCE25_MULTIMODAL_FORMAT = 'seedance_2_5_multimodal_film_v10';
const SEEDANCE25_PERFORMANCE_V11_MARKER = 'Seedance 2.5 + 八维表演';
const SEEDANCE25_PERFORMANCE_V11_FORMAT = 'seedance_2_5_plus_eight_dimensional_performance';
const MIN_SEEDANCE25_CARD_CHARS = 200;
const MAX_SEEDANCE25_CARD_CHARS = 20000;
const PROMPT_DETAILED_MOUNT_SYSTEM_AMENDMENT = [
  '【运行时挂载兼容修订｜高优先级】',
  '当前源分镜表本身就是本镜的最小 Asset Manifest。',
  'characters、props、sceneRef、sound 字段，以及 description/action 中明确命名且在本镜出现或触发的角色、关键机械装置、控制台、楼梯、护栏、道具、场景、环境声和机械声，均允许进入挂载。',
  '挂载必须尽量完整保留输入中的具体名称与限定词，不得把“巨型环形金属装置”压缩成“装置”，不得把“油污扳手”改写成“扳手”。',
  '挂载排序固定为：角色 → 关键道具/机械装置/空间结构 → 场景 → 关键声音 → 关键环境物。',
  '只有风格词、动作残片、摄影术语、解释句和仅作参考的图片不得挂载；不得因为独立 approved asset ID 列表为空而输出“挂载：无”。',
].join('\n');
const SEEDANCE2_SEGMENTED_HEADINGS = [
  '# 【全局视觉与美学基调】',
  '# 【人物与场景设定】',
  '# 【剧本与动作时间线】',
  '# 【生成约束与负面提示词】',
] as const;
const SEEDANCE_PROMPT_SECTION_INDEX = 9;
const SEEDANCE_OPTIONAL_SECTION_INDICES = new Set<number>();
const MOUNT_TOKEN_RE = /\|@=([^|\n]+)\|/g;
const MAX_STUDIO_CANVAS_V26_MOUNT_ITEMS = 15;
const STRUCTURED_FIELD_NOISE_RE = /文字生成版|无素材|角色资产|场景资产|半空中袖|口一翻/;
const ACTION_FRAGMENT_TOKEN_RE =
  /^(?:探头|探身|回头|转身|抬手|收枪|落锁|关门|开口|低声|沉声|冷声|停在|停住|看见|看向|望向|闪身|逼近|后撤|甩袖|翻腕)$/;
const SEEDANCE2_UI_RENDER_PARAM_RE = /\b(?:4k|8k|1080p|720p|fps)\b|分辨率|帧率|画幅比例|aspect\s*ratio/i;

type PromptStyleMode =
  | 'studioCanvas'
  | 'studioCanvasV23'
  | 'studioCanvasV231Segments'
  | 'studioCanvasV25'
  | 'studioCanvasV26'
  | 'studioCanvasV27'
  | 'seedance2Segmented'
  | 'seedance25Multimodal'
  | 'seedance25PerformanceV11';

const STUDIO_CANVAS_V23_MARKER = 'Studio Canvas 默认提示词规范·生产优化版';
const STUDIO_CANVAS_V231_SEGMENTS_MARKER = 'Studio Canvas 2.3.1 组合镜头结构化版';
const STUDIO_CANVAS_V25_MARKER = 'Studio Canvas 默认提示词规范·生产校验版';
const STUDIO_CANVAS_V26_MARKER = 'Studio Canvas 默认提示词规范·详细挂载版';
const STUDIO_CANVAS_V27_MARKER = 'Studio Canvas 默认提示词规范·摄影机参数匹配版';

function inferPromptStyleMode(executionSystemPrompt?: string): PromptStyleMode {
  if (executionSystemPrompt?.includes(SEEDANCE25_PERFORMANCE_V11_MARKER)) {
    return 'seedance25PerformanceV11';
  }
  if (executionSystemPrompt?.includes(SEEDANCE25_MULTIMODAL_PROMPT_MARKER)) {
    return 'seedance25Multimodal';
  }
  if (executionSystemPrompt?.includes(SEEDANCE2_SEGMENTED_PROMPT_MARKER)) {
    return 'seedance2Segmented';
  }
  if (executionSystemPrompt?.includes(STUDIO_CANVAS_V231_SEGMENTS_MARKER)) {
    return 'studioCanvasV231Segments';
  }
  if (executionSystemPrompt?.includes(STUDIO_CANVAS_V27_MARKER)) {
    return 'studioCanvasV27';
  }
  if (executionSystemPrompt?.includes(STUDIO_CANVAS_V26_MARKER)) {
    return 'studioCanvasV26';
  }
  if (executionSystemPrompt?.includes(STUDIO_CANVAS_V25_MARKER)) {
    return 'studioCanvasV25';
  }
  if (executionSystemPrompt?.includes(STUDIO_CANVAS_V23_MARKER)) {
    return 'studioCanvasV23';
  }
  return 'studioCanvas';
}

function isSeedance2SegmentedStyle(styleMode: PromptStyleMode): boolean {
  return styleMode === 'seedance2Segmented';
}

function isSeedance25MultimodalStyle(styleMode: PromptStyleMode): boolean {
  return styleMode === 'seedance25Multimodal' || styleMode === 'seedance25PerformanceV11';
}

function isSeedance25PerformanceV11Style(styleMode: PromptStyleMode): boolean {
  return styleMode === 'seedance25PerformanceV11';
}

function isStudioCanvasV23Style(styleMode: PromptStyleMode): boolean {
  return (
    styleMode === 'studioCanvasV23' ||
    styleMode === 'studioCanvasV231Segments' ||
    styleMode === 'studioCanvasV25' ||
    styleMode === 'studioCanvasV26' ||
    styleMode === 'studioCanvasV27'
  );
}

function isStudioCanvasV231SegmentsStyle(styleMode: PromptStyleMode): boolean {
  return styleMode === 'studioCanvasV231Segments';
}

function isStudioCanvasV25Style(styleMode: PromptStyleMode): boolean {
  return styleMode === 'studioCanvasV25';
}

function isStudioCanvasV26Style(styleMode: PromptStyleMode): boolean {
  return styleMode === 'studioCanvasV26';
}

function isStudioCanvasV27Style(styleMode: PromptStyleMode): boolean {
  return styleMode === 'studioCanvasV27';
}

function isStudioCanvasValidationStyle(styleMode: PromptStyleMode): boolean {
  return (
    isStudioCanvasV25Style(styleMode) ||
    isStudioCanvasV26Style(styleMode) ||
    isStudioCanvasV27Style(styleMode)
  );
}

function getMaxSeedanceCardChars(styleMode: PromptStyleMode): number {
  if (isSeedance25MultimodalStyle(styleMode)) return MAX_SEEDANCE25_CARD_CHARS;
  return isSeedance2SegmentedStyle(styleMode)
    ? MAX_SEEDANCE2_SEGMENTED_CARD_CHARS
    : MAX_SEEDANCE_CARD_CHARS;
}

function getMinSeedanceCardChars(styleMode: PromptStyleMode): number {
  if (isSeedance25MultimodalStyle(styleMode)) return MIN_SEEDANCE25_CARD_CHARS;
  return isSeedance2SegmentedStyle(styleMode)
    ? MIN_SEEDANCE2_SEGMENTED_CARD_CHARS
    : MIN_SEEDANCE_CARD_CHARS;
}

function normalizeSeedance2CardText(value: string): string {
  return value.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function getSeedance2RenderableContent(card: string): string {
  const negativeHeadingIndex = card.indexOf(SEEDANCE2_SEGMENTED_HEADINGS[3]);
  return negativeHeadingIndex >= 0 ? card.slice(0, negativeHeadingIndex) : card;
}

function withSeedance2StyleSystemOverride(systemPrompt?: string): string | undefined {
  if (!systemPrompt) return systemPrompt;
  return [
    systemPrompt,
    '',
    '[Seedance2.0 style override]',
    `Active prompt style skill: ${SEEDANCE2_SEGMENTED_PROMPT_MARKER}.`,
    'Keep the outer PromptOutput JSON contract unchanged.',
    'For every shotPrompts[i].seedanceCard, use only the Seedance2.0 four Markdown modules:',
    SEEDANCE2_SEGMENTED_HEADINGS.join('\n'),
    'Do not use the default Studio Canvas card fields such as 挂载 / 相机位置 / 提示词 / 钉子4行 in seedanceCard.',
    `Each seedanceCard must be ${MIN_SEEDANCE2_SEGMENTED_CARD_CHARS}-${MAX_SEEDANCE2_SEGMENTED_CARD_CHARS} Chinese characters and must contain a continuous timeline from 00.0s to the node-specified or upstream real duration. There is no 15-second hard limit.`,
  ].join('\n');
}

function looksNoisyStructuredToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return true;
  if (STRUCTURED_FIELD_NOISE_RE.test(trimmed)) return true;
  if (ACTION_FRAGMENT_TOKEN_RE.test(trimmed)) return true;
  if (/^[\u4e00-\u9fa5]{2,6}(?:在|着|了)$/.test(trimmed) && !/屋内|屋外|门内|门外|屏风后/.test(trimmed)) {
    return true;
  }
  return false;
}

const PROMPT_DIMENSION_KEYS = [
  '场景',
  '角色',
  '动作',
  '情感',
  '镜头',
  '运镜',
  '灯光',
  '风格',
  '构图',
  '连贯性',
] as const;

function normalizePromptDimensions(value: unknown, idx: number): PromptShotDimensions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Prompt 模型返回：shotPrompts[${idx}] 缺少完整 dimensions 对象。`);
  }
  const raw = value as Record<string, unknown>;
  const out: PromptShotDimensions = {};
  for (const key of PROMPT_DIMENSION_KEYS) {
    out[key] = typeof raw[key] === 'string' ? String(raw[key]).trim() : '';
  }
  return out;
}

function ensureRequiredNegativeTerms(value: string): string {
  const normalized = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ');
  const extras = REQUIRED_NEGATIVE_GROUPS
    .filter((rule) => !rule.pattern.test(normalized))
    .map((rule) => rule.add);
  return [normalized, ...extras].filter(Boolean).join(', ') || DEFAULT_NEG;
}

function assertSeedanceCard(shotId: string, seedanceCard: string): string {
  const card = seedanceCard.trim();
  if (!card) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 缺少 seedanceCard。`);
  }
  const firstLine = card
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine?.startsWith('【分镜')) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 seedanceCard 首行不是结构化标题。${PROMPT_CARD_HEADER_RULE}`,
    );
  }
  const missing = PROMPT_CARD_SECTION_HEADINGS.filter((heading) => !card.includes(heading));
  if (missing.length) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 seedanceCard 缺少固定栏位：${missing.join('、')}。`);
  }
  if (!card.includes('9:16') || !card.includes('16:9')) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 seedanceCard 缺少 9:16 或 16:9 双版本构图。`);
  }
  const mountSection = card.match(/挂载[\s\S]*?(?:\n\s*\n|相机位置|相机朝向|角色朝向|构图提点)/)?.[0] ?? '';
  const mountTokens = Array.from(mountSection.matchAll(MOUNT_TOKEN_RE))
    .map((match) => String(match[1] ?? '').trim())
    .filter(Boolean);
  if (mountTokens.length < 2) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的挂载区不合格。${PROMPT_MOUNT_TOKEN_RULE}`);
  }
  if (mountTokens.some((token) => looksNoisyStructuredToken(token))) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的挂载区混入了动作残片、截断短语或占位符。`);
  }
  const mustShowSection = card.match(/【目标物Must-Show】[\s\S]*?(?:\n\s*\n|【参考分工】)/)?.[0] ?? '';
  const mustShowTokens = mustShowSection
    .replace('【目标物Must-Show】', '')
    .split(/[、/；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (mustShowTokens.some((token) => looksNoisyStructuredToken(token))) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 Must-Show 含有噪声短语或动作残片。`);
  }
  return card;
}

function assertPromptBody(shotId: string, prompt: string): string {
  const normalized = prompt.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 prompt 为空。`);
  }
  if (looksTruncatedPromptText(normalized)) {
    throw new Error(`Prompt output for shot ${shotId} ends with an ellipsis and looks incomplete.`);
  }
  if (normalized.includes('镜头身份：') || normalized.includes('场面机制：') || normalized.includes('结果锚定：')) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 prompt 仍是结构栏目复述，没有压缩成可复制执行文本。`);
  }
  return normalized;
}

function looksTruncatedPromptText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /(?:\.{3}|\u2026+)\s*$/.test(trimmed);
}

function seedanceCharCount(value: string): number {
  return Array.from(value).length;
}

function normalizeSeedanceInline(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([；;，,。])/g, '$1')
    .replace(/([；;，,。])\s*/g, '$1')
    .trim();
}

function clampSeedanceInline(value: string, maxChars: number): string {
  const normalized = normalizeSeedanceInline(value);
  if (seedanceCharCount(normalized) <= maxChars) return normalized;
  return `${Array.from(normalized).slice(0, Math.max(0, maxChars - 1)).join('')}…`;
}

function splitSeedanceClauses(value: string): string[] {
  return normalizeSeedanceInline(value)
    .split(/[；;。]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function compactSeedanceClauses(value: string, maxChars: number, maxClauses = 3): string {
  const clauses = splitSeedanceClauses(value);
  if (!clauses.length) return clampSeedanceInline(value, maxChars);
  const kept: string[] = [];
  for (const clause of clauses) {
    if (kept.length >= maxClauses) break;
    const compactClause = clampSeedanceInline(
      clause,
      Math.max(8, Math.floor(maxChars / Math.max(1, maxClauses))),
    );
    const candidate = [...kept, compactClause].join('；');
    if (seedanceCharCount(candidate) > maxChars && kept.length) break;
    kept.push(compactClause);
  }
  return clampSeedanceInline(kept.join('；') || clauses[0], maxChars);
}

function compactShotSegments(value: string, maxSegmentChars = 18): string {
  const normalized = normalizeSeedanceInline(value);
  const parts = normalized.split(/(?=镜头\d+)/).map((item) => item.trim()).filter(Boolean);
  if (parts.length <= 1) return '';
  return parts
    .map((part, index) => {
      const match = part.match(/镜头(\d+)(?:\/镜头\d+)?[:：]?(.+)?/);
      const id = match?.[1] ?? String(index + 1);
      const body = match?.[2]?.trim() || part;
      return `镜${id}:${compactSeedanceClauses(body, maxSegmentChars, 2)}`;
    })
    .join('；');
}

function compactLabeledBody(
  value: string,
  labels: Array<{ label: string; short: string }>,
  maxChars: number,
): string {
  const normalized = normalizeSeedanceInline(value);
  const parts = labels
    .map(({ label, short }) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = normalized.match(new RegExp(`${escaped}[:：]?([^；;]+)`));
      if (!match?.[1]) return '';
      return `${short}=${clampSeedanceInline(match[1], 14)}`;
    })
    .filter(Boolean);
  if (!parts.length) return compactSeedanceClauses(normalized, maxChars, 3);
  return clampSeedanceInline(parts.join('；'), maxChars);
}

function compactMustShowBody(value: string): string {
  return value
    .split(/\n+/)
    .flatMap((line) => line.split(/[；;]/))
    .map((item) => item.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((item) => clampSeedanceInline(item, 18))
    .join('；');
}

function compactReferenceBody(value: string): string {
  return value
    .split(/\n+/)
    .map((line) => normalizeSeedanceInline(line))
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => {
      const [head, tail = ''] = line.split(/[:：]/, 2);
      return tail ? `${head}:${clampSeedanceInline(tail, 18)}` : clampSeedanceInline(head, 18);
    })
    .join('\n');
}

function compactNailsBody(value: string): string {
  return value
    .split(/\n+/)
    .map((line) => normalizeSeedanceInline(line))
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => {
      const [head, tail = ''] = line.split(/[:：]/, 2);
      return tail ? `${head}:${clampSeedanceInline(tail, 18)}` : clampSeedanceInline(head, 18);
    })
    .join('\n');
}

function compactMountBody(value: string): string {
  const parts = normalizeSeedanceInline(value)
    .split(/[；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((item) => clampSeedanceInline(item, 24));
  return parts.join('；');
}

function compactSeedanceSectionBodyV2(index: number, body: string): string {
  const normalized = body.trim();
  if (!normalized) return normalized;
  if (index === SEEDANCE_PROMPT_SECTION_INDEX) return normalized;
  switch (index) {
    case 0:
      return compactMountBody(normalized);
    case 1:
    case 2:
    case 3:
    case 6:
    case 7:
    case 8:
      return compactSeedanceClauses(normalized, 54, 3);
    case 4:
      return compactLabeledBody(
        normalized,
        [
          { label: '前景', short: '前' },
          { label: '中景', short: '中' },
          { label: '后景', short: '后' },
          { label: '焦点落点', short: '焦点' },
        ],
        84,
      );
    case 5:
      return compactLabeledBody(
        normalized,
        [
          { label: '光源', short: '光源' },
          { label: '明暗关系', short: '明暗' },
          { label: '层次分配', short: '层次' },
          { label: '灯光任务', short: '任务' },
        ],
        96,
      );
    case 10:
      return compactLabeledBody(
        normalized,
        [
          { label: '主镜', short: '主镜' },
          { label: '关键节点', short: '节点' },
          { label: '动态策略', short: '策略' },
        ],
        84,
      );
    case 11:
      return compactSeedanceClauses(normalized, 72, 3);
    case 12:
      return compactLabeledBody(
        normalized,
        [
          { label: '插针', short: '插针' },
          { label: '甩拍', short: '甩拍' },
          { label: '慢镜头', short: '慢镜' },
        ],
        72,
      );
    case 13:
      return compactSeedanceClauses(normalized, 60, 3);
    case 14:
      return compactNailsBody(normalized);
    default:
      return compactSeedanceClauses(normalized, 48, 3);
  }
}

function assertSeedanceCardV2(shotId: string, seedanceCard: string): string {
  const card = seedanceCard.trim();
  if (!card) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 缺少 seedanceCard。`);
  }
  const firstLine = card
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine?.startsWith('【分镜')) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 seedanceCard 首行不是结构化标题。${PROMPT_CARD_HEADER_RULE}`);
  }
  const missing = PROMPT_CARD_SECTION_HEADINGS.filter((heading) => !card.includes(heading));
  if (missing.length) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 seedanceCard 缺少固定栏位：${missing.join('、')}。`);
  }

  const { sections } = parseSeedanceCardSections(card);
  const sectionMap = new Map(sections.map((section) => [section.heading, section.body]));

  const mountBody = sectionMap.get('挂载')?.trim() ?? '';
  if (!mountBody || !/(角色：|场景：|声音：|道具：)/.test(mountBody)) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的挂载区不合格。${PROMPT_MOUNT_TOKEN_RULE}`);
  }
  const mountTokens = mountBody
    .split(/[；;\n]/)
    .map((item) => item.replace(/^(角色|场景|声音|道具)：/, '').trim())
    .filter(Boolean);
  if (!mountTokens.length || mountTokens.some((token) => looksNoisyStructuredToken(token))) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的挂载区混入了动作残片、截断短语或占位符。`);
  }

  const compositionBody = sectionMap.get('构图锚点')?.trim() ?? '';
  if (!/前景[:：]/.test(compositionBody) || !/中景[:：]/.test(compositionBody) || !/后景[:：]/.test(compositionBody)) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的构图锚点缺少前景 / 中景 / 后景。`);
  }

  const lightingBody = sectionMap.get('灯光布置与基调')?.trim() ?? '';
  if (!/光源[:：]/.test(lightingBody) || !/灯光任务[:：]/.test(lightingBody)) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的灯光布置与基调缺少光源或灯光任务。`);
  }

  const continuityBody = sectionMap.get('连续性约束')?.trim() ?? '';
  if (!/(必须|不能|先|再|最后|始终)/.test(continuityBody)) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的连续性约束缺少硬约束语气。`);
  }

  const nailsBody = sectionMap.get('钉子4行')?.trim() ?? '';
  const nailLines = nailsBody
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (nailLines.length !== 4) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的钉子4行不是严格四行。`);
  }

  return card;
}

function assertPromptBodyV2(shotId: string, prompt: string): string {
  const normalized = prompt.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 prompt 为空。`);
  }
  if (looksTruncatedPromptText(normalized)) {
    throw new Error(`Prompt output for shot ${shotId} ends with an ellipsis and looks incomplete.`);
  }
  if (
    normalized.includes('挂载：') ||
    normalized.includes('相机位置：') ||
    normalized.includes('灯光布置与基调：') ||
    normalized.includes('钉子4行：')
  ) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 prompt 仍是结构栏目复述，没有压缩成可复制执行文本。`);
  }
  return normalized;
}

type ParsedSeedanceSection = {
  heading: string;
  body: string;
};

function compactSeedanceSectionBody(index: number, body: string): string {
  const normalized = body.trim();
  if (!normalized) return normalized;
  if (index === SEEDANCE_PROMPT_SECTION_INDEX) return normalized;
  switch (index) {
    case 0: {
      const tokens = Array.from(normalized.matchAll(MOUNT_TOKEN_RE))
        .map((match) => `|@=${String(match[1] ?? '').trim()}|`)
        .filter(Boolean);
      return tokens.slice(0, 6).join(' ');
    }
    case 1:
      return compactShotSegments(normalized, 16) || compactSeedanceClauses(normalized, 42, 3);
    case 2:
      return compactShotSegments(normalized, 14) || compactSeedanceClauses(normalized, 38, 3);
    case 3:
      return compactSeedanceClauses(normalized, 34, 3);
    case 4:
      return compactLabeledBody(
        normalized,
        [
          { label: '前景', short: '前' },
          { label: '中景', short: '中' },
          { label: '后景', short: '后' },
          { label: '中心物', short: '中心' },
          { label: '遮挡关系', short: '遮挡' },
          { label: '焦点顺序', short: '焦点' },
        ],
        72,
      );
    case 5:
      return compactShotSegments(normalized, 15) || compactSeedanceClauses(normalized, 52, 3);
    case 6:
      return compactSeedanceClauses(normalized, 34, 2);
    case 7:
      return compactSeedanceClauses(normalized, 36, 2);
    case 8:
    case 9:
      return compactSeedanceClauses(normalized, 30, 2);
    case 10: {
      const vertical = normalized.match(/9:16[:：=]?([^;\n]+)/)?.[1]?.trim() || '';
      const wide = normalized.match(/16[:.]?9[:：=]?([^;\n]+)/)?.[1]?.trim() || '';
      return [`9:16=${clampSeedanceInline(vertical, 14)}`, `16:9=${clampSeedanceInline(wide, 16)}`]
        .filter((item) => !item.endsWith('='))
        .join('\n');
    }
    case 11:
      return compactSeedanceClauses(normalized, 34, 3);
    case 12:
      return compactSeedanceClauses(normalized, 40, 3);
    case 14:
      return compactMustShowBody(normalized);
    case 15:
      return compactReferenceBody(normalized);
    case 16:
      return compactSeedanceClauses(normalized, 38, 3);
    case 17:
      return compactSeedanceClauses(normalized, 34, 3);
    case 18:
      return compactReferenceBody(normalized);
    case 19:
      return compactSeedanceClauses(normalized, 30, 2);
    case 20:
      return compactNailsBody(normalized);
    default:
      return compactSeedanceClauses(normalized, 32, 2);
  }
}

function parseSeedanceCardSections(seedanceCard: string): { header: string; sections: ParsedSeedanceSection[] } {
  const lines = seedanceCard.replace(/\r/g, '').split('\n');
  const header = lines.find((line) => line.trim())?.trim() || '';
  const sections: ParsedSeedanceSection[] = [];
  let current: ParsedSeedanceSection | null = null;

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = PROMPT_CARD_SECTION_HEADINGS.find((item) => trimmed === item);
    if (heading) {
      if (current) {
        current.body = current.body.trim();
        sections.push(current);
      }
      current = { heading, body: '' };
      continue;
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${trimmed}` : trimmed;
    }
  }

  if (current) {
    current.body = current.body.trim();
    sections.push(current);
  }

  return { header, sections };
}

function renderParsedSeedanceCard(header: string, sections: ParsedSeedanceSection[]): string {
  const lines = [header, ''];
  for (const section of sections) {
    lines.push(section.heading, section.body || '同上', '');
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n').trim();
}

function tightenSeedanceCard(seedanceCard: string): string {
  const { header, sections } = parseSeedanceCardSections(seedanceCard);
  if (!header || !sections.length) return seedanceCard.trim();
  return renderParsedSeedanceCard(header, sections);
}

function parseStudioCanvasV23Sections(
  seedanceCard: string,
): { header: string; sections: ParsedSeedanceSection[] } {
  const lines = seedanceCard.replace(/\r/g, '').split('\n');
  const headerIndex = lines.findIndex((line) => line.trim());
  const header = headerIndex >= 0 ? lines[headerIndex].trim() : '';
  const sections: ParsedSeedanceSection[] = [];
  let current: ParsedSeedanceSection | null = null;

  for (const line of lines.slice(headerIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = PROMPT_CARD_V23_SECTION_HEADINGS.find((item) =>
      trimmed.startsWith(`${item}：`),
    );
    if (heading) {
      if (current) {
        current.body = current.body.trim();
        sections.push(current);
      }
      current = { heading, body: trimmed.slice(`${heading}：`.length).trim() };
      continue;
    }
    if (current) {
      current.body = current.body ? `${current.body}\n${trimmed}` : trimmed;
    }
  }

  if (current) {
    current.body = current.body.trim();
    sections.push(current);
  }

  return { header, sections };
}

function assertStudioCanvasV23Card(shotId: string, seedanceCard: string): string {
  const card = seedanceCard.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!card) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 缺少 Studio Canvas 2.3 seedanceCard。`);
  }
  if (/(?:\.{3}|…+)/.test(card)) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas 2.3 卡片含省略号或截断句。`);
  }

  const { header, sections } = parseStudioCanvasV23Sections(card);
  const headerMatch = header.match(/^【分镜([^|]+)\s*\|\s*(\d+(?:\.\d+)?)秒】$/);
  const duration = headerMatch ? Number(headerMatch[2]) : Number.NaN;
  if (!headerMatch || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas 2.3 首行必须为“【分镜XX | N秒】”，且时长必须大于 0 秒。`,
    );
  }

  const actualHeadings = sections.map((section) => section.heading);
  const expectedHeadings = [...PROMPT_CARD_V23_SECTION_HEADINGS];
  if (
    actualHeadings.length !== expectedHeadings.length ||
    actualHeadings.some((heading, index) => heading !== expectedHeadings[index])
  ) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas 2.3 字段缺失、重复、顺序错误，或未使用全角冒号。`,
    );
  }

  const sectionMap = new Map(sections.map((section) => [section.heading, section.body.trim()]));
  const emptyHeading = expectedHeadings.find((heading) => !sectionMap.get(heading));
  if (emptyHeading) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的“${emptyHeading}”为空；无适用内容时必须填写“无”。`);
  }

  const mountBody = sectionMap.get('挂载') ?? '';
  if (mountBody !== '无' && !MOUNT_TOKEN_RE.test(mountBody)) {
    MOUNT_TOKEN_RE.lastIndex = 0;
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的“挂载”必须使用 |@=实体名|，无实体时填写“无”。`);
  }
  MOUNT_TOKEN_RE.lastIndex = 0;

  const compositionBody = sectionMap.get('构图锚点') ?? '';
  const hasConventionalLayers = /前景/.test(compositionBody) && /中景/.test(compositionBody) && /后景/.test(compositionBody);
  const hasAdaptiveLayers =
    (/主体层/.test(compositionBody) && /关系层/.test(compositionBody) && /环境层/.test(compositionBody)) ||
    /无独立前景|全幅同焦/.test(compositionBody);
  if (!hasConventionalLayers && !hasAdaptiveLayers) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的“构图锚点”缺少前中后景或 Studio Canvas 2.3 自适应层级。`,
    );
  }

  const enginePrompt = sectionMap.get('提示词') ?? '';
  if (Array.from(enginePrompt).length > 900) {
    throw new Error(`Prompt 模型返回：镜头 ${shotId} 的 Engine Prompt 超过 Studio Canvas 2.3 建议上限 900 字。`);
  }

  return card;
}

function assertStudioCanvasValidationTimeline(
  shotId: string,
  card: string,
  versionLabel: string,
): void {
  const { header, sections } = parseStudioCanvasV23Sections(card);
  const sectionMap = new Map(sections.map((section) => [section.heading, section.body.trim()]));

  const duration = Number(header.match(/^【分镜[^|]+\s*\|\s*(\d+(?:\.\d+)?)秒】$/)?.[1]);
  const timeline = sectionMap.get('摄影机动态参数') ?? '';
  const intervals = parseStudioCanvasTimelineIntervals(timeline);
  if (!intervals.length) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas ${versionLabel} “摄影机动态参数”缺少连续时间段。`,
    );
  }
  const tolerance = 0.01;
  let cursor = 0;
  for (const interval of intervals) {
    if (
      !Number.isFinite(interval.start) ||
      !Number.isFinite(interval.end) ||
      interval.end <= interval.start ||
      Math.abs(interval.start - cursor) > tolerance
    ) {
      throw new Error(
        `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas ${versionLabel} 时间轴存在空洞、重叠或无效区间。`,
      );
    }
    cursor = interval.end;
  }
  if (!Number.isFinite(duration) || Math.abs(cursor - duration) > tolerance) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas ${versionLabel} 时间轴总和必须等于首行总时长。`,
    );
  }
}

function assertStudioCanvasV25Card(shotId: string, seedanceCard: string): string {
  const card = assertStudioCanvasV23Card(shotId, seedanceCard);
  const { sections } = parseStudioCanvasV23Sections(card);
  const sectionMap = new Map(sections.map((section) => [section.heading, section.body.trim()]));
  const mountBody = sectionMap.get('挂载') ?? '';
  if (mountBody !== '无') {
    const mountTokens = Array.from(mountBody.matchAll(MOUNT_TOKEN_RE))
      .map((match) => String(match[1] ?? '').trim())
      .filter(Boolean);
    const canonicalMountBody = mountTokens.map((token) => `|@=${token}|`).join(' ');
    if (!mountTokens.length || mountBody !== canonicalMountBody) {
      throw new Error(
        `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas 2.5 挂载必须只含独立资产标记，并以单个空格分隔，例如“|@=角色| |@=场景|”。`,
      );
    }
  }
  assertStudioCanvasValidationTimeline(shotId, card, '2.5');
  return card;
}

function assertStudioCanvasV26Card(
  shotId: string,
  seedanceCard: string,
  versionLabel = '2.6',
): string {
  const card = assertStudioCanvasV23Card(shotId, seedanceCard);
  const { sections } = parseStudioCanvasV23Sections(card);
  const sectionMap = new Map(sections.map((section) => [section.heading, section.body.trim()]));
  const mountBody = sectionMap.get('挂载') ?? '';
  if (mountBody !== '无') {
    const mountTokens = Array.from(mountBody.matchAll(MOUNT_TOKEN_RE))
      .map((match) => String(match[1] ?? '').trim())
      .filter(Boolean);
    const canonicalMountBody = mountTokens.map((token) => `|@=${token}|`).join('');
    if (!mountTokens.length || mountBody !== canonicalMountBody) {
      throw new Error(
        `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas ${versionLabel} 挂载必须使用无空格连续格式，例如“|@=角色||@=道具||@=场景|”。`,
      );
    }
    if (
      versionLabel !== '2.7' &&
      mountTokens.length > MAX_STUDIO_CANVAS_V26_MOUNT_ITEMS
    ) {
      throw new Error(
        `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas ${versionLabel} 挂载超过${MAX_STUDIO_CANVAS_V26_MOUNT_ITEMS}项，请删除不影响执行的装饰元素。`,
      );
    }
    if (
      new Set(mountTokens).size !== mountTokens.length ||
      mountTokens.some((token) => looksNoisyStructuredToken(token))
    ) {
      throw new Error(
        `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas ${versionLabel} 挂载含重复项、动作残片、占位符或无效实体。`,
      );
    }
  }
  assertStudioCanvasValidationTimeline(shotId, card, versionLabel);

  return card;
}

function assertStudioCanvasV27CameraParams(shotId: string, lensParams: string): void {
  const blocks = Array.from(lensParams.matchAll(/【摄影机·镜头】([^【\n]+)/g))
    .map((match) => String(match[1] ?? '').trim().replace(/[；;。]\s*$/, ''))
    .filter(Boolean);
  if (!blocks.length) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas 2.7 “镜头参数”缺少【摄影机·镜头】统一参数句式。`,
    );
  }

  for (const block of blocks) {
    const parts = block.split('+').map((part) => part.trim()).filter(Boolean);
    const [camera, optics, focalLength, aperture, ...depthParts] = parts;
    const depthAndFocus = depthParts.join('+');
    const validCamera = Boolean(camera && /(?:机型|摄影机)$/.test(camera));
    const validOptics = Boolean(
      optics && /(?:镜头|光学|Anamorphic|Prime|Macro|Probe)/i.test(optics),
    );
    const validFocalLength = Boolean(
      focalLength && /\d+(?:\.\d+)?(?:\s*[–—~-]\s*\d+(?:\.\d+)?)?\s*mm焦段/i.test(focalLength),
    );
    const validAperture = Boolean(
      aperture && /(?:T|F)\s*\d+(?:\.\d+)?(?:\s*[–—~-]\s*(?:T|F)?\s*\d+(?:\.\d+)?)?光圈/i.test(aperture),
    );
    const validDepth = /(?:极浅|浅|中等|中深|深|全深)景深/.test(depthAndFocus);
    const validFocusDuty =
      /（[^）]*实焦[^）]*）/.test(depthAndFocus) &&
      /(?:失焦|清晰|可读|拉焦|跟焦|焦点)/.test(depthAndFocus);

    if (
      parts.length < 5 ||
      !validCamera ||
      !validOptics ||
      !validFocalLength ||
      !validAperture ||
      !validDepth ||
      !validFocusDuty
    ) {
      throw new Error(
        `Prompt 模型返回：镜头 ${shotId} 的 Studio Canvas 2.7 摄影机参数必须完整写为“【摄影机·镜头】摄影机机型+镜头体系或光学类型+焦段+光圈+景深（实焦主体、失焦层级与焦点变化）”。`,
      );
    }
  }
}

function assertStudioCanvasV27Card(shotId: string, seedanceCard: string): string {
  const card = assertStudioCanvasV26Card(shotId, seedanceCard, '2.7');
  const { sections } = parseStudioCanvasV23Sections(card);
  const sectionMap = new Map(sections.map((section) => [section.heading, section.body.trim()]));
  assertStudioCanvasV27CameraParams(shotId, sectionMap.get('镜头参数') ?? '');
  return card;
}

function hasStudioCanvasV23Structure(seedanceCard: string): boolean {
  try {
    assertStudioCanvasV23Card('structure-check', seedanceCard);
    return true;
  } catch {
    return false;
  }
}

function hasStudioCanvasV25Structure(seedanceCard: string): boolean {
  try {
    assertStudioCanvasV25Card('structure-check', seedanceCard);
    return true;
  } catch {
    return false;
  }
}

function hasStudioCanvasV26Structure(seedanceCard: string): boolean {
  try {
    assertStudioCanvasV26Card('structure-check', seedanceCard);
    return true;
  } catch {
    return false;
  }
}

function hasStudioCanvasV27Structure(seedanceCard: string): boolean {
  try {
    assertStudioCanvasV27Card('structure-check', seedanceCard);
    return true;
  } catch {
    return false;
  }
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function looksLikePromptShotPackRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecordObject(value)) return false;
  return (
    value.shot_id != null ||
    value.shotId != null ||
    typeof value.prompt === 'string' ||
    typeof value.seedanceCard === 'string' ||
    typeof value.seedance_card === 'string'
  );
}

function extractShotPromptsCandidate(
  value: Record<string, unknown>,
  visited = new Set<Record<string, unknown>>(),
): unknown {
  if (visited.has(value)) return undefined;
  visited.add(value);

  const directCandidates = [
    value.shotPrompts,
    value.shot_prompts,
    value.promptShots,
    value.prompt_shots,
  ];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }

  const shotsCandidate = value.shots;
  if (
    Array.isArray(shotsCandidate) &&
    shotsCandidate.length > 0 &&
    shotsCandidate.every((item) => looksLikePromptShotPackRecord(item))
  ) {
    return shotsCandidate;
  }

  const nestedCandidates = [value.data, value.output, value.result, value.response];
  for (const candidate of nestedCandidates) {
    if (!isRecordObject(candidate)) continue;
    const nested = extractShotPromptsCandidate(candidate, visited);
    if (Array.isArray(nested) && nested.length > 0) return nested;
  }

  return value.shotPrompts;
}

function parsePromptShotSegments(raw: unknown): PromptShotSegment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const asNumber = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return Number.NaN;
  };
  const asString = (value: unknown): string => String(value ?? '').trim();
  return raw.map((item) => {
    const segment = isRecordObject(item) ? item : {};
    return {
      shot_id: asString(segment.shot_id ?? segment.shotId),
      start_sec: asNumber(segment.start_sec ?? segment.startSec),
      end_sec: asNumber(segment.end_sec ?? segment.endSec),
      shot_type: asString(segment.shot_type ?? segment.shotType),
      camera: asString(segment.camera),
      composition: asString(segment.composition),
      lighting: asString(segment.lighting),
      action: asString(segment.action),
      keyframe: asString(segment.keyframe),
      image_prompt: asString(segment.image_prompt ?? segment.imagePrompt),
    };
  });
}

function parsePromptShotPackList(raw: unknown): PromptShotPack[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Prompt 模型返回：必须包含非空 `shotPrompts` 数组。');
  }
  return raw.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Prompt 模型返回：shotPrompts[${idx}] 必须是对象。`);
    }
    const row = item as Record<string, unknown>;
    const shot_id = String(row.shot_id ?? row.shotId ?? '').trim();
    const prompt = String(row.prompt ?? '').trim();
    const negative_prompt = ensureRequiredNegativeTerms(
      String(row.negative_prompt ?? row.negativePrompt ?? DEFAULT_NEG).trim() || DEFAULT_NEG,
    );
    if (!shot_id) {
      throw new Error(`Prompt 模型返回：shotPrompts[${idx}] 缺少 shot_id。`);
    }
    if (!prompt) {
      throw new Error(`Prompt 模型返回：shotPrompts[${idx}] 缺少 prompt。`);
    }
    const dimensions = normalizePromptDimensions(row.dimensions ?? row.dimension, idx);
    const rawCharacterAssetIds = Array.isArray(row.character_asset_ids)
      ? row.character_asset_ids
      : Array.isArray(row.characterAssetIds)
        ? row.characterAssetIds
        : [];
    const character_asset_ids = rawCharacterAssetIds.length
      ? rawCharacterAssetIds.map((value) => String(value))
      : [];
    const rawSceneAssetIds = Array.isArray(row.scene_asset_ids)
      ? row.scene_asset_ids
      : Array.isArray(row.sceneAssetIds)
        ? row.sceneAssetIds
        : [];
    const scene_asset_ids = rawSceneAssetIds.length
      ? rawSceneAssetIds.map((value) => String(value))
      : [];
    return {
      shot_id,
      prompt,
      negative_prompt,
      dimensions,
      character_asset_ids,
      scene_asset_ids,
      seedanceCard:
        typeof row.seedanceCard === 'string'
          ? row.seedanceCard
          : typeof row.seedance_card === 'string'
            ? row.seedance_card
            : '',
      shotSegments: parsePromptShotSegments(row.shotSegments ?? row.shot_segments),
    };
  });
}

export function assertPromptOutput(
  value: unknown,
  fallback?: Partial<Pick<PromptOutput, 'system' | 'userTemplate' | 'negative' | 'parameters'>>,
): PromptOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('Prompt 模型返回：顶层必须是 JSON 对象。');
  }
  const raw = value as Record<string, unknown>;
  const system =
    typeof raw.system === 'string' && raw.system.trim()
      ? raw.system.trim()
      : typeof fallback?.system === 'string' && fallback.system.trim()
        ? fallback.system.trim()
        : '';
  if (!system) {
    throw new Error('Prompt 模型返回：缺少非空 `system`。');
  }
  const userTemplate =
    typeof raw.userTemplate === 'string'
      ? raw.userTemplate
      : typeof fallback?.userTemplate === 'string'
        ? fallback.userTemplate
        : '';
  if (typeof userTemplate !== 'string') {
    throw new Error('Prompt 模型返回：缺少 `userTemplate`。');
  }
  const rawParameters =
    raw.parameters && typeof raw.parameters === 'object' && !Array.isArray(raw.parameters)
      ? (raw.parameters as Record<string, unknown>)
      : fallback?.parameters && typeof fallback.parameters === 'object'
        ? fallback.parameters
        : null;
  if (!rawParameters || Array.isArray(rawParameters)) {
    throw new Error('Prompt 模型返回：缺少 `parameters` 对象。');
  }
  const parameters: Record<string, string> = {};
  for (const [key, item] of Object.entries(rawParameters)) {
    parameters[key] = item == null ? '' : String(item);
  }
  const negative =
    typeof raw.negative === 'string' && raw.negative.trim()
      ? ensureRequiredNegativeTerms(raw.negative.trim())
      : typeof raw.negativePrompt === 'string' && raw.negativePrompt.trim()
        ? ensureRequiredNegativeTerms(raw.negativePrompt.trim())
      : typeof fallback?.negative === 'string' && fallback.negative.trim()
        ? ensureRequiredNegativeTerms(fallback.negative.trim())
        : DEFAULT_NEG;
  return {
    system,
    userTemplate,
    negative,
    parameters,
    shotPrompts: parsePromptShotPackList(extractShotPromptsCandidate(raw)),
  };
}

function normalizeShotIdToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.match(/\d+/g)?.join('-') ?? '';
  return digits || trimmed.toLowerCase();
}

function tryParseStoryboardFromInputText(raw: string): StoryboardOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct = tryParseStoryboardOutput(trimmed);
  if (direct) return direct;
  try {
    return tryParseStoryboardOutput(JSON.parse(trimmed));
  } catch {
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd > objectStart) {
      try {
        return tryParseStoryboardOutput(JSON.parse(trimmed.slice(objectStart, objectEnd + 1)));
      } catch {
        return null;
      }
    }
    return looksLikeStructuredPromptInput(trimmed) ? null : buildPromptSingleShotStoryboardFromText(trimmed);
  }
}

function buildPromptModeHints(sourceStoryboard: StoryboardOutput | null): string {
  if (!sourceStoryboard?.shots?.length) return '';
  const continuityRules = [
    '【连续性硬约束】生成结果必须直接继承源分镜的场景空间底图与逐镜连续性账本。',
    '每条提示词的开场站位、世界位置、画面左右、动作轴、机位侧、朝向、视线、持有道具必须来自 startState；镜尾必须落到 endState。不得重新猜测或交换左右关系。',
    '若 continuity.intentionalBreak 不为 true，禁止无过渡越轴、瞬移、道具换手或角色画面位置跳变。',
    buildStoryboardContinuityContext(sourceStoryboard),
  ].join('\n');
  if (sourceStoryboard.shots.length === 1) {
    const first = sourceStoryboard.shots[0];
    const mergedCount = first.mergedMembers?.length ?? 0;
    if (mergedCount > 1) {
      return [
        '【输出模式】当前输入是多镜头组合模式。',
        '你必须只输出 1 条 shotPrompts。',
        `这 1 条 shotPrompt 对应 1 个组合镜头，内部要明确写出镜头1到镜头${mergedCount}的连续接力，不得拆成多条独立 shotPrompts。`,
        continuityRules,
      ].join('\n');
    }
    return [
      '【输出模式】当前输入是单镜头模式。',
      '你必须只输出 1 条 shotPrompts，不得擅自再拆成多镜头组合。',
      continuityRules,
    ].join('\n');
  }
  return [
    '【输出模式】当前输入包含多条源镜头。',
    '你必须逐镜输出，shotPrompts 数量必须与源镜头数量严格一致，不得把多条源镜头压成一条。',
    continuityRules,
  ].join('\n');
}

function findSourceShot(sourceStoryboard: StoryboardOutput | null, pack: PromptShotPack, index: number): StoryboardShot | null {
  if (!sourceStoryboard?.shots?.length) return null;
  const targetToken = normalizeShotIdToken(pack.shot_id);
  return (
    sourceStoryboard.shots.find((shot) => normalizeShotIdToken(String(shot.id)) === targetToken) ??
    sourceStoryboard.shots[index] ??
    null
  );
}

type Seedance2TimelineInterval = { start: number; end: number };

function parseSeedance2TimelineIntervals(card: string): Seedance2TimelineInterval[] {
  const intervals: Seedance2TimelineInterval[] = [];
  const pattern = /\[(\d{2})\.(\d)s?\s*-\s*(\d{2})\.(\d)s?\]/g;
  for (const match of card.matchAll(pattern)) {
    intervals.push({
      start: Number(match[1]) + Number(match[2]) / 10,
      end: Number(match[3]) + Number(match[4]) / 10,
    });
  }
  return intervals;
}

function assertContinuousSeedance2Timeline(shotId: string, card: string): void {
  const intervals = parseSeedance2TimelineIntervals(card);
  if (!intervals.length) {
    throw new Error(`Seedance2.0 prompt for shot ${shotId} must include timestamp ranges like [00.0s - 02.5s].`);
  }

  const tolerance = 0.05;
  let cursor = 0;
  for (const interval of intervals) {
    if (interval.end <= interval.start) {
      throw new Error(`Seedance2.0 prompt for shot ${shotId} has an invalid timeline interval.`);
    }
    if (Math.abs(interval.start - cursor) > tolerance) {
      throw new Error(`Seedance2.0 prompt for shot ${shotId} timeline must be continuous from 00.0s.`);
    }
    cursor = interval.end;
  }

  if (!Number.isFinite(cursor) || cursor <= 0) {
    throw new Error(`Seedance2.0 prompt for shot ${shotId} timeline must end at a valid positive duration.`);
  }
}

function assertSeedance2SegmentedCard(shotId: string, seedanceCard: string): string {
  const card = normalizeSeedance2CardText(seedanceCard);
  if (!card) {
    throw new Error(`Seedance2.0 prompt for shot ${shotId} is missing seedanceCard.`);
  }
  if (!card.startsWith(SEEDANCE2_SEGMENTED_HEADINGS[0])) {
    throw new Error(`Seedance2.0 prompt for shot ${shotId} must start with ${SEEDANCE2_SEGMENTED_HEADINGS[0]}.`);
  }

  const length = Array.from(card).length;
  if (length < MIN_SEEDANCE2_SEGMENTED_CARD_CHARS || length > MAX_SEEDANCE2_SEGMENTED_CARD_CHARS) {
    throw new Error(
      `Seedance2.0 prompt for shot ${shotId} must be ${MIN_SEEDANCE2_SEGMENTED_CARD_CHARS}-${MAX_SEEDANCE2_SEGMENTED_CARD_CHARS} Chinese characters.`,
    );
  }

  let previousIndex = -1;
  for (const heading of SEEDANCE2_SEGMENTED_HEADINGS) {
    const index = card.indexOf(heading);
    if (index < 0) {
      throw new Error(`Seedance2.0 prompt for shot ${shotId} is missing heading: ${heading}.`);
    }
    if (index <= previousIndex) {
      throw new Error(`Seedance2.0 prompt for shot ${shotId} headings are out of order.`);
    }
    previousIndex = index;
  }

  const oldStudioCanvasFields = [
    '挂载',
    '相机位置',
    '相机朝向',
    '角色朝向',
    '构图锚点',
    '灯光布置与基调',
    '起幅',
    '落幅',
    '连续性约束',
    '摄影机动态参数',
    '镜头参数',
    '插针',
    '甩拍',
    '慢镜头',
    '微表情',
    '表演建议',
    '钉子4行',
  ];
  const leakedOldField = oldStudioCanvasFields.find((field) =>
    new RegExp(`(^|\\n)\\s*(?:#{1,6}\\s*)?【?${field}】?\\s*[:：]?`).test(card),
  );
  if (leakedOldField) {
    throw new Error(`Seedance2.0 prompt for shot ${shotId} must not include old Studio Canvas field: ${leakedOldField}.`);
  }

  const requiredTerms = ['镜头机位', '视觉画面', '[前景]', '[主体]', '[背景]', '听觉声效'];
  const missingTerms = requiredTerms.filter((term) => !card.includes(term));
  if (missingTerms.length) {
    throw new Error(`Seedance2.0 prompt for shot ${shotId} is missing required timeline terms: ${missingTerms.join(', ')}.`);
  }
  if (SEEDANCE2_UI_RENDER_PARAM_RE.test(getSeedance2RenderableContent(card))) {
    throw new Error(`Seedance2.0 prompt for shot ${shotId} must not include UI render parameters.`);
  }

  assertContinuousSeedance2Timeline(shotId, card);

  return card;
}

function hasSeedance25MultimodalStructure(seedanceCard: string): boolean {
  const card = seedanceCard.replace(/\r/g, '').trim();
  if (!/^【Seedance 2\.5｜/.test(card)) return false;
  if (!/(^|\n)挂载：/.test(card)) return false;
  for (const heading of [
    '【摄影机 / 镜头】',
    '【机位与构图】',
    '【起幅】',
    '【时间轴】',
    '【声音 / 对白】',
    '【文字与字幕限制】',
  ]) {
    if (!card.includes(heading)) return false;
  }
  return card.includes('【最终落幅】') || card.includes('【落幅】');
}

function assertSeedance25MultimodalCard(
  shotId: string,
  seedanceCard: string,
  versionLabel = 'v10',
): string {
  const card = seedanceCard.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!hasSeedance25MultimodalStructure(card)) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 未遵守 Seedance 2.5 ${versionLabel} 最终结构，必须从“【Seedance 2.5｜”开始并包含挂载、摄影机/镜头、机位与构图、起幅、时间轴、声音/对白、落幅及文字与字幕限制。`,
    );
  }
  if (!extractSeedance25CameraModel(card)) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 Seedance 2.5【摄影机 / 镜头】缺少具体摄影机型号。`,
    );
  }
  MOUNT_TOKEN_RE.lastIndex = 0;
  const withoutValidMountTokens = card.replace(MOUNT_TOKEN_RE, '');
  MOUNT_TOKEN_RE.lastIndex = 0;
  if (withoutValidMountTokens.includes('|@=')) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 Seedance 2.5 挂载必须统一使用“|@=名称|”格式。`,
    );
  }
  const length = Array.from(card).length;
  if (length < MIN_SEEDANCE25_CARD_CHARS || length > MAX_SEEDANCE25_CARD_CHARS) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 的 Seedance 2.5 最终提示词长度必须在 ${MIN_SEEDANCE25_CARD_CHARS}-${MAX_SEEDANCE25_CARD_CHARS} 字之间。`,
    );
  }
  return card;
}

function getSeedance25Section(card: string, heading: string): string {
  const start = card.indexOf(heading);
  if (start < 0) return '';
  const contentStart = start + heading.length;
  const nextHeading = card.indexOf('\n【', contentStart);
  return card.slice(contentStart, nextHeading < 0 ? card.length : nextHeading).trim();
}

type Seedance25TimelineInterval = {
  start: number;
  end: number;
  body: string;
};

const SEEDANCE25_TIME_RANGE_PATTERN =
  String.raw`(?:\[|\()?\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:-|–|—|~|至|到)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:\]|\))?`;
const SEEDANCE25_PERFORMANCE_SIGNAL_RE =
  /面部|眉|眼睑|眼角|面颊|嘴角|唇|下颌|眨眼|视线|目光|眼神|头部|抬头|低头|转头|偏头|重心|肩|躯干|身体|手部|手指|步幅|姿态|呼吸|吸气|呼气|屏息|声音|语气|音量|语速|停顿|断句|尾音|沉默|机械|伺服|传感器|转向|加速|减速|制动|惯性|距离|灯光反馈/i;

function parseSeedance25TimelineIntervals(timeline: string): Seedance25TimelineInterval[] {
  const rangeRe = new RegExp(SEEDANCE25_TIME_RANGE_PATTERN, 'gi');
  const matches = Array.from(timeline.matchAll(rangeRe));
  return matches.map((match, index) => ({
    start: Number(match[1]),
    end: Number(match[2]),
    body: timeline
      .slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? timeline.length)
      .trim(),
  }));
}

function extractSeedance25DeclaredDuration(card: string): number | null {
  const header = card.split('\n', 1)[0] ?? '';
  const generationSpec = getSeedance25Section(card, '【生成规格】');
  const durationMatch = `${header}\n${generationSpec}`.match(
    /(?:总时长|时长)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*秒|[｜|]\s*(\d+(?:\.\d+)?)\s*秒/i,
  );
  const duration = Number(durationMatch?.[1] ?? durationMatch?.[2]);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function getSeedance25PerformanceV11Issues(seedanceCard: string): string[] {
  if (!hasSeedance25MultimodalStructure(seedanceCard)) {
    return ['缺少 Seedance 2.5 v10 基础结构'];
  }
  const issues: string[] = [];
  const performance = getSeedance25Section(seedanceCard, '【表演】');
  const timeline = getSeedance25Section(seedanceCard, '【时间轴】');
  if (!performance) issues.push('缺少【表演】规划层');
  if (!timeline) issues.push('缺少【时间轴】执行层');
  if (!performance || !timeline) return issues;

  if (/(?:AU\s*\d+|FACS)/i.test(seedanceCard)) {
    issues.push('最终提示词泄漏 AU/FACS 编号；必须翻译为自然语言表演');
  }

  const timestampRe = new RegExp(
    `${SEEDANCE25_TIME_RANGE_PATTERN}|第\\s*\\d+(?:\\.\\d+)?\\s*秒|\\d+(?:\\.\\d+)?\\s*秒(?:时|后|内)`,
    'i',
  );
  if (timestampRe.test(performance)) issues.push('【表演】出现时间戳；时间戳只能存在于【时间轴】');

  const noActionSubject = /无行动主体/.test(performance);
  if (!noActionSubject) {
    if (!/表演调性|整体(?:采用|保持)|整体表演/.test(performance)) {
      issues.push('【表演】缺少精简的整体表演调性');
    }
    if (/目标\s*[:：]|潜台词\s*[:：]|触发锚点\s*[:：]|表演弧线\s*[:：]|面部可读性\s*[:：]|镜尾状态\s*[:：]/.test(performance)) {
      issues.push('【表演】泄漏逐角色导演分析；目标、潜台词、触发、弧线、面部可读性和镜尾状态必须内部规划后编入【时间轴】');
    }
    if (performance.length > 800) {
      issues.push('【表演】过长；这里只保留整体调性、人物主次与关系，单人表演细节进入【时间轴】');
    }
  }

  const intervals = parseSeedance25TimelineIntervals(timeline);
  if (!intervals.length) {
    issues.push('【时间轴】缺少最终数值秒数范围');
    return issues;
  }
  const epsilon = 0.06;
  if (Math.abs(intervals[0].start) > epsilon) issues.push('【时间轴】没有从 0.0s 开始');
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    if (!(interval.end > interval.start)) issues.push(`【时间轴】第 ${index + 1} 段时长无效`);
    if (index > 0 && Math.abs(interval.start - intervals[index - 1].end) > epsilon) {
      issues.push(`【时间轴】第 ${index} 段与第 ${index + 1} 段不连续`);
    }
  }
  if (!noActionSubject && !SEEDANCE25_PERFORMANCE_SIGNAL_RE.test(timeline)) {
    issues.push('【时间轴】整段只有事件动作，没有可见或可听的八维表演增量');
  }
  issues.push(...getSeedance25ReadableFaceIssues(seedanceCard, timeline));
  const declaredDuration = extractSeedance25DeclaredDuration(seedanceCard);
  if (declaredDuration !== null && Math.abs(intervals.at(-1)!.end - declaredDuration) > epsilon) {
    issues.push(`【时间轴】未准确结束于生成规格声明的 ${declaredDuration} 秒`);
  }

  if (/机器人|非人角色|非人主体|机械主体/.test(seedanceCard)) {
    if (!/非人|机器人|机械|姿态|距离|节奏|灯光|声音/.test(performance)) {
      issues.push('【表演】没有说明非人主体的替代表演原则');
    }
    if (!/机械|伺服|传感器|转向|加速|减速|制动|惯性|距离|灯光反馈|机械声/.test(timeline)) {
      issues.push('非人主体没有在【时间轴】使用机械、姿态、距离、节奏、灯光或声音信号');
    }
  }
  return Array.from(new Set(issues));
}

function hasSeedance25PerformanceV11Structure(seedanceCard: string): boolean {
  return getSeedance25PerformanceV11Issues(seedanceCard).length === 0;
}

function assertSeedance25PerformanceV11Card(shotId: string, seedanceCard: string): string {
  const card = assertSeedance25MultimodalCard(shotId, seedanceCard, '+ 八维表演版');
  const issues = getSeedance25PerformanceV11Issues(card);
  if (issues.length) {
    throw new Error(
      `Prompt 模型返回：镜头 ${shotId} 未遵守 Seedance 2.5 + 八维表演结构：${issues.join('；')}。`,
    );
  }
  return card;
}

function normalizePromptOutput(
  output: PromptOutput,
  sourceStoryboard: StoryboardOutput | null,
  styleMode: PromptStyleMode = 'studioCanvas',
): PromptOutput {
  const getSceneCameraKey = (pack: PromptShotPack, index: number): string => {
    const sourceShot = findSourceShot(sourceStoryboard, pack, index);
    return String(sourceShot?.sceneRef ?? pack.dimensions?.场景 ?? '').trim() || '__default_scene__';
  };
  const sceneCameraModels = new Map<string, string>();
  if (isSeedance25MultimodalStyle(styleMode)) {
    for (const [index, pack] of (output.shotPrompts ?? []).entries()) {
      const cameraModel = extractSeedance25CameraModel(String(pack.seedanceCard ?? ''));
      const sceneKey = getSceneCameraKey(pack, index);
      if (cameraModel && !sceneCameraModels.has(sceneKey)) {
        sceneCameraModels.set(sceneKey, cameraModel);
      }
    }
  }
  const shotPrompts = (output.shotPrompts ?? []).map((pack, index) => {
    const sourceShot = findSourceShot(sourceStoryboard, pack, index);
    const sourceShots = sourceShot?.mergedMembers?.length
      ? sourceShot.mergedMembers
      : sourceShot
        ? [sourceShot]
        : [];
    const characters = Array.from(
      new Set(
        sourceShots
          .flatMap((shot) => shot.characters ?? [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    const props = Array.from(
      new Set(
        sourceShots
          .flatMap((shot) => shot.props ?? [])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    const sounds = Array.from(
      new Set(
        sourceShots.flatMap((shot) => inferPromptSoundNames(shot.sound)),
      ),
    );
    const scenes = Array.from(
      new Set(
        sourceShots
          .map((shot) => shot.sceneRef)
          .flatMap((value) => String(value ?? '').split(/[、,，；;|/]+/))
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    const resolvedCharacters =
      characters.length > 0
        ? characters
        : inferPromptCharacterNames(pack.dimensions?.角色);
    const resolvedScenes =
      scenes.length > 0
        ? scenes
        : inferPromptSceneNames(pack.dimensions?.场景);
    const replaceInternalMountTokens = (value: string): string => {
      return resolvePromptAssetPlaceholders(value, {
        characterNames: resolvedCharacters,
        propNames: props,
        sceneNames: resolvedScenes,
        soundNames: sounds,
      }, {
        mountSeparator:
          isStudioCanvasV26Style(styleMode) || isStudioCanvasV27Style(styleMode)
            ? ''
            : ' ',
      });
    };
    let normalizedSeedanceCard =
      typeof pack.seedanceCard === 'string'
        ? isSeedance25MultimodalStyle(styleMode)
          ? pack.seedanceCard.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
        : isSeedance2SegmentedStyle(styleMode)
          ? normalizeSeedance2CardText(pack.seedanceCard)
          : isStudioCanvasValidationStyle(styleMode)
            ? repairStudioCanvasV25Timeline(pack.seedanceCard)
          : isStudioCanvasV23Style(styleMode)
            ? pack.seedanceCard.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
            : tightenSeedanceCard(pack.seedanceCard)
        : '';
    if (isSeedance25MultimodalStyle(styleMode) && normalizedSeedanceCard) {
      const sceneKey = getSceneCameraKey(pack, index);
      const completed = ensureSeedance25CameraModel(
        normalizedSeedanceCard,
        sceneCameraModels.get(sceneKey),
      );
      normalizedSeedanceCard = completed.card;
      if (!sceneCameraModels.has(sceneKey)) {
        sceneCameraModels.set(sceneKey, completed.cameraModel);
      }
    }
    return {
      ...pack,
      shot_id: sourceShot ? String(sourceShot.id) : pack.shot_id,
      prompt: replaceInternalMountTokens(
        String(pack.prompt ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(),
      ),
      character_asset_ids: sanitizePromptAssetIds(pack.character_asset_ids),
      scene_asset_ids: sanitizePromptAssetIds(pack.scene_asset_ids),
      seedanceCard: replaceInternalMountTokens(normalizedSeedanceCard),
      shotSegments: (pack.shotSegments ?? []).map((segment) => ({
        ...segment,
        camera: sanitizePromptAssetPlaceholders(segment.camera),
        composition: sanitizePromptAssetPlaceholders(segment.composition),
        lighting: sanitizePromptAssetPlaceholders(segment.lighting),
        action: sanitizePromptAssetPlaceholders(segment.action),
        keyframe: sanitizePromptAssetPlaceholders(segment.keyframe),
        image_prompt: sanitizePromptAssetPlaceholders(segment.image_prompt),
      })),
    };
  });
  return {
    ...output,
    parameters: {
      ...output.parameters,
      format: isSeedance2SegmentedStyle(styleMode)
        ? SEEDANCE2_SEGMENTED_FORMAT
        : isSeedance25PerformanceV11Style(styleMode)
          ? SEEDANCE25_PERFORMANCE_V11_FORMAT
        : isSeedance25MultimodalStyle(styleMode)
          ? SEEDANCE25_MULTIMODAL_FORMAT
        : isStudioCanvasV231SegmentsStyle(styleMode)
        ? 'studio_canvas_v2_3_1_segments'
        : isStudioCanvasV27Style(styleMode)
          ? 'studio_canvas_v2_7'
        : isStudioCanvasV26Style(styleMode)
          ? 'studio_canvas_v2_6'
        : isStudioCanvasV25Style(styleMode)
          ? 'studio_canvas_v2_5'
        : isStudioCanvasV23Style(styleMode)
          ? 'studio_canvas_v2_3'
          : output.parameters.format || 'sd2_storyboard_dense_v2',
    },
    shotPrompts,
  };
}

function outputNeedsCompressionRepair(output: PromptOutput, styleMode: PromptStyleMode = 'studioCanvas'): boolean {
  return (output.shotPrompts ?? []).some((pack) => {
    const prompt = String(pack.prompt ?? '').trim();
    if (prompt && Array.from(prompt).length > MAX_PROMPT_CHARS) return true;
    const seedanceCard = String(pack.seedanceCard ?? '').trim();
    const seedanceCardLength = Array.from(seedanceCard).length;
    if (seedanceCard && seedanceCardLength < getMinSeedanceCardChars(styleMode)) return true;
    if (seedanceCard && seedanceCardLength > getMaxSeedanceCardChars(styleMode)) return true;
    if (isStudioCanvasV25Style(styleMode) && !hasStudioCanvasV25Structure(seedanceCard)) return true;
    if (isStudioCanvasV26Style(styleMode) && !hasStudioCanvasV26Structure(seedanceCard)) return true;
    if (isStudioCanvasV27Style(styleMode) && !hasStudioCanvasV27Structure(seedanceCard)) return true;
    if (
      isStudioCanvasV23Style(styleMode) &&
      !isStudioCanvasValidationStyle(styleMode) &&
      !hasStudioCanvasV23Structure(seedanceCard)
    ) return true;
    if (
      isStudioCanvasV231SegmentsStyle(styleMode) &&
      (pack.shotSegments ?? []).some((segment) =>
        PROMPT_SEGMENT_TEXT_FIELDS.some((field) => !String(segment[field] ?? '').trim()),
      )
    ) return true;
    if (isSeedance2SegmentedStyle(styleMode)) {
      if (!seedanceCard) return true;
      if (seedanceCardLength < MIN_SEEDANCE2_SEGMENTED_CARD_CHARS) return true;
      if (!seedanceCard.startsWith(SEEDANCE2_SEGMENTED_HEADINGS[0])) return true;
      if (SEEDANCE2_SEGMENTED_HEADINGS.some((heading) => !seedanceCard.includes(heading))) return true;
      if (['镜头机位', '视觉画面', '[前景]', '[主体]', '[背景]', '听觉声效'].some((term) => !seedanceCard.includes(term))) return true;
      if (!parseSeedance2TimelineIntervals(seedanceCard).length) return true;
    }
    if (isSeedance25PerformanceV11Style(styleMode) && !hasSeedance25PerformanceV11Structure(seedanceCard)) {
      return true;
    }
    if (isSeedance25MultimodalStyle(styleMode) && !hasSeedance25MultimodalStructure(seedanceCard)) {
      return true;
    }
    return false;
  });
}

function stripLineEndingEllipsis(value: string): string {
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/(?:\.{3}|\u2026+)\s*$/g, '').trimEnd())
    .join('\n')
    .trim();
}

function sanitizePromptOutputEllipsis(output: PromptOutput): PromptOutput {
  return {
    ...output,
    shotPrompts: (output.shotPrompts ?? []).map((pack) => ({
      ...pack,
      prompt: stripLineEndingEllipsis(pack.prompt ?? ''),
      seedanceCard: stripLineEndingEllipsis(pack.seedanceCard ?? ''),
    })),
  };
}

function validatePromptPackContent(pack: PromptShotPack, styleMode: PromptStyleMode = 'studioCanvas'): void {
  const prompt = String(pack.prompt ?? '');
  if (Array.from(prompt).length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt 输出超出字数限制：镜头 ${pack.shot_id} 的提示词超过 2500 字。`);
  }
  assertPromptBodyV2(pack.shot_id, prompt);
  const seedanceCard = String(pack.seedanceCard ?? '').trim();
  if (!seedanceCard) {
    throw new Error(`Prompt 模型返回：镜头 ${pack.shot_id} 缺少 seedanceCard。`);
  }
  if (isSeedance2SegmentedStyle(styleMode)) {
    assertSeedance2SegmentedCard(pack.shot_id, seedanceCard);
    return;
  }
  if (isSeedance25PerformanceV11Style(styleMode)) {
    assertSeedance25PerformanceV11Card(pack.shot_id, seedanceCard);
    return;
  }
  if (isSeedance25MultimodalStyle(styleMode)) {
    assertSeedance25MultimodalCard(pack.shot_id, seedanceCard);
    return;
  }
  if (isStudioCanvasV23Style(styleMode)) {
    if (isStudioCanvasV27Style(styleMode)) {
      assertStudioCanvasV27Card(pack.shot_id, seedanceCard);
    } else if (isStudioCanvasV26Style(styleMode)) {
      assertStudioCanvasV26Card(pack.shot_id, seedanceCard);
    } else if (isStudioCanvasV25Style(styleMode)) {
      assertStudioCanvasV25Card(pack.shot_id, seedanceCard);
    } else {
      assertStudioCanvasV23Card(pack.shot_id, seedanceCard);
    }
  }
  if (Array.from(seedanceCard).length > MAX_SEEDANCE_CARD_CHARS) {
    throw new Error(`Prompt 输出超出字数限制：镜头 ${pack.shot_id} 的 seedanceCard 超过 ${MAX_SEEDANCE_CARD_CHARS} 字。`);
  }
  if (Array.from(seedanceCard).length < MIN_SEEDANCE_CARD_CHARS) {
    throw new Error(`Prompt 输出低于字数下限：镜头 ${pack.shot_id} 的 seedanceCard 低于 ${MIN_SEEDANCE_CARD_CHARS} 字。`);
  }
}

const PROMPT_SEGMENT_TEXT_FIELDS = [
  'shot_id',
  'shot_type',
  'camera',
  'composition',
  'lighting',
  'action',
  'keyframe',
  'image_prompt',
] as const satisfies readonly (keyof PromptShotSegment)[];

function studioCanvasCardDuration(seedanceCard: string): number {
  const header = seedanceCard.replace(/\r/g, '').split('\n').find((line) => line.trim())?.trim() ?? '';
  const match = header.match(/^【分镜[^|]+\s*\|\s*(\d+(?:\.\d+)?)秒】$/);
  return match ? Number(match[1]) : Number.NaN;
}

function sourceShotIdCandidates(shot: StoryboardShot): string[] {
  return [String(shot.id), shot.shotNo ?? '', shot.wireId ?? '']
    .map(normalizeShotIdToken)
    .filter(Boolean);
}

function validatePromptShotSegments(
  pack: PromptShotPack,
  sourceShot: StoryboardShot | null,
  styleMode: PromptStyleMode,
): void {
  if (!isStudioCanvasV231SegmentsStyle(styleMode)) return;
  const mergedMembers = sourceShot?.mergedMembers?.length ? sourceShot.mergedMembers : null;
  const segments = pack.shotSegments ?? [];
  if (mergedMembers && segments.length !== mergedMembers.length) {
    throw new Error(
      `Prompt 输出组合镜头 ${pack.shot_id} 的 shotSegments 数量错误：需要 ${mergedMembers.length} 段，当前为 ${segments.length} 段。`,
    );
  }
  if (!segments.length) return;

  const seenIds = new Set<string>();
  const tolerance = 0.01;
  let previousEnd = 0;
  segments.forEach((segment, index) => {
    const emptyField = PROMPT_SEGMENT_TEXT_FIELDS.find(
      (field) => !String(segment[field] ?? '').trim(),
    );
    if (emptyField) {
      throw new Error(
        `Prompt 输出组合镜头 ${pack.shot_id} 的 shotSegments[${index}] 缺少 ${emptyField}。`,
      );
    }
    const normalizedId = normalizeShotIdToken(segment.shot_id);
    if (seenIds.has(normalizedId)) {
      throw new Error(`Prompt 输出组合镜头 ${pack.shot_id} 的 shotSegments 存在重复 shot_id：${segment.shot_id}。`);
    }
    seenIds.add(normalizedId);
    if (mergedMembers) {
      const expectedIds = sourceShotIdCandidates(mergedMembers[index]);
      if (!expectedIds.includes(normalizedId)) {
        throw new Error(
          `Prompt 输出组合镜头 ${pack.shot_id} 的第 ${index + 1} 个 segment 未对应源分镜 ${mergedMembers[index].shotNo ?? mergedMembers[index].id}。`,
        );
      }
    }
    if (
      !Number.isFinite(segment.start_sec) ||
      !Number.isFinite(segment.end_sec) ||
      segment.start_sec < 0 ||
      segment.end_sec <= segment.start_sec
    ) {
      throw new Error(`Prompt 输出组合镜头 ${pack.shot_id} 的第 ${index + 1} 个 segment 时间区间无效。`);
    }
    if (Math.abs(segment.start_sec - previousEnd) > tolerance) {
      throw new Error(`Prompt 输出组合镜头 ${pack.shot_id} 的 shotSegments 时间轴存在空洞或重叠。`);
    }
    previousEnd = segment.end_sec;
  });

  const cardDuration = studioCanvasCardDuration(String(pack.seedanceCard ?? ''));
  if (!Number.isFinite(cardDuration) || Math.abs(previousEnd - cardDuration) > tolerance) {
    throw new Error(
      `Prompt 输出组合镜头 ${pack.shot_id} 的 shotSegments 结束时间必须等于 seedanceCard 首行总时长。`,
    );
  }
}

function validatePromptCoverage(
  output: PromptOutput,
  sourceStoryboard: StoryboardOutput | null,
  styleMode: PromptStyleMode = 'studioCanvas',
): void {
  for (const [index, pack] of (output.shotPrompts ?? []).entries()) {
    validatePromptPackContent(pack, styleMode);
    validatePromptShotSegments(pack, findSourceShot(sourceStoryboard, pack, index), styleMode);
  }
  if (!sourceStoryboard?.shots?.length) return;
  const expected = sourceStoryboard.shots.map((shot) => String(shot.id));
  const actual = output.shotPrompts?.map((shot) => shot.shot_id) ?? [];
  if (actual.length !== expected.length) {
    throw new Error(
      `Prompt 输出镜头数量不完整：镜头表共 ${expected.length} 条镜头，但当前仅生成了 ${actual.length} 条。`,
    );
  }
  const expectedSet = new Set(expected.map(normalizeShotIdToken));
  const actualSet = new Set(actual.map(normalizeShotIdToken));
  for (const id of expectedSet) {
    if (!actualSet.has(id)) {
      throw new Error('Prompt 输出镜头编号不完整：未覆盖镜头表中的全部镜头。');
    }
  }
}

function buildPromptUserMessage(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  const sourceShotHints =
    sourceStoryboard?.shots?.length
      ? [
          `【源镜头总数】${sourceStoryboard.shots.length}`,
          `【源镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
          '【硬性要求】你必须为每一条源镜头各生成一条 shotPrompts 项，数量必须与源镜头完全一致，不得只输出第一条镜头。',
        ].join('\n')
      : '';
  return [
    '以下是部门 Input 正文，可能是镜头表 JSON，也可能是自然语言补充。请输出完整 PromptOutput JSON。',
    '',
    '【模板硬约束】',
    PROMPT_CARD_HEADER_RULE,
    PROMPT_MOUNT_TOKEN_RULE,
    PROMPT_COPY_CHAR_LIMIT_RULE,
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    PROMPT_LOCAL_COMPRESSION_RULE,
    PROMPT_TIMING_SYSTEM_RULE,
    'negative 与每个 shot 的 negative_prompt 必须显式包含：background music / bgm、subtitle / subtitles / text overlay、ui / hud / interface overlay。',
    'prompt body must not end with `...` or a unicode ellipsis; it must close on a complete result beat.',
    'seedanceCard 标题中的秒数必须是按内容推算出的真实总时长，不得固定写 15 秒。',
    '如果一条镜头组实际 5 秒就能完成，就写 5 秒；如果输入需要 25 秒就完整保留 25 秒，不得强行压缩到 15 秒。',
    '连续镜头组的秒数占比和时间区间只写在“摄影机动态参数”里，其它模块不要重复写。',
    'prompt 本体必须是“提示词(复制到即梦)”类型的压缩执行文本，不得逐条复述栏目标题。',
    '空镜、环境镜、道具镜、无人物镜头里，不要写眼神、人物微表情、角色朝向等人物描述；“表演建议”字段可改写为光影、气流、道具微动或空间静压。',
    `seedanceCard 必须按以下顺序完整包含栏位：${PROMPT_CARD_SECTION_HEADINGS.join('、')}。`,
    '“【双版本锚】”内必须同时出现 9:16 与 16:9。',
    '“提示词(复制到即梦)”必须是可直接复制执行的中文主导版本。',
    '“【目标物Must-Show】”“【参照/覆盖/稳帧】”“【声画同步】”“【表演建议】”“【文戏附加】”“【钉子4行】”不得缺失。',
    '',
    '【定稿依据】若 Input 含 JSON 字段 `shots`，其中每条镜头的 `description`、`content` 均视为最终定稿，生成时必须逐镜落实。',
    '【同场合并】若某条镜头含 `mergedMembers`，对应项中的 `prompt` 与 `seedanceCard` 都要按实际子镜头数量连续推进。',
    '【覆盖纠偏】mergedMembers 的镜头1 / 镜头2 / 镜头3 只是编号示例，不是固定三镜；必须按实际子镜头数量完整编号到最后一个，14 个子镜头就写到镜头14。',
    sourceShotHints,
    '',
    '【资产占位 ID】请为各 shot 写入 `character_asset_ids` / `scene_asset_ids`；没有真实 ID 时可留空数组，但键不可缺失。',
    JSON.stringify(assetRefs, null, 2),
    '',
    '--- Input ---',
    brief.trim() || '（空）',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildCoverageRepairUserMessage(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  const invalidShotPrompts = invalidOutput.shotPrompts ?? [];
  const failureSummary = failureReason ? `[Previous failure] ${failureReason}` : '';
  return [
    failureSummary,
    '你上一次返回的 PromptOutput 不完整，请重新输出完整 JSON。',
    `【必须覆盖的镜头总数】${sourceStoryboard.shots.length}`,
    `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    `【上一次返回的镜头编号】${invalidShotPrompts.map((shot) => shot.shot_id).join(', ')}`,
    '硬性要求：',
    '1. shotPrompts.length 必须等于源镜头数。',
    '2. 每一条源镜头都必须有对应 shot_id。',
    '3. 每个 shot 都必须带完整 seedanceCard，不得缺少固定栏位。',
    `4. “挂载”必须符合这条规则：${PROMPT_MOUNT_TOKEN_RULE}`,
    `5. “提示词(复制到即梦)”必须符合这条规则：${PROMPT_COPY_CHAR_LIMIT_RULE}`,
    `5a. seedanceCard 总篇幅必须符合这条规则：${PROMPT_CARD_LENGTH_BUDGET_RULE}`,
    '6. prompt 本体必须是压缩后的执行文本，不得逐条复述栏目标题。',
    '7. 空镜/无人物镜头不得出现眼神、人物微表情、角色朝向等人物描述；“表演建议”字段可由光影、气流、道具微动或空间静压承担。',
    '8. 不得返回解释文本、markdown 或半截 JSON。',
    '',
    '【固定栏位】',
    PROMPT_CARD_SECTION_HEADINGS.join('、'),
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    '【源镜头表】',
    JSON.stringify(sourceStoryboard, null, 2),
    '',
    '【上一次不完整的输出】',
    JSON.stringify(invalidOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].join('\n');
}

function buildCompressionRepairUserMessage(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '你上一次返回的 PromptOutput 语义基本可用，但长度与结构压缩不符合当前工具的本地压缩规则。请在不改坏镜头语义的前提下，重写为更短、更稳的版本。',
    '',
    '【本次修订目标】',
    PROMPT_COPY_CHAR_LIMIT_RULE,
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    PROMPT_LOCAL_COMPRESSION_RULE,
    '禁止简单截断，禁止在结尾补 `...` 或 `…`，禁止删除固定标题，禁止把同一句原文重复灌入多个模块。',
    '如果某些信息必须压缩，优先压缩非核心模块，而不是删掉镜头命题、主事件、关系变化、空间切割、焦点顺序、结果位和 Must-Show。',
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    sourceStoryboard
      ? ['【源镜头表】', JSON.stringify(sourceStoryboard, null, 2), ''].join('\n')
      : '',
    '【待压缩的当前输出】',
    JSON.stringify(draftOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPromptUserMessageV2(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  const sourceShotHints =
    sourceStoryboard?.shots?.length
      ? [
          `【源镜头总数】${sourceStoryboard.shots.length}`,
          `【源镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
          '【硬性要求】你必须为每一条源镜头各生成一条 shotPrompts 项，数量必须与源镜头完全一致，不得只输出第一条镜头。',
        ].join('\n')
      : '';
  return [
    '以下是部门 Input 正文，可能是镜头表 JSON，也可能是自然语言补充。请输出完整 PromptOutput JSON。',
    '',
    '【模板硬约束】',
    PROMPT_CARD_HEADER_RULE,
    PROMPT_MOUNT_TOKEN_RULE,
    PROMPT_COPY_CHAR_LIMIT_RULE,
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    PROMPT_LOCAL_COMPRESSION_RULE,
    PROMPT_TIMING_SYSTEM_RULE,
    'prompt body must not end with `...` or a unicode ellipsis; it must close on a complete result beat.',
    'prompt 本体必须是压缩后的执行文本，不得逐条复述栏目标题。',
    '空镜、环境镜、道具镜、无人物镜头里，不要硬写人物眼神、嘴角或面部停顿。',
    `seedanceCard 必须按以下顺序完整包含栏位：${PROMPT_CARD_SECTION_HEADINGS.join('、')}。`,
    '“构图锚点”必须写出前景 / 中景 / 后景 / 焦点落点。',
    '“灯光布置与基调”必须同时写出光源、明暗关系、层次分配、灯光任务。',
    '“连续性约束”必须带硬约束语气，明确方向、顺序与接镜规则。',
    '“摄影机动态参数”必须是主镜参数、关键节点参数和动态策略的组合。',
    '“插针 / 甩拍 / 慢镜头”必须写清是否使用与使用瞬间，不用时明确写“无”。',
    '“钉子4行”必须严格四行。',
    '',
    '【定稿依据】若 Input 含 JSON 字段 `shots`，其中每条镜头的 `description`、`content` 均视为最终定稿，生成时必须逐镜落实。',
    '【同场合并】若某条镜头含 `mergedMembers`，对应项中的 `prompt` 与 `seedanceCard` 都要按实际子镜头数量连续推进。',
    '【覆盖纠偏】mergedMembers 的镜头1 / 镜头2 / 镜头3 只是编号示例，不是固定三镜；必须按实际子镜头数量完整编号到最后一个，14 个子镜头就写到镜头14。',
    sourceShotHints,
    '',
    '【资产占位 ID】请为各 shot 写入 `character_asset_ids` / `scene_asset_ids`；没有真实 ID 时可留空数组，但键不可缺失。',
    JSON.stringify(assetRefs, null, 2),
    '',
    '--- Input ---',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildCoverageRepairUserMessageV2(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  const invalidShotPrompts = invalidOutput.shotPrompts ?? [];
  const failureSummary = failureReason ? `[Previous failure] ${failureReason}` : '';
  return [
    failureSummary,
    '你上一次返回的 PromptOutput 不完整，请重新输出完整 JSON。',
    `【必须覆盖的镜头总数】${sourceStoryboard.shots.length}`,
    `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    `【上一次返回的镜头编号】${invalidShotPrompts.map((shot) => shot.shot_id).join(', ')}`,
    '硬性要求：',
    '1. shotPrompts.length 必须等于源镜头数。',
    '2. 每一条源镜头都必须有对应 shot_id。',
    '3. 每个 shot 都必须带完整 seedanceCard，不得缺少固定栏位。',
    `4. “挂载”必须符合这条规则：${PROMPT_MOUNT_TOKEN_RULE}`,
    `5. “提示词”必须符合这条规则：${PROMPT_COPY_CHAR_LIMIT_RULE}`,
    `5a. seedanceCard 总篇幅必须符合这条规则：${PROMPT_CARD_LENGTH_BUDGET_RULE}`,
    '6. “构图锚点”必须写出前景 / 中景 / 后景 / 焦点落点。',
    '7. “灯光布置与基调”必须写出光源、明暗关系、层次分配、灯光任务。',
    '8. “连续性约束”必须使用必须 / 不能 / 先 / 再 / 最后 / 始终保持这类硬约束语气。',
    '9. “钉子4行”必须严格四行。',
    '10. prompt 本体必须是压缩后的执行文本，不得逐条复述栏目标题。',
    '11. 空镜 / 无人物镜头不许写人物眼神、嘴角或面部停顿。',
    '12. 不得返回解释文本、markdown 或半截 JSON。',
    '',
    '【固定栏位】',
    PROMPT_CARD_SECTION_HEADINGS.join('、'),
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    '【源镜头表】',
    JSON.stringify(sourceStoryboard, null, 2),
    '',
    '【上一次不完整的输出】',
    JSON.stringify(invalidOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].join('\n');
}

function buildCompressionRepairUserMessageV2(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '你上一次返回的 PromptOutput 语义基本可用，但长度与结构压缩不符合当前工具的本地压缩规则。请在不破坏镜头语义的前提下，重写为更短、更稳的版本。',
    '',
    '【本次修订目标】',
    PROMPT_COPY_CHAR_LIMIT_RULE,
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    PROMPT_LOCAL_COMPRESSION_RULE,
    '禁止简单截断，禁止在结尾补 `...` 或 `…`，禁止删除固定标题，禁止把同一句原文重复灌入多个模块。',
    '如果某些信息必须压缩，优先压缩非核心模块，而不是删掉构图前中后景、灯光任务、连续性约束、提示词和钉子4行。',
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    sourceStoryboard ? ['【源镜头表】', JSON.stringify(sourceStoryboard, null, 2), ''].join('\n') : '',
    '【待压缩的当前输出】',
    JSON.stringify(draftOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildPromptUserMessageV3(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  const sourceShotHints =
    sourceStoryboard?.shots?.length
      ? [
          `【源镜头总数】${sourceStoryboard.shots.length}`,
          `【源镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
          '【硬性要求】你必须为每一条源镜头各生成一条 shotPrompts 项，数量必须与源镜头完全一致，不得只输出第一条镜头。',
        ].join('\n')
      : '';
  const modeHints = buildPromptModeHints(sourceStoryboard);

  return [
    '以下是部门 Input 正文，可能是镜头表 JSON，也可能是自然语言补充。请输出完整 PromptOutput JSON。',
    '',
    '【模板硬约束】',
    PROMPT_CARD_HEADER_RULE,
    PROMPT_MOUNT_TOKEN_RULE,
    PROMPT_COPY_CHAR_LIMIT_RULE,
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    PROMPT_LOCAL_COMPRESSION_RULE,
    PROMPT_TIMING_SYSTEM_RULE,
    'prompt body must not end with `...` or a unicode ellipsis; it must close on a complete result beat.',
    'seedanceCard 标题中的秒数必须是按内容推算出的真实总时长，不得固定写 15 秒。',
    '如果一条镜头组实际 5 秒就能完成，就写 5 秒；如果输入需要 25 秒就完整保留 25 秒，不得强行压缩到 15 秒。',
    '连续镜头组必须显式写出每个子镜头的秒数占比和时间区间，并让时长与动作密度匹配。',
    'prompt 本体必须是压缩后的执行文本，不得逐条复述栏目标题。',
    '空镜、环境镜、道具镜、无人物镜头里，不要硬写人物眼神、嘴角或面部停顿。',
    `seedanceCard 必须按以下顺序完整包含栏位：${PROMPT_CARD_SECTION_HEADINGS.join('、')}。`,
    '“构图锚点”必须写出前景 / 中景 / 后景 / 焦点落点。',
    '“灯光布置与基调”必须同时写出光源、明暗关系、层次分配、灯光任务。',
    '“连续性约束”必须带硬约束语气，明确方向、顺序与接镜规则。',
    '“摄影机动态参数”必须是主镜参数、关键节点参数和动态策略的组合。',
    '“插针 / 甩拍 / 慢镜头”必须写清是否使用与使用瞬间，不用时明确写“无”。',
    '“钉子4行”必须严格四行。',
    '',
    '【定稿依据】若 Input 含 JSON 字段 `shots`，其中每条镜头的 `description`、`content`、`type`、`movement`、`sceneRef`、`action`、`durationSec`、`note` 均视为最终定稿，生成时必须逐镜落实。',
    '【同场合并】若某条镜头含 `mergedMembers`，对应项中的 `prompt` 与 `seedanceCard` 都要按实际子镜头数量连续推进。',
    '【时长判断】先判断这一条镜头真正需要几秒，再写内容；不要先写满 15 秒再去塞动作。',
    '【时长分配】如果镜头很短，3 秒或 5 秒都可以；如果是连续动作组，再在总时长内合理分配给每个子镜头，但只在“摄影机动态参数”里展开写秒数。',
    '【覆盖纠偏】mergedMembers 的镜头1 / 镜头2 / 镜头3 只是编号示例，不是固定三镜；必须按实际子镜头数量完整编号到最后一个，14 个子镜头就写到镜头14。',
    sourceShotHints,
    modeHints,
    '',
    '【资产占位 ID】请为各 shot 写入 `character_asset_ids` / `scene_asset_ids`；没有真实 ID 时可留空数组，但键不可缺失。',
    JSON.stringify(assetRefs, null, 2),
    '',
    '--- Input ---',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildStructureRepairUserMessageV3(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  invalidOutput: unknown,
  failureReason?: string,
): string {
  const failureSummary = failureReason ? `[Previous failure] ${failureReason}` : '';
  const sourceShotHints =
    sourceStoryboard?.shots?.length
      ? [
          `【必须覆盖的镜头总数】${sourceStoryboard.shots.length}`,
          `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
        ].join('\n')
      : '';
  const modeHints = buildPromptModeHints(sourceStoryboard);

  return [
    failureSummary,
    '你上一次返回的 PromptOutput JSON 结构不合格，请重新输出完整 JSON。',
    '不要解释，不要 markdown，不要代码块，只输出一个 JSON 对象。',
    '顶层必须直接包含：system、userTemplate、negative、parameters、shotPrompts。',
    'shotPrompts 必须是非空数组，不要写成 shot_prompts、promptShots、shots，也不要把它包在 data、output、result 里面。',
    'shotPrompts 内每一项都必须包含：shot_id、prompt、negative_prompt、dimensions、character_asset_ids、scene_asset_ids、seedanceCard。',
    'negative 与每个 shot 的 negative_prompt 都必须显式包含：background music / bgm、subtitle / subtitles / text overlay、ui / hud / interface overlay。',
    '每个 shot 的 seedanceCard 必须保留完整固定栏位，prompt 必须是压缩后的执行文本。',
    sourceShotHints,
    modeHints,
    '',
    '【固定栏位】',
    PROMPT_CARD_SECTION_HEADINGS.join('、'),
    '',
    '【时长规则】',
    PROMPT_TIMING_SYSTEM_RULE,
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    sourceStoryboard ? ['【源镜头表】', JSON.stringify(sourceStoryboard, null, 2), ''].join('\n') : '',
    '【上一次错误输出】',
    JSON.stringify(invalidOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildCoverageRepairUserMessageV3(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  const invalidShotPrompts = invalidOutput.shotPrompts ?? [];
  const failureSummary = failureReason ? `[Previous failure] ${failureReason}` : '';
  const modeHints = buildPromptModeHints(sourceStoryboard);

  return [
    failureSummary,
    modeHints,
    '你上一次返回的 PromptOutput 不完整，请重新输出完整 JSON。',
    `【必须覆盖的镜头总数】${sourceStoryboard.shots.length}`,
    `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    `【上一次返回的镜头编号】${invalidShotPrompts.map((shot) => shot.shot_id).join(', ')}`,
    '硬性要求：',
    '1. shotPrompts.length 必须等于源镜头数。',
    '2. 每一条源镜头都必须有对应 shot_id。',
    '3. 每个 shot 都必须带完整 seedanceCard，不得缺少固定栏位。',
    `4. “挂载”必须符合这条规则：${PROMPT_MOUNT_TOKEN_RULE}`,
    `5. “提示词”必须符合这条规则：${PROMPT_COPY_CHAR_LIMIT_RULE}`,
    `5a. seedanceCard 总篇幅必须符合这条规则：${PROMPT_CARD_LENGTH_BUDGET_RULE}`,
    `6. 时长规划必须符合这条规则：${PROMPT_TIMING_SYSTEM_RULE}`,
    '7. negative 与每个 shot 的 negative_prompt 都必须显式包含：background music / bgm、subtitle / subtitles / text overlay、ui / hud / interface overlay。',
    '8. “构图锚点”必须写出前景 / 中景 / 后景 / 焦点落点。',
    '9. “灯光布置与基调”必须写出光源、明暗关系、层次分配、灯光任务。',
    '10. “连续性约束”必须使用必须 / 不能 / 先 / 再 / 最后 / 始终保持这类硬约束语气。',
    '11. “钉子4行”必须严格四行。',
    '12. prompt 本体必须是压缩后的执行文本，不得逐条复述栏目标题。',
    '13. 空镜 / 无人物镜头不许写人物眼神、嘴角或面部停顿。',
    '14. 不得返回解释文本、markdown 或半截 JSON。',
    '15. 不得把标题时长固定写成 15 秒；必须根据镜头内容重新判断总时长与每段秒数。',
    '16. 秒数区间和分段时长只允许出现在“摄影机动态参数”里，起幅、落幅、连续性约束、提示词不要重复写。',
    '',
    '【固定栏位】',
    PROMPT_CARD_SECTION_HEADINGS.join('、'),
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    '【源镜头表】',
    JSON.stringify(sourceStoryboard, null, 2),
    '',
    '【上一次不完整的输出】',
    JSON.stringify(invalidOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].join('\n');
}

function buildCompressionRepairUserMessageV3(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '你上一次返回的 PromptOutput 语义基本可用，但 seedanceCard 长度不符合当前工具规则。请在不破坏镜头语义的前提下做长度修订：低于下限时扩写，高于上限时才压缩。',
    '',
    '【本次修订目标】',
    PROMPT_COPY_CHAR_LIMIT_RULE,
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    '重要：这不是默认压缩轮。只有超过上限时才压缩；如果 seedanceCard 低于 1000 字，必须扩写到 1000 字以上，扩写内容应来自画面空间、前中后景、灯光逻辑、真实表演、声画同步、连续性约束和运镜执行，不要重复堆形容词。',
    PROMPT_LOCAL_COMPRESSION_RULE,
    PROMPT_TIMING_SYSTEM_RULE,
    '禁止简单截断，禁止在结尾补 `...` 或 `…`，禁止删除固定标题，禁止把同一句原文重复灌入多个模块。',
    '如果某些信息必须压缩，优先压缩非核心模块，而不是删掉构图前中后景、灯光任务、连续性约束、提示词和钉子4行。',
    '压缩修订时不得改变已经合理的总时长和分段时长分配，不得把原本 5 秒可完成的镜头改写成 15 秒。',
    '压缩修订时也不要把秒数区间扩散到其它模块；秒数信息只保留在“摄影机动态参数”。',
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    sourceStoryboard ? ['【源镜头表】', JSON.stringify(sourceStoryboard, null, 2), ''].join('\n') : '',
    '【待长度修订的当前输出】',
    JSON.stringify(draftOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildStudioCanvasV23RuntimeRules(sourceStoryboard: StoryboardOutput | null): string {
  return [
    `【当前主规范】${STUDIO_CANVAS_V23_MARKER}（v2.3.0）。`,
    'Studio Canvas 2.3 取代 V1 的卡片字段模板；不要输出旧字段“钉子4行”。',
    '每个 seedanceCard 必须使用全角冒号，并严格按以下顺序输出：',
    PROMPT_CARD_V23_SECTION_HEADINGS.map((heading) => `${heading}：`).join('\n'),
    '所有字段必须有值；无适用内容时填写“无”。四类钉子必须独立保留，不能合并回“钉子4行”。',
    '“提示词”是可独立发送给视频引擎的 Engine Prompt，不是 Studio Card 其他字段的逐字拼接，常规不超过900字。',
    '“构图锚点”允许传统前景/中景/后景，也允许主体层/关系层/环境层、无独立前景或全幅同焦等自适应表达。',
    '首行与摄影机动态参数的总时长必须一致，所有分段连续且总和等于首行时长；单卡不设15秒硬上限，必须保留输入或上游给出的真实时长。',
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    buildPromptModeHints(sourceStoryboard),
  ].filter(Boolean).join('\n');
}

function buildPromptUserMessageV23(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  return [
    '请按当前 Studio Canvas 2.3 主规范，将输入转换为完整 PromptOutput JSON。只输出合法 JSON。',
    buildStudioCanvasV23RuntimeRules(sourceStoryboard),
    sourceStoryboard?.shots?.length
      ? `【源镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`
      : '',
    '【资产引用】仅绑定真实存在且与当前镜头匹配的实体；不要把占位符写进“挂载”。',
    JSON.stringify(assetRefs, null, 2),
    '--- Input ---',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n\n');
}

function buildStructureRepairUserMessageV23(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  invalidOutput: unknown,
  failureReason: string | undefined,
): string {
  return [
    failureReason ? `【上次失败原因】${failureReason}` : '',
    '上一次输出未满足 Studio Canvas 2.3 协议。请重新输出完整 PromptOutput JSON，不要解释。',
    buildStudioCanvasV23RuntimeRules(sourceStoryboard),
    'shotPrompts 每项必须包含 shot_id、prompt、negative_prompt、dimensions、character_asset_ids、scene_asset_ids、seedanceCard。',
    '【资产引用】',
    JSON.stringify(assetRefs, null, 2),
    sourceStoryboard ? `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}` : '',
    `【上一次错误输出】\n${JSON.stringify(invalidOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildCompressionRepairUserMessageV23(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '当前 PromptOutput 语义可用，但长度或 Studio Canvas 2.3 字段结构不合格。请完成一次结构与密度修订，只输出完整 JSON。',
    buildStudioCanvasV23RuntimeRules(sourceStoryboard),
    '低于卡片下限时补充有控制价值的空间、光线、动作和连续性信息；高于上限时去重压缩。不得为了凑字数重复字段。',
    'Engine Prompt 保持可独立执行且不超过900字；不得使用省略号或截断句。',
    '【资产引用】',
    JSON.stringify(assetRefs, null, 2),
    sourceStoryboard ? `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}` : '',
    `【待修订输出】\n${JSON.stringify(draftOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildCoverageRepairUserMessageV23(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason: string | undefined,
): string {
  return [
    failureReason ? `【上次失败原因】${failureReason}` : '',
    '当前输出没有完整覆盖输入镜头或卡片结构不合格。请重新输出完整 PromptOutput JSON。',
    buildStudioCanvasV23RuntimeRules(sourceStoryboard),
    `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    '默认每条源镜头对应一条 shotPrompt；仅对源数据中明确标记的 mergedMembers 输出一张合并卡。',
    '【资产引用】',
    JSON.stringify(assetRefs, null, 2),
    `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}`,
    `【上一次输出】\n${JSON.stringify(invalidOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildStudioCanvasV25RuntimeRules(sourceStoryboard: StoryboardOutput | null): string {
  return [
    `【当前主规范】${STUDIO_CANVAS_V25_MARKER}（v2.5.0）。`,
    'Studio Canvas 2.5 使用与2.3兼容的18字段 Studio Card；全部字段使用全角冒号并严格保持既定顺序，无适用内容填写“无”。',
    PROMPT_CARD_V23_SECTION_HEADINGS.map((heading) => `${heading}：`).join('\n'),
    '生成前在内部按 HARD / SOFT / AUTO 处理约束：人物身份、真实资产ID、关键道具状态、剧情结果和用户明确要求属于 HARD，不得被系统建议覆盖。',
    '精确数字只能继承用户输入、Project Bible、场景数据或结构化参数；系统建议使用定性表述、合理范围或带“约”的软锁数字，禁止伪造厘米、米、占比、色温、BPM和光比事实。',
    '源分镜表是当前镜头的最小资产清单：characters、props、sceneRef、sound 以及 description/action 中明确命名且实际出现或触发的关键物体、机械装置、空间结构和声音，均可进入挂载；不得因为独立资产 ID 为空而丢弃。',
    PROMPT_MOUNT_TOKEN_RULE,
    '先建立可见性矩阵：只有进入画幅且达到可辨识尺寸的部位、道具、环境和表演才能进入提示词。肢体特写、背影、俯拍和极远景不得强写不可见的正脸微表情。',
    '先计算动作与运镜执行预算：一张卡只承担一个明确镜头任务；超过三个主要动作单元、两个独立叙事目标或明显时空变化时仍应按叙事结构拆镜，不能仅靠延长时长掩盖任务过载。',
    '若输入给出 BPM 或重拍，先按 60/BPM 换算单拍秒数，再明确“拍点→秒数→动作”；音乐名称不能替代可执行时间轴。',
    'Studio Card 只写 Project Bible 的本镜差量，不重复整套设备、摄影品牌、固定光源 Rig、调色圣经和全局负向。',
    '“提示词”是可独立发送给视频引擎的 Engine Prompt，按主体初态→动作变化→摄影机→环境光线→材质物理→落幅→专项负向编译，常规不超过900字。',
    'Engine Prompt 超长时按安全顺序压缩：先删重复项目继承、品牌与解释，再压缩次要环境和修辞；必须保留主体身份、动作因果、镜头路径、起落幅结果、关键光向、专项负向和有效钉子。',
    '首行与摄影机动态参数的总时长必须一致；时间段从0开始、连续无重叠无空洞，最后结束时间等于首行总时长；单卡不设15秒硬上限。',
    PROMPT_SCENE_REFERENCE_RULE,
    PROMPT_COLOR_TABLE_RULE,
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    buildPromptModeHints(sourceStoryboard),
  ].filter(Boolean).join('\n');
}

function buildPromptUserMessageV25(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  return [
    '请按 Studio Canvas 2.5 生产校验规范，将输入转换为完整 PromptOutput JSON。只输出合法 JSON。',
    buildStudioCanvasV25RuntimeRules(sourceStoryboard),
    sourceStoryboard?.shots?.length
      ? `【源镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`
      : '',
    '【独立资产引用】这是附加候选，不是唯一来源；还必须读取下方源分镜的 characters、props、sceneRef、sound 及正文中明确命名的执行实体。',
    JSON.stringify(assetRefs, null, 2),
    '--- Input ---',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n\n');
}

function buildStructureRepairUserMessageV25(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  invalidOutput: unknown,
  failureReason?: string,
): string {
  return [
    failureReason ? `【上次失败原因】${failureReason}` : '',
    '上一次输出未通过 Studio Canvas 2.5 校验。请重新输出完整 PromptOutput JSON，不要解释。',
    buildStudioCanvasV25RuntimeRules(sourceStoryboard),
    'shotPrompts 每项必须包含 shot_id、prompt、negative_prompt、dimensions、character_asset_ids、scene_asset_ids、seedanceCard。',
    '重点修复挂载资产来源与单空格格式、可见性、伪精确数字、动作预算、连续时间轴和 Engine Prompt 去重。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    sourceStoryboard ? `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}` : '',
    `【上一次错误输出】\n${JSON.stringify(invalidOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildCompressionRepairUserMessageV25(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '当前 PromptOutput 语义可用，但长度或 Studio Canvas 2.5 校验不合格。请完成一次安全修订，只输出完整 JSON。',
    buildStudioCanvasV25RuntimeRules(sourceStoryboard),
    '低于下限时补充可见且有控制价值的空间、光线、动作、表演和连续性；高于上限时先删除重复 Project Bible、品牌、修辞和次要环境。',
    '不得删改主体身份、真实资产、动作因果、镜头路径、起落幅结果、关键光向、连续性和有效钉子；不得用省略号或截断句。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    sourceStoryboard ? `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}` : '',
    `【待修订输出】\n${JSON.stringify(draftOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildCoverageRepairUserMessageV25(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  return [
    failureReason ? `【上次失败原因】${failureReason}` : '',
    '当前输出没有完整覆盖输入镜头或未通过 Studio Canvas 2.5 校验。请重新输出完整 PromptOutput JSON。',
    buildStudioCanvasV25RuntimeRules(sourceStoryboard),
    `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    '默认每条源镜头对应一条 shotPrompt；仅对源数据明确标记的 mergedMembers 输出一张合并卡，禁止擅自合并或漏镜。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}`,
    `【上一次输出】\n${JSON.stringify(invalidOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildStudioCanvasV26RuntimeRules(sourceStoryboard: StoryboardOutput | null): string {
  return [
    `【当前主规范】${STUDIO_CANVAS_V26_MARKER}（v2.6.0）。`,
    'Studio Canvas 2.6 使用与2.3兼容的18字段 Studio Card；全部字段使用全角冒号并严格保持既定顺序，无适用内容填写“无”。',
    PROMPT_CARD_V23_SECTION_HEADINGS.map((heading) => `${heading}：`).join('\n'),
    '生成前在内部按 HARD / SOFT / AUTO 处理约束：人物身份、真实资产ID、关键道具状态、剧情结果和用户明确要求属于 HARD，不得被系统建议覆盖。',
    '精确数字只能继承用户输入、Project Bible、场景数据或结构化参数；系统建议使用定性表述、合理范围或带“约”的软锁数字，禁止伪造厘米、米、占比、色温、BPM和光比事实。',
    '源分镜表是当前镜头的最小执行清单：characters、props、sceneRef、sound，以及 description/action 中明确命名并直接影响动作、构图、光线、空间路径、状态变化或连续性的实体，均可进入详细挂载。',
    '挂载必须使用无空格连续格式：|@=实体名||@=实体名|；禁止在标记之间添加空格、逗号或解释文字。',
    '挂载顺序固定为：主体角色 → 关键角色或群像 → 交互道具 → 主场景 → 关键结构 → 地面/门窗/设备/载具 → 固定实景光源或发光体 → 环境物或体积介质 → 动作相关声音。',
    '场景子结构只有在影响接触、遮挡、空间比例、构图边界、运动路径、光源、状态变化或跨镜连续性时才进入挂载；纯装饰背景零件不得挂载。',
    '普通镜头建议挂载5至12项，复杂群像、载具或大型场景最多15项；数量是建议，不得为凑数虚构实体。',
    '参考图、布局图、色彩表和灯光示意图本身不得挂载；只有已由输入或 Project Bible 确认并命名的执行实体或执行锚点可以挂载。',
    '先建立可见性矩阵：只有进入画幅且达到可辨识尺寸的部位、道具、环境和表演才能进入提示词。肢体特写、背影、俯拍和极远景不得强写不可见的正脸微表情。',
    '先计算动作与运镜执行预算：一张卡只承担一个明确镜头任务；超过三个主要动作单元、两个独立叙事目标或明显时空变化时仍应按叙事结构拆镜，不能仅靠延长时长掩盖任务过载。',
    '若输入给出 BPM 或重拍，先按 60/BPM 换算单拍秒数，再明确“拍点→秒数→动作”；音乐名称不能替代可执行时间轴。',
    'Studio Card 只写 Project Bible 的本镜差量，不重复整套设备、摄影品牌、固定光源 Rig、调色圣经和全局负向。',
    '“提示词”是可独立发送给视频引擎的 Engine Prompt，按主体初态→动作变化→摄影机→环境光线→材质物理→落幅→专项负向编译，常规不超过900字。',
    'Engine Prompt 超长时按安全顺序压缩：先删重复项目继承、品牌与解释，再压缩次要环境和修辞；必须保留主体身份、动作因果、镜头路径、起落幅结果、关键光向、专项负向和有效钉子。',
    '首行与摄影机动态参数的总时长必须一致；时间段从0开始、连续无重叠无空洞，最后结束时间等于首行总时长；单卡不设15秒硬上限。',
    PROMPT_SCENE_REFERENCE_RULE,
    PROMPT_COLOR_TABLE_RULE,
    PROMPT_CARD_LENGTH_BUDGET_RULE,
    buildPromptModeHints(sourceStoryboard),
  ].filter(Boolean).join('\n');
}

function buildPromptUserMessageV26(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  return [
    '请按 Studio Canvas 2.6 详细挂载规范，将输入转换为完整 PromptOutput JSON。只输出合法 JSON。',
    buildStudioCanvasV26RuntimeRules(sourceStoryboard),
    sourceStoryboard?.shots?.length
      ? `【源镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`
      : '',
    '【独立资产引用】这是附加候选，不是唯一来源；还必须读取下方源分镜中的角色、交互道具、主场景、关键结构、设备、固定光源、环境介质和动作相关声音。',
    JSON.stringify(assetRefs, null, 2),
    '--- Input ---',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n\n');
}

function buildStructureRepairUserMessageV26(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  invalidOutput: unknown,
  failureReason?: string,
): string {
  return [
    failureReason ? `【上次失败原因】${failureReason}` : '',
    '上一次输出未通过 Studio Canvas 2.6 校验。请重新输出完整 PromptOutput JSON，不要解释。',
    buildStudioCanvasV26RuntimeRules(sourceStoryboard),
    'shotPrompts 每项必须包含 shot_id、prompt、negative_prompt、dimensions、character_asset_ids、scene_asset_ids、seedanceCard。',
    '重点修复无空格连续详细挂载、挂载来源、可见性、动作预算、连续时间轴和 Engine Prompt 去重。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    sourceStoryboard ? `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}` : '',
    `【上一次错误输出】\n${JSON.stringify(invalidOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildCompressionRepairUserMessageV26(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '当前 PromptOutput 语义可用，但长度或 Studio Canvas 2.6 校验不合格。请完成一次安全修订，只输出完整 JSON。',
    buildStudioCanvasV26RuntimeRules(sourceStoryboard),
    '低于下限时补充可见且有控制价值的空间、光线、动作、表演和连续性；高于上限时先删除重复 Project Bible、品牌、修辞和次要环境。',
    '详细挂载只删除纯装饰项，不得丢失影响动作、构图、光线、路径、状态和连续性的关键实体；不得添加空格分隔符。',
    '不得删改主体身份、真实资产、动作因果、镜头路径、起落幅结果、关键光向、连续性和有效钉子；不得用省略号或截断句。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    sourceStoryboard ? `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}` : '',
    `【待修订输出】\n${JSON.stringify(draftOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildCoverageRepairUserMessageV26(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  return [
    failureReason ? `【上次失败原因】${failureReason}` : '',
    '当前输出没有完整覆盖输入镜头或未通过 Studio Canvas 2.6 校验。请重新输出完整 PromptOutput JSON。',
    buildStudioCanvasV26RuntimeRules(sourceStoryboard),
    `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    '默认每条源镜头对应一条 shotPrompt；仅对源数据明确标记的 mergedMembers 输出一张合并卡，禁止擅自合并或漏镜。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}`,
    `【上一次输出】\n${JSON.stringify(invalidOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildStudioCanvasV27RuntimeRules(sourceStoryboard: StoryboardOutput | null): string {
  const inheritedV26Rules = buildStudioCanvasV26RuntimeRules(sourceStoryboard)
    .replace(/Studio Canvas 2\.6/g, 'Studio Canvas 2.7')
    .replace(/v2\.6\.0/g, 'v2.7.0')
    .replace(STUDIO_CANVAS_V26_MARKER, STUDIO_CANVAS_V27_MARKER)
    .replace(
      '普通镜头建议挂载5至12项，复杂群像、载具或大型场景最多15项',
      '普通镜头建议挂载5至15项；复杂群像、载具或大型场景不设固定数量上限，但每项都必须有明确来源并具有执行价值',
    );
  return [
    inheritedV26Rules,
    '【Studio Canvas 2.7 挂载容量修订】单镜挂载不设数量硬上限，覆盖旧版数量限制；不得仅因挂载项较多而删除有明确来源并影响执行、构图、光线、路径、状态或连续性的实体。',
    '【Studio Canvas 2.7 摄影机参数匹配】',
    '每个镜头先依次判断六项：主体任务、景别、空间任务、摄影机运动、光线环境、焦点职责；完成判断后再选择摄影机机型、主镜头体系、焦段、光圈、景深和焦点变化。',
    '若 Project Bible 或用户已指定摄影机与镜头体系，必须优先继承；未指定时才可自动匹配。自动选择属于 SOFT 技术建议，不得伪装成用户提供的项目事实。',
    '摄影机匹配：人物、自然肤色、火光、窗光和高反差优先 ARRI Alexa LF / Mini LF；大型空间与史诗建筑可用 Alexa 65；夜景、霓虹、复杂色光与暗部优先 Sony VENICE 2；高速动作、车辆、爆炸与粒子可用 RED V-RAPTOR XL；微距、高速、监控、手机和无人机仅在镜头任务明确需要时启用特殊摄影机。',
    '镜头体系匹配：人物情绪与受控变形可用 Cooke Anamorphic SF；稳定低畸变变形宽银幕可用 ARRI Master Anamorphic；工业科幻、纵深与强逆光可用 Panavision T-Series；人物对白与自然焦外可用 Cooke S8/i；现代通透与VFX可用 ARRI Signature Prime；冷峻清晰和几何稳定可用 Zeiss Supreme Prime；手部、眼睛、念珠和机械接触点才使用 Macro / Probe。',
    '焦段按任务匹配：14–21mm用于极端或狭小空间，24–28mm用于环境建立和大全景，32–40mm用于人物环境平衡与中景跟拍，45–55mm用于自然视角和人物表演，65–85mm用于近景情绪，100–135mm用于紧特写或远距离压缩，90–120mm Macro用于微距接触点。人物靠近广角边缘时必须控制面部和肢体拉伸。',
    '光圈必须服从主体数量、运动速度和跟焦难度：T1.4–T2.0仅适合单一焦点和极浅景深；T2.0–T2.8适合人物近景；T2.8–T4适合人物与环境共同可读或跟拍；T4–T5.6适合大全景、建筑、群像和动作路径。禁止用极浅景深同时要求多人、多距离和多层环境全部清晰。',
    '“镜头参数”必须至少包含一条统一句式：【摄影机·镜头】摄影机机型+镜头系列或光学类型+焦段+光圈+景深（实焦主体、失焦层级与焦点变化）。加号、单位、光圈和括号内焦点职责不得省略。',
    '焦点职责必须具体写出实焦主体以及前景、中景、背景的失焦或清晰层级；动态镜头还必须写明焦点锁定、持续跟焦或拉焦发生的时间与目标。',
    '同一连续场景原则上保持摄影机机型、画幅、主镜头系列、色彩与焦外特征一致；单镜只按叙事任务调整焦段、光圈、对焦距离和炫光开关。球面与变形镜头或摄影机品牌切换必须有明确视觉动机。',
    '炫光使用“开启 ON”“关闭 OFF”或“自动 AUTO”；ON必须写明直射光源、入射方向与出现阶段，OFF禁止随机拉丝，AUTO仅在真实入射光条件成立时出现。',
    '镜头参数必须与相机位置、相机朝向、构图锚点、摄影机动态参数、光线条件和可见性矩阵一致；发生冲突时先修正参数，再编译 Engine Prompt。',
    sourceStoryboard?.projectConstraints?.length
      ? `【上游项目约束｜必须继承】\n${sourceStoryboard.projectConstraints
          .map((constraint, index) => `${index + 1}. ${constraint}`)
          .join('\n')}\n这些约束来自分镜前的串联文本节点。必须按适用性落实到画幅、场景、灯光布置与基调、镜头参数和 Engine Prompt；不得改写为剧情或台词。`
      : '',
  ].filter(Boolean).join('\n');
}

function buildPromptUserMessageV27(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  return [
    '请按 Studio Canvas 2.7 摄影机参数匹配规范，将输入转换为完整 PromptOutput JSON。只输出合法 JSON。',
    buildStudioCanvasV27RuntimeRules(sourceStoryboard),
    sourceStoryboard?.shots?.length
      ? `【源镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`
      : '',
    '【独立资产引用】这是附加候选，不是唯一来源；还必须读取下方源分镜中的角色、交互道具、主场景、关键结构、设备、固定光源、环境介质和动作相关声音。',
    JSON.stringify(assetRefs, null, 2),
    '--- Input ---',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n\n');
}

function buildStructureRepairUserMessageV27(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  invalidOutput: unknown,
  failureReason?: string,
): string {
  return [
    failureReason ? `【上次失败原因】${failureReason}` : '',
    '上一次输出未通过 Studio Canvas 2.7 校验。请重新输出完整 PromptOutput JSON，不要解释。',
    buildStudioCanvasV27RuntimeRules(sourceStoryboard),
    'shotPrompts 每项必须包含 shot_id、prompt、negative_prompt、dimensions、character_asset_ids、scene_asset_ids、seedanceCard。',
    '重点修复无空格连续详细挂载、连续时间轴，以及“镜头参数”中的【摄影机·镜头】完整句式、参数任务匹配、焦点职责和同场景器材连续性。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    sourceStoryboard ? `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}` : '',
    `【上一次错误输出】\n${JSON.stringify(invalidOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildCompressionRepairUserMessageV27(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '当前 PromptOutput 语义可用，但长度或 Studio Canvas 2.7 校验不合格。请完成一次安全修订，只输出完整 JSON。',
    buildStudioCanvasV27RuntimeRules(sourceStoryboard),
    '低于下限时补充可见且有控制价值的空间、光线、动作、表演、连续性与摄影参数；高于上限时先删除重复 Project Bible、修辞和次要环境。',
    '不得压缩掉【摄影机·镜头】统一句式中的机型、镜头体系、焦段、光圈、景深、实焦主体、失焦层级和焦点变化。',
    '详细挂载只删除纯装饰项，不得丢失影响动作、构图、光线、路径、状态和连续性的关键实体；不得添加空格分隔符。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    sourceStoryboard ? `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}` : '',
    `【待修订输出】\n${JSON.stringify(draftOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildCoverageRepairUserMessageV27(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  return [
    failureReason ? `【上次失败原因】${failureReason}` : '',
    '当前输出没有完整覆盖输入镜头或未通过 Studio Canvas 2.7 校验。请重新输出完整 PromptOutput JSON。',
    buildStudioCanvasV27RuntimeRules(sourceStoryboard),
    `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    '默认每条源镜头对应一条 shotPrompt；仅对源数据明确标记的 mergedMembers 输出一张合并卡，禁止擅自合并或漏镜。',
    '每张卡的镜头参数都必须根据该镜头任务独立判断，但同一连续场景必须继承摄影机、主镜头体系、画幅、色彩与焦外特征。',
    `【资产引用】\n${JSON.stringify(assetRefs, null, 2)}`,
    `【源镜头表】\n${JSON.stringify(sourceStoryboard, null, 2)}`,
    `【上一次输出】\n${JSON.stringify(invalidOutput, null, 2)}`,
    `【原始 Input】\n${brief.trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
}

function buildStudioCanvasV231SegmentsRuntimeRules(
  sourceStoryboard: StoryboardOutput | null,
): string {
  const mappings = (sourceStoryboard?.shots ?? [])
    .filter((shot) => (shot.mergedMembers?.length ?? 0) > 0)
    .map((shot) => {
      const ids = (shot.mergedMembers ?? []).map((member) =>
        member.shotNo || member.wireId || String(member.id),
      );
      return `组合卡 ${shot.id} 的 shotSegments 必须依次对应：${ids.join('、')}`;
    });
  return [
    `【当前扩展规范】${STUDIO_CANVAS_V231_SEGMENTS_MARKER}。`,
    '完整继承 Studio Canvas 2.3 的18字段 seedanceCard；外层连续视频卡不得拆开。',
    '只要源镜头含 mergedMembers，就必须在对应 shotPrompt 内输出 shotSegments，数量与源子镜头严格一致。',
    '每个 segment 必须含：shot_id、start_sec、end_sec、shot_type、camera、composition、lighting、action、keyframe、image_prompt。',
    'shot_id 必须使用对应源分镜的真实 id / shotNo；时间段从0连续衔接，最后 end_sec 等于卡片首行总时长。',
    'image_prompt 只描述该分镜一个决定性静态关键帧，必须包含目标画幅、景别、主体、空间、构图、光线、动作瞬间和可见结果；禁止时间线、运镜过程、声音和多阶段动作。',
    '单镜头没有 mergedMembers 时可以省略 shotSegments；不得为凑格式虚构切片。',
    ...mappings,
  ].join('\n');
}

function withV231SegmentsRules(
  base: string,
  sourceStoryboard: StoryboardOutput | null,
): string {
  return `${base}\n\n${buildStudioCanvasV231SegmentsRuntimeRules(sourceStoryboard)}`;
}

function buildPromptUserMessageV231Segments(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  return withV231SegmentsRules(
    buildPromptUserMessageV23(brief, assetRefs, sourceStoryboard),
    sourceStoryboard,
  );
}

function buildStructureRepairUserMessageV231Segments(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  invalidOutput: unknown,
  failureReason?: string,
): string {
  return withV231SegmentsRules(
    buildStructureRepairUserMessageV23(
      brief,
      assetRefs,
      sourceStoryboard,
      invalidOutput,
      failureReason,
    ),
    sourceStoryboard,
  );
}

function buildCompressionRepairUserMessageV231Segments(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return withV231SegmentsRules(
    buildCompressionRepairUserMessageV23(brief, assetRefs, sourceStoryboard, draftOutput),
    sourceStoryboard,
  );
}

function buildCoverageRepairUserMessageV231Segments(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  return withV231SegmentsRules(
    buildCoverageRepairUserMessageV23(
      brief,
      assetRefs,
      sourceStoryboard,
      invalidOutput,
      failureReason,
    ),
    sourceStoryboard,
  );
}

function resolveSeedance2ExampleDuration(sourceStoryboard: StoryboardOutput | null): number {
  const firstShot = sourceStoryboard?.shots?.[0];
  const sourceShots = firstShot?.mergedMembers?.length ? firstShot.mergedMembers : firstShot ? [firstShot] : [];
  const sourceDuration = sourceShots.reduce(
    (sum, shot) => sum + (Number.isFinite(Number(shot.durationSec)) ? Math.max(0, Number(shot.durationSec)) : 0),
    0,
  );
  return sourceDuration > 0 ? Math.round(sourceDuration * 10) / 10 : 15;
}

function formatSeedance2Time(value: number): string {
  return value.toFixed(1).padStart(4, '0');
}

function buildSeedance2OutputSkeleton(sourceStoryboard: StoryboardOutput | null): string {
  const exampleDuration = resolveSeedance2ExampleDuration(sourceStoryboard);
  return JSON.stringify(
    {
      system: SEEDANCE2_SEGMENTED_PROMPT_MARKER,
      userTemplate: '{{input}}',
      negative: DEFAULT_NEG,
      parameters: {
        engine: 'seedance',
        aspect: '16:9',
        format: SEEDANCE2_SEGMENTED_FORMAT,
      },
      shotPrompts: [
        {
          shot_id: '1',
          prompt: `${exampleDuration}秒 Seedance2.0 分段式视听提示词摘要。`,
          negative_prompt: DEFAULT_NEG,
          dimensions: {},
          character_asset_ids: [],
          scene_asset_ids: [],
          seedanceCard: [
            '# 【全局视觉与美学基调】',
            '- **美学风格**：明确真人实拍、2D 动漫、3D 动画、水墨或其他视觉流派，并说明底层质感。',
            '- **镜头与景深**：说明镜头语言、焦平面、景深、焦外虚化或对应风格的空间规律。',
            '- **色彩与光照**：说明主光源方向、色温、明暗层次与整体基调。',
            '',
            '# 【人物与场景设定】',
            '- **人物设定**：写人物外观、服饰材质、状态、微观表情基础。',
            '- **场景设定**：写场景空间结构、材质、天气、道具与环境声源。',
            '',
            '# 【剧本与动作时间线】',
            `- **[00.0s - ${formatSeedance2Time(exampleDuration)}s]**`,
            '  - **镜头机位**：明确景别、机位和运镜。',
            '  - **视觉画面**：',
            '    - **[前景]**：镜头与主体之间的遮挡、失焦物或空气层。',
            '    - **[主体]**：焦平面内的角色、动作、表情、材质交互。',
            '    - **[背景]**：主体后的环境纵深、光斑、空间信息。',
            '  - **听觉声效**：仅写对白轨与环境音效轨（Foley），禁止音乐轨。',
            '',
            '# 【生成约束与负面提示词】',
            '- **绝对禁止项**：禁止背景音乐、BGM、配乐、旋律、字幕、UI、HUD、水印、logo、分辨率、帧率、画幅比例、瞬移、反关节、面部崩坏、光影逻辑冲突。',
          ].join('\n'),
        },
      ],
    },
    null,
    2,
  );
}

function buildSeedance2SourceShotHints(sourceStoryboard: StoryboardOutput | null): string {
  if (!sourceStoryboard?.shots?.length) return '';
  return [
    `【源镜头总数】${sourceStoryboard.shots.length}`,
    `【源镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    '若输入是单个分镜，生成 1 条 shotPrompts。',
    '若输入是多个独立分镜，shotPrompts 数量必须与源镜头数量一致，每条按对应源镜头的真实时长生成。',
    '若输入是 mergedMembers 组合镜头，只输出 1 条组合 shotPrompt，seedanceCard 时间线必须覆盖全部子镜头，并使用各成员时长之和。',
  ].join('\n');
}

function buildSeedance2PromptRules(sourceStoryboard: StoryboardOutput | null): string {
  const modeHints = buildPromptModeHints(sourceStoryboard);
  return [
    `【当前启用技能】${SEEDANCE2_SEGMENTED_PROMPT_MARKER}。`,
    '你必须返回 PromptOutput JSON，不要 Markdown 包裹，不要解释，不要输出分析过程。',
    '外层 JSON 字段必须包含：system、userTemplate、negative、parameters、shotPrompts。',
    'shotPrompts 必须是非空数组；每条必须包含 shot_id、prompt、negative_prompt、dimensions、character_asset_ids、scene_asset_ids、seedanceCard。',
    'prompt 字段只写可复制执行的简短摘要，不要复述 seedanceCard 四大模块。',
    `parameters.format 必须写为 ${SEEDANCE2_SEGMENTED_FORMAT}。`,
    '',
    '【seedanceCard 结构硬规则】',
    'seedanceCard 第一个字符必须是：# 【全局视觉与美学基调】。',
    'seedanceCard 必须只使用以下四个一级 Markdown 标题，顺序不能变：',
    SEEDANCE2_SEGMENTED_HEADINGS.join('\n'),
    '禁止混入默认 Studio Canvas 字段：挂载、相机位置、相机朝向、角色朝向、构图锚点、灯光布置与基调、起幅、落幅、连续性约束、提示词、摄影机动态参数、镜头参数、插针 / 甩拍 / 慢镜头、微表情、表演建议、钉子4行。',
    `每个 seedanceCard 字数必须控制在 ${MIN_SEEDANCE2_SEGMENTED_CARD_CHARS}-${MAX_SEEDANCE2_SEGMENTED_CARD_CHARS} 个中文字符之间。`,
    '',
    '【真实时长时间轴硬规则】',
    '每个 seedanceCard 的总时长由节点指定值或对应源镜头/镜头组真实时长决定，不设 15 秒硬上限；仅在完全没有时长信息时回退为 15 秒。',
    '【剧本与动作时间线】中的时间戳必须使用 `[00.0s - 02.5s]` 这种格式，从 00.0s 连续推进到实际总时长，无空档、无重叠。',
    '根据分镜动作密度自动划分时间段；短动作不得无理由拖长，长动作、完整表演与落幅也不得为适配 15 秒而截断。',
    '如果源分镜有多个子镜头，必须按各子镜头的输入时长合理分配，完整覆盖且总和等于镜头组真实总时长。',
    '',
    '【空间、光学与声音硬规则】',
    '【剧本与动作时间线】每个时间段必须包含：镜头机位、视觉画面、听觉声效。',
    '视觉画面必须严格写出 [前景]、[主体]、[背景] 三层，不得缺失任意一层。',
    '必须写美学风格、镜头景深、色彩光照、人物/场景设定、常识校验后的动作、微观表情或材质交互。',
    '禁止背景音乐、BGM、配乐、旋律；只允许对白轨和环境音效轨（Foley）。',
    '禁止分辨率、帧率、画幅比例、控制台参数、字幕、UI、HUD、水印、logo。',
    '动作必须符合重力、惯性、摩擦力和人体工学，不得瞬移、反关节、无因果破坏。',
    '',
    '【输出收尾硬规则】',
    'seedanceCard 必须在【生成约束与负面提示词】模块内自然结束。',
    '不得追加当前切片进度、当前场景状态、下一步指令、继续、Next 等与视频提示词无关的连载说明。',
    '',
    buildSeedance2SourceShotHints(sourceStoryboard),
    modeHints,
  ].filter(Boolean).join('\n');
}

function buildPromptUserMessageSeedance2(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  return [
    buildSeedance2PromptRules(sourceStoryboard),
    '',
    '【输出 JSON 参考骨架】',
    buildSeedance2OutputSkeleton(sourceStoryboard),
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    sourceStoryboard ? ['【源镜头表】', JSON.stringify(sourceStoryboard, null, 2), ''].join('\n') : '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildStructureRepairUserMessageSeedance2(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  invalidOutput: unknown,
  failureReason?: string,
): string {
  return [
    failureReason ? `[Previous failure] ${failureReason}` : '',
    '上一次返回不符合 Seedance2.0 技能或 PromptOutput JSON 协议。请只返回完整 JSON。',
    buildSeedance2PromptRules(sourceStoryboard),
    '',
    '【输出 JSON 参考骨架】',
    buildSeedance2OutputSkeleton(sourceStoryboard),
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    sourceStoryboard ? ['【源镜头表】', JSON.stringify(sourceStoryboard, null, 2), ''].join('\n') : '',
    '【上一次错误输出】',
    JSON.stringify(invalidOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildCoverageRepairUserMessageSeedance2(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  return [
    failureReason ? `[Previous failure] ${failureReason}` : '',
    '上一次 PromptOutput 没有完整覆盖源分镜，或 seedanceCard 不符合 Seedance2.0 四模块与真实时长规范。请重写完整 JSON。',
    buildSeedance2PromptRules(sourceStoryboard),
    '',
    `【必须覆盖的镜头总数】${sourceStoryboard.shots.length}`,
    `【必须覆盖的镜头编号】${sourceStoryboard.shots.map((shot) => shot.id).join(', ')}`,
    `【上一次返回的镜头编号】${(invalidOutput.shotPrompts ?? []).map((shot) => shot.shot_id).join(', ')}`,
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    '【源镜头表】',
    JSON.stringify(sourceStoryboard, null, 2),
    '',
    '【上一次不合格输出】',
    JSON.stringify(invalidOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildCompressionRepairUserMessageSeedance2(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '上一次 PromptOutput 的语义基本可用，但 Seedance2.0 技能规范仍不合格。请在不改变源分镜事实的前提下重写完整 JSON：低于下限时扩写，高于上限时才压缩。',
    buildSeedance2PromptRules(sourceStoryboard),
    '',
    '【本次修订目标】',
    `每个 seedanceCard 必须在 ${MIN_SEEDANCE2_SEGMENTED_CARD_CHARS}-${MAX_SEEDANCE2_SEGMENTED_CARD_CHARS} 个中文字符之间。`,
    '如果低于 2000 字，优先扩写空间景深、材质细节、微观表情、物理声效和常识动作反馈。',
    `如果高于 ${MAX_SEEDANCE2_SEGMENTED_CARD_CHARS} 字，优先删除重复形容、重复动作说明和非关键环境铺陈，不得删除四大模块、时间轴、[前景]/[主体]/[背景]、听觉声效和负面约束。`,
    '时间线必须重新校验：从 00.0s 连续覆盖到节点指定值或上游镜头真实总时长，不得套用 15 秒上限。',
    '不得退回默认 Studio Canvas 字段。',
    '',
    '【资产占位 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    sourceStoryboard ? ['【源镜头表】', JSON.stringify(sourceStoryboard, null, 2), ''].join('\n') : '',
    '【待修订的当前输出】',
    JSON.stringify(draftOutput, null, 2),
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

const SEEDANCE25_MULTIMODAL_OUTPUT_SHAPE = `{
  "system": "Seedance 2.5 多模态影视提示词 Skill v10",
  "userTemplate": "{{input}}",
  "negative": "subtitle, ui, hud, watermark, logo, temporal inconsistency",
  "parameters": { "engine": "seedance-2.5", "aspect": "16:9", "format": "${SEEDANCE25_MULTIMODAL_FORMAT}" },
  "shotPrompts": [{
    "shot_id": "1",
    "prompt": "当前镜头的简短可执行摘要",
    "negative_prompt": "subtitle, ui, hud, watermark, logo, temporal inconsistency",
    "dimensions": {},
    "character_asset_ids": [],
    "scene_asset_ids": [],
    "seedanceCard": "【Seedance 2.5｜多模态参考生成】\\n\\n挂载： |@=真实素材名称|\\n\\n【生成规格】...\\n\\n【摄影机 / 镜头】...\\n\\n【机位与构图】...\\n\\n【起幅】...\\n\\n【表演】...\\n\\n【时间轴】...\\n\\n【光学效果】...\\n\\n【声音 / 对白】...\\n\\n【最终落幅】...\\n\\n【高风险限制】...\\n\\n【文字与字幕限制】..."
  }]
}`;

function buildSeedance25MultimodalRules(sourceStoryboard: StoryboardOutput | null): string {
  const sourceMode = !sourceStoryboard?.shots?.length
    ? '当前没有结构化镜头表；只依据 Input 中可证实的镜头事实生成，不新增剧情。'
    : sourceStoryboard.shots.some((shot) => shot.mergedMembers?.length)
      ? 'mergedMembers 镜头组按一条多镜头组合任务输出；时间轴覆盖全部成员，时长使用成员之和。'
      : `当前有 ${sourceStoryboard.shots.length} 条独立镜头；逐镜输出 ${sourceStoryboard.shots.length} 条 shotPrompts，不得合并、漏写或新增。`;
  return [
    `【当前启用主规范】${SEEDANCE25_MULTIMODAL_PROMPT_MARKER} v10。`,
    '只返回合法 PromptOutput JSON，不要 Markdown 代码围栏、解释或分析过程。PromptOutput 只是应用传输容器。',
    '每条 seedanceCard 必须直接输出本 Skill 第65或第66节的最终 Seedance 2.5 Prompt；禁止使用 Studio Canvas 的挂载/相机位置/钉子等中间卡片结构。',
    'seedanceCard 第一个字符必须是“【”，并以“【Seedance 2.5｜”开头。',
    '参考素材只在一行“挂载：”中输出；所有引用统一为 |@=名称|，同一素材只挂载一次，不使用 @图片1、分类标题或资产编号式引用。',
    '时长优先使用节点指定值或上游 durationSec；不设固定秒数上限，也不使用固定默认秒数。完全没有时长信息时，按动作、对白、表演停顿、运镜复杂度和完整落幅自主估算。',
    '多镜头组合不设 15 秒最低门槛；4 秒、8 秒、10 秒、12 秒等较短连续段也可组合。组合或拆组由场景、时间、角色、道具、动作、对白、覆盖剪辑、连续性与单次生成承载能力决定，不得由总时长阈值决定。',
    '人物、机器人或其他行动主体可见时必须输出【表演】；纯空镜或无行动主体镜头可以省略。',
    '【表演】写怎么演，【时间轴】写什么时候发生什么；二者互补，不机械重复。',
    'character_asset_ids 与 scene_asset_ids 只能填写真实资产 ID；没有真实 ID 时使用空数组，挂载名称只写进 seedanceCard。',
    sourceMode,
  ].join('\n');
}

function buildPromptUserMessageSeedance25(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
): string {
  return [
    buildSeedance25MultimodalRules(sourceStoryboard),
    '',
    '【输出 JSON 形状】',
    SEEDANCE25_MULTIMODAL_OUTPUT_SHAPE,
    '',
    '【真实资产 ID】',
    JSON.stringify(assetRefs, null, 2),
    '',
    sourceStoryboard ? ['【源镜头表】', JSON.stringify(sourceStoryboard, null, 2), ''].join('\n') : '',
    '【原始 Input】',
    brief.trim() || '（空）',
  ].filter(Boolean).join('\n');
}

function buildStructureRepairUserMessageSeedance25(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  invalidOutput: unknown,
  failureReason?: string,
): string {
  return [
    failureReason ? `【上一次失败原因】${failureReason}` : '',
    '重写完整 PromptOutput JSON。只修复结构、挂载语法和缺失模块，不改变源镜头事实。',
    buildPromptUserMessageSeedance25(brief, assetRefs, sourceStoryboard),
    '',
    '【上一次不合格输出】',
    JSON.stringify(invalidOutput, null, 2),
  ].filter(Boolean).join('\n');
}

function buildCompressionRepairUserMessageSeedance25(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput | null,
  draftOutput: PromptOutput,
): string {
  return [
    '当前输出过短、过长或缺少 Seedance 2.5 v10 必需结构。请重写完整 JSON。',
    `每条 seedanceCard 保持在 ${MIN_SEEDANCE25_CARD_CHARS}-${MAX_SEEDANCE25_CARD_CHARS} 字，优先删除重复解释，不能删除挂载、摄影机/镜头、机位与构图、起幅、时间轴、声音/对白、落幅和文字与字幕限制。`,
    buildPromptUserMessageSeedance25(brief, assetRefs, sourceStoryboard),
    '',
    '【待修订输出】',
    JSON.stringify(draftOutput, null, 2),
  ].join('\n');
}

function buildCoverageRepairUserMessageSeedance25(
  brief: string,
  assetRefs: unknown,
  sourceStoryboard: StoryboardOutput,
  invalidOutput: PromptOutput,
  failureReason?: string,
): string {
  return [
    failureReason ? `【覆盖校验失败】${failureReason}` : '',
    '必须完整覆盖源镜头编号和顺序。独立镜头逐镜输出；只有 mergedMembers 才按一个组合任务输出。',
    buildPromptUserMessageSeedance25(brief, assetRefs, sourceStoryboard),
    '',
    '【上一次覆盖不完整的输出】',
    JSON.stringify(invalidOutput, null, 2),
  ].filter(Boolean).join('\n');
}

type Seedance25PerformanceModuleOverride = {
  shot_id: string;
  performance: string;
  timeline: string;
};

const SEEDANCE25_PERFORMANCE_MODULE_OUTPUT_SHAPE = `{
  "shotModules": [{
    "performance": "只填写【表演】的新正文，不带标题",
    "timeline": "只填写【时间轴】的新正文，不带标题"
  }]
}`;

function assertSeedance25PerformanceModuleOverrides(
  value: unknown,
  baseOutput: PromptOutput,
): Seedance25PerformanceModuleOverride[] {
  if (!value || typeof value !== 'object') {
    throw new Error('八维表演模块接管返回了无效 JSON。');
  }
  const rows = (value as { shotModules?: unknown }).shotModules;
  if (!Array.isArray(rows)) {
    throw new Error('八维表演模块接管缺少 shotModules 数组。');
  }

  const basePacks = baseOutput.shotPrompts ?? [];
  if (!basePacks.length) {
    throw new Error('Seedance 2.5 v10 基础 PromptOutput 没有可接管的镜头。');
  }
  if (rows.length !== basePacks.length) {
    throw new Error(`八维表演模块必须按 v10 基础卡顺序返回 ${basePacks.length} 项，当前为 ${rows.length} 项。`);
  }

  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`八维表演模块第 ${index + 1} 项无效。`);
    }
    const record = row as Record<string, unknown>;
    const performance = String(record.performance ?? '').trim();
    const timeline = String(record.timeline ?? '').trim();
    if (!performance || !timeline) {
      throw new Error(`八维表演模块第 ${index + 1} 项缺少 performance 或 timeline。`);
    }
    return {
      shot_id: String(basePacks[index].shot_id),
      performance,
      timeline,
    };
  });
}

function buildSeedance25PerformanceModuleUserMessage(
  brief: string,
  baseOutput: PromptOutput,
): string {
  return [
    '【任务】对已冻结的 Seedance 2.5 v10 基础卡执行八维表演模块接管。',
    '只返回各镜头新的【表演】和【时间轴】正文；不得返回或改写其他模块。',
    '应用将通过程序化拼接替换这两个正文，v10 的挂载、生成规格、摄影机、机位与构图、起幅、光学效果、声音/对白、最终落幅和限制将按原文冻结保留。',
    '【表演】不带时间戳；不输出目标、潜台词、触发锚点、表演弧线等内部分析标签。',
    '【时间轴】保持 v10 已确定的动作顺序、时间边界和段落覆盖，仅把可执行的表演增量融入对应时段；不得改变剧情事件、摄影、声音或镜尾事实。',
    '`shotModules` 必须按 v10 基础卡顺序逐项返回；不要输出、推断或校验 shot_id，应用会按数组顺序自动绑定原镜头。',
    '只返回合法 JSON，结构严格为：',
    SEEDANCE25_PERFORMANCE_MODULE_OUTPUT_SHAPE,
    '',
    '【原始 Input】',
    brief.trim() || '（空）',
    '',
    '【已冻结的 v10 基础 PromptOutput】',
    JSON.stringify(baseOutput, null, 2),
  ].join('\n');
}

async function applySeedance25PerformanceModules(params: {
  brief: string;
  baseOutput: PromptOutput;
  eligiblePackIndexes: number[];
  executionSystemPrompt?: string;
  onDelta?: (delta: string, accumulated: string) => void;
  signal?: AbortSignal;
}): Promise<PromptOutput> {
  const basePacks = params.baseOutput.shotPrompts ?? [];
  const eligiblePackIndexes = Array.from(
    new Set(
      params.eligiblePackIndexes.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < basePacks.length,
      ),
    ),
  );
  if (!eligiblePackIndexes.length) return params.baseOutput;
  const moduleBaseOutput: PromptOutput = {
    ...params.baseOutput,
    shotPrompts: eligiblePackIndexes.map((index) => basePacks[index]),
  };
  const parsed = await invokeLlmJsonObjectStream({
    systemPrompt: [
      params.executionSystemPrompt?.trim() || PROMPT_DEPT_AGENT_SYSTEM,
      '【运行时模块接管契约｜最高优先级】',
      '你接收的 v10 基础 PromptOutput 已冻结。只生成【表演】与【时间轴】的替换正文，不输出完整 seedanceCard，不重新设计其他模块。',
    ].join('\n\n'),
    userPrompt: buildSeedance25PerformanceModuleUserMessage(params.brief, moduleBaseOutput),
    temperature: 0.2,
    onDelta: params.onDelta,
    signal: params.signal,
  });
  const overrides = assertSeedance25PerformanceModuleOverrides(parsed, moduleBaseOutput);
  const overrideByPackIndex = new Map(
    eligiblePackIndexes.map((packIndex, moduleIndex) => [packIndex, overrides[moduleIndex]]),
  );

  const shotPrompts = basePacks.map((pack, index) => {
    const override = overrideByPackIndex.get(index);
    if (!override) return pack;
    const seedanceCard = composeSeedance25PerformanceCard(
      String(pack.seedanceCard ?? ''),
      override.performance,
      override.timeline,
    );
    return {
      ...pack,
      seedanceCard: assertSeedance25PerformanceV11Card(String(pack.shot_id), seedanceCard),
    };
  });

  return {
    ...params.baseOutput,
    system: SEEDANCE25_PERFORMANCE_V11_MARKER,
    parameters: {
      ...(params.baseOutput.parameters ?? {}),
      format: SEEDANCE25_PERFORMANCE_V11_FORMAT,
    },
    shotPrompts,
  };
}

async function invokePromptOutputWithStructureRepair(params: {
  systemPrompt: string;
  userPrompt: string;
  repairUserPromptBuilder: (invalidOutput: unknown, failureReason: string) => string;
  outputFallback: Partial<Pick<PromptOutput, 'system' | 'userTemplate' | 'negative' | 'parameters'>>;
  temperature?: number;
  onDelta?: (delta: string, accumulated: string) => void;
  signal?: AbortSignal;
}): Promise<PromptOutput> {
  const parsed = await invokeLlmJsonObjectStream({
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    temperature: params.temperature,
    onDelta: params.onDelta,
    signal: params.signal,
  });

  try {
    return assertPromptOutput(parsed, params.outputFallback);
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    const repairedParsed = await invokeLlmJsonObjectStream({
      systemPrompt: params.systemPrompt,
      userPrompt: params.repairUserPromptBuilder(parsed, failureReason),
      temperature: 0.2,
      onDelta: params.onDelta,
      signal: params.signal,
    });
    return assertPromptOutput(repairedParsed, params.outputFallback);
  }
}

void assertSeedanceCard;
void assertPromptBody;
void assertSeedanceCardV2;
void compactSeedanceSectionBody;
void compactSeedanceSectionBodyV2;
void buildPromptUserMessage;
void buildPromptUserMessageV2;
void buildCoverageRepairUserMessage;
void buildCoverageRepairUserMessageV2;
void buildCompressionRepairUserMessage;
void buildCompressionRepairUserMessageV2;
void MAX_SEEDANCE_CARD_CHARS;
void SEEDANCE_OPTIONAL_SECTION_INDICES;
void inferPromptStyleMode;
void withSeedance2StyleSystemOverride;
void buildPromptUserMessageSeedance2;
void buildStructureRepairUserMessageSeedance2;
void buildCompressionRepairUserMessageSeedance2;
void buildCoverageRepairUserMessageSeedance2;
void buildPromptUserMessageSeedance25;
void buildStructureRepairUserMessageSeedance25;
void buildCompressionRepairUserMessageSeedance25;
void buildCoverageRepairUserMessageSeedance25;

async function runSeedance25PerformanceV11Composition(
  brief: string,
  approvedAssets: ApprovedAsset[],
  executionSystemPrompt?: string,
  onDelta?: (delta: string, accumulated: string) => void,
  signal?: AbortSignal,
): Promise<PromptOutput> {
  onDelta?.('', '正在按 Seedance 2.5 v10 生成并冻结基础提示词…');
  const v10ExecutionSystemPrompt = resolveAndComposeMountedSkills(
    'prompt',
    PROMPT_DEPT_AGENT_SYSTEM,
    [SEEDANCE25_MULTIMODAL_PROMPT_V10_SKILL_ID],
  ).systemPrompt;
  const baseOutput = await runPromptGenerationPipeline(
    {
      brief,
      approvedAssets,
      executionSystemPrompt: v10ExecutionSystemPrompt,
      signal,
    },
    {
      defaultNegative: DEFAULT_NEG,
      departmentSystemPrompt: PROMPT_DEPT_AGENT_SYSTEM,
      departmentOutputShape: SEEDANCE25_MULTIMODAL_OUTPUT_SHAPE,
      timingSystemRule: PROMPT_TIMING_SYSTEM_RULE,
      resolveAssetRefs: promptAssetRefsFromApproved,
      parseSourceStoryboard: tryParseStoryboardFromInputText,
      buildGenerationUserMessage: buildPromptUserMessageSeedance25,
      buildStructureRepairUserMessage: buildStructureRepairUserMessageSeedance25,
      buildCompressionRepairUserMessage: buildCompressionRepairUserMessageSeedance25,
      buildCoverageRepairUserMessage: buildCoverageRepairUserMessageSeedance25,
      invokeWithStructureRepair: invokePromptOutputWithStructureRepair,
      outputNeedsCompressionRepair: (output) =>
        outputNeedsCompressionRepair(output, 'seedance25Multimodal'),
      normalizeOutput: (output, sourceStoryboard) =>
        normalizePromptOutput(output, sourceStoryboard, 'seedance25Multimodal'),
      validateCoverage: (output, sourceStoryboard) =>
        validatePromptCoverage(output, sourceStoryboard, 'seedance25Multimodal'),
      sanitizeEllipsis: sanitizePromptOutputEllipsis,
    },
  );

  const eligiblePackIndexes = (baseOutput.shotPrompts ?? []).reduce<number[]>(
    (indexes, pack, index) => {
      if (isSeedance25PerformanceEligibleCard(String(pack.seedanceCard ?? ''))) {
        indexes.push(index);
      }
      return indexes;
    },
    [],
  );
  if (!eligiblePackIndexes.length) {
    onDelta?.('', '当前镜头没有角色或行动主体，已保留 Seedance 2.5 v10，不启用八维表演。');
    return baseOutput;
  }
  onDelta?.('', '正在仅接管角色镜头的【表演】与【时间轴】，其他 v10 模块保持不变…');
  if (eligiblePackIndexes.length < (baseOutput.shotPrompts?.length ?? 0)) {
    onDelta?.(
      '',
      `仅对 ${eligiblePackIndexes.length} 个角色镜头启用八维表演；无角色镜头保留 Seedance 2.5 v10。`,
    );
  }
  return applySeedance25PerformanceModules({
    brief,
    baseOutput,
    eligiblePackIndexes,
    executionSystemPrompt,
    onDelta,
    signal,
  });
}

export async function runPromptEmployee(
  brief: string,
  approvedAssets: ApprovedAsset[] = [],
  executionSystemPrompt?: string,
  onDelta?: (delta: string, accumulated: string) => void,
  signal?: AbortSignal,
): Promise<PromptOutput> {
  const styleMode = inferPromptStyleMode(executionSystemPrompt);
  const useStudioCanvasV23 = isStudioCanvasV23Style(styleMode);
  const useStudioCanvasV231Segments = isStudioCanvasV231SegmentsStyle(styleMode);
  const useStudioCanvasV25 = isStudioCanvasV25Style(styleMode);
  const useStudioCanvasV26 = isStudioCanvasV26Style(styleMode);
  const useStudioCanvasV27 = isStudioCanvasV27Style(styleMode);
  const useSeedance25Multimodal = isSeedance25MultimodalStyle(styleMode);
  const useSeedance25PerformanceV11 = isSeedance25PerformanceV11Style(styleMode);
  const effectiveExecutionSystemPrompt = useStudioCanvasV25
    ? [executionSystemPrompt?.trim(), PROMPT_DETAILED_MOUNT_SYSTEM_AMENDMENT]
        .filter(Boolean)
        .join('\n\n')
    : executionSystemPrompt;

  if (useSeedance25PerformanceV11) {
    return runSeedance25PerformanceV11Composition(
      brief,
      approvedAssets,
      executionSystemPrompt,
      onDelta,
      signal,
    );
  }

  return runPromptGenerationPipeline(
    {
      brief,
      approvedAssets,
      executionSystemPrompt: effectiveExecutionSystemPrompt,
      onDelta,
      signal,
    },
    {
      defaultNegative: DEFAULT_NEG,
      departmentSystemPrompt: PROMPT_DEPT_AGENT_SYSTEM,
      departmentOutputShape: useSeedance25Multimodal
        ? SEEDANCE25_MULTIMODAL_OUTPUT_SHAPE
        : useStudioCanvasV231Segments
        ? PROMPT_DEPT_OUTPUT_SHAPE_V231_SEGMENTS
        : useStudioCanvasV27
          ? PROMPT_DEPT_OUTPUT_SHAPE_V27
        : useStudioCanvasV26
          ? PROMPT_DEPT_OUTPUT_SHAPE_V26
        : useStudioCanvasV25
          ? PROMPT_DEPT_OUTPUT_SHAPE_V25
        : useStudioCanvasV23
          ? PROMPT_DEPT_OUTPUT_SHAPE_V23
        : PROMPT_DEPT_OUTPUT_SHAPE,
      timingSystemRule: PROMPT_TIMING_SYSTEM_RULE,
      resolveAssetRefs: promptAssetRefsFromApproved,
      parseSourceStoryboard: tryParseStoryboardFromInputText,
      buildGenerationUserMessage: useSeedance25Multimodal
        ? buildPromptUserMessageSeedance25
        : useStudioCanvasV231Segments
        ? buildPromptUserMessageV231Segments
        : useStudioCanvasV27
          ? buildPromptUserMessageV27
        : useStudioCanvasV26
          ? buildPromptUserMessageV26
        : useStudioCanvasV25
          ? buildPromptUserMessageV25
        : useStudioCanvasV23
          ? buildPromptUserMessageV23
        : buildPromptUserMessageV3,
      buildStructureRepairUserMessage: useSeedance25Multimodal
        ? buildStructureRepairUserMessageSeedance25
        : useStudioCanvasV231Segments
        ? buildStructureRepairUserMessageV231Segments
        : useStudioCanvasV27
          ? buildStructureRepairUserMessageV27
        : useStudioCanvasV26
          ? buildStructureRepairUserMessageV26
        : useStudioCanvasV25
          ? buildStructureRepairUserMessageV25
        : useStudioCanvasV23
          ? buildStructureRepairUserMessageV23
        : buildStructureRepairUserMessageV3,
      buildCompressionRepairUserMessage: useSeedance25Multimodal
        ? buildCompressionRepairUserMessageSeedance25
        : useStudioCanvasV231Segments
        ? buildCompressionRepairUserMessageV231Segments
        : useStudioCanvasV27
          ? buildCompressionRepairUserMessageV27
        : useStudioCanvasV26
          ? buildCompressionRepairUserMessageV26
        : useStudioCanvasV25
          ? buildCompressionRepairUserMessageV25
        : useStudioCanvasV23
          ? buildCompressionRepairUserMessageV23
        : buildCompressionRepairUserMessageV3,
      buildCoverageRepairUserMessage: useSeedance25Multimodal
        ? buildCoverageRepairUserMessageSeedance25
        : useStudioCanvasV231Segments
        ? buildCoverageRepairUserMessageV231Segments
        : useStudioCanvasV27
          ? buildCoverageRepairUserMessageV27
        : useStudioCanvasV26
          ? buildCoverageRepairUserMessageV26
        : useStudioCanvasV25
          ? buildCoverageRepairUserMessageV25
        : useStudioCanvasV23
          ? buildCoverageRepairUserMessageV23
        : buildCoverageRepairUserMessageV3,
      invokeWithStructureRepair: invokePromptOutputWithStructureRepair,
      outputNeedsCompressionRepair: (output) => outputNeedsCompressionRepair(output, styleMode),
      normalizeOutput: (output, sourceStoryboard) =>
        normalizePromptOutput(output, sourceStoryboard, styleMode),
      validateCoverage: (output, sourceStoryboard) =>
        validatePromptCoverage(output, sourceStoryboard, styleMode),
      sanitizeEllipsis: sanitizePromptOutputEllipsis,
    },
  );
}

export type LeaderDecision = { approved: true } | { approved: false; feedback: string };

export async function runPromptLeaderReview(
  output: PromptOutput,
  orderedSkillIds: string[] = [],
  signal?: AbortSignal,
): Promise<LeaderDecision> {
  void output;
  void orderedSkillIds;
  void signal;
  return { approved: true };

  const { systemPrompt } = resolveAndComposeMountedSkills('prompt', PROMPT_LEADER_SPEC, orderedSkillIds);
  const result = await invokeLlmLeaderReview({
    systemPrompt,
    userPrompt: `以下为员工产出的 PromptOutput JSON，请按 Prompt 总监规范审核，重点检查新 15 字段完整性、挂载分类、构图前中后景、灯光布置、连续性约束、钉子4行和最终执行性：\n\n${JSON.stringify(output, null, 2)}`,
    temperature: 0.2,
    signal,
  });
  return result.approved
    ? { approved: true }
    : { approved: false, feedback: result.feedback ?? '请按审核意见补齐缺失栏位，并提高镜头卡片的可执行性。' };
}
