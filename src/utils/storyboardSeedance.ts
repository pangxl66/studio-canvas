import type {
  PromptShotDimensions,
  PromptShotPack,
  StoryboardOutput,
  StoryboardShot,
} from '@/types/studio';
import { createStoryboardShotWireId } from '@/utils/shotListWire';

type TimeSlice = {
  label: string;
  range: string;
  text: string;
};

type TimingSegment = {
  label: string;
  range: string;
  durationSec: number;
  text: string;
};

type TimingPlan = {
  totalText: string;
  allocationText: string;
  allocationCompactText: string;
  sequenceRuleText: string;
  sequenceRuleCompactText: string;
};

type SemanticProfile = {
  shotId: string;
  durationSec: number;
  shotType: string;
  movement: string;
  shotPlan: string;
  shotTempo: string;
  characterTokens: string[];
  sceneTokens: string[];
  propTokens: string[];
  mountTokens: string[];
  proposition: string;
  dramaticFunction: string;
  mainEvent: string;
  supportAction: string;
  resultState: string;
  relationBefore: string;
  relationTransition: string;
  relationAfter: string;
  foreground: string;
  midground: string;
  background: string;
  centerObject: string;
  occlusion: string;
  cameraPosition: string;
  cameraFacing: string;
  characterFacing: string;
  lens: string;
  depthOfField: string;
  focusPrimary: string;
  focusSecondary: string;
  focusReaction: string;
  startBeat: string;
  middleBeat: string;
  endBeat: string;
  timeSlices: TimeSlice[];
  visibleSpeaker: string;
  hiddenSpeaker: string;
  primarySound: string;
  secondarySound: string;
  soundCover: string;
  mustShow: string[];
  hardNails: string[];
  emotionNail: string;
  narrativeNail: string;
  microExpression: string;
  handoff: string;
  relayObject: string;
  transitionGate: string;
  styleHint: string;
  dimensions: PromptShotDimensions;
};

type SceneSpaceSummary = {
  mainScene: string;
  splitState: string;
  centerClause: string;
  characterClause: string;
};

type ExtractedShotSemantics = {
  characters: string[];
  scenes: string[];
  props: string[];
  mainAction: string;
  supportAction: string;
  resultState: string;
  actionClauses: string[];
};

type ModelSemanticHints = {
  characters: string[];
  scenes: string[];
  props: string[];
  mainAction: string;
  supportAction: string;
  resultState: string;
};

const SCENE_HINT_RE =
  /卧室|屋内|室内|屋外|庭院|院内|院外|走廊|廊道|门口|窗边|屏风后|床前|楼道|楼梯|桥上|桥下|船舱|山道|林间|街口|阁楼|宫殿|偏殿|厅堂|仓库|房门内外|夜色|月光下/g;
const PROP_HINT_RE =
  /屏风|窗棂|锦被|包袱|刀|剑|匕首|门闩|门锁|门体|床榻|帘子|火把|灯盏|楼梯|栏杆|桌案|椅背|门缝|窗框|瓦檐|纸条|玉佩|血迹|脚步|影子/g;
const OCCLUSION_HINT_RE =
  /屏风|门缝|门框|窗框|帘后|屏风后|门后|栏杆|树影|床幔|廊柱|阴影/g;
const REVEAL_HINT_RE =
  /探头|探身|看见|发现|露出|现身|显露|回头|转身|对上|看到|从.*后|从.*边缘/g;
const PURSUIT_HINT_RE =
  /追|扑|冲|逼近|压上|围住|包抄|扑向|后撤|闪避|躲|潜入|贴近|锁住|落锁|拖拽|掀开|推开/g;
const DIALOGUE_HINT_RE = /说|低声|开口|质问|逼问|回话|答|喝止|冷笑|呢喃|沉声/;
const CLOSE_HINT_RE = /眼|手|唇|泪|血|刀锋|锁芯|门缝|指尖|呼吸|眼神|表情|微颤|包袱带/g;
const SCENE_WORD_RE =
  /卧室|屋内|屋外|庭院|走廊|门口|楼梯|桥上|桥下|街口|阁楼|宫殿|厅堂|仓库|夜色|月光|窗边|床前|屏风后/g;
const CHARACTER_CONTEXT_RE =
  /([\u4e00-\u9fa5]{2,4})(?=一身|身形|身影|背影|停在|停住|站在|站稳|立在|立于|回头|转身|探头|探身|看见|看向|望向|盯着|扑向|闪身|跃起|抬手|收枪|开口|低声|冷声|沉声|背对|隔门|退后|上前|后撤|逼近|躲在|藏在|现身|出现|回应|答道|问道|垂眸|抬眼|手探|持刀|提刀|举刀|甩袖|翻腕|在半空|在空中|在门内|在门后|在门外|在桥上|在栏杆上|在窗边|在床前)/g;
const DIALOGUE_SPEAKER_RE =
  /([\u4e00-\u9fa5]{2,4})(?=低而冷的一句|冷冷说|低声说|沉声说|回一句|说道|问道|答道|喝道|说[:：]|问[:：]|答[:：])/g;
const ACTION_PHRASE_RE =
  /探头|探身|回头|转身|看见|看向|望向|盯着|抬手|收枪|落锁|关上|封死|推开|掀开|压住|隔开|切开|逼近|后撤|闪身|跃起|扑向|现身|躲在|藏在|拖拽|甩袖|翻腕|袖口一翻|翻落|落到|停住|占据|抬眼|借力|开口|低声|沉声|冷冷说|回一句|说出|压低声音/;
const RESULT_HINT_RE =
  /落幅|结果位|定格|停在|停住|留在|留给|钉住|被隔在|被迫|落回|成立|锁死|封死|听完|静听|收枪|稳住/;
const ENTITY_EDGE_NOISE_RE =
  /^(?:在|从|向|把|被|由|并|又|再|仍|还|刚|正|将|于|朝|往)|(?:在|中|里|上|下|前|后|侧|边|着|了|地|得|来|去|起|开|出|入)$/;
const ENTITY_PLACEHOLDER_RE = /文字生成版|无素材|角色资产|场景资产|占位/;
const CHARACTER_NOISE_RE =
  /半空|空中|袖|口|眼|手|脚|呼吸|余震|白气|低声|冷声|沉声|门后|门内|门外|一侧|另一侧|结果位|动作落点|空间|前景|中景|后景|中心物|接力物/;
const ACTION_FRAGMENT_ONLY_RE =
  /^(?:探头|探身|回头|转身|抬手|收枪|落锁|关门|封门|开口|低声|沉声|冷声|看见|看向|望向|停在|停住|闪身|逼近|后撤|甩袖|翻腕|袖口一翻|口一翻)$/;
const SCENE_SPLIT_RE = /与|和|、|\/|→|->/;
const CARD_MOUNT_TOKEN_RE = /\|@=([^|\n]+)\|/g;
const CARD_MUST_SHOW_SECTION_RE = /【目标物\s*Must-Show】([\s\S]*?)(?:\n\s*\n|【参考分工】|【参照\/覆盖\/稳帧】|【声画同步】|$)/;
const CARD_RESULT_LINE_RE = /落幅[:：]\s*([^\n]+)/;
const ENTITY_HINT_SPLIT_RE = /[、/|｜,，;；]/;
const GENERIC_ENTITY_STOPWORDS = new Set([
  '镜头',
  '画面',
  '人物',
  '环境',
  '气氛',
  '动作',
  '关系',
  '结果',
  '空间',
  '前景',
  '中景',
  '后景',
  '主体',
  '黑影',
  '房内',
  '房外',
  '屋内',
  '屋外',
  '夜色',
  '月光',
  '门口',
  '床前',
  '出口',
  '危险',
]);
const MAX_SEEDANCE_TOTAL_DURATION_SEC = 15;
const MIN_SEGMENT_DURATION_SEC = 0.3;

