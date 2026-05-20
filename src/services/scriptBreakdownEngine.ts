import type {
  ScriptAiAssetKind,
  ScriptAiAssetPlatform,
  ScriptAiAssetsOutput,
  ScriptAiPromptAsset,
  ScriptBreakdownOutput,
  ScriptArtComplexity,
  ScriptArtDirectionOutput,
  ScriptArtRequirement,
  ScriptCharacterBreakdown,
  ScriptCharactersOutput,
  ScriptConfidence,
  ScriptEvidenceRef,
  ScriptPackageOutput,
  ScriptPropBreakdown,
  ScriptProductionComplexity,
  ScriptProductionDepartment,
  ScriptProductionOutput,
  ScriptProductionRequirement,
  ScriptPropsOutput,
  ScriptReviewIssue,
  ScriptReviewOutput,
  ScriptSceneBreakdown,
  ScriptScenesOutput,
  ScriptTimelineConflict,
  ScriptTimelineEvent,
  ScriptTimelineMarker,
  ScriptTimelineOutput,
  ScriptVfxCategory,
  ScriptVfxComplexity,
  ScriptVfxOutput,
  ScriptVfxRequirement,
  ScriptWorldbuildingOutput,
} from '@/types/scriptBreakdown';

const HAN = '\\u4e00-\\u9fa5';

const KNOWN_PROP_CATEGORIES: Record<string, string[]> = {
  武器: ['刀', '剑', '枪', '匕首', '弓', '箭', '兵刃', '长矛', '钩', '鞭', '盾'],
  生活道具: ['手机', '钥匙', '信', '书', '照片', '笔', '纸', '杯', '碗', '酒', '药', '包', '箱', '盒'],
  置景陈设: ['门', '窗', '桌', '椅', '床', '灯', '镜', '帘', '屏风', '牌匾', '香炉'],
  服化饰品: ['衣', '袍', '帽', '面具', '戒指', '项链', '玉佩', '手套', '披风'],
  特效元素: ['血', '火', '烟', '雾', '雨', '雪', '白盐', '毒', '爆炸'],
  交通动物: ['车', '船', '马', '轿', '飞机'],
};

const COMMON_NAME_FALSE_POSITIVES = new Set([
  '一个',
  '两个',
  '众人',
  '所有人',
  '这时',
  '此时',
  '忽然',
  '突然',
  '镜头',
  '画面',
  '特写',
  '近景',
  '远景',
  '内景',
  '外景',
  '日景',
  '夜景',
  '白天',
  '夜晚',
  '月光',
  '巨大',
  '黑暗',
  '正是',
  '一阵',
  '一道',
  '手里',
  '桌上',
  '门口',
  '身后',
  '面前',
  '船舱',
  '船舱里',
  '码头',
  '码头尽头',
  '墙上',
  '香炉',
  '香炉里',
  '袖口',
  '岩壁',
  '山石',
  '木箱',
]);

