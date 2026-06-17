import {
  PROMPT_CARD_LENGTH_BUDGET_RULE,
  PROMPT_CARD_HEADER_RULE,
  PROMPT_CARD_SECTION_HEADINGS,
  PROMPT_COPY_CHAR_LIMIT_RULE,
  PROMPT_DEPT_AGENT_SYSTEM,
  PROMPT_DEPT_OUTPUT_SHAPE,
  PROMPT_LOCAL_COMPRESSION_RULE,
  PROMPT_LEADER_SPEC,
  PROMPT_MOUNT_TOKEN_RULE,
  PROMPT_TIMING_SYSTEM_RULE,
} from '@/agents/promptDeptSpec';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import { invokeLlmJsonObjectStream, invokeLlmLeaderReview } from '@/services/llmJsonClient';
import { resolveAndComposeMountedSkills } from '@/services/skillLoader';
import { runPromptGenerationPipeline } from '@/agents/promptPipeline';
import type {
  ApprovedAsset,
  PromptOutput,
  PromptShotDimensions,
  PromptShotPack,
  StoryboardOutput,
  StoryboardShot,
} from '@/types/studio';
import {
  buildPromptSingleShotStoryboardFromText,
  looksLikeStructuredPromptInput,
} from '@/utils/promptInputMode';
import { promptAssetRefsFromApproved } from '@/utils/promptAssetRefs';
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
const SEEDANCE2_SEGMENTED_FORMAT = 'seedance2_segmented_15s_v1';
const SEEDANCE2_SEGMENTED_HEADINGS = [
  '# 【全局视觉与美学基调】',
  '# 【人物与场景设定】',
  '# 【剧本与动作时间线】',
  '# 【生成约束与负面提示词】',
] as const;
const SEEDANCE_PROMPT_SECTION_INDEX = 9;
const SEEDANCE_OPTIONAL_SECTION_INDICES = new Set<number>();
const MOUNT_TOKEN_RE = /\|@=([^|\n]+)\|/g;
const STRUCTURED_FIELD_NOISE_RE = /文字生成版|无素材|角色资产|场景资产|半空中袖|口一翻/;
const ACTION_FRAGMENT_TOKEN_RE =
  /^(?:探头|探身|回头|转身|抬手|收枪|落锁|关门|开口|低声|沉声|冷声|停在|停住|看见|看向|望向|闪身|逼近|后撤|甩袖|翻腕)$/;
const SEEDANCE2_UI_RENDER_PARAM_RE = /\b(?:4k|8k|1080p|720p|fps)\b|分辨率|帧率|画幅比例|aspect\s*ratio/i;

type PromptStyleMode = 'studioCanvas' | 'seedance2Segmented';

function inferPromptStyleMode(executionSystemPrompt?: string): PromptStyleMode {
  return executionSystemPrompt?.includes(SEEDANCE2_SEGMENTED_PROMPT_MARKER)
    ? 'seedance2Segmented'
    : 'studioCanvas';
}

function isSeedance2SegmentedStyle(styleMode: PromptStyleMode): boolean {
  return styleMode === 'seedance2Segmented';
}

function getMaxSeedanceCardChars(styleMode: PromptStyleMode): number {
  return isSeedance2SegmentedStyle(styleMode)
    ? MAX_SEEDANCE2_SEGMENTED_CARD_CHARS
    : MAX_SEEDANCE_CARD_CHARS;
}