function uniq(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function normalizeSourceText(value: string): string {
  return value
    .replace(/[△▲◆◇]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstClause(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const parts = trimmed
    .split(/[。！？!?；;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] ?? trimmed;
}

function summarizeText(value: string, max = 34): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (Array.from(trimmed).length <= max) return trimmed;
  const clipped = Array.from(trimmed).slice(0, max).join('').trim();
  const boundary = Math.max(
    clipped.lastIndexOf('。'),
    clipped.lastIndexOf('！'),
    clipped.lastIndexOf('？'),
    clipped.lastIndexOf('；'),
    clipped.lastIndexOf('，'),
    clipped.lastIndexOf(' '),
  );
  return boundary >= Math.floor(max * 0.55) ? clipped.slice(0, boundary).trim() : clipped;
}
function charCount(value: string): number {
  return Array.from(value).length;
}

function formatTimingSecond(value: number): string {
  const normalized = Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1).replace(/\.0$/, '');
}

function formatTimingRange(start: number, end: number): string {
  return `${formatTimingSecond(start)}-${formatTimingSecond(end)}秒`;
}

function normalizeTimeSliceRange(range: string): string {
  return range.replace(/s/g, '秒');
}

export function clampPromptText(value: string, maxChars: number): string {
  const normalized = value
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (charCount(normalized) <= maxChars) return normalized;
  const clipped = Array.from(normalized).slice(0, maxChars).join('').trim();
  const boundary = Math.max(
    clipped.lastIndexOf('。'),
    clipped.lastIndexOf('！'),
    clipped.lastIndexOf('？'),
    clipped.lastIndexOf('；'),
    clipped.lastIndexOf('，'),
    clipped.lastIndexOf('\n'),
    clipped.lastIndexOf(' '),
  );
  return boundary >= Math.floor(maxChars * 0.55) ? clipped.slice(0, boundary).trim() : clipped;
}

type ClausePriority = 'required' | 'important' | 'optional';

type PromptClause = {
  text: string;
  compactText?: string;
  priority?: ClausePriority;
};

type CardSectionPriority = 'core' | 'support' | 'optional';

type CardSection = {
  heading: string;
  body: string;
  compactBody?: string;
  priority?: CardSectionPriority;
};

function fitPromptClausesWithinLimit(
  clauses: PromptClause[],
  maxChars: number,
  separator = '，',
): string {
  const normalized = clauses
    .map((clause) => ({
      ...clause,
      priority: clause.priority ?? 'required',
      text: clause.text.trim(),
      compactText: clause.compactText?.trim() || '',
    }))
    .filter((clause) => clause.text);

  const render = (options: {
    dropOptional?: boolean;
    useCompactFor?: ClausePriority[];
  }): string => {
    const useCompactFor = new Set(options.useCompactFor ?? []);
    return normalized
      .filter((clause) => !(options.dropOptional && clause.priority === 'optional'))
      .map((clause) =>
        useCompactFor.has(clause.priority) && clause.compactText ? clause.compactText : clause.text,
      )
      .filter(Boolean)
      .join(separator)
      .trim();
  };

  const attempts = [
    render({}),
    render({ useCompactFor: ['optional'] }),
    render({ useCompactFor: ['important', 'optional'] }),
    render({ dropOptional: true }),
    render({ dropOptional: true, useCompactFor: ['important'] }),
    render({ dropOptional: true, useCompactFor: ['required', 'important'] }),
  ];

  for (const candidate of attempts) {
    if (charCount(candidate) <= maxChars) return candidate;
  }

  return clampPromptText(attempts[attempts.length - 1] || '', maxChars);
}

function renderSeedanceCard(header: string, sections: CardSection[], compactMode: 'none' | 'non-core' | 'all') {
  const lines = [header, ''];
  for (const section of sections) {
    const useCompact =
      compactMode === 'all' ||
      (compactMode === 'non-core' && (section.priority ?? 'core') !== 'core');
    const body = (useCompact && section.compactBody ? section.compactBody : section.body).trim();
    lines.push(section.heading, body || '同上', '');
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n').trim();
}

function fitSeedanceCardWithinLimit(header: string, sections: CardSection[], softLimit: number): string {
  const attempts = [
    renderSeedanceCard(header, sections, 'none'),
    renderSeedanceCard(header, sections, 'non-core'),
    renderSeedanceCard(header, sections, 'all'),
    renderSeedanceCard(
      header,
      sections.map((section, index) => ({
        ...section,
        body:
          index === 13 || index === 0 || index === 14 || index === 20
            ? (section.compactBody || section.body)
            : index >= 10 && index !== 13
              ? '同上'
              : (section.compactBody || section.body),
      })),
      'all',
    ),
  ];

  for (const candidate of attempts) {
    if (charCount(candidate) <= softLimit) return candidate;
  }

  return attempts[attempts.length - 1];
}

export function expandMergedMembers(shot: StoryboardShot): StoryboardShot[] {
  const members = shot.mergedMembers?.length ? shot.mergedMembers : null;
  return members?.length ? members.map((member) => ({ ...member })) : [{ ...shot, mergedMembers: undefined }];
}

function clampDurationSec(value: number, max = MAX_SEEDANCE_TOTAL_DURATION_SEC): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(1, Math.round(value)));
}

function estimateSingleShotDurationSec(shot: StoryboardShot): number {
  if (typeof shot.durationSec === 'number' && Number.isFinite(shot.durationSec)) {
    return clampDurationSec(shot.durationSec);
  }
  const text = `${shot.type} ${shot.movement} ${shot.description} ${shot.content} ${shot.action ?? ''} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (/插针|特写|细节|脚底|手部|眼部|刀锋|瞬间|一瞬|短促|甩拍/.test(text)) return 1.5;
  if (PURSUIT_HINT_RE.test(text) || /冲|跃|闪|扑|刺|砍|追|跑|逼近|压上/.test(text)) return 2;
  if (DIALOGUE_HINT_RE.test(text) || shot.content.trim()) return 3;
  if (CLOSE_HINT_RE.test(text)) return 2;
  return 2.5;
}

function estimateMergedShotDurationSec(members: StoryboardShot[]): number {
  if (!members.length) return 1;
  const rawTotal = members.reduce((sum, member) => sum + estimateSingleShotDurationSec(member), 0);
  const densityFactor = members.length <= 1 ? 1 : Math.max(0.72, 0.94 - (members.length - 2) * 0.035);
  const minTotal = Math.min(MAX_SEEDANCE_TOTAL_DURATION_SEC, members.length * MIN_SEGMENT_DURATION_SEC);
  return clampDurationSec(Math.max(minTotal, rawTotal * densityFactor));
}

export function estimateShotDurationSec(shot: StoryboardShot): number {
  const members = expandMergedMembers(shot);
  if (members.length > 1) {
    return estimateMergedShotDurationSec(members);
  }
  return estimateSingleShotDurationSec(shot);
}

function mergeTextParts(parts: string[]): string {
  return parts
    .map((item) => item.trim())
    .filter(Boolean)
    .join('；');
}

export function mergeStoryboardShotSlice(shots: StoryboardShot[]): StoryboardShot {
  const slice = shots.map((shot) => ({ ...shot, mergedMembers: undefined }));
  const first = slice[0];
  if (!first) {
    return {
      id: 1,
      wireId: createStoryboardShotWireId(1),
      type: '中景',
      movement: '固定',
      description: '',
      content: '',
    };
  }
  const members = slice.map((shot) => ({ ...shot }));
  const description = mergeTextParts(slice.map((shot) => `镜头${shot.id} ${shot.description}`));
  const content = mergeTextParts(slice.filter((shot) => shot.content.trim()).map((shot) => `镜头${shot.id}对白：${shot.content}`));
  const action = mergeTextParts(slice.map((shot) => shot.action?.trim() || firstClause(shot.description)));
  const note = mergeTextParts([
    `多镜头组合：${slice.map((shot) => `#${shot.id}`).join(' + ')}`,
    mergeTextParts(slice.map((shot) => `${shot.sound ?? ''} ${shot.note ?? ''}`.trim())),
  ]);
  return {
    id: first.id,
    wireId: createStoryboardShotWireId(`merged_${slice.map((shot) => shot.id).join('_')}`),
    type: uniq(slice.map((shot) => shot.type)).join(' / ') || first.type,
    movement: uniq(slice.map((shot) => shot.movement)).join(' -> ') || first.movement,
    description,
    content,
    sceneRef: first.sceneRef,
    action: action || undefined,
    durationSec: estimateMergedShotDurationSec(slice),
    note: note || undefined,
    mergedMembers: members,
  };
}

export function mergeSameSceneShots(shots: StoryboardShot[], maxDurationSec = 15): StoryboardShot[] {
  const out: StoryboardShot[] = [];
  let cursor = 0;
  while (cursor < shots.length) {
    const current = shots[cursor];
    const sceneRef = current.sceneRef?.trim() || '';
    const bucket: StoryboardShot[] = [current];
    let duration = estimateShotDurationSec(current);
    let walker = cursor + 1;
    while (walker < shots.length) {
      const next = shots[walker];
      const sameScene = (next.sceneRef?.trim() || '') === sceneRef && sceneRef !== '';
      if (!sameScene) break;
      const nextDuration = estimateShotDurationSec(next);
      if (bucket.length >= 3 || duration + nextDuration > maxDurationSec) break;
      bucket.push(next);
      duration += nextDuration;
      walker += 1;
    }
    out.push(bucket.length > 1 ? mergeStoryboardShotSlice(bucket) : current);
    cursor += bucket.length;
  }
  return out;
}

function splitClauses(...sources: string[]): string[] {
  return uniq(
    sources
      .flatMap((source) =>
        normalizeSourceText(source)
          .split(/[。！？!?；;，,\n]/)
          .map((part) => part.trim()),
      )
      .filter(Boolean)
      .map((part) => part.replace(/^镜头\d+\s*/, '').trim())
      .filter((part) => part.length >= 2),
  );
}

function sanitizeEntityToken(raw: string, kind: 'character' | 'scene' | 'prop'): string {
  let token = raw.replace(/[“”"'`《》〈〉【】（）()、，。；：！？!?]/g, '').trim();
  if (kind === 'character') {
    token = token
      .replace(/^(?:落幅定在|定在|回望门内的|回望门后的|门内的|门后的|门外的|隔门的|被隔在|被迫|先|再|最后|仍|又|正|刚|将|把|与|和|同|其|那名|这名)/, '')
      .replace(/(?:被迫|停住|站住|站定|回望|看向|抬眼|垂眸|收枪|翻落|跃起|现身|出现|开口|低声|冷声|沉声|说道|答道|问道|回应|半空中|空中|门内|门后|门外|栏杆上|床前|窗边)$/, '');
    if (token.includes('的')) {
      token = token.split('的').filter(Boolean).at(-1) ?? token;
    }
  }
  if (!token) return '';
  if (ENTITY_PLACEHOLDER_RE.test(token)) return '';
  if (GENERIC_ENTITY_STOPWORDS.has(token)) return '';
  if (kind === 'character') {
    if (token.length < 2 || token.length > 4) return '';
    if (SCENE_WORD_RE.test(token)) return '';
    if (ENTITY_EDGE_NOISE_RE.test(token)) return '';
    if (ACTION_FRAGMENT_ONLY_RE.test(token)) return '';
    if (CHARACTER_NOISE_RE.test(token)) return '';
    if (ACTION_PHRASE_RE.test(token)) return '';
  }
  if (kind === 'scene') {
    if (token.length < 2 || token.length > 16) return '';
    if (ACTION_PHRASE_RE.test(token)) return '';
  }
  if (kind === 'prop') {
    if (token.length < 1 || token.length > 8) return '';
  }
  return token;
}