function normalizeScriptText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function compactSnippet(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/[。！？!?；;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function firstSummary(text: string): string {
  const sentences = splitSentences(text);
  return compactSnippet(sentences.slice(0, 2).join('。') || text, 150);
}

function isSceneHeading(line: string): boolean {
  const t = line.trim();
  return /^(?:#{1,3}\s*)?(?:第?\s*[0-9一二三四五六七八九十百]+\s*(?:场|幕)|场次?\s*[0-9一二三四五六七八九十百]+|(?:INT|EXT)\.|(?:内景|外景|内外景)|【[^】]{2,40}】)/i.test(
    t,
  );
}

function cleanHeadingTitle(line: string, sceneNo: number): string {
  const cleaned = line
    .replace(/^#{1,3}\s*/, '')
    .replace(/^第?\s*[0-9一二三四五六七八九十百]+\s*(?:场|幕)\s*[：:.\-—]?\s*/i, '')
    .replace(/^场次?\s*[0-9一二三四五六七八九十百]+\s*[：:.\-—]?\s*/i, '')
    .replace(/^【|】$/g, '')
    .trim();
  return cleaned || `场次 ${sceneNo}`;
}

function splitIntoSceneChunks(text: string): Array<{ title: string; body: string; fromHeading: boolean }> {
  const normalized = normalizeScriptText(text);
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const headingCount = lines.filter(isSceneHeading).length;

  if (headingCount > 0) {
    const chunks: Array<{ title: string; lines: string[]; fromHeading: boolean }> = [];
    for (const line of lines) {
      if (isSceneHeading(line)) {
        chunks.push({
          title: cleanHeadingTitle(line, chunks.length + 1),
          lines: [],
          fromHeading: true,
        });
        continue;
      }
      if (chunks.length === 0) {
        chunks.push({ title: '开场', lines: [], fromHeading: false });
      }
      chunks[chunks.length - 1].lines.push(line);
    }
    return chunks.map((chunk) => ({
      title: chunk.title,
      body: chunk.lines.join('\n').trim(),
      fromHeading: chunk.fromHeading,
    }));
  }

  const paragraphs = normalized
    .split(/\n{2,}|\n(?=△|▲|○|●)/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paragraphs.length <= 5) {
    return [{ title: '场次 1', body: normalized, fromHeading: false }];
  }

  const groupSize = paragraphs.length > 18 ? 6 : paragraphs.length > 10 ? 5 : 4;
  const chunks: Array<{ title: string; body: string; fromHeading: boolean }> = [];
  for (let i = 0; i < paragraphs.length; i += groupSize) {
    chunks.push({
      title: `规则分段 ${chunks.length + 1}`,
      body: paragraphs.slice(i, i + groupSize).join('\n'),
      fromHeading: false,
    });
  }
  return chunks;
}

function detectInteriorExterior(text: string): ScriptSceneBreakdown['interiorExterior'] {
  if (/(?:内外景|内\/外景|内、外景)/i.test(text)) return '内外景待确认';
  if (/(?:INT\.|内景|室内|屋内|房间|大厅|殿内|船舱)/i.test(text)) return '内景';
  if (/(?:EXT\.|外景|室外|街上|院中|山路|林中|海边|荒野|殿外)/i.test(text)) return '外景';
  return '内外景待确认';
}

function detectTimeOfDay(text: string): string {
  const match = text.match(/(清晨|黎明|早晨|上午|中午|午后|下午|傍晚|黄昏|夜晚|深夜|凌晨|白天|日|夜)/);
  if (match?.[1]) return match[1];
  const englishMatch = text.match(/\b(NIGHT|DAY|MORNING|DAWN|NOON|AFTERNOON|EVENING|DUSK)\b/i);
  const englishTime = englishMatch?.[1]?.toUpperCase();
  if (englishTime === 'NIGHT') return '夜';
  if (englishTime === 'DAY') return '日';
  if (englishTime === 'MORNING' || englishTime === 'DAWN') return '清晨';
  if (englishTime === 'NOON') return '中午';
  if (englishTime === 'AFTERNOON') return '下午';
  if (englishTime === 'EVENING' || englishTime === 'DUSK') return '黄昏';
  return '时间待确认';
}

function detectLocation(title: string, body: string): string {
  const titlePart = title
    .replace(
      /(?:内景|外景|内外景|INT\.|EXT\.|NIGHT|DAY|MORNING|DAWN|NOON|AFTERNOON|EVENING|DUSK|清晨|黎明|早晨|上午|中午|午后|下午|傍晚|黄昏|夜晚|深夜|凌晨|白天|日|夜)/gi,
      '',
    )
    .replace(/[第场幕0-9一二三四五六七八九十百：:.\-—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (titlePart && titlePart.length >= 2 && titlePart.length <= 18) return titlePart;

  const bodyMatch = body.match(new RegExp(`(?:在|到|回到|来到|冲进|进入)([${HAN}A-Za-z0-9·]{2,14})(?:里|中|前|后|外|内|旁|上|下)?`));
  return bodyMatch?.[1] ?? '地点待确认';
}

function isLikelyName(name: string): boolean {
  const normalized = name.replace(/[△▲○●\s]/g, '').trim();
  if (normalized.length < 2 || normalized.length > 6) return false;
  if (COMMON_NAME_FALSE_POSITIVES.has(normalized)) return false;
  if (/(?:里|上|下|中|前|后|内|外|旁|边|尽头|袖口|炉|箱|桌|门|墙|石|铃)$/.test(normalized)) return false;
  if (/^(?:把|被|将|给|向|对|在|从|着|躲|传|浮|冒|渗|爆|拔|握|持|举|放|推|拉|点燃|照见)/.test(normalized)) {
    return false;
  }
  if (/^(?:男人|女人|老人|小孩|男孩|女孩|少年|少女|孩子|士兵|侍卫|村民|甲|乙|丙|丁)$/.test(normalized)) {
    return true;
  }
  return !/[，。！？、；：:]/.test(normalized);
}

function normalizeNameCandidate(raw: string): string {
  let value = raw
    .replace(/[△▲○●\s]/g, '')
    .replace(/(?:低声问|低声说|轻声问|轻声说|问道|说道|喊道|冷笑|怒吼)$/g, '')
    .replace(/(?:猛地|忽然|缓缓|立刻|马上|急忙|低声|轻声|突然)$/g, '')
    .replace(/(?:骑马|拔剑|握剑|持剑|点燃|手里|桌上|门口|身后|面前|机会|身影|长臂)$/g, '')
    .trim();

  const particleIndex = value.search(/[把将给向对被在从]/);
  if (particleIndex > 0) value = value.slice(0, particleIndex);

  const possessiveIndex = value.lastIndexOf('的');
  if (possessiveIndex >= 0 && possessiveIndex < value.length - 1) {
    value = value.slice(possessiveIndex + 1);
  }

  return value.trim();
}

function extractCharacterCandidates(text: string): Array<{ name: string; excerpt: string; dialogue: boolean }> {
  const candidates: Array<{ name: string; excerpt: string; dialogue: boolean }> = [];
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const dialogueRe = new RegExp(`(?:^|[。！？!?；;\\s])([A-Za-z${HAN}·]{2,12})(?:（[^）]*）)?[：:]`, 'g');
    for (const dialogue of line.matchAll(dialogueRe)) {
      const name = normalizeNameCandidate(dialogue[1] ?? '');
      if (isLikelyName(name)) {
        candidates.push({ name, excerpt: compactSnippet(line), dialogue: true });
      }
    }

    const actionRe = new RegExp(
      `([${HAN}]{2,6}?)(?=(?:猛地|忽然|缓缓|立刻|马上|急忙|低声|轻声|突然)?(?:说道|说|问|喊|道|笑|看|望|盯|抓|握|拔|推|拉|走|站|坐|躲|冲|刺|伸|抬|转|跪|扑|举|放|抱|牵|挡|点燃|点|已到))`,
      'g',
    );
    for (const match of line.matchAll(actionRe)) {
      const raw = match[1]?.trim();
      if (raw) {
        const name = normalizeNameCandidate(raw);
        if (isLikelyName(name)) {
          candidates.push({ name, excerpt: compactSnippet(line), dialogue: false });
        }
      }
    }

    const objectActionRe = new RegExp(
      `([${HAN}]{2,4}?)(?=(?:把|将|给|向|对|被)[${HAN}]{1,8}(?:放|递|交|推|拉|扔|举|拔|握|点燃|挡))`,
      'g',
    );
    for (const match of line.matchAll(objectActionRe)) {
      const raw = match[1]?.trim();
      if (raw) {
        const name = normalizeNameCandidate(raw);
        if (isLikelyName(name)) {
          candidates.push({ name, excerpt: compactSnippet(line), dialogue: false });
        }
      }
    }
  }

  return candidates;
}

function extractProps(text: string): Array<{ name: string; category: string; excerpt: string }> {
  const props: Array<{ name: string; category: string; excerpt: string }> = [];
  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    for (const [category, names] of Object.entries(KNOWN_PROP_CATEGORIES)) {
      for (const name of names) {
        if (sentence.includes(name)) {
          props.push({ name, category, excerpt: compactSnippet(sentence) });
        }
      }
    }
  }

  return props;
}

function confidenceForScene(fromHeading: boolean, location: string, timeOfDay: string): ScriptConfidence {
  if (fromHeading && location !== '地点待确认' && timeOfDay !== '时间待确认') return 'high';
  if (fromHeading || location !== '地点待确认') return 'medium';
  return 'low';
}

export function analyzeScriptScenes(text: string, opts?: { sourceNodeId?: string }): ScriptScenesOutput {
  const normalized = normalizeScriptText(text);
  const chunks = splitIntoSceneChunks(normalized);
  const scenes: ScriptSceneBreakdown[] = chunks.map((chunk, index) => {
    const sceneNo = index + 1;
    const sourceText = chunk.body || chunk.title;
    const combined = `${chunk.title}\n${sourceText}`;
    const location = detectLocation(chunk.title, sourceText);
    const timeOfDay = detectTimeOfDay(combined);
    const titleInteriorExterior = detectInteriorExterior(chunk.title);
    const interiorExterior =
      titleInteriorExterior === '内外景待确认' ? detectInteriorExterior(combined) : titleInteriorExterior;
    const characters = uniq(extractCharacterCandidates(sourceText).map((item) => item.name)).slice(0, 12);
    const propHits = extractProps(sourceText);
    const props = uniq(propHits.map((item) => item.name)).slice(0, 12);
    const confidence = confidenceForScene(chunk.fromHeading, location, timeOfDay);
    const warnings: string[] = [];

    if (!chunk.fromHeading) warnings.push('缺少明确场次标题，当前为规则分段。');
    if (location === '地点待确认') warnings.push('地点待确认。');
    if (timeOfDay === '时间待确认') warnings.push('时间标签待确认。');
    if (interiorExterior === '内外景待确认') warnings.push('内外景标签待确认。');

    return {
      id: `scene_${sceneNo}`,
      sceneNo,
      title: chunk.fromHeading ? chunk.title : `场次 ${sceneNo}`,
      location,
      interiorExterior,
      timeOfDay,
      characters,
      props,
      summary: firstSummary(sourceText),
      sourceText,
      confidence,
      warnings,
    };
  });

  const warnings = uniq(scenes.flatMap((scene) => scene.warnings));
  return {
    module: 'script_scenes',
    createdAt: Date.now(),
    sourceNodeId: opts?.sourceNodeId,
    scenes,
    warnings,
    stats: {
      sourceLength: normalized.length,
      sceneCount: scenes.length,
      warningCount: warnings.length,
    },
  };
}

export function analyzeScriptCharacters(
  text: string,
  scenes?: ScriptSceneBreakdown[],
  opts?: { sourceNodeId?: string },
): ScriptCharactersOutput {
  const normalized = normalizeScriptText(text);
  const sceneList = scenes?.length ? scenes : analyzeScriptScenes(normalized).scenes;
  const byName = new Map<string, ScriptCharacterBreakdown>();

  for (const scene of sceneList) {
    const candidates = [
      ...scene.characters.map((name) => ({ name, excerpt: compactSnippet(scene.sourceText), dialogue: false })),
      ...extractCharacterCandidates(scene.sourceText),
    ];

    for (const candidate of candidates) {
      const name = candidate.name.trim();
      if (!isLikelyName(name)) continue;
      const current =
        byName.get(name) ??
        ({
          id: `character_${byName.size + 1}`,
          name,
          aliases: [],
          firstSceneNo: scene.sceneNo,
          sceneNos: [],
          actionHints: [],
          dialogueCount: 0,
          evidence: [],
          confidence: 'low',
          warnings: [],
        } satisfies ScriptCharacterBreakdown);

      if (!current.sceneNos.includes(scene.sceneNo)) current.sceneNos.push(scene.sceneNo);
      if (candidate.dialogue) current.dialogueCount += 1;
      if (current.evidence.length < 4) {
        current.evidence.push({ sceneNo: scene.sceneNo, excerpt: candidate.excerpt });
      }
      if (current.actionHints.length < 4 && !candidate.dialogue) {
        current.actionHints.push(candidate.excerpt);
      }
      byName.set(name, current);
    }
  }

  const characters = [...byName.values()]
    .map((character) => {
      const confidence: ScriptConfidence =
        character.dialogueCount > 0 || character.sceneNos.length >= 2 ? 'high' : 'medium';
      return {
        ...character,
        sceneNos: character.sceneNos.sort((a, b) => a - b),
        confidence,
        warnings: confidence === 'medium' ? ['仅由动作规则识别，建议人工确认角色名。'] : [],
      };
    })
    .sort((a, b) => a.firstSceneNo - b.firstSceneNo || a.name.localeCompare(b.name, 'zh-Hans-CN'));

  const warnings = uniq(characters.flatMap((character) => character.warnings));
  return {
    module: 'script_characters',
    createdAt: Date.now(),
    sourceNodeId: opts?.sourceNodeId,
    characters,
    warnings,
    stats: {
      sourceLength: normalized.length,
      characterCount: characters.length,
      warningCount: warnings.length,
    },
  };
}

export function analyzeScriptProps(
  text: string,
  scenes?: ScriptSceneBreakdown[],
  opts?: { sourceNodeId?: string },
): ScriptPropsOutput {
  const normalized = normalizeScriptText(text);
  const sceneList = scenes?.length ? scenes : analyzeScriptScenes(normalized).scenes;
  const byName = new Map<string, ScriptPropBreakdown>();

  for (const scene of sceneList) {
    for (const hit of extractProps(scene.sourceText)) {
      const current =
        byName.get(hit.name) ??
        ({
          id: `prop_${byName.size + 1}`,
          name: hit.name,
          category: hit.category,
          sceneNos: [],
          notes: [],
          evidence: [],
          confidence: 'medium',
          warnings: [],
        } satisfies ScriptPropBreakdown);
      if (!current.sceneNos.includes(scene.sceneNo)) current.sceneNos.push(scene.sceneNo);
      if (current.evidence.length < 4) current.evidence.push({ sceneNo: scene.sceneNo, excerpt: hit.excerpt });
      if (current.notes.length < 3) current.notes.push(`场${scene.sceneNo}出现`);
      byName.set(hit.name, current);
    }
  }

  const props = [...byName.values()]
    .map((prop) => ({
      ...prop,
      sceneNos: prop.sceneNos.sort((a, b) => a - b),
      confidence: prop.sceneNos.length >= 2 ? ('high' as const) : prop.confidence,
      warnings: prop.sceneNos.length === 1 ? ['单次出现，需确认是否为关键道具。'] : [],
    }))
    .sort((a, b) => a.sceneNos[0] - b.sceneNos[0] || a.name.localeCompare(b.name, 'zh-Hans-CN'));

  const warnings = uniq(props.flatMap((prop) => prop.warnings));
  return {
    module: 'script_props',
    createdAt: Date.now(),
    sourceNodeId: opts?.sourceNodeId,
    props,
    warnings,
    stats: {
      sourceLength: normalized.length,
      propCount: props.length,
      warningCount: warnings.length,
    },
  };
}

export function combineScriptBreakdownOutputs(outputs: ScriptBreakdownOutput[]): ScriptPackageOutput {
  const sceneOutput = outputs.find((output): output is ScriptScenesOutput => output.module === 'script_scenes');
  const characterOutput = outputs.find(
    (output): output is ScriptCharactersOutput => output.module === 'script_characters',
  );
  const propOutput = outputs.find((output): output is ScriptPropsOutput => output.module === 'script_props');
  const warnings = uniq(outputs.flatMap((output) => output.warnings ?? []));
  const scenes = sceneOutput?.scenes ?? [];
  const characters = characterOutput?.characters ?? [];
  const props = propOutput?.props ?? [];

  return {
    module: 'script_package',
    createdAt: Date.now(),
    scenes,
    characters,
    props,
    warnings,
    stats: {
      sourceLength: Math.max(0, ...outputs.map((output) => output.stats?.sourceLength ?? 0)),
      sceneCount: scenes.length,
      characterCount: characters.length,
      propCount: props.length,
      warningCount: warnings.length,
    },
  };
}

function issue(
  id: string,
  severity: ScriptReviewIssue['severity'],
  category: ScriptReviewIssue['category'],
  target: string,
  summary: string,
  recommendation: string,
  evidence?: ScriptReviewIssue['evidence'],
): ScriptReviewIssue {
  return { id, severity, category, target, summary, recommendation, evidence };
}

function detectTimelineMarker(text: string): ScriptTimelineMarker {
  if (/(回忆|闪回|倒叙|多年前|小时候|曾经|梦中|梦见)/.test(text)) return 'flashback';
  if (/(多年后|后来|将来|未来|预示|预告)/.test(text)) return 'future';
  if (/(蒙太奇| montage |组接|快切)/i.test(text)) return 'montage';
  return 'present';
}

function timeRank(timeOfDay: string): number | null {
  if (/(凌晨|黎明|清晨|早晨|早上)/.test(timeOfDay)) return 1;
  if (/(上午|白天)/.test(timeOfDay)) return 2;
  if (/(中午)/.test(timeOfDay)) return 3;
  if (/(午后|下午)/.test(timeOfDay)) return 4;
  if (/(傍晚|黄昏)/.test(timeOfDay)) return 5;
  if (/(夜晚|深夜|晚上|夜)/.test(timeOfDay)) return 6;
  return null;
}

function conflict(
  id: string,
  severity: ScriptTimelineConflict['severity'],
  summary: string,
  recommendation: string,
  scene?: ScriptSceneBreakdown,
): ScriptTimelineConflict {
  return {
    id,
    severity,
    sceneNo: scene?.sceneNo,
    summary,
    recommendation,
    evidence: scene ? { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) } : undefined,
  };
}

export function analyzeScriptTimelineOutputs(outputs: ScriptBreakdownOutput[]): ScriptTimelineOutput {
  const packageOutput =
    outputs.find((output): output is ScriptPackageOutput => output.module === 'script_package') ??
    combineScriptBreakdownOutputs(outputs);
  const events: ScriptTimelineEvent[] = [];
  const conflicts: ScriptTimelineConflict[] = [];
  let currentDay = 1;
  let previousRank: number | null = null;

  const sortedScenes = [...packageOutput.scenes].sort((a, b) => a.sceneNo - b.sceneNo);
  for (const scene of sortedScenes) {
    const combined = `${scene.title}\n${scene.sourceText}`;
    const marker = detectTimelineMarker(combined);
    const explicitNextDay = /(次日|翌日|第二天|第二日|第二晚|隔天|次晨)/.test(combined);
    const explicitSameDay = /(同日|当天|当晚|随后|片刻后|不久后|紧接|与此同时)/.test(combined);
    const rank = timeRank(scene.timeOfDay);
    const warnings: string[] = [];

    if (events.length > 0 && explicitNextDay) {
      currentDay += 1;
    } else if (
      events.length > 0 &&
      marker === 'present' &&
      previousRank != null &&
      rank != null &&
      rank < previousRank &&
      !explicitSameDay
    ) {
      currentDay += 1;
      warnings.push('时间从较晚场景跳到较早场景，已推定为次日，需人工确认。');
      conflicts.push(
        conflict(
          `timeline_${scene.sceneNo}_day_rollover`,
          'warning',
          `场次 ${scene.sceneNo} 可能发生跨日。`,
          '建议在场次标题或正文中补充“次日/翌日/同日”等明确时间关系。',
          scene,
        ),
      );
    }

    if (scene.timeOfDay === '时间待确认') {
      warnings.push('时间标签缺失，无法稳定排入拍摄日程。');
      conflicts.push(
        conflict(
          `timeline_${scene.sceneNo}_missing_time`,
          'warning',
          `场次 ${scene.sceneNo} 缺少时间标签。`,
          '补充清晨/白天/夜晚等时间信息，方便后续灯光和通告排期。',
          scene,
        ),
      );
    }
    if (scene.location === '地点待确认') {
      warnings.push('地点缺失，时间线无法和场景资源表对齐。');
      conflicts.push(
        conflict(
          `timeline_${scene.sceneNo}_missing_location`,
          'info',
          `场次 ${scene.sceneNo} 缺少地点。`,
          '补充主场景地点，后续可以按地点合并拍摄计划。',
          scene,
        ),
      );
    }
    if (marker === 'flashback' || marker === 'future' || marker === 'montage') {
      warnings.push('非顺叙时间标记需要人工确认故事时间。');
      conflicts.push(
        conflict(
          `timeline_${scene.sceneNo}_${marker}`,
          'info',
          `场次 ${scene.sceneNo} 含有${marker === 'flashback' ? '回忆/闪回' : marker === 'future' ? '未来' : '蒙太奇'}结构。`,
          '建议单独标注故事时间、现实时间和剪辑方式，避免统筹排期误读。',
          scene,
        ),
      );
    }

    const storyDay =
      marker === 'flashback'
        ? '回忆'
        : marker === 'future'
          ? '未来'
          : marker === 'montage'
            ? `D${currentDay}/蒙太奇`
            : `D${currentDay}`;

    events.push({
      id: `timeline_${scene.sceneNo}`,
      sceneNo: scene.sceneNo,
      order: events.length + 1,
      storyDay,
      timeOfDay: scene.timeOfDay,
      marker,
      location: scene.location,
      summary: scene.summary,
      evidence: { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
      confidence: warnings.length > 0 ? (scene.confidence === 'high' ? 'medium' : scene.confidence) : scene.confidence,
      warnings,
    });

    if (marker === 'present' && rank != null) previousRank = rank;
  }

  if (events.length === 0) {
    conflicts.push(
      conflict(
        'timeline_no_events',
        'warning',
        '没有可用的时间线事件。',
        '请先运行场景拆解和拆解汇总，或确认剧本文本是否为空。',
      ),
    );
  }

  const warnings = uniq([
    ...events.flatMap((event) => event.warnings),
    ...conflicts.filter((item) => item.severity === 'warning').map((item) => item.summary),
  ]);
  const dayCount = new Set(events.map((event) => event.storyDay)).size;
  const unknownTimeCount = events.filter((event) => event.timeOfDay === '时间待确认').length;

  return {
    module: 'script_timeline',
    createdAt: Date.now(),
    events,
    conflicts,
    warnings,
    stats: {
      sourceLength: packageOutput.stats.sourceLength,
      eventCount: events.length,
      dayCount,
      conflictCount: conflicts.length,
      unknownTimeCount,
      warningCount: warnings.length,
    },
  };
}

function artMoodForScene(scene: ScriptSceneBreakdown): string {
  const text = `${scene.title}\n${scene.sourceText}`;
  if (/(血|刀|剑|杀|追|逃|围|怒|悲痛|恐惧|压迫)/.test(text)) return '紧张压迫';
  if (/(月光|深夜|夜晚|黑暗|烛|灯)/.test(text)) return '低照度悬疑';
  if (/(清晨|黎明|晨光)/.test(text)) return '冷暖过渡';
  if (/(宫|殿|庙|寺|城|寨|堂|府)/.test(text)) return '厚重秩序';
  if (/(林|山|河|海|雨|雪|风|荒野)/.test(text)) return '自然环境';
  return '写实叙事';
}

function artPaletteForScene(scene: ScriptSceneBreakdown, mood: string): string[] {
  const text = `${scene.timeOfDay}\n${scene.sourceText}`;
  if (/(夜|深夜|黑暗)/.test(text)) return ['靛蓝', '冷黑', '低饱和暖光'];
  if (/(清晨|黎明|晨光)/.test(text)) return ['灰蓝', '浅金', '雾白'];
  if (/(黄昏|傍晚)/.test(text)) return ['琥珀', '暗红', '灰褐'];
  if (/(血|火|灯|烛)/.test(text)) return ['暗红', '暖橙', '烟黑'];
  if (mood === '自然环境') return ['草木绿', '岩灰', '雾白'];
  return ['低饱和中性色', '环境主色', '角色强调色'];
}

function visualStyleForScene(scene: ScriptSceneBreakdown, mood: string): string {
  if (scene.interiorExterior === '内景') return `${mood} · 可控置景`;
  if (scene.interiorExterior === '外景') return `${mood} · 实景/外景资源`;
  return `${mood} · 内外景待定`;
}

function artComplexityForScene(scene: ScriptSceneBreakdown): ScriptArtComplexity {
  const propScore = scene.props.length >= 8 ? 2 : scene.props.length >= 4 ? 1 : 0;
  const unknownScore =
    (scene.location === '地点待确认' ? 1 : 0) +
    (scene.timeOfDay === '时间待确认' ? 1 : 0) +
    (scene.interiorExterior === '内外景待确认' ? 1 : 0);
  const nightExteriorScore = scene.interiorExterior === '外景' && /(夜|深夜|黄昏|傍晚)/.test(scene.timeOfDay) ? 1 : 0;
  const score = propScore + unknownScore + nightExteriorScore;
  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

export function analyzeScriptArtDirectionOutputs(outputs: ScriptBreakdownOutput[]): ScriptArtDirectionOutput {
  const packageOutput =
    outputs.find((output): output is ScriptPackageOutput => output.module === 'script_package') ??
    combineScriptBreakdownOutputs(outputs);
  const requirements: ScriptArtRequirement[] = packageOutput.scenes.map((scene) => {
    const mood = artMoodForScene(scene);
    const palette = artPaletteForScene(scene, mood);
    const complexity = artComplexityForScene(scene);
    const warnings: string[] = [];
    if (scene.location === '地点待确认') warnings.push('缺少主场景地点，无法稳定拆出置景资产。');
    if (scene.timeOfDay === '时间待确认') warnings.push('缺少时间标签，灯光和色彩方案需要人工确认。');
    if (scene.interiorExterior === '内外景待确认') warnings.push('内外景未定，会影响搭景/实景选择。');

    const setRequirements = [
      scene.location === '地点待确认' ? '先确认主场景地点' : `主场景：${scene.location}`,
      `空间类型：${scene.interiorExterior}`,
      `时间氛围：${scene.timeOfDay}`,
      scene.props.length ? `重点道具：${scene.props.slice(0, 8).join('、')}` : '道具待补充',
      scene.characters.length ? `角色动线需服务：${scene.characters.slice(0, 6).join('、')}` : '角色动线待确认',
    ];

    return {
      id: `art_${scene.sceneNo}`,
      sceneNo: scene.sceneNo,
      category: 'set',
      title: `${scene.location === '地点待确认' ? `场${scene.sceneNo}` : scene.location}美术方案`,
      visualStyle: visualStyleForScene(scene, mood),
      mood,
      palette,
      requirements: setRequirements,
      references: [
        scene.interiorExterior === '外景' ? '外景勘景照片/地形参考' : '平面图/置景参考',
        scene.timeOfDay === '时间待确认' ? '时间光效待补' : `${scene.timeOfDay}光效参考`,
      ],
      complexity,
      evidence: { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
      warnings,
    };
  });

  if (requirements.length === 0) {
    return {
      module: 'script_art',
      createdAt: Date.now(),
      requirements: [],
      palette: [],
      summary: '暂无可分析场景，请先运行场景拆解和拆解汇总。',
      warnings: ['暂无可分析场景。'],
      stats: {
        sourceLength: packageOutput.stats.sourceLength,
        requirementCount: 0,
        sceneCount: 0,
        highComplexityCount: 0,
        warningCount: 1,
      },
    };
  }

  const palette = uniq(requirements.flatMap((item) => item.palette)).slice(0, 12);
  const warnings = uniq(requirements.flatMap((item) => item.warnings));
  const highComplexityCount = requirements.filter((item) => item.complexity === 'high').length;
  const summary = `已生成 ${requirements.length} 条美术统筹底稿，覆盖 ${packageOutput.scenes.length} 场；高复杂度场景 ${highComplexityCount} 个。`;

  return {
    module: 'script_art',
    createdAt: Date.now(),
    requirements,
    palette,
    summary,
    warnings,
    stats: {
      sourceLength: packageOutput.stats.sourceLength,
      requirementCount: requirements.length,
      sceneCount: packageOutput.scenes.length,
      highComplexityCount,
      warningCount: warnings.length,
    },
  };
}

type VfxHit = {
  category: ScriptVfxCategory;
  effectType: string;
  keywords: string[];
};

const VFX_RULES: VfxHit[] = [
  { category: 'practical', effectType: '火焰/燃烧', keywords: ['火', '火焰', '燃烧', '灯火', '烛火'] },
  { category: 'practical', effectType: '爆破/破碎', keywords: ['爆炸', '爆破', '炸开', '坍塌', '碎裂', '崩塌'] },
  { category: 'environment', effectType: '烟雾/尘土', keywords: ['烟', '烟雾', '尘土', '沙尘', '灰尘', '雾'] },
  { category: 'environment', effectType: '天气特效', keywords: ['雨', '暴雨', '雪', '雷', '闪电', '风', '狂风', '洪水', '海浪'] },
  { category: 'makeup', effectType: '血浆/创伤', keywords: ['血', '血迹', '伤口', '断肢', '腐烂', '尸体'] },
  { category: 'digital', effectType: '超自然/能量', keywords: ['法术', '灵光', '光芒', '结界', '幻影', '消失', '变形', '悬浮', '飞起'] },
  { category: 'creature', effectType: '生物/怪物', keywords: ['怪物', '妖', '魔', '兽', '巨兽', '龙', '鬼影'] },
  { category: 'stunt', effectType: '危险动作辅助', keywords: ['坠落', '飞身', '撞飞', '爆冲', '落下', '翻滚'] },
];

function vfxComplexityForHit(scene: ScriptSceneBreakdown, hit: VfxHit): ScriptVfxComplexity {
  const text = `${scene.title}\n${scene.sourceText}`;
  const multiLayer = VFX_RULES.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword))).length;
  if (
    hit.category === 'digital' ||
    hit.category === 'creature' ||
    /(爆炸|爆破|坍塌|洪水|巨兽|变形|悬浮|飞起)/.test(text) ||
    multiLayer >= 3
  ) {
    return 'high';
  }
  if (hit.category === 'practical' || hit.category === 'makeup' || multiLayer >= 2) return 'medium';
  return 'low';
}

function vfxMethodForHit(hit: VfxHit, complexity: ScriptVfxComplexity): string {
  if (hit.category === 'digital' || hit.category === 'creature') return '数字特效为主，现场采集干净底板和互动光参考';
  if (hit.category === 'environment') return complexity === 'high' ? '实拍天气元素结合数字增强' : '现场气氛机/风雨设备为主';
  if (hit.category === 'makeup') return '特效化妆与血浆道具为主，必要时做数字擦除';
  if (hit.category === 'stunt') return '动作设计、威亚/安全垫和数字擦除配合';
  return complexity === 'high' ? '现场实效与数字合成混合' : '现场实效优先';
}

function vfxPlateNeeds(scene: ScriptSceneBreakdown, hit: VfxHit): string[] {
  const needs = ['主镜头底板'];
  if (hit.category === 'digital' || hit.category === 'creature') needs.push('干净底板', 'HDRI/灰球铬球', '互动光参考');
  if (hit.category === 'environment') needs.push('环境空镜', '粒子/天气参考');
  if (hit.category === 'makeup') needs.push('妆效连续性照片');
  if (scene.interiorExterior === '外景') needs.push('外景光线变化记录');
  return uniq(needs);
}

function vfxAssetNeeds(scene: ScriptSceneBreakdown, hit: VfxHit): string[] {
  const needs = [hit.effectType];
  if (hit.category === 'digital') needs.push('能量/光效元素', '合成遮罩');
  if (hit.category === 'creature') needs.push('生物概念设定', '比例参考', '动作参考');
  if (hit.category === 'practical') needs.push('安全实效方案');
  if (hit.category === 'makeup') needs.push('伤效/血浆道具');
  if (scene.props.length) needs.push(`关联道具：${scene.props.slice(0, 4).join('、')}`);
  return uniq(needs);
}

export function analyzeScriptVfxOutputs(outputs: ScriptBreakdownOutput[]): ScriptVfxOutput {
  const packageOutput =
    outputs.find((output): output is ScriptPackageOutput => output.module === 'script_package') ??
    combineScriptBreakdownOutputs(outputs);
  const requirements: ScriptVfxRequirement[] = [];

  for (const scene of packageOutput.scenes) {
    const text = `${scene.title}\n${scene.sourceText}\n${scene.props.join(' ')}`;
    const hits = VFX_RULES.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword)));
    for (const hit of hits) {
      const complexity = vfxComplexityForHit(scene, hit);
      const warnings: string[] = [];
      if (scene.timeOfDay === '时间待确认') warnings.push('时间标签缺失，互动光和曝光方案待确认。');
      if (scene.location === '地点待确认') warnings.push('地点缺失，无法判断现场安全和底板需求。');
      if (complexity === 'high') warnings.push('高复杂度视效，建议提前做视效分解和拍摄测试。');

      requirements.push({
        id: `vfx_${scene.sceneNo}_${requirements.length + 1}`,
        sceneNo: scene.sceneNo,
        category: hit.category,
        title: `场${scene.sceneNo} · ${hit.effectType}`,
        effectType: hit.effectType,
        complexity,
        productionMethod: vfxMethodForHit(hit, complexity),
        plateNeeds: vfxPlateNeeds(scene, hit),
        assetNeeds: vfxAssetNeeds(scene, hit),
        riskNotes: [
          complexity === 'high' ? '需提前评估预算、拍摄时长和后期周期。' : '可纳入常规视效/实效清单。',
          hit.category === 'practical' ? '现场安全审批和消防方案需先行确认。' : '',
          hit.category === 'stunt' ? '需动作指导与安全员联合设计。' : '',
        ].filter(Boolean),
        evidence: { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
        warnings,
      });
    }
  }

  const warnings = uniq(requirements.flatMap((item) => item.warnings));
  const highComplexityCount = requirements.filter((item) => item.complexity === 'high').length;
  const digitalCount = requirements.filter((item) => item.category === 'digital' || item.category === 'creature').length;
  const sceneCount = new Set(requirements.map((item) => item.sceneNo)).size;
  const summary = requirements.length
    ? `已生成 ${requirements.length} 条 VFX 底稿，覆盖 ${sceneCount} 场；高复杂度 ${highComplexityCount} 条。`
    : '当前拆解汇总中未识别到明确 VFX 需求。';

  return {
    module: 'script_vfx',
    createdAt: Date.now(),
    requirements,
    summary,
    warnings,
    stats: {
      sourceLength: packageOutput.stats.sourceLength,
      requirementCount: requirements.length,
      sceneCount,
      highComplexityCount,
      digitalCount,
      warningCount: warnings.length,
    },
  };
}

