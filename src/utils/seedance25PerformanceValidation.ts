type FacialChannel = {
  name: string;
  pattern: RegExp;
};

const CLOSE_FACE_SHOT_RE = /大特写|特写|近景|中近景|胸像|肩部以上/;
const NON_FACE_CLOSEUP_RE =
  /手部特写|手指特写|脚部特写|足部特写|道具特写|物件特写|机械结构特写|仪表特写|屏幕特写|纯空镜|无行动主体/;
const EXPLICITLY_UNREADABLE_FACE_RE =
  /面部不可读|面部不可见|脸部不可读|脸部不可见|背对镜头|背影|后脑|全罩头盔|面具遮挡|严重遮挡/;
const NON_HUMAN_SUBJECT_RE = /机器人|机械主体|非人主体|非人角色/;
const HUMAN_FACE_CONTEXT_RE =
  /人物|男人|女人|男性|女性|男孩|女孩|老人|人类|眉毛|眉心|眉间|眼睑|嘴唇|下颌/;

const FACIAL_CHANNELS: FacialChannel[] = [
  { name: 'brow', pattern: /眉心|眉间|眉头|眉梢|眉尾|双眉|眉毛/ },
  { name: 'eyelid', pattern: /上眼睑|下眼睑|眼睑|眼皮|眼角|眼眶|眨眼|闭眼/ },
  { name: 'cheek', pattern: /面颊|脸颊|颧肌|酒窝/ },
  { name: 'nose', pattern: /鼻翼|鼻根|皱鼻/ },
  { name: 'lip', pattern: /嘴角|嘴唇|双唇|唇线|唇瓣|下唇|上唇/ },
  { name: 'jaw', pattern: /下颌|下巴|咬肌|牙关|吞咽/ },
  { name: 'forehead', pattern: /额头|额纹/ },
];

const FACIAL_CHANGE_RE =
  /微微|轻微|略微|短促|缓慢|逐渐|由.+到|先.+(?:再|随后)|收紧|绷紧|绷住|压低|下压|抬起|上扬|放松|松开|闭合|张开|微张|抿紧|压紧|咬紧|颤动|抽动|湿润|泛红|凝住|停住|恢复|残留/;

function getSection(card: string, heading: string): string {
  const start = card.indexOf(heading);
  if (start < 0) return '';
  const contentStart = start + heading.length;
  const nextHeading = card.indexOf('\n【', contentStart);
  return card.slice(contentStart, nextHeading < 0 ? card.length : nextHeading).trim();
}

function getLastTimelineBody(timeline: string): string {
  const rangeRe = /(?:\[|\()?\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*(?:-|–|—|~|至|到)\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*(?:\]|\))?/gi;
  const matches = Array.from(timeline.matchAll(rangeRe));
  const last = matches.at(-1);
  if (!last) return timeline;
  return timeline.slice((last.index ?? 0) + last[0].length).trim();
}

export function getConcreteFacialChannels(text: string): string[] {
  return FACIAL_CHANNELS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

export function requiresConcreteFacialPerformance(seedanceCard: string): boolean {
  const framingContext = [
    getSection(seedanceCard, '【摄影机 / 镜头】'),
    getSection(seedanceCard, '【机位与构图】'),
    getSection(seedanceCard, '【起幅】'),
    getSection(seedanceCard, '【最终落幅】'),
  ]
    .filter(Boolean)
    .join('\n');

  if (!CLOSE_FACE_SHOT_RE.test(framingContext)) return false;
  if (NON_FACE_CLOSEUP_RE.test(framingContext) || EXPLICITLY_UNREADABLE_FACE_RE.test(framingContext)) {
    return false;
  }

  const appearsNonHumanOnly =
    NON_HUMAN_SUBJECT_RE.test(framingContext) && !HUMAN_FACE_CONTEXT_RE.test(framingContext);
  return !appearsNonHumanOnly;
}

export function getSeedance25ReadableFaceIssues(seedanceCard: string, timeline: string): string[] {
  if (!requiresConcreteFacialPerformance(seedanceCard)) return [];

  const issues: string[] = [];
  const channels = getConcreteFacialChannels(timeline);
  if (channels.length < 2 || !FACIAL_CHANGE_RE.test(timeline)) {
    issues.push(
      '近景/特写中的可读人脸缺少具体表情变化；【时间轴】至少写出两个不同面部区域（如眉部、眼睑、面颊、嘴唇或下颌）的可见变化，不能只写情绪、视线、抬头或停顿',
    );
  }

  const lastTimelineBody = getLastTimelineBody(timeline);
  if (
    getConcreteFacialChannels(lastTimelineBody).length < 1 ||
    !FACIAL_CHANGE_RE.test(lastTimelineBody)
  ) {
    issues.push(
      '近景/特写镜尾缺少具体面部残留状态；最后一个时间段至少保留一个可见面部区域的明确状态',
    );
  }

  return issues;
}