function sanitizeDescriptorValue(raw: string | undefined, minLength = 4): string {
  const value = normalizeSourceText(raw ?? '');
  if (!value) return '';
  if (ENTITY_PLACEHOLDER_RE.test(value)) return '';
  return value.length >= minLength ? value : '';
}

function normalizeVisualAnchor(raw: string, fallback = '结果位'): string {
  const cleaned = normalizeSourceText(raw)
    .replace(/^(?:落幅定在|落幅|定在|结果位[:：]?|停在)/, '')
    .replace(/^把/, '')
    .trim();
  const core = cleaned.split(/[，；。]/)[0]?.trim() || '';
  return summarizeText(core || fallback, 14);
}

function testPattern(pattern: RegExp, value: string): boolean {
  return new RegExp(pattern.source, pattern.flags.replace(/g/g, '')).test(value);
}

function isLikelySceneToken(token: string): boolean {
  return testPattern(SCENE_HINT_RE, token) || /门内外|门内|门后|门外|桥|廊|楼|阁|殿|室|屋|场|区/.test(token);
}

function isLikelyPropToken(token: string): boolean {
  return testPattern(PROP_HINT_RE, token);
}

function isNoisyEntityToken(token: string): boolean {
  const normalized = normalizeSourceText(token);
  if (!normalized) return true;
  if (ENTITY_PLACEHOLDER_RE.test(normalized)) return true;
  if (ENTITY_EDGE_NOISE_RE.test(normalized)) return true;
  if (ACTION_FRAGMENT_ONLY_RE.test(normalized)) return true;
  if (CHARACTER_NOISE_RE.test(normalized) && !isLikelySceneToken(normalized) && !isLikelyPropToken(normalized)) return true;
  return false;
}

function splitEntityHintTokens(value: string, kind: 'character' | 'scene' | 'prop'): string[] {
  const normalized = normalizeSourceText(value);
  if (!normalized) return [];
  if (kind === 'character') {
    const contextual = collectChineseNameCandidates(normalized);
    if (contextual.length) return contextual;
  }
  const splitter = kind === 'scene' ? /[、/|｜,，;；与和及跟]/ : ENTITY_HINT_SPLIT_RE;
  return uniq(
    normalized
      .split(splitter)
      .map((item) => sanitizeEntityToken(item, kind))
      .filter(Boolean),
  );
}

function parseMountTokensFromCard(seedanceCard: string): string[] {
  if (!seedanceCard.trim()) return [];
  return uniq(
    Array.from(seedanceCard.matchAll(CARD_MOUNT_TOKEN_RE))
      .map((match) => normalizeSourceText(String(match[1] ?? '')))
      .filter(Boolean),
  );
}

function parseMustShowTokensFromCard(seedanceCard: string): string[] {
  const section = seedanceCard.match(CARD_MUST_SHOW_SECTION_RE)?.[1] ?? '';
  if (!section.trim()) return [];
  return uniq(
    section
      .split(/[、，,\n]/)
      .map((item) => normalizeVisualAnchor(item, ''))
      .filter(Boolean),
  );
}

function classifyModelMountTokens(
  mountTokens: string[],
  roleHints: string[],
  sceneHints: string[],
  contextualCharacters: string[],
): { all: string[]; characters: string[]; scenes: string[]; props: string[] } {
  const cleanTokens = uniq(mountTokens.map((token) => normalizeSourceText(token)).filter((token) => !isNoisyEntityToken(token)));
  const knownCharacters = new Set([...roleHints, ...contextualCharacters]);
  const knownScenes = new Set(sceneHints);
  const characters: string[] = [];
  const scenes: string[] = [];
  const props: string[] = [];

  for (const token of cleanTokens) {
    const sceneToken = sanitizeEntityToken(token, 'scene');
    const propToken = sanitizeEntityToken(token, 'prop');
    const characterToken = sanitizeEntityToken(token, 'character');

    if ((knownScenes.has(token) || isLikelySceneToken(token)) && sceneToken) {
      scenes.push(sceneToken);
      continue;
    }
    if ((knownCharacters.has(token) || characterToken) && !isLikelyPropToken(token) && !isLikelySceneToken(token) && characterToken) {
      characters.push(characterToken);
      continue;
    }
    if (propToken) {
      props.push(propToken);
      continue;
    }
    if (sceneToken) {
      scenes.push(sceneToken);
    }
  }

  return {
    all: cleanTokens,
    characters: uniq(characters),
    scenes: uniq(scenes),
    props: uniq(props),
  };
}

function extractModelSemanticHints(pack: PromptShotPack): ModelSemanticHints {
  const mountTokens = parseMountTokensFromCard(pack.seedanceCard ?? '');
  const mustShowTokens = parseMustShowTokensFromCard(pack.seedanceCard ?? '');
  const roleHints = splitEntityHintTokens(pack.dimensions?.角色 ?? '', 'character');
  const sceneHints = splitEntityHintTokens(pack.dimensions?.场景 ?? '', 'scene');
  const contextualCharacters = collectChineseNameCandidates(`${pack.prompt ?? ''} ${pack.seedanceCard ?? ''}`);
  const classifiedMount = classifyModelMountTokens(mountTokens, roleHints, sceneHints, contextualCharacters);
  const actionHint = sanitizeDescriptorValue(pack.dimensions?.动作 ?? '', 2);
  const continuityHint = sanitizeDescriptorValue(pack.dimensions?.连贯性 ?? '', 2);
  const resultHint =
    normalizeVisualAnchor(pack.seedanceCard?.match(CARD_RESULT_LINE_RE)?.[1] ?? '', '') ||
    normalizeVisualAnchor(mustShowTokens.at(-1) ?? '', '');

  return {
    characters: uniq([
      ...roleHints,
      ...classifiedMount.characters,
      ...contextualCharacters,
    ]).slice(0, 6),
    scenes: uniq([
      ...sceneHints,
      ...classifiedMount.scenes,
    ]).slice(0, 4),
    props: uniq([
      ...classifiedMount.props,
      ...mustShowTokens
        .filter((token) => isLikelyPropToken(token))
        .map((token) => sanitizeEntityToken(token, 'prop'))
        .filter(Boolean),
      ...collectPropCandidates(`${pack.prompt ?? ''} ${actionHint} ${mustShowTokens.join(' ')}`),
    ]).slice(0, 6),
    mainAction: actionHint,
    supportAction: continuityHint,
    resultState: resultHint,
  };
}

function collectChineseNameCandidates(text: string): string[] {
  const matches = [
    ...Array.from(normalizeSourceText(text).matchAll(CHARACTER_CONTEXT_RE)).map((match) => String(match[1] ?? '')),
    ...Array.from(normalizeSourceText(text).matchAll(DIALOGUE_SPEAKER_RE)).map((match) => String(match[1] ?? '')),
  ];
  return uniq(matches.map((item) => sanitizeEntityToken(item, 'character')).filter(Boolean));
}