function sceneEvidenceForKeywords(
  scenes: ScriptSceneBreakdown[],
  keywords: string[],
  max = 5,
): Array<{ sceneNo: number; excerpt: string }> {
  const evidence: Array<{ sceneNo: number; excerpt: string }> = [];
  for (const scene of scenes) {
    const sentences = splitSentences(`${scene.title}。${scene.sourceText}`);
    const hit = sentences.find((sentence) => keywords.some((keyword) => sentence.includes(keyword)));
    if (hit) evidence.push({ sceneNo: scene.sceneNo, excerpt: compactSnippet(hit, 160) });
    if (evidence.length >= max) break;
  }
  return evidence;
}

function textHasAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function inferWorldEra(text: string): string {
  if (textHasAny(text, ['飞船', '星舰', '太空', '殖民星', '机器人', 'AI', '赛博'])) return '未来/科幻时代';
  if (textHasAny(text, ['手机', '电脑', '汽车', '电梯', '公司', '警局', '医院'])) return '现代/近现代';
  if (textHasAny(text, ['皇帝', '朝廷', '王府', '土司', '寨', '刀', '剑', '弓', '马', '庙', '香炉'])) {
    return '古装/冷兵器时代';
  }
  if (textHasAny(text, ['法术', '灵力', '结界', '妖', '魔', '鬼', '巨兽'])) return '奇幻/超自然时代';
  return '时代待确认';
}

