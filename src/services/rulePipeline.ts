import {
  PROMPT_CARD_HEADER_RULE,
  PROMPT_CARD_SECTION_HEADINGS,
} from '@/agents/promptDeptSpec';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import type {
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
import { buildSeedanceCard, clampPromptText, expandMergedMembers, estimateShotDurationSec } from '@/utils/storyboardSeedance';
import { createStoryboardShotWireId } from '@/utils/shotListWire';

type RuleBlock = {
  kind: 'action' | 'dialogue';
  speaker: string;
  text: string;
};

type RuleScene = {
  title: string;
  text: string;
  blocks: RuleBlock[];
};

const SCENE_RE = /^\s*(第[一二三四五六七八九十百\d]+场|INT\.|EXT\.|内景|外景|场景[:：]|序[:：])/i;
const SPEAKER_RE = /^\s*([\u4e00-\u9fa5A-Za-z0-9_]{1,20})\s*[:：]\s*(.+)$/;
const WIDE_RE = /楼|阁|桥|山|林|街|巷|殿|宫|船|庭|院|城|屋内|屋外|夜色|月光|火光|风雨|屏风|窗|门|楼梯/;
const CLOSE_RE = /眼|手|唇|泪|血|刀|剑|匕首|玉佩|纸条|伤口|指尖|细节|表情|目光/;
const DYNAMIC_RE = /跑|追|冲|扑|翻|跃|坠|撞|闪|袭|刺|拔|砍|挥|逼近|后撤|突围|包抄|扑向|现身|掀开/;
const REVEAL_RE = /探头|现身|显露|露出|看见|发现|回头|屏风后|门后|帘后|暗处|背后|转身/;
const PRESSURE_RE = /压迫|围猎|追兵|封死|狭窄|逼迫|高位|低位|高处|低处|纵深|包围/;
const EMOTION_RE = /惊|怒|恨|慌|怕|沉默|压住|迟疑|哽咽|冷笑|低声|逼问|质问|试探/;
const PROP_RE = /屏风|窗棂|锦被|包袱|刀|剑|火把|门|帘|桌|椅|楼梯|栏杆|灯|火|水|烟|桥栏|屋檐/g;

function uniq(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonLikeValue(text: string): unknown | null {
  const direct = safeJsonParse(text);
  if (direct != null) return direct;
  const trimmed = text.trim();
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    const parsed = safeJsonParse(trimmed.slice(objectStart, objectEnd + 1));
    if (parsed != null) return parsed;
  }
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const parsed = safeJsonParse(trimmed.slice(arrayStart, arrayEnd + 1));
    if (parsed != null) return parsed;
  }
  return null;
}

function splitScenesFromRaw(raw: string): RuleScene[] {
  const lines = raw.split(/\r?\n/);
  const scenes: RuleScene[] = [];
  let currentTitle = '场景 1';
  let currentLines: string[] = [];
  let sceneIndex = 1;

  const flushScene = () => {
    const text = currentLines.join('\n').trim();
    if (!text && scenes.length > 0) return;
    scenes.push({
      title: currentTitle,
      text,
      blocks: parseBlocks(text),
    });
    currentLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (SCENE_RE.test(line)) {
      if (currentLines.length > 0 || scenes.length > 0) flushScene();
      currentTitle = line || `场景 ${sceneIndex}`;
      sceneIndex += 1;
      continue;
    }
    currentLines.push(rawLine);
  }
  if (currentLines.length > 0 || scenes.length === 0) flushScene();
  return scenes.filter((scene) => scene.text.trim() || scene.blocks.length > 0);
}