function collectSceneCandidates(shot: StoryboardShot): string[] {
  const joined = `${shot.sceneRef ?? ''} ${shot.description} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  const sceneRefParts = (shot.sceneRef ?? '')
    .split(SCENE_SPLIT_RE)
    .map((part) => sanitizeEntityToken(part, 'scene'))
    .filter(Boolean);
  const matches = (joined.match(SCENE_HINT_RE) ?? [])
    .map((item) => sanitizeEntityToken(item, 'scene'))
    .filter(Boolean);
  return uniq([sanitizeEntityToken(shot.sceneRef ?? '', 'scene'), ...sceneRefParts, ...matches]);
}

function collectPropCandidates(text: string): string[] {
  const matches = text.match(PROP_HINT_RE) ?? [];
  return uniq(matches.map((item) => sanitizeEntityToken(item, 'prop')).filter(Boolean));
}

function extractActionClauses(shot: StoryboardShot, members: StoryboardShot[]): string[] {
  const clauses = splitClauses(
    shot.action ?? '',
    shot.description,
    shot.content,
    shot.sound ?? '',
    shot.note ?? '',
    ...members.map((member) => member.action ?? ''),
    ...members.map((member) => member.description),
  );
  const preferred = clauses.filter((clause) => ACTION_PHRASE_RE.test(clause) || /把|将|被|让|使/.test(clause));
  return preferred.length ? preferred : clauses;
}

function extractResultClause(shot: StoryboardShot, members: StoryboardShot[], actionClauses: string[]): string {
  const resultClause =
    splitClauses(
      `${shot.sound ?? ''} ${shot.note ?? ''}`.trim(),
      ...members.map((member) => `${member.sound ?? ''} ${member.note ?? ''}`.trim()),
      shot.description,
    )
      .find((clause) => RESULT_HINT_RE.test(clause)) ??
    actionClauses.at(-1) ??
    firstClause(shot.description);
  return normalizeVisualAnchor(resultClause, summarizeText(firstClause(shot.description), 14));
}

function extractShotSemantics(shot: StoryboardShot, members: StoryboardShot[], pack?: PromptShotPack): ExtractedShotSemantics {
  const combinedText = normalizeSourceText(
    [
      shot.description,
      shot.content,
      shot.action ?? '',
      shot.sound ?? '',
      shot.note ?? '',
      ...members.map((member) => member.description),
    ].join(' '),
  );
  const modelHints = pack ? extractModelSemanticHints(pack) : null;
  const characters = uniq([...(modelHints?.characters ?? []), ...collectChineseNameCandidates(combinedText)]).slice(0, 6);
  const scenes = uniq([...(modelHints?.scenes ?? []), ...collectSceneCandidates(shot)]).slice(0, 4);
  const props = uniq([...(modelHints?.props ?? []), ...collectPropCandidates(combinedText)]).slice(0, 6);
  const actionClauses = extractActionClauses(shot, members);
  const mainAction = modelHints?.mainAction || summarizeText(actionClauses[0] ?? firstClause(shot.description), 26);
  const fallbackSupportAction = shot.content.trim() || actionClauses[0] || '';
  const supportAction = modelHints?.supportAction || summarizeText(actionClauses[1] ?? fallbackSupportAction, 24);
  const resultState = modelHints?.resultState || extractResultClause(shot, members, actionClauses);
  return {
    characters,
    scenes,
    props,
    mainAction,
    supportAction,
    resultState,
    actionClauses,
  };
}

function hasVisibleCharacter(shot: StoryboardShot): boolean {
  const text = `${shot.description} ${shot.action ?? ''}`;
  if (/空镜|无人|无角色|无人物/.test(text)) return false;
  if ((collectChineseNameCandidates(text).length ?? 0) > 0) return true;
  return /她|他|其|身形|背影|人影|手|眼|脸|嘴角|转身|探头|停在|停住|迈步|抬手|看向/.test(text);
}

function buildMountTokens(shot: StoryboardShot, pack?: PromptShotPack): string[] {
  const extracted = extractShotSemantics(shot, expandMergedMembers(shot), pack);
  const modelMountTokens = pack
    ? parseMountTokensFromCard(pack.seedanceCard ?? '').filter((token) => !isNoisyEntityToken(token))
    : [];
  const combined = uniq([
    ...modelMountTokens,
    ...extracted.characters.slice(0, 4),
    ...extracted.scenes.slice(0, 3),
    ...extracted.props.slice(0, 4),
  ]).slice(0, 10);
  if (combined.length === 0) return ['主体角色', '当前场景'];
  if (combined.length === 1) return [combined[0], '当前场景'];
  return combined;
}

function inferShotPlan(shot: StoryboardShot, members: StoryboardShot[]): string {
  const text = `${shot.description} ${shot.action ?? ''} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (members.length > 1) return '连续镜头接力推进';
  if (REVEAL_HINT_RE.test(text)) return '显藏揭示与关系确认';
  if (PURSUIT_HINT_RE.test(text)) return '压迫推进与动作改写';
  if (DIALOGUE_HINT_RE.test(text) || shot.content.trim()) return '对位试探与信息压入';
  if (/锁|落锁|关门|封住/.test(text)) return '结果钉住与出口封死';
  return '空间压迫与结果落点';
}

function inferShotTempo(shot: StoryboardShot, members: StoryboardShot[], durationSec: number): string {
  const text = `${shot.description} ${shot.content} ${shot.action ?? ''}`;
  if (members.length > 1) return '连续接力';
  if (PURSUIT_HINT_RE.test(text) || durationSec <= 3) return '快压';
  if (DIALOGUE_HINT_RE.test(text)) return '缓压试探';
  return '蓄势钉住';
}

function inferEmotion(shot: StoryboardShot): string {
  const text = `${shot.description} ${shot.content} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (/惊|慌|急|躲|避|追|逼|压/.test(text)) return '紧张压迫';
  if (/怒|恨|杀|反击|拔刀|冲/.test(text)) return '爆发对抗';
  if (/沉默|低声|试探|迟疑|观察/.test(text)) return '克制试探';
  if (/冷|暗|夜|月/.test(text)) return '悬疑潜伏';
  return '结果逼近';
}

function inferLighting(shot: StoryboardShot, pack: PromptShotPack): string {
  const preferred = pack.dimensions?.灯光?.trim();
  if (preferred) return preferred;
  const text = `${shot.description} ${shot.content}`;
  if (/月|夜|窗|窗棂/.test(text)) return '月光与冷色侧逆光';
  if (/火|灯|烛/.test(text)) return '火光与低照度反差光';
  return '写实电影光，保留暗部层次与可读高光';
}

function inferLens(shotType: string): string {
  if (/特写|近/.test(shotType)) return '50-85mm';
  if (/全景|大全景/.test(shotType)) return '24-28mm';
  return '35-50mm';
}

function inferDepthOfField(shot: StoryboardShot): string {
  const text = `${shot.description} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (/遮挡|屏风|门缝|前景/.test(text)) return '中等景深，保留前景遮挡与后景结果位';
  if (/特写|近景/.test(shot.type)) return '浅景深，压实主焦点';
  return '中深景深，保证空间切割可读';
}

function buildCoreEvent(shot: StoryboardShot, members: StoryboardShot[]): string {
  if (members.length > 1) {
    return `${summarizeText(firstClause(members[0].description), 22)}，并连续推进到${summarizeText(firstClause(members[members.length - 1].description), 22)}`;
  }
  return summarizeText(firstClause(shot.action?.trim() || shot.description), 28) || summarizeText(shot.description, 28);
}

function inferDramaticFunction(shot: StoryboardShot, members: StoryboardShot[]): string {
  const text = `${shot.description} ${shot.content} ${shot.action ?? ''}`;
  if (members.length > 1) return '把同场动作压成一条带结果的镜头接力';
  if (REVEAL_HINT_RE.test(text)) return '完成隐藏信息的揭示，让观测关系成立';
  if (PURSUIT_HINT_RE.test(text)) return '推进压迫或追逐，让局势明显改写';
  if (DIALOGUE_HINT_RE.test(text) || shot.content.trim()) return '在说话与停顿之间压入信息，让关系悄悄转势';
  if (/锁|封|关/.test(text)) return '把结果状态钉死，让出口或机会被封住';
  return '建立空间压迫并确认这一镜的结果落点';
}

function inferRelationBefore(shot: StoryboardShot): string {
  const text = `${shot.description} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (/屏风后|门后|窗后|躲|藏|避/.test(text)) return '观察方先藏在遮挡后，占据被动观察位';
  if (shot.content.trim()) return '发声方与对位方先处在不对等的对位关系里';
  if (/逼近|压迫|追/.test(text)) return '危险先在空间里逼近，主体尚未完全应对';
  return '主体先被空间关系与压迫源框住，局势尚未松动';
}

function inferRelationTransition(shot: StoryboardShot, members: StoryboardShot[]): string {
  const text = `${shot.description} ${shot.action ?? ''} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (members.length > 1) return '中段用镜头接力完成关系改写，让原先隐藏的信息或动作逐段抬高';
  if (REVEAL_HINT_RE.test(text)) return '通过探头、转身、遮挡掀开或视线接通，把关系从隐到显改写';
  if (/锁|关|封/.test(text)) return '通过落锁、关门或封口动作，把关系从可逃转为被封死';
  if (PURSUIT_HINT_RE.test(text)) return '通过逼近、后撤、追压或位移，把双方距离和主动权重排';
  if (shot.content.trim()) return '通过一句话、一次停顿或一个短促动作，把表层关系悄悄改写';
  return '通过动作尾势与视线迁移，让镜头内部关系完成转势';
}

function inferRelationAfter(shot: StoryboardShot, mustShow: string[]): string {
  const text = `${shot.description} ${shot.action ?? ''}`;
  if (/锁|封|关/.test(text)) return '结果停在“出口被封住”这一结果位上';
  if (/发现|看见|探头/.test(text)) return '结果停在“危险被看清”这一确认位上';
  if (PURSUIT_HINT_RE.test(text)) return '结果停在“主动权已经向压迫方倾斜”这一局面上';
  return `结果停在“${mustShow[0] ?? '关键结果'}被看清”这一终点上`;
}