function inferWorldTech(text: string): string {
  if (textHasAny(text, ['飞船', '星舰', '机器人', 'AI', '赛博'])) return '高科技/科幻技术';
  if (textHasAny(text, ['手机', '电脑', '汽车', '电梯', '监控'])) return '现代工业技术';
  if (textHasAny(text, ['火枪', '火炮', '炸药'])) return '冷兵器 + 早期火器';
  if (textHasAny(text, ['刀', '剑', '弓', '箭', '马', '寨', '庙', '香炉'])) return '冷兵器/手工业技术';
  if (textHasAny(text, ['法术', '灵力', '结界', '妖', '魔', '鬼'])) return '超自然能量体系';
  return '技术水平待确认';
}

function inferWorldCivilization(text: string): string {
  if (textHasAny(text, ['土司', '寨', '部落', '族人'])) return '边疆寨堡/部族秩序';
  if (textHasAny(text, ['皇帝', '朝廷', '王府', '将军', '官军'])) return '王朝军政秩序';
  if (textHasAny(text, ['公司', '集团', '警局', '医院', '学校'])) return '现代组织社会';
  if (textHasAny(text, ['门派', '江湖', '宗门'])) return '江湖/宗门社会';
  if (textHasAny(text, ['鬼', '妖', '魔', '神', '庙', '祭'])) return '宗教/超自然混合秩序';
  return '文明结构待确认';
}

function inferWorldFactions(text: string, characters: ScriptCharacterBreakdown[]): string[] {
  const factions: string[] = [];
  if (textHasAny(text, ['皇帝', '朝廷', '官军', '将军', '衙门', '王府'])) factions.push('军政/朝廷势力');
  if (textHasAny(text, ['土司', '寨', '部落', '族人', '校场'])) factions.push('地方部族/寨堡势力');
  if (textHasAny(text, ['门派', '宗门', '江湖', '帮派'])) factions.push('江湖/宗门势力');
  if (textHasAny(text, ['公司', '集团', '警局', '医院', '学校'])) factions.push('现代组织/机构势力');
  if (textHasAny(text, ['庙', '寺', '祭司', '神', '鬼', '妖', '魔', '怪物', '巨兽'])) factions.push('宗教/超自然势力');
  if (characters.length >= 2) factions.push('主角行动小队');
  return uniq(factions);
}

export function analyzeScriptWorldbuildingOutputs(outputs: ScriptBreakdownOutput[]): ScriptWorldbuildingOutput {
  const packageOutput =
    outputs.find((output): output is ScriptPackageOutput => output.module === 'script_package') ??
    combineScriptBreakdownOutputs(outputs);
  const text = packageOutput.scenes.map((scene) => `${scene.title}\n${scene.sourceText}`).join('\n\n');
  const era = inferWorldEra(text);
  const technologyLevel = inferWorldTech(text);
  const civilization = inferWorldCivilization(text);
  const factions = inferWorldFactions(text, packageOutput.characters);
  const evidence = sceneEvidenceForKeywords(
    packageOutput.scenes,
    ['皇帝', '朝廷', '土司', '寨', '庙', '香炉', '刀', '剑', '马', '手机', '公司', '法术', '灵力', '鬼', '妖', '巨兽'],
    8,
  );
  const warnings: string[] = [];
  if (era === '时代待确认') warnings.push('时代背景缺少明确线索。');
  if (technologyLevel === '技术水平待确认') warnings.push('技术水平缺少明确线索。');
  if (civilization === '文明结构待确认') warnings.push('社会/文明结构缺少明确线索。');
  if (factions.length <= 1) warnings.push('势力结构较弱，建议人工补充阵营或组织关系。');

  const religion = textHasAny(text, ['庙', '寺', '香炉', '祭', '神', '鬼', '妖', '魔'])
    ? '存在宗教/灵异/祭祀线索'
    : '宗教体系待确认';
  const economy = textHasAny(text, ['钱', '银', '商', '货', '公司', '交易', '买卖'])
    ? '存在交易/组织经济线索'
    : '经济体系待确认';
  const energySystem = textHasAny(text, ['法术', '灵力', '结界', '光芒', '鬼', '妖', '魔', '巨兽'])
    ? '超自然/异兽能量体系'
    : '无明确超自然能量体系';
  const socialStructure = civilization === '文明结构待确认' ? '社会结构待确认' : civilization;
  const politicalSystem = textHasAny(text, ['皇帝', '朝廷', '官军', '将军', '衙门'])
    ? '中央军政体系'
    : textHasAny(text, ['土司', '寨', '部落'])
      ? '地方首领/部族治理'
      : textHasAny(text, ['公司', '集团', '警局'])
        ? '现代机构治理'
        : '政治体系待确认';
  const militarySystem = textHasAny(text, ['刀', '剑', '弓', '兵', '军', '校场', '马'])
    ? '冷兵器/队列武装'
    : textHasAny(text, ['枪', '炮', '炸药'])
      ? '火器武装'
      : '军事体系待确认';
  const architectureStyle = textHasAny(text, ['庙', '寺', '香炉'])
    ? '寺庙/宗教建筑'
    : textHasAny(text, ['寨', '城', '府', '殿', '校场'])
      ? '寨堡/古代公共空间'
      : textHasAny(text, ['公司', '医院', '学校', '电梯'])
        ? '现代城市建筑'
        : '建筑体系待确认';
  const clothingStyle = textHasAny(text, ['袍', '甲', '披风', '盔', '面具'])
    ? '古装/甲胄/仪式服饰'
    : textHasAny(text, ['西装', '制服', '校服'])
      ? '现代制服/日常服饰'
      : '服装体系待确认';
  const languageStyle = era.includes('古装') || civilization.includes('王朝') || civilization.includes('寨堡')
    ? '古风/仪式化对白'
    : era.includes('现代')
      ? '现代口语'
      : '语言风格待确认';
  const summary = `世界观底稿：${era}，${technologyLevel}，识别 ${factions.length} 类势力线索。`;

  return {
    module: 'script_world',
    createdAt: Date.now(),
    era,
    civilization,
    technologyLevel,
    politicalSystem,
    militarySystem,
    religion,
    economy,
    energySystem,
    socialStructure,
    architectureStyle,
    clothingStyle,
    languageStyle,
    factions,
    evidence,
    summary,
    warnings,
    stats: {
      sourceLength: packageOutput.stats.sourceLength,
      factionCount: factions.length,
      evidenceCount: evidence.length,
      warningCount: warnings.length,
    },
  };
}