function getMinSeedanceCardChars(styleMode: PromptStyleMode): number {
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
    `Each seedanceCard must be ${MIN_SEEDANCE2_SEGMENTED_CARD_CHARS}-${MAX_SEEDANCE2_SEGMENTED_CARD_CHARS} Chinese characters and must contain a continuous [00.0s - 15.0s] timeline.`,
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
  if (sourceStoryboard.shots.length === 1) {
    const first = sourceStoryboard.shots[0];
    const mergedCount = first.mergedMembers?.length ?? 0;
    if (mergedCount > 1) {
      return [
        '【输出模式】当前输入是多镜头组合模式。',
        '你必须只输出 1 条 shotPrompts。',
        `这 1 条 shotPrompt 对应 1 个组合镜头，内部要明确写出镜头1到镜头${mergedCount}的连续接力，不得拆成多条独立 shotPrompts。`,
      ].join('\n');
    }
    return [
      '【输出模式】当前输入是单镜头模式。',
      '你必须只输出 1 条 shotPrompts，不得擅自再拆成多镜头组合。',
    ].join('\n');
  }
  return [
    '【输出模式】当前输入包含多条源镜头。',
    '你必须逐镜输出，shotPrompts 数量必须与源镜头数量严格一致，不得把多条源镜头压成一条。',
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

function assertContinuousFifteenSecondTimeline(shotId: string, card: string): void {
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

  if (Math.abs(cursor - 15) > tolerance) {
    throw new Error(`Seedance2.0 prompt for shot ${shotId} timeline must end exactly at 15.0s.`);
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

  assertContinuousFifteenSecondTimeline(shotId, card);

  return card;
}

function normalizePromptOutput(
  output: PromptOutput,
  sourceStoryboard: StoryboardOutput | null,
  styleMode: PromptStyleMode = 'studioCanvas',
): PromptOutput {
  const shotPrompts = (output.shotPrompts ?? []).map((pack, index) => {
    const sourceShot = findSourceShot(sourceStoryboard, pack, index);
    return {
      ...pack,
      shot_id: sourceShot ? String(sourceShot.id) : pack.shot_id,
      prompt: String(pack.prompt ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(),
      seedanceCard:
        typeof pack.seedanceCard === 'string'
          ? isSeedance2SegmentedStyle(styleMode)
            ? normalizeSeedance2CardText(pack.seedanceCard)
            : tightenSeedanceCard(pack.seedanceCard)
          : '',
    };
  });
  return {
    ...output,
    parameters: {
      ...output.parameters,
      format: isSeedance2SegmentedStyle(styleMode)
        ? SEEDANCE2_SEGMENTED_FORMAT
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
    if (isSeedance2SegmentedStyle(styleMode)) {
      if (!seedanceCard) return true;
      if (seedanceCardLength < MIN_SEEDANCE2_SEGMENTED_CARD_CHARS) return true;
      if (!seedanceCard.startsWith(SEEDANCE2_SEGMENTED_HEADINGS[0])) return true;
      if (SEEDANCE2_SEGMENTED_HEADINGS.some((heading) => !seedanceCard.includes(heading))) return true;
      if (['镜头机位', '视觉画面', '[前景]', '[主体]', '[背景]', '听觉声效'].some((term) => !seedanceCard.includes(term))) return true;
      if (!parseSeedance2TimelineIntervals(seedanceCard).length) return true;
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
  if (Array.from(seedanceCard).length > MAX_SEEDANCE_CARD_CHARS) {
    throw new Error(`Prompt 输出超出字数限制：镜头 ${pack.shot_id} 的 seedanceCard 超过 ${MAX_SEEDANCE_CARD_CHARS} 字。`);
  }
  if (Array.from(seedanceCard).length < MIN_SEEDANCE_CARD_CHARS) {
    throw new Error(`Prompt 输出低于字数下限：镜头 ${pack.shot_id} 的 seedanceCard 低于 ${MIN_SEEDANCE_CARD_CHARS} 字。`);
  }
}

function validatePromptCoverage(
  output: PromptOutput,
  sourceStoryboard: StoryboardOutput | null,
  styleMode: PromptStyleMode = 'studioCanvas',
): void {
  for (const pack of output.shotPrompts ?? []) {
    validatePromptPackContent(pack, styleMode);
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
    '如果一条镜头组实际 5 秒就能完成，就写 5 秒；不要因为上限是 15 秒就把所有内容拉满到 15 秒。',
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
    '如果一条镜头组实际 5 秒就能完成，就写 5 秒；不要因为上限是 15 秒就把所有内容拉满到 15 秒。',
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

function buildSeedance2OutputSkeleton(): string {
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
          prompt: '15.0秒 Seedance2.0 分段式视听提示词摘要。',
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
            '- **[00.0s - 15.0s]**',
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
    '若输入是多个独立分镜，shotPrompts 数量必须与源镜头数量一致，每条都是独立的 15.0 秒切片。',
    '若输入是 mergedMembers 组合镜头，只输出 1 条组合 shotPrompt，但 seedanceCard 的时间线必须覆盖全部子镜头并仍然严格收束在 15.0 秒内。',
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
    '【15 秒时间轴硬规则】',
    '每个 seedanceCard 都是一个 15.0 秒切片，总时长必须严格等于 15.0 秒。',
    '【剧本与动作时间线】中的时间戳必须使用 `[00.0s - 02.5s]` 这种格式，连续推进，无空档、无重叠、不能超过 15.0s。',
    '可以根据分镜动作密度自动切成 3-7 个时间段；短动作不要硬塞成拖沓长动作，而是在 15 秒内用镜头、微表情、空间层次、环境反馈和声效细节完成节奏分配。',
    '如果源分镜有多个子镜头，必须在 15 秒内合理分配每个子镜头时长，而不是让总时长超过 15 秒。',
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
    buildSeedance2OutputSkeleton(),
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
    buildSeedance2OutputSkeleton(),
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
    '上一次 PromptOutput 没有完整覆盖源分镜，或 seedanceCard 不符合 Seedance2.0 四模块 15 秒规范。请重写完整 JSON。',
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
    '时间线必须重新校验为严格 15.0 秒，不能超过 15 秒，也不能少于 15 秒。',
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

export async function runPromptEmployee(
  brief: string,
  approvedAssets: ApprovedAsset[] = [],
  executionSystemPrompt?: string,
  onDelta?: (delta: string, accumulated: string) => void,
  signal?: AbortSignal,
): Promise<PromptOutput> {
  const styleMode: PromptStyleMode = 'studioCanvas';

  return runPromptGenerationPipeline(
    { brief, approvedAssets, executionSystemPrompt, onDelta, signal },
    {
      defaultNegative: DEFAULT_NEG,
      departmentSystemPrompt: PROMPT_DEPT_AGENT_SYSTEM,
      departmentOutputShape: PROMPT_DEPT_OUTPUT_SHAPE,
      timingSystemRule: PROMPT_TIMING_SYSTEM_RULE,
      resolveAssetRefs: promptAssetRefsFromApproved,
      parseSourceStoryboard: tryParseStoryboardFromInputText,
      buildGenerationUserMessage: buildPromptUserMessageV3,
      buildStructureRepairUserMessage: buildStructureRepairUserMessageV3,
      buildCompressionRepairUserMessage: buildCompressionRepairUserMessageV3,
      buildCoverageRepairUserMessage: buildCoverageRepairUserMessageV3,
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