function buildSpaceSegments(shot: StoryboardShot, mustShow: string[], preferredCenter = ''): {
  foreground: string;
  midground: string;
  background: string;
  centerObject: string;
  occlusion: string;
} {
  const text = `${shot.description} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  const occlusion = (text.match(OCCLUSION_HINT_RE) ?? [])[0] ?? '门框/屏风/阴影做显藏遮挡';
  const foreground = occlusion;
  const centerObject =
    (preferredCenter || mustShow[1]) ??
    mustShow[0] ??
    (summarizeText(firstClause(shot.description), 18) || '当前动作落点');
  const sceneFallback = collectSceneCandidates(shot)[0] ?? '';
  const background =
    (text.match(/门口|出口|楼梯|床榻|走廊|窗边|远处|暗处|屋内|屋外|背后/g) ?? [])[0] ??
    (sceneFallback || '结果位与出口线');
  const midground = mustShow.find((item) => item && item !== centerObject) ?? centerObject;
  return { foreground, midground, background, centerObject, occlusion };
}

function buildCameraPosition(
  shot: StoryboardShot,
  space: { foreground: string; midground: string; background: string },
): string {
  const scene = shot.sceneRef?.trim() || '当前场景';
  if (/大全景|全景/.test(shot.type)) return `${scene}外侧或高位机位先把前后景和出口线一起纳入，确保空间切割清楚。`;
  if (/特写|近景/.test(shot.type)) return `机位贴近${space.midground ?? '主体'}一侧，但仍保留${space.foreground}作为前景控制。`;
  return `机位落在${scene}内与${space.background}相对的位置，让前景遮挡、主体和结果位同处一条调度轴线上。`;
}

function buildCameraFacing(shot: StoryboardShot, space: { centerObject: string; background: string }): string {
  if (/推|缓推|推进/.test(shot.movement)) {
    return `镜头沿着${space.centerObject}缓慢压近，朝向${space.background}所在的结果线推进。`;
  }
  if (/摇|移|跟/.test(shot.movement)) {
    return `镜头顺着主体动作或视线方向摇移/跟移，始终把${space.centerObject}和结果位保持在同一关系链上。`;
  }
  return `镜头朝向${space.centerObject}与${space.background}形成的关系轴线，固定但不死平，保留压迫方向。`;
}

function buildCharacterFacing(visibleCharacter: boolean, mountTokens: string[]): string {
  if (!visibleCharacter) return '本镜无明确可见人物，不设置角色朝向，改由空间遮挡和道具位移承担表演。';
  const role = mountTokens[0] ?? '主体角色';
  return `${role}必须朝向事件中心或压迫来源，不能散开看；如有对位人物，则保持视线与动线在同一轴线上。`;
}

function buildFocusPriority(
  coreEvent: string,
  space: { centerObject: string; background: string },
  mustShow: string[],
  resultState: string,
): { primary: string; secondary: string; reaction: string } {
  return {
    primary: coreEvent || space.centerObject,
    secondary: mustShow.find((item) => item && item !== coreEvent && item !== space.centerObject) ?? space.background,
    reaction: normalizeVisualAnchor(resultState, '结果位上的反应或局势确认'),
  };
}

function distributeSegmentDurations(members: StoryboardShot[], totalSec: number): number[] {
  if (!members.length) return [];
  const safeTotal = Math.min(MAX_SEEDANCE_TOTAL_DURATION_SEC, Math.max(1, totalSec));
  const minSum = members.length * MIN_SEGMENT_DURATION_SEC;
  if (minSum >= safeTotal) {
    return members.map(() => safeTotal / members.length);
  }
  const weights = members.map((member) => Math.max(MIN_SEGMENT_DURATION_SEC, estimateSingleShotDurationSec(member)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || members.length;
  const rawDurations = weights.map((weight) => Math.max(MIN_SEGMENT_DURATION_SEC, (weight / weightTotal) * safeTotal));
  const rawTotal = rawDurations.reduce((sum, duration) => sum + duration, 0) || safeTotal;
  const normalized = rawDurations.map((duration) => (duration / rawTotal) * safeTotal);
  return normalized.map((duration) => Math.round(duration * 10) / 10);
}

function allocateTimingSegments(shot: StoryboardShot): Array<{
  member: StoryboardShot;
  start: number;
  end: number;
  durationSec: number;
}> {
  const members = expandMergedMembers(shot);
  if (members.length <= 1) return [];
  const totalSec = estimateShotDurationSec(shot);
  const durations = distributeSegmentDurations(members, totalSec);
  let cursor = 0;
  return members.map((member, index) => {
    const start = Number(cursor.toFixed(1));
    const end =
      index === members.length - 1
        ? totalSec
        : Math.min(totalSec, Number((cursor + (durations[index] ?? 0)).toFixed(1)));
    cursor = end;
    return {
      member,
      start,
      end,
      durationSec: Math.max(MIN_SEGMENT_DURATION_SEC, Number((end - start).toFixed(1))),
    };
  });
}

function splitTimeSlices(shot: StoryboardShot, members: StoryboardShot[], coreEvent: string, relationAfter: string): TimeSlice[] {
  if (members.length > 1) {
    const timingSegments = allocateTimingSegments(shot);
    const firstSegment = timingSegments[0];
    const lastSegment = timingSegments[timingSegments.length - 1];
    const middleSegments = timingSegments.slice(1, -1);
    const first = firstSegment?.member ?? members[0];
    const last = lastSegment?.member ?? members[members.length - 1];
    const middleRange = middleSegments.length
      ? formatTimingRange(firstSegment?.end ?? 1, lastSegment?.start ?? estimateShotDurationSec(shot))
      : `${formatTimingSecond(firstSegment?.end ?? 1)}秒节点`;
    return [
      {
        label: '事件成立',
        range: formatTimingRange(firstSegment?.start ?? 0, firstSegment?.end ?? 1),
        text: summarizeText(first.description || coreEvent, 30),
      },
      {
        label: '信息压入',
        range: middleRange,
        text: summarizeText(
          middleSegments.length
            ? middleSegments.map((segment) => firstClause(segment.member.description)).join(' / ')
            : firstClause(shot.action?.trim() || shot.description),
          34,
        ),
      },
      {
        label: '结果钉住',
        range: formatTimingRange(lastSegment?.start ?? 0, lastSegment?.end ?? estimateShotDurationSec(shot)),
        text: summarizeText(firstClause(last.description) || relationAfter, 30),
      },
    ];
  }
  const total = estimateShotDurationSec(shot);
  const firstEnd = Math.max(1, Number((total * 0.3).toFixed(1)));
  const secondEnd = Math.max(firstEnd + 1, Number((total * 0.75).toFixed(1)));
  return [
    { label: '事件成立', range: `0-${firstEnd}s`, text: summarizeText(firstClause(shot.description), 30) },
    {
      label: '信息压入',
      range: `${firstEnd}-${Math.min(secondEnd, total)}s`,
      text: summarizeText(firstClause(shot.action?.trim() || shot.content.trim() || coreEvent), 30),
    },
    {
      label: '结果钉住',
      range: `${Math.min(secondEnd, total)}-${total}s`,
      text: summarizeText(relationAfter, 30),
    },
  ];
}

function buildTimingSegments(shot: StoryboardShot): TimingSegment[] {
  const allocatedSegments = allocateTimingSegments(shot);
  if (!allocatedSegments.length) return [];
  return allocatedSegments.map(({ member, start, end, durationSec }) => {
    const text =
      summarizeText(firstClause(member.description), 22) ||
      summarizeText(firstClause(member.action?.trim() || ''), 22) ||
      summarizeText(firstClause(member.content.trim()), 22) ||
      summarizeText(`${member.type}${member.movement ? ` ${member.movement}` : ''}`.trim(), 22);
    return {
      label: `镜头${member.id}`,
      range: formatTimingRange(start, end),
      durationSec,
      text,
    };
  });
}

function buildTimingPlan(shot: StoryboardShot, timeSlices: TimeSlice[]): TimingPlan {
  const totalSec = estimateShotDurationSec(shot);
  const totalText = `总时长${formatTimingSecond(totalSec)}秒，严格控制在15秒内`;
  const timingSegments = buildTimingSegments(shot);
  if (timingSegments.length) {
    const allocationText = timingSegments
      .map((segment) => `${segment.label}${segment.range}（${formatTimingSecond(segment.durationSec)}秒）${segment.text ? `完成${segment.text}` : ''}`)
      .join('；');
    const allocationCompactText = timingSegments.map((segment) => `${segment.label}${segment.range}`).join('；');
    return {
      totalText,
      allocationText: `${totalText}；时长分配：${allocationText}`,
      allocationCompactText: `总${formatTimingSecond(totalSec)}秒；${allocationCompactText}`,
      sequenceRuleText: `不能把内容平均摊满15秒，必须严格按${allocationCompactText}推进`,
      sequenceRuleCompactText: `按${allocationCompactText}推进`,
    };
  }

  const allocationText = timeSlices
    .map((slice) => `${normalizeTimeSliceRange(slice.range)}${slice.label}${slice.text ? `完成${slice.text}` : ''}`)
    .join('；');
  const allocationCompactText = timeSlices
    .map((slice) => `${normalizeTimeSliceRange(slice.range)}${slice.label}`)
    .join('；');
  return {
    totalText,
    allocationText: `${totalText}；时长分配：${allocationText}`,
    allocationCompactText: `总${formatTimingSecond(totalSec)}秒；${allocationCompactText}`,
    sequenceRuleText: `不能把内容平均摊满15秒，必须严格按${allocationCompactText}推进`,
    sequenceRuleCompactText: `按${allocationCompactText}推进`,
  };
}

function inferVisibleSpeaker(shot: StoryboardShot, visibleCharacter: boolean, mountTokens: string[]): string {
  if (!shot.content.trim()) return '本镜无明确对白';
  if (!visibleCharacter) return '有声音信息，但不强求完整口型可见';
  return `${mountTokens[0] ?? '主说话角色'}承担可见发声位`;
}

function inferHiddenSpeaker(shot: StoryboardShot, visibleCharacter: boolean): string {
  if (!shot.content.trim()) return '无隐藏发声要求';
  if (!visibleCharacter) return '声音可存在于画外或遮挡后';
  return '对位人物可存在，但不要抢口型';
}

function inferPrimarySound(shot: StoryboardShot, mustShow: string[]): string {
  if (shot.content.trim()) return `对白与${mustShow[1] ?? '动作落点'}同步出现，优先读清信息落点。`;
  return `${mustShow[1] ?? '主体动作'}产生的细节声与环境底噪共同承担主声源。`;
}

function inferSecondarySound(shot: StoryboardShot): string {
  const text = `${shot.description} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (/夜|月|风/.test(text)) return '夜风、室内静噪、布料摩擦为次声源。';
  if (/门|窗|楼梯/.test(text)) return '门体、窗框、楼梯回响与脚步余音为次声源。';
  return '环境底噪、衣料摩擦与空间回声为次声源。';
}

function inferSoundCover(shot: StoryboardShot): string {
  if (shot.content.trim()) return '对白压住环境底噪，但不能盖掉动作关键信息。';
  if (PURSUIT_HINT_RE.test(`${shot.description} ${shot.action ?? ''}`)) {
    return '动作声压住环境底噪，突出势能推进。';
  }
  return '细小动作声压住空场静噪，让结果位更可读。';
}