function productionComplexity(score: number): ScriptProductionComplexity {
  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

function makeProductionRequirement(
  scene: ScriptSceneBreakdown,
  department: ScriptProductionDepartment,
  title: string,
  score: number,
  resourceNeeds: string[],
  callSheetNotes: string[],
  riskNotes: string[],
  warnings: string[] = [],
): ScriptProductionRequirement {
  return {
    id: `production_${scene.sceneNo}_${department}_${title}`,
    sceneNo: scene.sceneNo,
    department,
    title,
    complexity: productionComplexity(score),
    resourceNeeds: uniq(resourceNeeds),
    callSheetNotes: uniq(callSheetNotes),
    riskNotes: uniq(riskNotes).filter(Boolean),
    evidence: { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
    warnings,
  };
}

function vfxHitCountForScene(scene: ScriptSceneBreakdown): number {
  const text = `${scene.title}\n${scene.sourceText}\n${scene.props.join(' ')}`;
  return VFX_RULES.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword))).length;
}

export function analyzeScriptProductionOutputs(outputs: ScriptBreakdownOutput[]): ScriptProductionOutput {
  const packageOutput =
    outputs.find((output): output is ScriptPackageOutput => output.module === 'script_package') ??
    combineScriptBreakdownOutputs(outputs);
  const requirements: ScriptProductionRequirement[] = [];

  for (const scene of packageOutput.scenes) {
    const text = `${scene.title}\n${scene.sourceText}`;
    const vfxHits = vfxHitCountForScene(scene);
    const nightExterior = scene.interiorExterior === '外景' && /(夜|深夜|黄昏|傍晚)/.test(scene.timeOfDay);
    const weather = /(雨|暴雨|雪|风|雷|雾|尘土|沙尘|海浪|洪水)/.test(text);
    const makeup = /(血|伤口|尸体|腐烂|断肢)/.test(text);
    const stunt = /(追|逃|打|杀|刺|冲|撞|坠|跌|翻滚|爆炸|坍塌)/.test(text);
    const animalVehicle = /(马|车|船|飞机|轿|骑)/.test(text);
    const baseScore =
      (scene.characters.length >= 5 ? 1 : 0) +
      (scene.props.length >= 6 ? 1 : 0) +
      (vfxHits >= 2 ? 1 : 0) +
      (nightExterior ? 1 : 0) +
      (weather ? 1 : 0);

    const sceneWarnings: string[] = [];
    if (scene.location === '地点待确认') sceneWarnings.push('主场景地点待确认。');
    if (scene.timeOfDay === '时间待确认') sceneWarnings.push('时间标签待确认。');
    if (scene.interiorExterior === '内外景待确认') sceneWarnings.push('内外景待确认。');

    requirements.push(
      makeProductionRequirement(
        scene,
        'location',
        `${scene.location === '地点待确认' ? `场${scene.sceneNo}` : scene.location}拍摄统筹`,
        baseScore,
        [
          scene.location === '地点待确认' ? '确认主场景地点' : `场景资源：${scene.location}`,
          `空间类型：${scene.interiorExterior}`,
          `时间：${scene.timeOfDay}`,
        ],
        [
          `场${scene.sceneNo}优先核对地点/时间/内外景`,
          scene.characters.length ? `演员到场：${scene.characters.join('、')}` : '演员待确认',
        ],
        [
          nightExterior ? '夜外景需预留照明、供电和安全时间。' : '',
          weather ? '天气/气氛元素会影响现场控制和连续性。' : '',
          vfxHits >= 2 ? '多类特效同场出现，建议提前做技术分解。' : '',
        ],
        sceneWarnings,
      ),
    );

    if (scene.characters.length >= 3) {
      requirements.push(
        makeProductionRequirement(
          scene,
          'cast',
          `场${scene.sceneNo}演员调度`,
          scene.characters.length >= 5 ? 2 : 1,
          [`主要演员：${scene.characters.slice(0, 8).join('、')}`],
          ['多人同场，需提前排练动线和站位。'],
          scene.characters.length >= 6 ? ['群戏/多人调度复杂，建议安排副导演走位。'] : [],
        ),
      );
    }

    if (scene.props.length >= 4) {
      requirements.push(
        makeProductionRequirement(
          scene,
          'props',
          `场${scene.sceneNo}道具统筹`,
          scene.props.length >= 8 ? 2 : 1,
          [`重点道具：${scene.props.slice(0, 10).join('、')}`],
          ['道具需按场次分装并拍连续性照片。'],
          scene.props.length >= 8 ? ['道具数量较多，建议建道具追踪表。'] : [],
        ),
      );
    }

    if (vfxHits > 0) {
      requirements.push(
        makeProductionRequirement(
          scene,
          'vfx',
          `场${scene.sceneNo}视效/实效统筹`,
          vfxHits >= 3 ? 3 : 2,
          ['VFX拆解表', '干净底板/环境空镜', '现场互动参考'],
          ['VFX镜头需在通告中标注额外拍摄素材。'],
          ['需提前确认现场实效、安全审批和后期周期。'],
        ),
      );
    }

    if (nightExterior) {
      requirements.push(
        makeProductionRequirement(
          scene,
          'night',
          `场${scene.sceneNo}夜外景`,
          2,
          ['移动照明', '发电/供电方案', '安全动线'],
          ['夜外景建议集中拍摄，减少转场损耗。'],
          ['夜间安全、噪音、交通和演员状态需提前评估。'],
        ),
      );
    }

    if (weather) {
      requirements.push(
        makeProductionRequirement(
          scene,
          'weather',
          `场${scene.sceneNo}天气/气氛`,
          2,
          ['雨雪/风/雾/尘土设备或素材', '连续性记录'],
          ['天气元素需与服化道连续性同步。'],
          ['实拍天气不稳定，建议准备替代方案。'],
        ),
      );
    }

    if (makeup) {
      requirements.push(
        makeProductionRequirement(
          scene,
          'makeup',
          `场${scene.sceneNo}妆效连续性`,
          1,
          ['伤效/血浆妆', '连续性照片'],
          ['妆效需记录阶段变化。'],
          ['血浆和服装污染可能影响重复拍摄。'],
        ),
      );
    }

    if (stunt) {
      requirements.push(
        makeProductionRequirement(
          scene,
          'stunt',
          `场${scene.sceneNo}动作安全`,
          2,
          ['动作设计', '安全员', '保护垫/威亚视情况'],
          ['动作段落需提前排练并拆分镜头。'],
          ['涉及冲撞、跌落、爆炸或兵器时需安全方案。'],
        ),
      );
    }

    if (animalVehicle) {
      requirements.push(
        makeProductionRequirement(
          scene,
          'animal_vehicle',
          `场${scene.sceneNo}交通/动物`,
          1,
          ['车辆/船/马匹等资源', '调度与安全范围'],
          ['交通/动物资源需提前锁定到场时间。'],
          ['移动资源会影响现场安全和拍摄节奏。'],
        ),
      );
    }
  }

  const warnings = uniq(requirements.flatMap((item) => item.warnings));
  const highComplexityCount = requirements.filter((item) => item.complexity === 'high').length;
  const nightExteriorCount = requirements.filter((item) => item.department === 'night').length;
  const locationCount = new Set(packageOutput.scenes.map((scene) => scene.location).filter((item) => item !== '地点待确认')).size;
  const summary = requirements.length
    ? `已生成 ${requirements.length} 条制片统筹事项，覆盖 ${packageOutput.scenes.length} 场；高复杂度 ${highComplexityCount} 条。`
    : '暂无可生成的制片统筹事项，请先运行拆解汇总。';

  return {
    module: 'script_production',
    createdAt: Date.now(),
    requirements,
    summary,
    warnings,
    stats: {
      sourceLength: packageOutput.stats.sourceLength,
      requirementCount: requirements.length,
      sceneCount: packageOutput.scenes.length,
      highComplexityCount,
      nightExteriorCount,
      locationCount,
      warningCount: warnings.length,
    },
  };
}

const AI_ASSET_PLATFORMS: ScriptAiAssetPlatform[] = ['midjourney', 'gpt_image_2', 'nanobanana'];

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
      kind === 'character_prompt' ? 'size=1024x1536' : 'size=1536x1024',
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
    'describe scene in natural language',
    'preserve continuity when references are provided',
  ];
}

function negativePromptForPlatform(platform: ScriptAiAssetPlatform): string {
  const common = 'low quality, blurry, distorted anatomy, inconsistent face, extra limbs, unreadable text, watermark, logo';
  if (platform === 'midjourney') return `Use --no for: ${common}, flat lighting, plastic skin`;
  if (platform === 'gpt_image_2') return `${common}, captions, UI overlay, poster typography, fake credits`;
  return `${common}, captions, UI overlay, broken continuity, altered character identity`;
}

function midjourneySuffix(kind: ScriptAiAssetKind): string {
  const aspect = kind === 'character_prompt' ? '3:4' : kind === 'prop_prompt' ? '4:3' : '16:9';
  const stylize = kind === 'character_prompt' || kind === 'prop_prompt' ? 80 : 120;
  return `--ar ${aspect} --raw --s ${stylize} --c 5 --no text, watermark, logo, extra fingers, distorted anatomy, duplicate face`;
}

const OLD_AI_ASSET_PLATFORM_TERMS = ['Flux', 'Seedance', 'Kling', 'Veo', 'Runway', 'Sora'];
const FILM_CONCEPT_DESIGN_TERMS = [
  '影视级',
  '电影级',
  '概念设计',
  '美术概念',
  '视觉开发',
  'production design',
  'concept design',
  'concept art',
  'visual development',
  'pre-production',
  'film design',
];
const FILM_CRAFT_TERMS = [
  '空间',
  '材质',
  '光线',
  '构图',
  '镜头',
  '服装',
  '道具',
  'production design',
  'material',
  'lighting',
  'composition',
  'lens',
  'wardrobe',
  'props',
];