function parseWritingOutputScenes(raw: string): RuleScene[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.scenes) || obj.scenes.length === 0) return null;
  return obj.scenes.map((item, idx) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const title = String(row.title ?? `场次 ${idx + 1}`).trim() || `场次 ${idx + 1}`;
    const text = [
      typeof row.narrativeDraft === 'string' ? row.narrativeDraft.trim() : '',
      typeof row.coreConflict === 'string' ? row.coreConflict.trim() : '',
      typeof row.beat === 'string' ? row.beat.trim() : '',
      Array.isArray(row.characters) && row.characters.length ? `角色：${row.characters.join('、')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return {
      title,
      text,
      blocks: parseBlocks(text || title),
    };
  });
}

function parseBlocks(sceneText: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  const currentActionLines: string[] = [];

  const flushAction = () => {
    if (!currentActionLines.length) return;
    blocks.push({
      kind: 'action',
      speaker: '',
      text: currentActionLines.join(' ').trim(),
    });
    currentActionLines.length = 0;
  };

  for (const raw of sceneText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushAction();
      continue;
    }
    const speakerMatch = SPEAKER_RE.exec(line);
    if (speakerMatch) {
      flushAction();
      blocks.push({
        kind: 'dialogue',
        speaker: speakerMatch[1],
        text: speakerMatch[2].trim(),
      });
      continue;
    }
    if (line.startsWith('△')) {
      flushAction();
      blocks.push({ kind: 'action', speaker: '', text: line.slice(1).trim() });
      continue;
    }
    currentActionLines.push(line);
  }
  flushAction();
  if (blocks.length === 0 && sceneText.trim()) {
    blocks.push({ kind: 'action', speaker: '', text: sceneText.trim() });
  }
  return blocks;
}

function splitActionBeats(text: string): string[] {
  const primary = text
    .split(/[。！？!?；;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of primary.length ? primary : [text]) {
    if (part.length <= 26) {
      out.push(part);
      continue;
    }
    const chunks = part
      .split(/[，,]/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    if (chunks.length <= 1) {
      out.push(part);
      continue;
    }
    let bucket = '';
    for (const chunk of chunks) {
      if (!bucket) {
        bucket = chunk;
        continue;
      }
      if (`${bucket}，${chunk}`.length <= 26) {
        bucket = `${bucket}，${chunk}`;
      } else {
        out.push(bucket);
        bucket = chunk;
      }
    }
    if (bucket) out.push(bucket);
  }
  return out.filter(Boolean);
}

function pickPhase(index: number, total: number): string {
  if (total <= 1) return '蓄势';
  if (index === 0) return '蓄势';
  if (index >= total - 1) return total >= 4 ? '收束' : '爆发';
  if (index >= Math.floor(total / 2)) return '爆发';
  return '转势';
}

function inferShotType(text: string, index: number, total: number, isDialogue: boolean): string {
  if (CLOSE_RE.test(text)) return '特写';
  if (isDialogue && EMOTION_RE.test(text)) return '近景';
  if (index === 0 && (WIDE_RE.test(text) || total >= 3)) return '大全景';
  if (DYNAMIC_RE.test(text)) return '中近景';
  if (WIDE_RE.test(text)) return '全景';
  return isDialogue ? '中近景' : '中景';
}

function inferMovement(text: string, isDialogue: boolean, phase: string): string {
  if (DYNAMIC_RE.test(text)) return '跟移推进';
  if (REVEAL_RE.test(text)) return '摇移揭示';
  if (isDialogue && EMOTION_RE.test(text)) return '固定压迫后缓推';
  if (CLOSE_RE.test(text)) return '缓推';
  if (phase === '蓄势') return '固定后缓慢推进';
  return '固定压迫';
}

function inferDuration(text: string, isDialogue: boolean): number {
  if (DYNAMIC_RE.test(text)) return 4;
  if (isDialogue && text.length > 16) return 5;
  if (CLOSE_RE.test(text)) return 3;
  return 4;
}

function buildSceneBeats(scene: RuleScene): string[] {
  const basis = scene.text || scene.title;
  return [
    `蓄势：${scene.title}先建立空间压迫与危险关系`,
    `转势：${scene.title}通过遮挡、视线或动线改写关系`,
    `爆发：${scene.title}把局势推进到动作或情绪落点`,
    basis.length > 30 ? `收束：${scene.title}给出余势镜头，确认局势已被改写` : '',
  ].filter(Boolean);
}

function extractMustShowText(text: string): string[] {
  const props = Array.from(text.matchAll(PROP_RE)).map((m) => m[0]);
  return uniq(props).slice(0, 4);
}

function buildActionDescription(beat: string): string {
  const spaceHint = WIDE_RE.test(beat) ? '保留纵深与高低差' : '保留主体与压迫来源的空间关系';
  const revealHint = REVEAL_RE.test(beat) ? '通过遮挡揭示完成信息显露' : '让动作方向清楚可读';
  return `${beat}，${spaceHint}，${revealHint}。`;
}

function buildDialogueDescription(sceneTitle: string, speaker: string, text: string): string {
  const pressureHint = PRESSURE_RE.test(text) ? '对位人物留在遮挡或边缘位置，压迫关系不能丢' : '画面保留对位关系与空间压迫';
  return `${sceneTitle}内，${speaker}在可见压迫关系中开口，${pressureHint}。`;
}

function buildNote(sceneTitle: string, phase: string, text: string, isDialogue: boolean): string {
  const parts = [
    `${phase}段`,
    REVEAL_RE.test(text) ? '通过遮挡揭示完成转势' : '',
    WIDE_RE.test(text) ? '强化纵深与高低差' : '',
    DYNAMIC_RE.test(text) ? '环境卷入动作推进' : '',
    isDialogue ? '文戏按空间压迫处理，不平拍对说' : '',
  ].filter(Boolean);
  return `${sceneTitle}：${parts.join('；')}。`;
}

function buildStoryboardShotsFromScenes(scenes: RuleScene[]): StoryboardShot[] {
  const shots: StoryboardShot[] = [];
  let shotId = 1;
  for (const scene of scenes) {
    const expandedBlocks = scene.blocks.flatMap((block) => {
      if (block.kind === 'dialogue') return [block];
      return splitActionBeats(block.text).map((text) => ({ ...block, text }));
    });
    const total = expandedBlocks.length || 1;
    expandedBlocks.forEach((block, index) => {
      const phase = pickPhase(index, total);
      const isDialogue = block.kind === 'dialogue';
      const type = inferShotType(block.text, index, total, isDialogue);
      const movement = inferMovement(block.text, isDialogue, phase);
      shots.push({
        id: shotId,
        wireId: createStoryboardShotWireId(shotId),
        type,
        movement,
        description: isDialogue
          ? buildDialogueDescription(scene.title, block.speaker || '角色', block.text)
          : buildActionDescription(block.text),
        content: isDialogue ? block.text : '',
        sceneRef: scene.title,
        action: isDialogue ? `${block.speaker || '角色'}在压迫关系中说话` : block.text,
        durationSec: inferDuration(block.text, isDialogue),
        note: buildNote(scene.title, phase, block.text, isDialogue),
      });
      shotId += 1;
    });
  }
  return shots;
}

function inferEmotion(shot: StoryboardShot): string {
  const text = `${shot.description} ${shot.content} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (/惊|慌|急|追|逃|逼|压/.test(text)) return '紧张压迫';
  if (/怒|恨|杀|反击|拔刀/.test(text)) return '爆发对抗';
  if (/沉默|低声|试探|迟疑/.test(text)) return '克制试探';
  return '悬疑推进';
}

function inferLighting(shot: StoryboardShot): string {
  const text = `${shot.description} ${shot.content}`;
  if (/月|夜|窗|窗棂/.test(text)) return '月光与冷色侧逆光';
  if (/火|灯|烛/.test(text)) return '火光与低照度反差光';
  return '写实电影光，保留暗部层次';
}

function inferComposition(shot: StoryboardShot): string {
  const text = `${shot.description} ${shot.sound ?? ''} ${shot.note ?? ''}`;
  if (/高低差|楼梯|楼上|楼下/.test(text)) return '强调高低差与纵深压迫';
  if (/遮挡|屏风|门后|帘后|窗/.test(text)) return '用遮挡和留白完成显藏关系';
  return '主体、压迫源与出口关系同框';
}

function inferCharacters(shot: StoryboardShot): string {
  const speaker = shot.content.trim();
  if (speaker) return '说话角色与对位人物';
  const names = shot.description.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [];
  return uniq(names).slice(0, 2).join('、') || '主体角色';
}

function summarizeAction(shot: StoryboardShot): string {
  const text = shot.action?.trim() || shot.description.trim();
  return text.length > 38 ? `${text.slice(0, 38)}...` : text;
}

function buildPromptDimensions(shot: StoryboardShot): PromptShotDimensions {
  return {
    场景: shot.sceneRef?.trim() || extractMustShowText(shot.description)[0] || '当前场景空间',
    角色: inferCharacters(shot),
    动作: summarizeAction(shot),
    情感: inferEmotion(shot),
    镜头: shot.type,
    运镜: shot.movement,
    灯光: inferLighting(shot),
    风格: 'REAL_CG 写实电影质感，徐克式空间压迫与关系转势',
    构图: inferComposition(shot),
    连贯性: '承接上一镜动作方向与情绪惯性，禁跳轴、禁时序闪烁',
  };
}

function buildRulePromptText(shot: StoryboardShot, dimensions: PromptShotDimensions): string {
  const members = expandMergedMembers(shot);
  if (members.length > 1) {
    const segments = members.map((member, idx) => {
      return `镜头${idx + 1}：${member.type}，${member.movement}，${member.description}${member.content ? `；对白：${member.content}` : ''}`;
    });
    return [
      'REAL_CG，写实电影质感，徐克式空间压迫与纵深调度。',
      segments.join(' '),
      `灯光：${dimensions.灯光}。`,
      `构图：${dimensions.构图}。`,
      '环境必须参与动作推进，主体关系清晰，承接连续镜头接力，禁UI、禁字幕、禁水印、禁logo、无背景音乐。',
    ].join(' ');
  }
  return [
    'REAL_CG，写实电影质感。',
    `${shot.type}，${shot.movement}。`,
    shot.description,
    shot.content ? `对白：${shot.content}。` : '',
    `灯光：${dimensions.灯光}。`,
    `构图：${dimensions.构图}。`,
    '环境参与动作推进，主体关系清晰，禁UI、禁字幕、禁水印、禁logo、无背景音乐，避免时序闪烁和肢体畸形。',
  ]
    .filter(Boolean)
    .join(' ');
}

function buildRuleSeedanceCard(
  shot: StoryboardShot,
  pack: PromptShotPack,
  dimensions: PromptShotDimensions,
): string {
  const mustShow = uniq([
    dimensions.场景 ?? '',
    dimensions.角色 ?? '',
    ...extractMustShowText(`${shot.description} ${shot.content}`),
    dimensions.动作 ?? '',
  ])
    .filter(Boolean)
    .slice(0, 4);
  while (mustShow.length < 4) mustShow.push(`关键视觉元素${mustShow.length + 1}`);
  const members = expandMergedMembers(shot);
  const stateProgression =
    members.length > 1
      ? members
          .map((member, idx) => `镜头${idx + 1}：${member.description}${member.content ? `；对白：${member.content}` : ''}`)
          .join('\n')
      : `起始状态：${shot.description}\n变化节点：${shot.action?.trim() || shot.content.trim() || '推进关键动作'}\n结果状态：落在最关键的情绪或信息结果上`;
  const rhythm =
    members.length > 1 ? '蓄势/转势/爆发' : (shot.note?.includes('收束') ? '收束' : '蓄势/转势');
  const durationSec = typeof shot.durationSec === 'number' ? shot.durationSec : estimateShotDurationSec(shot);
  const startText = shot.description;
  const changeText = shot.action?.trim() || shot.content.trim() || '关系在动作推进中被改写';
  const settleText = mustShow[3];
  const holdText =
    members.length > 1
      ? '最后一镜留出清晰结果位，供模型稳定收束画面。'
      : '在结果位短暂停住，让主信息与情绪落点被读清。';
  const transitionText =
    members.length > 1
      ? '用遮挡、人物位移或视线牵引完成组内镜头过门，不硬切断势能。'
      : '通过动作尾势、视线方向或环境遮挡，把下个镜头自然带入。';
  const soundText = shot.content
    ? `保留对白“${shot.content}”，声音与口型同步；以环境声、衣料声、落点声维持张力，不加背景音乐。`
    : '无背景音乐，以环境底噪、动作声、衣料摩擦声或空间回响维持势能。';
  const mustShowLines = mustShow.map((item) => `- ${item}`).join('\n');
  return [
    `【分镜${String(shot.id).padStart(2, '0')} | ${durationSec}秒 | 类型:${members.length > 1 ? 'B' : 'A'} | 方案:空间压迫与动作接力 | 档位:LTE | 节奏:${rhythm}】`,
    '',
    '挂载:',
    `@角色=${pack.character_asset_ids?.join(', ') || '文字生成版，无素材'} | @场景=${pack.scene_asset_ids?.join(', ') || '文字生成版，无素材'} | @道具=${mustShow.slice(2).join('、')}`,
    '',
    '相机位置:',
    `${dimensions.场景}内建立纵深与高低关系，相机始终服务当前压迫来源与出口关系。`,
    '',
    '相机朝向:',
    `${shot.movement}，镜头顺着力量关系与动作方向推进，不跳轴。`,
    '',
    '角色朝向:',
    `${dimensions.角色}始终朝向事件中心或压迫来源，表演焦点跟随关系变化。`,
    '',
    '构图锚点:',
    `${dimensions.构图}；前景/中景/后景要能读出主体、阻碍与结果。`,
    '',
    '镜头规格:',
    `景别：${shot.type}\n运镜：${shot.movement}\n时长：${durationSec}秒\n灯光：${dimensions.灯光}`,
    '',
    '起端:',
    startText,
    '',
    '变化:',
    changeText,
    '',
    '落幅:',
    settleText,
    '',
    '稳幅:',
    holdText,
    '',
    '承接:',
    '承接上一镜的动作方向、情绪惯性与空间压迫，不做解释性停顿。',
    '',
    '接力物:',
    `${mustShow[2]} 与 ${mustShow[3]} 共同承担势能接力。`,
    '',
    '过门:',
    transitionText,
    '',
    '【双版本构图】',
    `9:16 = 主体置于纵向主视轴，保留上下运动空间与高低差。`,
    `16:9 = 主体、压迫源与出口关系同框，保留纵深通道和遮挡关系。`,
    '（不换轴线）',
    '',
    '【使用状态递进】',
    stateProgression,
    '',
    '【运动协议】',
    members.length > 1
      ? '镜头按镜头1 / 镜头2 / 镜头3 顺序连续推进，动作方向、空间关系与压迫来源保持同一条叙事轴线。'
      : `镜头按“${shot.type} / ${shot.movement}”执行，优先放大关系变化与空间压迫。`,
    '',
    '提示词(复制到即梦):',
    pack.prompt,
    '',
    '【目标物 Must-Show】',
    mustShowLines,
    '',
    '【参考分工】',
    `@角色负责：${mustShow[1]} / ${mustShow[2]}\n@场景负责：${mustShow[0]} / ${mustShow[3]}\n@摄影负责：${shot.type} / ${shot.movement}`,
    '',
    '【声音/氛围】',
    soundText,
    '',
    '【微表情】',
    shot.content ? '在台词落点前后补一个可读的眼神、停顿或细小表情变化。' : '在镜头收束前补一个可读的眼神或动作停顿。',
    '',
    '【文戏附加】',
    shot.content ? '对话不做机械正反打，让视线、停顿与遮挡承担信息传递。' : '非对白镜头通过动作与空间调度完成叙事，不额外解释。',
    '',
    '【钉子4行】',
    `硬钉子1：必须看见 ${mustShow[0]}`,
    `硬钉子2：动作落点必须指向 ${mustShow[2]}`,
    `情绪钉子：${dimensions.情感}`,
    `叙事钉子：镜头最终落在 ${mustShow[3]}`,
  ].join('\n');
}

function normalizeRuleMountEntities(values: string[]): string {
  const entities = uniq(values)
    .map((item) => item.replace(/[\s,，。、《》【】：“”"'()（）]/g, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  if (entities.length === 0) return '|@=主体角色| |@=当前场景|';
  if (entities.length === 1) return `|@=${entities[0]}| |@=当前场景|`;
  return entities.map((item) => `|@=${item}|`).join(' ');
}

function rewriteRuleSeedanceMountBlock(
  seedanceCard: string,
  dimensions: PromptShotDimensions,
  mustShow: string[],
): string {
  const mountLine = normalizeRuleMountEntities([
    dimensions.角色 ?? '',
    dimensions.场景 ?? '',
    ...mustShow,
  ]);
  return seedanceCard.replace(/(挂载:|鎸傝浇:)\r?\n[^\n]*/m, `$1\n${mountLine}`);
}

void buildRuleSeedanceCard;
void rewriteRuleSeedanceMountBlock;

export function runRuleStoryboardFromText(inputText: string): StoryboardOutput {
  const scenes = parseWritingOutputScenes(inputText) ?? splitScenesFromRaw(inputText);
  const shots = buildStoryboardShotsFromScenes(scenes);
  return {
    shots,
    narrativeBeats: scenes.flatMap((scene) => buildSceneBeats(scene)),
  };
}

export function runRulePromptFromStoryboard(inputText: string): PromptOutput {
  const trimmedInput = inputText.trim();
  const directStoryboard = tryParseStoryboardOutput(extractJsonLikeValue(trimmedInput) ?? trimmedInput);
  const directTextSingleShot =
    !directStoryboard?.shots?.length && trimmedInput && !looksLikeStructuredPromptInput(trimmedInput)
      ? buildPromptSingleShotStoryboardFromText(trimmedInput)
      : null;
  const storyboard =
    directStoryboard?.shots?.length
      ? directStoryboard
      : directTextSingleShot?.shots?.length
        ? directTextSingleShot
      : trimmedInput
        ? runRuleStoryboardFromText(trimmedInput)
        : null;
  if (!storyboard?.shots?.length) {
    throw new Error('规则模式需要有效输入：请连接分镜表/镜头表，或直接把剧本文本接到 Prompt 节点。');
  }
  const shotPrompts = storyboard.shots.map((shot) => {
    const dimensions = buildPromptDimensions(shot);
    const prompt = clampPromptText(buildRulePromptText(shot, dimensions), 2500);
    const pack: PromptShotPack = {
      shot_id: String(shot.id),
      prompt,
      negative_prompt:
        'low quality, blurry, subtitle, text overlay, watermark, logo, extra limbs, deformed hands, flicker, temporal inconsistency',
      dimensions,
      character_asset_ids: [],
      scene_asset_ids: [],
      seedanceCard: '',
    };
    pack.seedanceCard = buildSeedanceCard(shot, pack);
    return pack;
  });

  return {
    system: '规则模式：基于本地镜头拆解与即梦工业模板生成 PromptOutput，不调用外部 API。',
    userTemplate: directStoryboard?.shots?.length
      ? '规则模式已根据镜头表生成逐镜头即梦提示词与工业卡，可直接继续审核或导出。'
      : '规则模式已先根据文本自动拆分镜头，再生成逐镜头即梦提示词与工业卡，可直接继续审核或导出。',
    negative:
      'low quality, blurry, subtitle, text overlay, watermark, logo, extra limbs, deformed hands, flicker, temporal inconsistency',
    parameters: {
      engine: 'jimeng',
      aspect: '16:9',
      renderMode: 'rule',
    },
    shotPrompts,
  };
}

export function runRuleStoryboardLeaderReview(output: StoryboardOutput): {
  approved: boolean;
  feedback: string | null;
} {
  if (!output.shots?.length) {
    return { approved: false, feedback: '规则审核未通过：分镜结果为空。' };
  }
  const noDescription = output.shots.filter((shot) => !shot.description.trim()).map((shot) => shot.id);
  if (noDescription.length) {
    return { approved: false, feedback: `规则审核未通过：镜头 ${noDescription.join('、')} 缺少画面描述。` };
  }
  const envHits = output.shots.filter((shot) =>
    /(门|窗|帘|屏风|楼梯|栏杆|桥|火|水|烟|屋檐|通道|高位|低位)/.test(
      `${shot.description} ${shot.sound ?? ''} ${shot.note ?? ''}`,
    ),
  ).length;
  if (envHits < Math.max(1, Math.floor(output.shots.length / 3))) {
    return {
      approved: false,
      feedback: '规则审核未通过：环境参与不足。请加强高低差、遮挡、危险源或可借力物，让空间真正卷入动作。',
    };
  }
  const beatsText = output.narrativeBeats.join('\n');
  if (!/蓄势/.test(beatsText) || !/爆发/.test(beatsText)) {
    return {
      approved: false,
      feedback: '规则审核未通过：narrativeBeats 缺少“蓄势 / 爆发”节奏信息，请补足势能递进。',
    };
  }
  return { approved: true, feedback: null };
}

export function runRulePromptLeaderReview(output: PromptOutput): {
  approved: boolean;
  feedback: string | null;
} {
  const shots = output.shotPrompts ?? [];
  if (!shots.length) {
    return { approved: false, feedback: '规则审核未通过：PromptOutput 缺少 shotPrompts。' };
  }
  for (const pack of shots) {
    if (!pack.prompt.trim()) {
      return { approved: false, feedback: `规则审核未通过：镜头 ${pack.shot_id} 缺少 prompt。` };
    }
    const card = pack.seedanceCard?.trim() ?? '';
    if (!card) {
      return { approved: false, feedback: `规则审核未通过：镜头 ${pack.shot_id} 缺少 seedanceCard。` };
    }
    const firstLine = card
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine?.startsWith('【分镜')) {
      return {
        approved: false,
        feedback: `规则审核未通过：镜头 ${pack.shot_id} 的卡片首行不符合要求。${PROMPT_CARD_HEADER_RULE}`,
      };
    }
    const missing = PROMPT_CARD_SECTION_HEADINGS.filter((heading) => !card.includes(heading));
    if (missing.length) {
      return {
        approved: false,
        feedback: `规则审核未通过：镜头 ${pack.shot_id} 的卡片缺少栏位：${missing.join('、')}。`,
      };
    }
  }
  return { approved: true, feedback: null };
}