function buildMustShow(
  profileSeed: Pick<SemanticProfile, 'characterTokens' | 'propTokens' | 'centerObject' | 'resultState' | 'mainEvent' | 'background'>,
): string[] {
  const combined = uniq([
    profileSeed.centerObject,
    profileSeed.propTokens[0] ?? '',
    profileSeed.characterTokens[0] ?? '',
    summarizeText(profileSeed.mainEvent, 16),
    normalizeVisualAnchor(profileSeed.resultState || profileSeed.background, profileSeed.background),
  ]).filter((item) => {
    if (!item) return false;
    if (ENTITY_PLACEHOLDER_RE.test(item)) return false;
    if (ACTION_FRAGMENT_ONLY_RE.test(item)) return false;
    if (ENTITY_EDGE_NOISE_RE.test(item)) return false;
    return true;
  });
  return combined.slice(0, 5);
}

function buildMicroExpression(shot: StoryboardShot, visibleCharacter: boolean, emotion: string): string {
  if (!visibleCharacter) {
    return '无人物表演建议；由光影变化、道具轻微位移、空气扰动或空间静压承担情绪钉子。';
  }
  if (shot.content.trim()) {
    return `在台词前后给一个短促可读的停顿、眼神压住或手部收紧，让“${emotion}”落在可拍的细节上。`;
  }
  return `用一次回头、停顿、呼吸收紧或手部细动作承接“${emotion}”，不要写成空泛情绪词。`;
}

function buildDimensions(
  shot: StoryboardShot,
  extracted: ExtractedShotSemantics,
  pack: PromptShotPack,
  coreEvent: string,
  emotion: string,
  lighting: string,
  space: { foreground: string; midground: string; background: string },
  relayObject: string,
): PromptShotDimensions {
  return {
    场景: extracted.scenes[0] || '当前场景',
    角色: extracted.characters.slice(0, 2).join('、') || '主体角色',
    动作: coreEvent,
    情感: pack.dimensions?.情感?.trim() || emotion,
    镜头: sanitizeDescriptorValue(pack.dimensions?.镜头?.trim(), 4) || `${shot.type} / ${inferLens(shot.type)}`,
    运镜: sanitizeDescriptorValue(pack.dimensions?.运镜?.trim(), 4) || shot.movement,
    灯光: sanitizeDescriptorValue(lighting, 4) || '写实电影光，保留暗部层次与可读高光',
    风格:
      sanitizeDescriptorValue(pack.dimensions?.风格?.trim(), 4) ||
      'SD2.0 分镜密度，写实电影调度，强调空间压迫与结果落点',
    构图: `前景 ${space.foreground} / 中景 ${space.midground} / 后景 ${space.background}`,
    连贯性: `承接上一镜动作方向与关系惯性，下一镜由 ${relayObject} 继续接力`,
  };
}

function buildSemanticProfile(shot: StoryboardShot, pack: PromptShotPack): SemanticProfile {
  const members = expandMergedMembers(shot);
  const extracted = extractShotSemantics(shot, members, pack);
  const durationSec = estimateShotDurationSec(shot);
  const mountTokens = buildMountTokens(shot, pack);
  const coreEvent = extracted.mainAction || buildCoreEvent(shot, members);
  const shotPlan = inferShotPlan(shot, members);
  const shotTempo = inferShotTempo(shot, members, durationSec);
  const proposition = members.length > 1
    ? `本镜要把连续动作从“${coreEvent}”推进到“${extracted.resultState}”，让同场信息在接力里完成重组。`
    : `本镜本质在于让“${coreEvent}”成立，并把结果钉在“${extracted.resultState}”上，不重复剧情摘要。`;
  const dramaticFunction = inferDramaticFunction(shot, members);
  const visibleCharacter = hasVisibleCharacter(shot);
  const lighting = inferLighting(shot, pack);
  const provisionalMustShow = uniq([
    ...extracted.characters.slice(0, 1),
    ...extracted.props.slice(0, 2),
    coreEvent,
    extracted.resultState,
  ]).slice(0, 4);
  const provisionalSpace = buildSpaceSegments(shot, provisionalMustShow, extracted.props[0] ?? extracted.characters[0] ?? '');
  const mustShow = buildMustShow({
    characterTokens: extracted.characters,
    propTokens: extracted.props,
    centerObject: provisionalSpace.centerObject,
    resultState: extracted.resultState,
    mainEvent: coreEvent,
    background: provisionalSpace.background,
  });
  const space = buildSpaceSegments(shot, mustShow, extracted.props[0] ?? mustShow[0] ?? '');
  const relationBefore = inferRelationBefore(shot);
  const relationTransition = inferRelationTransition(shot, members);
  const relationAfter = extracted.resultState || inferRelationAfter(shot, mustShow);
  const focus = buildFocusPriority(coreEvent, space, mustShow, relationAfter);
  const timeSlices = splitTimeSlices(shot, members, coreEvent, relationAfter);
  const emotion = inferEmotion(shot);
  const relayObject = extracted.props[0] ?? mustShow[1] ?? extracted.characters[0] ?? space.centerObject;
  const dimensions = buildDimensions(shot, extracted, pack, coreEvent, emotion, lighting, space, relayObject);
  const visibleSpeaker = inferVisibleSpeaker(shot, visibleCharacter, mountTokens);
  const hiddenSpeaker = inferHiddenSpeaker(shot, visibleCharacter);
  const primarySound = inferPrimarySound(shot, mustShow);
  const secondarySound = inferSecondarySound(shot);
  const soundCover = inferSoundCover(shot);
  return {
    shotId: String(shot.id),
    durationSec,
    shotType: shot.type,
    movement: shot.movement,
    shotPlan,
    shotTempo,
    characterTokens: extracted.characters,
    sceneTokens: extracted.scenes,
    propTokens: extracted.props,
    mountTokens,
    proposition,
    dramaticFunction,
    mainEvent: coreEvent,
    supportAction: extracted.supportAction,
    resultState: extracted.resultState,
    relationBefore,
    relationTransition,
    relationAfter,
    foreground: space.foreground,
    midground: space.midground,
    background: space.background,
    centerObject: space.centerObject,
    occlusion: space.occlusion,
    cameraPosition: buildCameraPosition(shot, space),
    cameraFacing: buildCameraFacing(shot, space),
    characterFacing: buildCharacterFacing(visibleCharacter, mountTokens),
    lens: inferLens(shot.type),
    depthOfField: inferDepthOfField(shot),
    focusPrimary: focus.primary,
    focusSecondary: focus.secondary,
    focusReaction: focus.reaction,
    startBeat: timeSlices[0]?.text ?? coreEvent,
    middleBeat: timeSlices[1]?.text ?? relationTransition,
    endBeat: timeSlices[2]?.text ?? relationAfter,
    timeSlices,
    visibleSpeaker,
    hiddenSpeaker,
    primarySound,
    secondarySound,
    soundCover,
    mustShow,
    hardNails: uniq([
      `${mustShow[0] ?? '主体'}必须先被看清`,
      `${summarizeText(extracted.resultState, 14) || mustShow[1] || '结果位'}必须在落幅处被钉住`,
    ]),
    emotionNail: emotion,
    narrativeNail: dramaticFunction,
    microExpression: buildMicroExpression(shot, visibleCharacter, emotion),
    handoff: '承接上一镜已经建立的动作方向、关系惯性和空间压迫，不重讲剧情。',
    relayObject,
    transitionGate:
      REVEAL_HINT_RE.test(`${shot.description} ${shot.action ?? ''}`)
        ? '用遮挡揭示与视线接通完成过门，不硬切势能。'
        : '用动作尾势、物件位移或空间压迫完成过门，不让镜头断气。',
    styleHint: dimensions.风格 ?? 'SD2.0 分镜密度',
    dimensions,
  };
}

function buildApertureText(profile: SemanticProfile): string {
  if (/浅景深/.test(profile.depthOfField)) return 'f/2.8浅景深';
  if (/中等景深|中景深/.test(profile.depthOfField)) return 'f/4中景深';
  return 'f/5.6可读景深';
}

function buildSceneSpaceSummary(profile: SemanticProfile): SceneSpaceSummary {
  const mainScene = profile.sceneTokens[0] || profile.dimensions.场景?.trim() || '当前场景';
  const splitState = `空间被${profile.centerObject}硬切成前后或两侧关系，${profile.background}作为结果位保留下来`;
  const roleA = profile.characterTokens[0] || profile.dimensions.角色 || '主体角色';
  const roleB = profile.characterTokens[1] || '';
  const characterClause = hasGenericHumanText(roleA)
    ? `${roleA}处在主承受位，动作与反应都围绕${profile.centerObject}展开`
    : roleB
      ? `${roleA}与${roleB}围绕${profile.centerObject}形成对位关系`
      : `${roleA}围绕${profile.centerObject}承担主反应位`;
  return {
    mainScene,
    splitState,
    centerClause: `${profile.centerObject}成为这一镜的视觉中心，${profile.foreground}负责显藏，${profile.background}负责结果落点`,
    characterClause,
  };
}

function hasGenericHumanText(value: string): boolean {
  return /角色|人物|主体|说话者/.test(value);
}