function hasAnyTerm(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function assetPromptTarget(asset: ScriptAiPromptAsset): string {
  if (asset.sceneNo) return `场${asset.sceneNo}`;
  return asset.characterName || '全局风格';
}

function assetPromptKindLabel(kind: ScriptAiAssetKind): string {
  if (kind === 'scene_prompt') return '影视场景概念设计图';
  if (kind === 'character_prompt') return '影视角色概念设计图';
  if (kind === 'prop_prompt') return '影视道具概念设计图';
  if (kind === 'style_prompt') return '全片视觉开发概念图';
  if (kind === 'lighting_prompt') return '影视光影概念设计图';
  return '影视镜头概念设计图';
}

function cleanPromptForRewrite(prompt: string): string {
  return prompt
    .replace(/--(?:ar|raw|s|stylize|c|chaos|no)\b[^；\n]*/gi, '')
    .replace(/\bmodel=[^\s；\n]+/gi, '')
    .replace(/\b(?:size|quality|output_format|background|response_format\.[^\s=]+|response_modalities)=[^\s；\n]+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[；,，]\s*[；,，]+/g, '；')
    .trim();
}

export function reviewScriptAiPromptAsset(asset: ScriptAiPromptAsset): { score: number; issues: string[] } {
  const prompt = asset.prompt.trim();
  const promptLower = prompt.toLowerCase();
  const parameterText = asset.parameters.join(' ').toLowerCase();
  const combined = `${promptLower} ${parameterText}`;
  const issues: string[] = [];
  const minLength = asset.platform === 'midjourney' ? 80 : 120;

  if (!prompt) {
    issues.push('Prompt 为空。');
  } else {
    if (prompt.length < minLength) issues.push(`Prompt 偏短，建议至少 ${minLength} 字符，补足主体、空间、光线和连续性。`);
    if (prompt.length > 2400) issues.push('Prompt 过长，建议压缩到 2400 字符以内，减少重复描述。');
  }

  if (hasAnyTerm(prompt, OLD_AI_ASSET_PLATFORM_TERMS)) {
    issues.push('Prompt 中仍包含旧平台名称，请移除 Flux / Seedance / Kling / Veo / Runway / Sora。');
  }
  if (!hasAnyTerm(prompt, FILM_CONCEPT_DESIGN_TERMS)) {
    issues.push('Prompt 缺少“影视级概念设计 / production design / visual development”定位，容易生成普通插画或泛海报。');
  }
  if (!hasAnyTerm(prompt, FILM_CRAFT_TERMS)) {
    issues.push('Prompt 缺少影视美术执行要素：空间、材质、光线、构图、镜头、服装或道具。');
  }
  if (hasAnyTerm(prompt, ['poster', 'key art', '营销海报', '宣传海报', '海报感']) && !hasAnyTerm(prompt, ['not poster', 'not marketing key art', '避免营销海报感', 'no poster'])) {
    issues.push('Prompt 出现海报倾向，请明确排除营销海报、片名字和宣传构图。');
  }
  if (asset.kind === 'scene_prompt' && !hasAnyTerm(prompt, ['场景', 'scene', 'location', '地点', '空间', 'composition', '画面'])) {
    issues.push('场景 Prompt 缺少明确场景/空间描述。');
  }
  if (asset.kind === 'character_prompt' && !hasAnyTerm(prompt, ['角色', 'character', 'face', 'identity', 'wardrobe', '服装', '脸部'])) {
    issues.push('角色 Prompt 缺少身份、脸部或服装连续性描述。');
  }
  if (asset.kind === 'prop_prompt' && !hasAnyTerm(prompt, ['道具', 'prop', 'object', '材质', 'material', '资产', 'hero prop'])) {
    issues.push('道具 Prompt 缺少资产、材质、尺度或制作细节描述。');
  }
  if (asset.kind === 'style_prompt' && !hasAnyTerm(prompt, ['风格', 'style', 'visual bible', 'palette', 'color', '色彩', '世界观'])) {
    issues.push('风格 Prompt 缺少全片风格、色彩或世界观描述。');
  }

  if (asset.platform === 'midjourney') {
    if (!combined.includes('--ar')) issues.push('Midjourney Prompt 缺少画幅参数 --ar。');
    if (!combined.includes('--raw')) issues.push('Midjourney Prompt 建议使用 --raw，减少默认风格干扰。');
    if (!combined.includes('--no')) issues.push('Midjourney Prompt 缺少 --no 负面约束。');
    if (prompt.includes('\n')) issues.push('Midjourney Prompt 建议保持单行，方便直接复制。');
    if (combined.includes('model=')) issues.push('Midjourney Prompt 不应混入 API model 参数。');
  }

  if (asset.platform === 'gpt_image_2') {
    if (!parameterText.includes('model=gpt-image-2')) issues.push('GPT Image 2 参数缺少 model=gpt-image-2。');
    if (combined.includes('--ar') || combined.includes('--raw') || combined.includes('--no')) {
      issues.push('GPT Image 2 Prompt 不应混入 Midjourney 参数。');
    }
    if (!hasAnyTerm(prompt, ['create', 'generate', '生成', '创作'])) issues.push('GPT Image 2 Prompt 建议使用自然语言生成指令开头。');
    if (!hasAnyTerm(prompt, ['composition', 'lighting', 'continuity', '构图', '光', '连续'])) {
      issues.push('GPT Image 2 Prompt 缺少构图、光线或连续性约束。');
    }
    if (!hasAnyTerm(prompt, ['do not add', '不要', '禁止'])) issues.push('GPT Image 2 Prompt 缺少字幕、UI、logo、水印等排除说明。');
  }

  if (asset.platform === 'nanobanana') {
    if (!parameterText.includes('gemini-3.1-flash-image-preview')) {
      issues.push('Nano Banana 参数缺少 gemini-3.1-flash-image-preview。');
    }
    if (combined.includes('--ar') || combined.includes('--raw') || combined.includes('--no')) {
      issues.push('Nano Banana Prompt 不应混入 Midjourney 参数。');
    }
    if (!hasAnyTerm(prompt, ['生成', 'create', '画面', '完整自然语言', '完整画面描述'])) {
      issues.push('Nano Banana Prompt 建议使用完整自然语言画面描述。');
    }
    if (!hasAnyTerm(prompt, ['连续', '保持', '参考图', 'continuity', 'preserve'])) {
      issues.push('Nano Banana Prompt 缺少参考图或连续性保持要求。');
    }
    if (!hasAnyTerm(prompt, ['不要', '禁止', 'do not'])) issues.push('Nano Banana Prompt 缺少文字、UI、logo、水印等排除说明。');
  }

  return { score: Math.max(0, 100 - issues.length * 12), issues: uniq(issues) };
}

export function applyScriptAiPromptQuality(asset: ScriptAiPromptAsset): ScriptAiPromptAsset {
  const quality = reviewScriptAiPromptAsset(asset);
  const status =
    quality.issues.length || asset.warnings.length
      ? 'needs_revision'
      : asset.status === 'approved'
        ? 'approved'
        : 'needs_review';
  return {
    ...asset,
    status,
    qualityIssues: quality.issues,
    qualityScore: quality.score,
    lastQualityCheckAt: Date.now(),
  };
}

export function rewriteScriptAiPromptAsset(asset: ScriptAiPromptAsset): ScriptAiPromptAsset {
  const source = cleanPromptForRewrite(asset.prompt);
  const target = assetPromptTarget(asset);
  const kindLabel = assetPromptKindLabel(asset.kind);
  const compactSource = source || asset.title;
  let prompt: string;

  if (asset.platform === 'midjourney') {
    prompt = [
      `film-level concept design, cinematic visual development, ${kindLabel}, ${asset.title}, ${target}`,
      compactSource,
      'pre-production artwork for film, believable production design, clear subject hierarchy, readable set geography, real lens language, practical cinematic lighting, tactile materials, wardrobe and props continuity, not marketing key art, no poster typography',
      midjourneySuffix(asset.kind),
    ].join('；');
  } else if (asset.platform === 'gpt_image_2') {
    prompt = [
      `Create one film-level ${kindLabel} for pre-production visual development, not a poster or generic illustration.`,
      `Target: ${target}.`,
      `Source material: ${compactSource}`,
      'Concept design goal: make it useful for a director, production designer, art director, cinematographer, and VFX team to discuss the scene before production.',
      'Composition: clear subject hierarchy, readable production geography, believable lens depth, no decorative poster layout, no centered promotional key art.',
      'Craft detail: practical set design, tactile materials, costume/prop logic, environmental aging, scale references, physically motivated cinematic lighting.',
      'Continuity: stable character identity, consistent wardrobe, props, scene direction, color palette, and worldbuilding rules.',
      'Do not add captions, subtitles, UI, title text, credits, logos, or watermarks.',
    ].join('\n');
  } else {
    prompt = [
      `生成一张影视级${kindLabel}，对象：${target}。定位是前期视觉开发 / 美术概念设计，不是普通插画、海报或泛 AI 美图。`,
      `原始素材：${compactSource}`,
      '概念设计目标：导演、美术指导、摄影指导、制片和 VFX 团队看图后能讨论场景空间、置景、材质、服装、道具、光线和拍摄可行性。',
      '画面要求：主体层级清楚，空间方向明确，真实电影镜头语言，物理可信的电影光线，服装、道具、材质和环境细节可被后续镜头复用。',
      '连续性要求：如果后续提供参考图，保持角色身份、服装逻辑、道具状态、场景方向和整体世界观稳定。',
      '不要生成字幕、UI、海报字、片名字、logo、水印。',
    ].join('\n');
  }

  return applyScriptAiPromptQuality({
    ...asset,
    prompt,
    negativePrompt: negativePromptForPlatform(asset.platform),
    parameters: platformParameters(asset.platform, asset.kind),
    status: undefined,
    updatedAt: Date.now(),
  });
}

function assetStyleLine(
  scene: ScriptSceneBreakdown,
  artOutput: ScriptArtDirectionOutput,
  worldOutput: ScriptWorldbuildingOutput,
): string {
  const art = artOutput.requirements.find((item) => item.sceneNo === scene.sceneNo);
  return [
    `时代/世界观：${worldOutput.era}，${worldOutput.technologyLevel}`,
    `地点：${scene.location}，${scene.interiorExterior}，${scene.timeOfDay}`,
    art ? `美术风格：${art.visualStyle}，氛围：${art.mood}，色彩：${art.palette.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('；');
}

function assetVfxLine(scene: ScriptSceneBreakdown, vfxOutput: ScriptVfxOutput): string {
  const hits = vfxOutput.requirements.filter((item) => item.sceneNo === scene.sceneNo);
  if (!hits.length) return 'VFX：无明确特效，保持写实连续性';
  return `VFX：${hits.map((item) => `${item.effectType}/${item.complexity}`).join('、')}`;
}

function createPromptAsset(params: {
  kind: ScriptAiAssetKind;
  platform: ScriptAiAssetPlatform;
  title: string;
  prompt: string;
  usage: string;
  sceneNo?: number;
  characterName?: string;
  evidence: ScriptEvidenceRef[];
  warnings?: string[];
}): ScriptAiPromptAsset {
  const suffix = params.sceneNo ? `scene_${params.sceneNo}` : params.characterName ? params.characterName : 'global';
  return applyScriptAiPromptQuality({
    id: `ai_asset_${params.kind}_${params.platform}_${suffix}`.replace(/\s+/g, '_'),
    kind: params.kind,
    platform: params.platform,
    title: params.title,
    prompt: params.prompt,
    negativePrompt: negativePromptForPlatform(params.platform),
    usage: params.usage,
    sceneNo: params.sceneNo,
    characterName: params.characterName,
    parameters: platformParameters(params.platform, params.kind),
    evidence: params.evidence,
    warnings: params.warnings ?? [],
    status: params.warnings?.length ? 'needs_revision' : 'needs_review',
  });
}

function scenePromptForPlatform(
  scene: ScriptSceneBreakdown,
  platform: ScriptAiAssetPlatform,
  artOutput: ScriptArtDirectionOutput,
  worldOutput: ScriptWorldbuildingOutput,
  vfxOutput: ScriptVfxOutput,
): string {
  const style = assetStyleLine(scene, artOutput, worldOutput);
  const vfx = assetVfxLine(scene, vfxOutput);
  const characters = scene.characters.length ? scene.characters.join('、') : '无明确角色';
  const props = scene.props.length ? scene.props.join('、') : '无关键道具';
  const base = [
    `场景：${scene.location}，${scene.interiorExterior}，${scene.timeOfDay}`,
    `世界/美术：${style}`,
    `角色：${characters}`,
    `关键道具：${props}`,
    `剧情动作：${scene.summary}`,
    vfx,
  ];
  if (platform === 'midjourney') {
    return [
      'film-level cinematic concept design, pre-production visual development, production design reference, not marketing poster',
      ...base,
      'readable set geography, clear subject hierarchy, practical set construction logic, tactile materials, lens-aware composition, physically motivated cinematic lighting, emotional color palette, scale references, wardrobe and props continuity, no poster text',
      midjourneySuffix('scene_prompt'),
    ].join('；');
  }
  if (platform === 'gpt_image_2') {
    return [
      'Create one film-level cinematic concept design image for pre-production visual development. It should look like a production design reference, not a poster, thumbnail, or generic illustration.',
      ...base,
      'Concept design goal: the director, production designer, art director, cinematographer, and VFX team should be able to discuss set geography, material choices, costume/prop logic, camera direction, and production feasibility from this image.',
      'Composition: 16:9 wide frame, clear spatial geography, visible subject hierarchy, believable lens depth, no decorative key-art layout.',
      'Craft detail: practical set construction, tactile materials, environmental aging, scale references, props placed with story purpose.',
      'Lighting: physically motivated cinematic lighting that matches the time of day and keeps faces readable.',
      'Continuity: keep character wardrobe, props, color palette, scene direction, and worldbuilding rules consistent with the script evidence.',
      'Do not add captions, subtitles, UI, credits, logos, or watermarks.',
    ].join('\n');
  }
  return [
    '生成一张影视级场景概念设计图，用于前期视觉开发和美术统筹。不要只堆关键词，不要做成宣传海报或泛 AI 插画，请用完整画面描述。',
    ...base,
    '概念设计目标：导演、美术指导、摄影指导、制片和 VFX 团队看图后能讨论置景结构、材质选择、角色调度、道具位置、拍摄方向和制作可行性。',
    '画面要求：16:9 横版，空间层次清楚，主光方向明确，真实电影镜头语言，材质细节可信，有尺度参照，角色与道具关系可被后续镜头复用。',
    '连续性要求：如果后续提供参考图，保持角色身份、服装、道具状态和场景方向不变。',
    '不要生成字幕、UI、海报字、logo、水印。',
  ].join('\n');
}

function stylePromptForPackage(
  platform: ScriptAiAssetPlatform,
  worldOutput: ScriptWorldbuildingOutput,
  artOutput: ScriptArtDirectionOutput,
): string {
  const palette = uniq(artOutput.palette).slice(0, 8).join('、') || '低饱和电影色';
  const base = [
    `时代/文明：${worldOutput.era}，${worldOutput.civilization}`,
    `技术/社会质感：${worldOutput.technologyLevel}，${worldOutput.socialStructure}`,
    `建筑与服饰：${worldOutput.architectureStyle}，${worldOutput.clothingStyle}`,
    `主色体系：${palette}`,
    `语言与叙事气质：${worldOutput.languageStyle}`,
  ];
  if (platform === 'midjourney') {
    return [
      'film-level visual development bible, production design concept sheet, cinematic realism, not marketing poster',
      ...base,
      'coherent worldbuilding, consistent cast identity, consistent props, practical sets, material logic, wardrobe system, lighting language, production-ready visual rules, atmospheric but not poster-like',
      midjourneySuffix('style_prompt'),
    ].join('；');
  }
  if (platform === 'gpt_image_2') {
    return [
      'Create a single film-level visual development bible image that defines the production design language for this script. It must not look like marketing key art.',
      ...base,
      'The image should read as a production design reference for art direction, cinematography, VFX, costume, props, and set decoration.',
      'Prioritize coherent worldbuilding, wardrobe logic, prop language, architecture, material aging, scale references, practical set logic, and cinematic color.',
      'Do not add typography, title text, UI, credits, logo, or watermark.',
    ].join('\n');
  }
  return [
    '生成一张影视级全片视觉开发概念图，用完整自然语言描述画面，不要只堆关键词。定位是美术概念设计和 production design bible，不是营销海报。',
    ...base,
    '统一要求：电影级真实质感，世界观、建筑、服装、道具、材质、光线、色彩和场景空间可持续复用，能够指导美术、摄影、VFX 和制片沟通。',
    '如果后续用于参考图编辑，请保持整体世界观、色彩体系和材质逻辑稳定。',
    '不要生成字幕、海报字、UI、logo、水印。',
  ].join('\n');
}

function characterPromptForPlatform(
  character: ScriptCharacterBreakdown,
  platform: ScriptAiAssetPlatform,
  packageOutput: ScriptPackageOutput,
  worldOutput: ScriptWorldbuildingOutput,
): string {
  const firstScene = packageOutput.scenes.find((scene) => scene.sceneNo === character.firstSceneNo);
  const sceneRefs = packageOutput.scenes.filter((scene) => character.sceneNos.includes(scene.sceneNo));
  const actions = character.actionHints.length
    ? character.actionHints.slice(0, 2).map((item) => compactSnippet(item, 80)).join('；')
    : '动作线索待补充';
  const sceneContext = sceneRefs.map((scene) => `${scene.location}/${scene.timeOfDay}`).slice(0, 4).join('、');
  const base = [
    `角色：${character.name}`,
    `世界观：${worldOutput.era}，${worldOutput.clothingStyle}`,
    `首次出现：场${character.firstSceneNo} ${firstScene?.location ?? '地点待确认'}`,
    `出现场景：${sceneContext || '待确认'}`,
    `行为证据：${actions}`,
  ];
  if (platform === 'midjourney') {
    return [
      'film-level character concept design sheet, cinematic costume and makeup development, realistic actor texture',
      ...base,
      'clear face identity, wardrobe construction, fabric material details, makeup and hair logic, practical costume, neutral readable pose, scale and silhouette clarity, reusable reference for later shots, not poster portrait',
      midjourneySuffix('character_prompt'),
    ].join('；');
  }
  if (platform === 'gpt_image_2') {
    return [
      'Create one film-level character concept design image for pre-production visual development, not a glamour portrait or poster.',
      ...base,
      'Concept design goal: costume, makeup, hair, props, and directing teams should understand identity, silhouette, social status, era, material choices, and continuity needs.',
      'Composition: 3:4 portrait, half body, face readable, neutral usable pose, wardrobe construction and material details clear.',
      'Identity: keep a realistic actor-like face, consistent age, body language, costume logic, era accuracy, and repeatable silhouette.',
      'Do not add name labels, captions, UI, logos, or watermarks.',
    ].join('\n');
  }
  return [
    '生成一张影视级角色概念设计图，用于前期视觉开发和角色连续性，不是普通头像、写真或宣传海报。请用完整自然语言描述人物，不要只列关键词。',
    ...base,
    '概念设计目标：导演、服装、化妆、道具和制片团队看图后能确认人物身份、轮廓、时代、社会位置、服装结构、材质与连续性风险。',
    '画面要求：3:4 角色设定图，半身，脸部清楚，中性可复用姿态，服装材质、发型妆容、身份线索和轮廓比例明确。',
    '连续性要求：后续如果基于参考图继续生成，保持同一张脸、同一体态、同一服装逻辑，不要随意改年龄或身份。',
    '不要生成姓名牌、字幕、UI、logo、水印。',
  ].join('\n');
}

function propPromptForPlatform(
  prop: ScriptPropBreakdown,
  platform: ScriptAiAssetPlatform,
  packageOutput: ScriptPackageOutput,
  worldOutput: ScriptWorldbuildingOutput,
): string {
  const sceneRefs = packageOutput.scenes.filter((scene) => prop.sceneNos.includes(scene.sceneNo));
  const sceneContext = sceneRefs
    .map((scene) => `场${scene.sceneNo} ${scene.location}/${scene.timeOfDay}`)
    .slice(0, 5)
    .join('、');
  const notes = prop.notes.length ? prop.notes.slice(0, 4).join('；') : '道具用途待确认';
  const evidence = prop.evidence.length
    ? prop.evidence.slice(0, 3).map((item) => compactSnippet(item.excerpt, 90)).join('；')
    : '剧本证据待补充';
  const base = [
    `道具：${prop.name}`,
    `类别：${prop.category}`,
    `世界观/时代：${worldOutput.era}，${worldOutput.technologyLevel}`,
    `出现场景：${sceneContext || `场${prop.sceneNos.join('、') || '待确认'}`}`,
    `用途/备注：${notes}`,
    `剧本证据：${evidence}`,
  ];
  if (platform === 'midjourney') {
    return [
      'film-level hero prop concept design, production design asset sheet, cinematic pre-production visual development, not product advertisement',
      ...base,
      'clear silhouette, readable scale, tactile materials, aging and wear, construction logic, story-specific details, functional design, multiple material cues, neutral studio presentation plus one cinematic context hint, reusable prop reference for continuity',
      midjourneySuffix('prop_prompt'),
    ].join('；');
  }
  if (platform === 'gpt_image_2') {
    return [
      'Create one film-level hero prop concept design image for pre-production visual development, not a product ad, poster, or generic object render.',
      ...base,
      'Concept design goal: prop master, production designer, art director, director, and continuity team should understand scale, material, wear, story function, handling logic, and manufacturing feasibility.',
      'Composition: 4:3 asset concept frame, the prop is clearly readable, with believable scale reference and material close-up logic.',
      'Craft detail: tactile materials, aging, scratches, stains, seams, mechanisms, labels only if explicitly required by the script, and continuity-safe design choices.',
      'Lighting: neutral cinematic studio lighting with enough texture detail, plus subtle context cues from the scene world.',
      'Do not add captions, UI, logos, watermarks, fake product branding, or unrelated decorative text.',
    ].join('\n');
  }
  return [
    '生成一张影视级道具概念设计图，用于前期美术开发、道具制作和连续性管理。不要做成商品广告、海报或普通物体渲染，请用完整自然语言描述。',
    ...base,
    '概念设计目标：道具师、美术指导、导演、制片和场记看图后能确认尺度、材质、磨损、功能、拿取方式、制作难度和连续性风险。',
    '画面要求：4:3 道具资产图，道具轮廓清楚，有尺度参考，材质、磨损、结构、纹理和故事痕迹明确；可以带少量场景语境，但不要遮挡道具本体。',
    '连续性要求：后续如果用参考图继续生成，保持同一材质、同一形状、同一道具状态和同一世界观规则。',
    '不要生成字幕、UI、商品 logo、海报字、水印或无关装饰文字。',
  ].join('\n');
}

export function analyzeScriptAiAssetsOutputs(outputs: ScriptBreakdownOutput[]): ScriptAiAssetsOutput {
  const packageOutput =
    outputs.find((output): output is ScriptPackageOutput => output.module === 'script_package') ??
    combineScriptBreakdownOutputs(outputs);
  const artOutput =
    outputs.find((output): output is ScriptArtDirectionOutput => output.module === 'script_art') ??
    analyzeScriptArtDirectionOutputs([packageOutput]);
  const vfxOutput =
    outputs.find((output): output is ScriptVfxOutput => output.module === 'script_vfx') ??
    analyzeScriptVfxOutputs([packageOutput]);
  const worldOutput =
    outputs.find((output): output is ScriptWorldbuildingOutput => output.module === 'script_world') ??
    analyzeScriptWorldbuildingOutputs([packageOutput]);
  const assets: ScriptAiPromptAsset[] = [];

  for (const scene of packageOutput.scenes) {
    for (const platform of AI_ASSET_PLATFORMS) {
      assets.push(
        createPromptAsset({
          kind: 'scene_prompt',
          platform,
        title: `场${scene.sceneNo} · ${platformLabel(platform)} 场景概念设计`,
        prompt: scenePromptForPlatform(scene, platform, artOutput, worldOutput, vfxOutput),
        usage: `${platformLabel(platform)} 生图 / 影视级场景概念设计与美术参考`,
          sceneNo: scene.sceneNo,
          evidence: [{ sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) }],
          warnings: scene.warnings,
        }),
      );
    }
  }

  for (const character of packageOutput.characters.slice(0, 12)) {
    for (const platform of AI_ASSET_PLATFORMS) {
      assets.push(
        createPromptAsset({
          kind: 'character_prompt',
          platform,
        title: `${character.name} · ${platformLabel(platform)} 角色概念设计`,
        prompt: characterPromptForPlatform(character, platform, packageOutput, worldOutput),
        usage: `${platformLabel(platform)} 生图 / 影视级角色概念设计与连续性参考`,
          characterName: character.name,
          evidence: character.evidence,
          warnings: character.warnings,
        }),
      );
    }
  }

  for (const prop of packageOutput.props.slice(0, 18)) {
    for (const platform of AI_ASSET_PLATFORMS) {
      assets.push(
        createPromptAsset({
          kind: 'prop_prompt',
          platform,
          title: `${prop.name} · ${platformLabel(platform)} 道具概念设计`,
          prompt: propPromptForPlatform(prop, platform, packageOutput, worldOutput),
          usage: `${platformLabel(platform)} 生图 / 影视级道具概念设计与资产连续性参考`,
          evidence: prop.evidence,
          warnings: prop.warnings,
        }),
      );
    }
  }

  for (const platform of AI_ASSET_PLATFORMS) {
    assets.push(
      createPromptAsset({
        kind: 'style_prompt',
        platform,
        title: `全片视觉开发 · ${platformLabel(platform)}`,
        prompt: stylePromptForPackage(platform, worldOutput, artOutput),
        usage: `${platformLabel(platform)} 生图 / 全片影视级视觉开发与概念设计`,
        evidence: worldOutput.evidence,
        warnings: worldOutput.warnings,
      }),
    );
  }

  const qualityIssueCount = assets.reduce((total, asset) => total + (asset.qualityIssues?.length ?? 0), 0);
  const warnings = uniq(assets.flatMap((asset) => [...asset.warnings, ...(asset.qualityIssues ?? [])]));
  const scenePromptCount = assets.filter((asset) => asset.kind === 'scene_prompt').length;
  const characterPromptCount = assets.filter((asset) => asset.kind === 'character_prompt').length;
  const propPromptCount = assets.filter((asset) => asset.kind === 'prop_prompt').length;
  const cinematicPromptCount = assets.filter((asset) => asset.kind === 'cinematic_prompt').length;
  const platformCount = AI_ASSET_PLATFORMS.filter((platform) => assets.some((asset) => asset.platform === platform)).length;
  const summary = assets.length
    ? `已生成 ${assets.length} 条生图 Prompt，覆盖 ${packageOutput.scenes.length} 场、${packageOutput.characters.length} 个角色、${packageOutput.props.length} 个道具、${platformCount} 个平台（Midjourney / GPT Image 2 / Nano Banana），质检${qualityIssueCount ? `发现 ${qualityIssueCount} 个问题` : '通过'}。`
    : '暂无可生成 AI 资产，请先运行拆解汇总。';

  return {
    module: 'script_ai_assets',
    createdAt: Date.now(),
    assets,
    summary,
    warnings,
    stats: {
      sourceLength: packageOutput.stats.sourceLength,
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

export function reviewScriptBreakdownOutputs(outputs: ScriptBreakdownOutput[]): ScriptReviewOutput {
  const packageOutput =
    outputs.find((output): output is ScriptPackageOutput => output.module === 'script_package') ??
    combineScriptBreakdownOutputs(outputs);
  const issues: ScriptReviewIssue[] = [];
  const sceneNos = new Set(packageOutput.scenes.map((scene) => scene.sceneNo));
  const characterNames = new Set(packageOutput.characters.map((character) => character.name));
  const propNames = new Set(packageOutput.props.map((prop) => prop.name));

  if (packageOutput.scenes.length === 0) {
    issues.push(
      issue(
        'schema_no_scenes',
        'blocker',
        'schema',
        '场景表',
        '没有可用场景。',
        '请先运行场景拆解节点，或确认剧本文本是否为空。',
      ),
    );
  }

  if (packageOutput.characters.length === 0) {
    issues.push(
      issue(
        'schema_no_characters',
        'warning',
        'schema',
        '角色表',
        '没有识别到角色。',
        '建议先确认对白格式，或在角色分析节点中人工补充主角。',
      ),
    );
  }

  for (const scene of packageOutput.scenes) {
    if (scene.location === '地点待确认') {
      issues.push(
        issue(
          `scene_${scene.sceneNo}_location`,
          'warning',
          'scene_structure',
          `场${scene.sceneNo}`,
          '地点缺失。',
          '补充主场景地点，避免后续统筹和场景资产生成失准。',
          { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
        ),
      );
    }
    if (scene.timeOfDay === '时间待确认') {
      issues.push(
        issue(
          `scene_${scene.sceneNo}_time`,
          'warning',
          'scene_structure',
          `场${scene.sceneNo}`,
          '时间标签缺失。',
          '补充日/夜/清晨/黄昏等时间信息，供时间线和灯光方案使用。',
          { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
        ),
      );
    }
    if (scene.interiorExterior === '内外景待确认') {
      issues.push(
        issue(
          `scene_${scene.sceneNo}_int_ext`,
          'warning',
          'scene_structure',
          `场${scene.sceneNo}`,
          '内外景标签缺失。',
          '确认内景/外景，后续会影响置景、灯光和拍摄计划。',
          { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
        ),
      );
    }
    if (scene.characters.length === 0) {
      issues.push(
        issue(
          `scene_${scene.sceneNo}_no_cast`,
          'info',
          'character',
          `场${scene.sceneNo}`,
          '本场未识别到登场角色。',
          '若该场为纯环境/空镜可忽略，否则建议人工补充。',
          { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
        ),
      );
    }
    for (const name of scene.characters) {
      if (!characterNames.has(name)) {
        issues.push(
          issue(
            `scene_${scene.sceneNo}_cast_${name}`,
            'warning',
            'character',
            `场${scene.sceneNo}`,
            `场景中出现角色「${name}」，但角色表未收录。`,
            '请在角色分析节点复核姓名，或手动补入角色表。',
            { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
          ),
        );
      }
    }
    for (const name of scene.props) {
      if (!propNames.has(name)) {
        issues.push(
          issue(
            `scene_${scene.sceneNo}_prop_${name}`,
            'warning',
            'prop',
            `场${scene.sceneNo}`,
            `场景中出现道具「${name}」，但道具表未收录。`,
            '请在道具分析节点复核，避免后续资产遗漏。',
            { sceneNo: scene.sceneNo, excerpt: compactSnippet(scene.sourceText) },
          ),
        );
      }
    }
  }

  for (const character of packageOutput.characters) {
    const invalidSceneNos = character.sceneNos.filter((sceneNo) => !sceneNos.has(sceneNo));
    if (invalidSceneNos.length > 0) {
      issues.push(
        issue(
          `character_${character.id}_scene_ref`,
          'warning',
          'continuity',
          character.name,
          `角色出现场次不存在：${invalidSceneNos.join('、')}。`,
          '请重新同步场景拆解和角色分析结果。',
          character.evidence[0],
        ),
      );
    }
    if (character.confidence !== 'high') {
      issues.push(
        issue(
          `character_${character.id}_confidence`,
          'info',
          'character',
          character.name,
          '角色名置信度不高。',
          '建议人工确认是否为真实角色，或是否包含动作词。',
          character.evidence[0],
        ),
      );
    }
  }

  for (const prop of packageOutput.props) {
    const invalidSceneNos = prop.sceneNos.filter((sceneNo) => !sceneNos.has(sceneNo));
    if (invalidSceneNos.length > 0) {
      issues.push(
        issue(
          `prop_${prop.id}_scene_ref`,
          'warning',
          'continuity',
          prop.name,
          `道具出现场次不存在：${invalidSceneNos.join('、')}。`,
          '请重新同步场景拆解和道具分析结果。',
          prop.evidence[0],
        ),
      );
    }
    if (prop.sceneNos.length === 1) {
      issues.push(
        issue(
          `prop_${prop.id}_single_scene`,
          'info',
          'production',
          prop.name,
          '道具仅出现一次。',
          '确认是否为关键道具；若是，应在美术/道具清单中重点标注。',
          prop.evidence[0],
        ),
      );
    }
  }

  if (packageOutput.props.length === 0 && packageOutput.scenes.length > 0) {
    issues.push(
      issue(
        'production_no_props',
        'info',
        'production',
        '道具表',
        '没有识别到道具。',
        '若剧本确实没有道具可忽略；否则建议人工复核动作描写中的物件。',
      ),
    );
  }

  const blockerCount = issues.filter((item) => item.severity === 'blocker').length;
  const warningIssueCount = issues.filter((item) => item.severity === 'warning').length;
  const warnings = uniq([
    ...packageOutput.warnings,
    ...issues.filter((item) => item.severity !== 'info').map((item) => item.summary),
  ]);
  const pass = blockerCount === 0 && warningIssueCount === 0;
  const summary = pass
    ? '规则底稿通过基础一致性检查，可进入下一阶段。'
    : `发现 ${blockerCount} 个阻塞问题、${warningIssueCount} 个需要确认的问题，建议先复核后再进入 Phase 2。`;

  return {
    module: 'script_review',
    createdAt: Date.now(),
    issues,
    pass,
    summary,
    warnings,
    stats: {
      sourceLength: packageOutput.stats.sourceLength,
      issueCount: issues.length,
      blockerCount,
      warningIssueCount,
      warningCount: warnings.length,
    },
  };
}

export function isScriptBreakdownOutput(value: unknown): value is ScriptBreakdownOutput {
  if (!value || typeof value !== 'object') return false;
  const module = (value as { module?: unknown }).module;
  return (
    module === 'script_scenes' ||
    module === 'script_characters' ||
    module === 'script_props' ||
    module === 'script_package' ||
    module === 'script_review' ||
    module === 'script_timeline' ||
    module === 'script_art' ||
    module === 'script_vfx' ||
    module === 'script_world' ||
    module === 'script_production' ||
    module === 'script_ai_assets'
  );
}

export function isScriptScenesOutput(value: unknown): value is ScriptScenesOutput {
  return isScriptBreakdownOutput(value) && value.module === 'script_scenes';
}