function buildMultiShotSequenceText(shot: StoryboardShot): string {
  const members = expandMergedMembers(shot);
  const timingSegments = buildTimingSegments(shot);
  if (members.length <= 1 || !timingSegments.length) return '';
  return members
    .map((member, index) => {
      const timing = timingSegments[index];
      const desc = summarizeText(firstClause(member.description), 24) || summarizeText(member.description, 24);
      const dialogue = member.content.trim() ? `，对白“${summarizeText(member.content.trim(), 16)}”` : '';
      return `${index === 0 ? '先' : index === members.length - 1 ? '最后' : '再'}用${timing.range}（${formatTimingSecond(timing.durationSec)}秒）以${member.type}${member.movement ? `与${member.movement}` : ''}${desc ? `完成${desc}` : '推进动作'}${dialogue}`;
    })
    .join('，');
}

function buildSoundCompression(profile: SemanticProfile, shot: StoryboardShot): string {
  const dialogue = shot.content.trim();
  if (dialogue) {
    const clipped = summarizeText(dialogue.replace(/\s+/g, ' '), 28);
    return `仅保留${profile.visibleSpeaker}的关键信息句“${clipped}”，${profile.soundCover}`;
  }
  return `${profile.primarySound}${profile.secondarySound ? `，${profile.secondarySound}` : ''}`;
}

function buildControlTail(profile: SemanticProfile): string {
  const style = /写实|电影/.test(profile.styleHint) ? profile.styleHint : `${profile.styleHint}，写实电影压迫感`;
  return `${style}，画面克制、压迫、可读，无背景音乐，禁字幕、禁台词文字、禁水印、禁Logo、禁角标、禁UI`;
}

function buildReferenceCoverageStability(profile: SemanticProfile): string {
  const sameFrame = uniq([
    profile.characterTokens[0] ?? '',
    profile.centerObject,
    profile.sceneTokens[0] ?? profile.dimensions.场景 ?? '',
  ])
    .filter(Boolean)
    .slice(0, 3)
    .join('、');
  const coverage = `${profile.foreground}到${profile.background}`;
  const settleMarks = profile.timeSlices.map((slice) => `${slice.range}${slice.label}`).join('；');
  return `参照同框=${sameFrame || profile.centerObject};覆盖范围=${coverage};稳帧建议=${settleMarks}`;
}

function stripLineEndingEllipsis(value: string): string {
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/(?:\.{3}|\u2026+)\s*$/g, '').trimEnd())
    .join('\n')
    .trim();
}

export function buildCopyToJimengPrompt(shot: StoryboardShot, pack: PromptShotPack): string {
  const profile = buildSemanticProfile(shot, pack);
  const sceneSpace = buildSceneSpaceSummary(profile);
  const multiShotSequence = buildMultiShotSequenceText(shot);
  const sequenceText =
    multiShotSequence ||
    `先${profile.mainEvent}，再${profile.supportAction || profile.middleBeat}，最后钉在${profile.resultState}`;
  const relationText = `${profile.mainEvent}，关系从“${profile.relationBefore}”转入“${profile.relationAfter}”`;
  const centerText = `${sceneSpace.centerClause}，${sceneSpace.characterClause}`;
  const focusText = `焦点优先锁${profile.focusPrimary}${profile.focusSecondary ? `、${profile.focusSecondary}` : ''}${profile.focusReaction ? `与${profile.focusReaction}` : ''}`;
  const soundText = buildSoundCompression(profile, shot);
  const controlTail = buildControlTail(profile);

  return stripLineEndingEllipsis(fitPromptClausesWithinLimit(
    [
      { text: '影视级3D渲染CG', compactText: '影视级3D CG', priority: 'important' },
      { text: '超写实PBR材质', compactText: 'PBR材质', priority: 'optional' },
      { text: '电影级光影渲染', compactText: '电影光影', priority: 'optional' },
      { text: `${profile.lens}电影镜头语言`, priority: 'required' },
      { text: buildApertureText(profile), compactText: summarizeText(buildApertureText(profile), 16), priority: 'important' },
      { text: sceneSpace.mainScene, compactText: summarizeText(sceneSpace.mainScene, 18), priority: 'required' },
      { text: sequenceText, compactText: summarizeText(sequenceText, 42), priority: 'required' },
      { text: relationText, compactText: `${summarizeText(profile.mainEvent, 18)}，关系转为${summarizeText(profile.relationAfter, 12)}`, priority: 'required' },
      { text: sceneSpace.splitState, compactText: summarizeText(sceneSpace.splitState, 22), priority: 'important' },
      { text: centerText, compactText: `${summarizeText(sceneSpace.centerClause, 18)}，${summarizeText(sceneSpace.characterClause, 18)}`, priority: 'optional' },
      { text: focusText, compactText: `焦点锁${summarizeText(profile.focusPrimary, 8)}>${summarizeText(profile.focusSecondary, 8)}>${summarizeText(profile.focusReaction, 8)}`, priority: 'required' },
      { text: soundText, compactText: summarizeText(soundText, 26), priority: 'important' },
      { text: `结果位停在${profile.resultState}`, compactText: `结果位=${summarizeText(profile.resultState, 16)}`, priority: 'required' },
      { text: controlTail, compactText: `${summarizeText(profile.styleHint, 12)}，禁字幕禁水印禁Logo禁UI`, priority: 'important' },
    ],
    2500,
  ));
}

export function buildStoryboardPromptText(shot: StoryboardShot, pack: PromptShotPack): string {
  const profile = buildSemanticProfile(shot, pack);
  const body = [
    `镜头身份：镜号#${profile.shotId} | ${profile.durationSec}秒`,
    `挂载：${profile.mountTokens.map((item) => `|@=${item}|`).join(' ')}`,
    `镜头命题：${profile.proposition}`,
    `场面机制：主事件=${profile.mainEvent}；戏剧功能=${profile.dramaticFunction}；关系变化=before ${profile.relationBefore} -> transition ${profile.relationTransition} -> after ${profile.relationAfter}`,
    `空间机制：前景=${profile.foreground}；中景=${profile.midground}；后景=${profile.background}；中心物=${profile.centerObject}；遮挡关系=${profile.occlusion}`,
    `镜头执行：相机位置=${profile.cameraPosition} 相机朝向=${profile.cameraFacing} 角色朝向=${profile.characterFacing} 焦段=${profile.lens} 景深=${profile.depthOfField} 焦点优先级=1.${profile.focusPrimary} 2.${profile.focusSecondary} 3.${profile.focusReaction}`,
    `时间推进：${profile.timeSlices.map((slice) => `${slice.label}:${slice.text}`).join(' ｜ ')}`,
    `声画规则：谁出声=${profile.visibleSpeaker}；谁不露口型=${profile.hiddenSpeaker}；主声源=${profile.primarySound}；次声源=${profile.secondarySound}；声音压住什么=${profile.soundCover}`,
    `结果锚定：Must-Show=${profile.mustShow.join(' / ')}；表演建议=${profile.microExpression}；硬钉子=${profile.hardNails.join('；')}；情绪钉子=${profile.emotionNail}；叙事钉子=${profile.narrativeNail}；承接=${profile.handoff}；过门=${profile.transitionGate}；下一镜接力物=${profile.relayObject}`,
    '禁项：不要把镜头写成普通文生图词串，不要重发剧情，不要补新人物或新事件，禁字幕、禁水印、禁Logo、禁UI、禁空泛风格词堆砌。',
  ].join('\n');
  return stripLineEndingEllipsis(clampPromptText(body, 2500));
}

export function buildStoryboardPromptPackFromShot(shot: StoryboardShot, pack: PromptShotPack): PromptShotPack {
  const profile = buildSemanticProfile(shot, pack);
  const prompt = buildCopyToJimengPrompt(shot, pack);
  return {
    ...pack,
    shot_id: String(shot.id),
    prompt,
    dimensions: profile.dimensions,
    seedanceCard: buildSeedanceCard(shot, { ...pack, prompt, dimensions: profile.dimensions }),
  };
}

export function buildSeedanceCard(shot: StoryboardShot, pack: PromptShotPack): string {
  const profile = buildSemanticProfile(shot, pack);
  const prompt = buildCopyToJimengPrompt(shot, pack);
  const timingPlan = buildTimingPlan(shot, profile.timeSlices);
  const mustShowText = profile.mustShow.join('、');
  const stateProgression = profile.timeSlices.map((slice) => `${slice.label}:${slice.text}`).join('；');
  const stateProgressionCompact = profile.timeSlices.map((slice) => slice.label).join(' -> ');
  const referenceLines = hasVisibleCharacter(shot)
    ? [
        `@角色负责：${profile.characterTokens.slice(0, 2).join(' / ') || '主体角色'}`,
        `@场景负责：${profile.sceneTokens[0] ?? profile.dimensions.场景 ?? '当前场景'} / ${profile.background}`,
        `@摄影负责：${profile.shotType} / ${profile.movement} / ${profile.lens}`,
      ]
    : [
        `@场景负责：${profile.sceneTokens[0] ?? profile.dimensions.场景 ?? '当前场景'} / ${profile.background}`,
        `@道具负责：${profile.propTokens.slice(0, 2).join(' / ') || profile.relayObject}`,
        `@摄影负责：${profile.shotType} / ${profile.movement} / ${profile.lens}`,
      ];
  const referenceLinesCompact = hasVisibleCharacter(shot)
    ? [
        `@角色：${profile.characterTokens.slice(0, 2).join(' / ') || '主体角色'}`,
        `@场景：${profile.sceneTokens[0] ?? profile.dimensions.场景 ?? '当前场景'}`,
      ]
    : [
        `@场景：${profile.sceneTokens[0] ?? profile.dimensions.场景 ?? '当前场景'}`,
        `@道具：${profile.propTokens.slice(0, 2).join(' / ') || profile.relayObject}`,
      ];
  const shotSpec = `焦段${profile.lens};光圈${buildApertureText(profile)};${profile.depthOfField};焦平面优先锁${profile.focusPrimary}${profile.focusSecondary ? `、${profile.focusSecondary}` : ''}${profile.focusReaction ? `与${profile.focusReaction}` : ''}`;
  const shotSpecCompact = `焦段${profile.lens};${summarizeText(buildApertureText(profile), 10)};焦点=${summarizeText(profile.focusPrimary, 6)}>${summarizeText(profile.focusSecondary, 6)}>${summarizeText(profile.focusReaction, 6)}`;
  const openingText = `${profile.startBeat}；${profile.mainEvent}，把${profile.relationBefore}强行改写为${profile.relationTransition}`;
  const openingTextCompact = `${summarizeText(profile.startBeat, 12)}；${summarizeText(profile.mainEvent, 14)}；转为${summarizeText(profile.relationTransition, 10)}`;
  const endingText = `${profile.endBeat}；${profile.resultState || profile.relationAfter}${shot.content.trim() ? `；关键发声句落在“${summarizeText(shot.content.trim(), 22)}”` : ''}`;
  const endingTextCompact = `${summarizeText(profile.endBeat, 12)}；结果位=${summarizeText(profile.resultState || profile.relationAfter, 12)}${shot.content.trim() ? `；台词“${summarizeText(shot.content.trim(), 8)}”` : ''}`;
  const cameraDirectionText = `${profile.cameraFacing};角色关系沿${profile.centerObject}同轴展开`;
  const cameraDirectionCompact = `${summarizeText(profile.cameraFacing, 12)}；沿${summarizeText(profile.centerObject, 8)}展开`;
  const compositionText = `前景${profile.foreground}，中景${profile.midground}，背景${profile.background}；中心物=${profile.centerObject}；遮挡关系=${profile.occlusion}；焦点顺序=${profile.focusPrimary} -> ${profile.focusSecondary} -> ${profile.focusReaction}`;
  const compositionCompact = `前=${summarizeText(profile.foreground, 6)}；中=${summarizeText(profile.midground, 6)}；后=${summarizeText(profile.background, 8)}；中心=${summarizeText(profile.centerObject, 8)}；焦点=${summarizeText(profile.focusPrimary, 5)}>${summarizeText(profile.focusSecondary, 5)}>${summarizeText(profile.focusReaction, 5)}`;
  const motionProtocolText = `${timingPlan.allocationText}；动态推进：${profile.timeSlices.map((slice) => `${normalizeTimeSliceRange(slice.range)}${slice.label}${slice.text}`).join('；')}；主导运镜只服从${profile.mainEvent}，不做复杂切换`;
  const motionProtocolCompact = `${timingPlan.allocationCompactText}；运镜服从${summarizeText(profile.mainEvent, 12)}`;
  const soundSyncText = `口型规则=${profile.hiddenSpeaker};主声源=${profile.primarySound};次声源=${profile.secondarySound};声音压住什么=${profile.soundCover}`;
  const soundSyncCompact = `口型=${summarizeText(profile.hiddenSpeaker, 8)}；主声=${summarizeText(profile.primarySound, 10)}；次声=${summarizeText(profile.secondarySound, 10)}；声压=${summarizeText(profile.soundCover, 10)}`;
  void mustShowText;
  void stateProgression;
  void referenceLines;
  void referenceLinesCompact;
  void compositionText;
  void compositionCompact;
  void soundSyncText;
  void soundSyncCompact;

  const header = `【分镜${profile.shotId} | ${profile.durationSec}秒】`;
  const sections: CardSection[] = [
    {
      heading: '挂载',
      body: [
        ...profile.characterTokens.slice(0, 2),
        ...profile.propTokens.slice(0, 2),
        profile.sceneTokens[0] ?? profile.dimensions.场景 ?? '当前场景',
        profile.primarySound || profile.secondarySound || '环境底噪 / 动作声',
      ]
        .filter(Boolean)
        .map((item) => `|@=${item}|`)
        .join(''),
      compactBody: [
        ...profile.characterTokens.slice(0, 1),
        profile.propTokens[0] ?? profile.relayObject,
        profile.sceneTokens[0] ?? profile.dimensions.场景 ?? '当前场景',
        profile.primarySound || '环境声',
      ]
        .filter(Boolean)
        .map((item) => `|@=${item}|`)
        .join(''),
      priority: 'core',
    },
    {
      heading: '相机位置',
      body: profile.cameraPosition,
      compactBody: summarizeText(profile.cameraPosition, 18),
      priority: 'core',
    },
    {
      heading: '相机朝向',
      body: cameraDirectionText,
      compactBody: cameraDirectionCompact,
      priority: 'support',
    },
    {
      heading: '角色朝向',
      body: profile.characterFacing,
      compactBody: summarizeText(profile.characterFacing, 14),
      priority: 'support',
    },
    {
      heading: '构图锚点',
      body: `前景：${profile.foreground}；中景：${profile.midground}；后景：${profile.background}；焦点落点：${profile.focusPrimary} -> ${profile.focusSecondary} -> ${profile.focusReaction}`,
      compactBody: `前景：${summarizeText(profile.foreground, 8)}；中景：${summarizeText(profile.midground, 8)}；后景：${summarizeText(profile.background, 8)}；焦点落点：${summarizeText(profile.focusPrimary, 6)}>${summarizeText(profile.focusSecondary, 6)}>${summarizeText(profile.focusReaction, 6)}`,
      priority: 'core',
    },
    {
      heading: '灯光布置与基调',
      body: `光源：${profile.dimensions.灯光 || '写实电影光'}；明暗关系：主体亮、压迫源半亮、非关键信息留黑；层次分配：前景${profile.foreground} / 中景${profile.midground} / 后景${profile.background}分层读清；灯光任务：服务${profile.mainEvent}的可读性与压迫感，不做平均照明`,
      compactBody: `光源：${summarizeText(profile.dimensions.灯光 || '写实电影光', 16)}；明暗关系：主体亮、非关键留黑；层次分配：前中后分层；灯光任务：服务${summarizeText(profile.mainEvent, 12)}`,
      priority: 'core',
    },
    {
      heading: '起幅',
      body: openingText,
      compactBody: openingTextCompact,
      priority: 'core',
    },
    {
      heading: '落幅',
      body: endingText,
      compactBody: endingTextCompact,
      priority: 'core',
    },
    {
      heading: '连续性约束',
      body: `必须承接${profile.handoff}；必须让${profile.relayObject}继续承担接镜；不能跳轴、不能打乱${stateProgressionCompact}的顺序；最后用${profile.transitionGate}把下一镜带入`,
      compactBody: `必须承接${summarizeText(profile.handoff, 12)}；不能跳轴；顺序按${stateProgressionCompact}推进；最后用${summarizeText(profile.transitionGate, 12)}接出去`,
      priority: 'core',
    },
    {
      heading: '提示词',
      body: prompt,
      compactBody: prompt,
      priority: 'core',
    },
    {
      heading: '摄影机动态参数',
      body: `主镜：24fps | 180°；关键节点：24fps | 144°；动态策略：${motionProtocolText}`,
      compactBody: `主镜：24fps | 180°；关键节点：24fps | 144°；动态策略：${motionProtocolCompact}`,
      priority: 'support',
    },
    {
      heading: '镜头参数',
      body: shotSpec,
      compactBody: shotSpecCompact,
      priority: 'core',
    },
    {
      heading: '插针 / 甩拍 / 慢镜头',
      body: `插针：${profile.mustShow.slice(0, 2).join('、')}各一次短插针；甩拍：无大甩拍，仅在${profile.mainEvent}瞬间允许短促甩拍；慢镜头：无`,
      compactBody: `插针：${profile.mustShow.slice(0, 1).join('、') || '无'}；甩拍：短促；慢镜头：无`,
      priority: 'support',
    },
    {
      heading: '表演建议',
      body: profile.microExpression,
      compactBody: summarizeText(profile.microExpression, 16),
      priority: 'support',
    },
    {
      heading: '钉子4行',
      body: [
        `${profile.hardNails[0] ?? `${profile.centerObject}必须先被看清`}`,
        `${profile.hardNails[1] ?? `${profile.relayObject}必须留在结果位`}`,
        `${profile.emotionNail}`,
        `${profile.narrativeNail}`,
      ].join('\n'),
      compactBody: [
        `${summarizeText(profile.hardNails[0] ?? `${profile.centerObject}必须先被看清`, 18)}`,
        `${summarizeText(profile.hardNails[1] ?? `${profile.relayObject}必须留在结果位`, 18)}`,
        `${summarizeText(profile.emotionNail, 18)}`,
        `${summarizeText(profile.narrativeNail, 18)}`,
      ].join('\n'),
      priority: 'core',
    },
  ];

  return stripLineEndingEllipsis(renderSeedanceCard(header, sections, 'none'));
}

export function buildSeedanceCardsText(
  shotPrompts: PromptShotPack[],
  storyboard: StoryboardOutput | null,
): string {
  const blocks = shotPrompts.map((pack, index) => {
    if (pack.seedanceCard?.trim()) return pack.seedanceCard.trim();
    const sourceShot =
      storyboard?.shots.find((shot) => String(shot.id) === String(pack.shot_id)) ??
      storyboard?.shots[index];
    if (sourceShot) return buildSeedanceCard(sourceShot, pack);
    return pack.seedanceCard?.trim() || '';
  });
  return blocks.filter(Boolean).join('\n\n');
}

void fitSeedanceCardWithinLimit;
void buildReferenceCoverageStability;
