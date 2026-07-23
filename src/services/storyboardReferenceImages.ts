import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import type {
  StoryboardReferenceBinding,
  StoryboardReferenceKind,
  StoryboardShot,
} from '@/types/studio';

export const STORYBOARD_REFERENCE_MAX_IMAGES = 8;

export type StoryboardBreakdownEntity = {
  id: string;
  name: string;
  kind: StoryboardReferenceKind;
  detail?: string;
};

export type StoryboardConnectedReference = StoryboardReferenceBinding & {
  dataUrl?: string;
  mimeType?: string;
  sourceLabel: string;
};

export type StoryboardReferenceContext = {
  references: StoryboardConnectedReference[];
  entities: StoryboardBreakdownEntity[];
  missingImageCount: number;
  entitySourceNodeIds: string[];
  entitySource: 'connected' | 'project' | 'none';
};

const REFERENCE_KIND_PRIORITY: Record<StoryboardReferenceKind, number> = {
  character: 0,
  scene: 1,
  prop: 2,
};

/** Character identity is the strongest anchor; scene and prop references remain secondary constraints. */
export function prioritizeStoryboardReferences(
  references: StoryboardConnectedReference[],
): StoryboardConnectedReference[] {
  return references
    .map((reference, index) => ({ reference, index }))
    .sort(
      (a, b) =>
        REFERENCE_KIND_PRIORITY[a.reference.kind] - REFERENCE_KIND_PRIORITY[b.reference.kind] ||
        a.index - b.index,
    )
    .map(({ reference }) => reference);
}

function referenceNames(reference: StoryboardConnectedReference): string[] {
  return [...new Set([reference.entityName, reference.name, reference.sourceLabel]
    .map((value) => normalize(text(value)))
    .filter(Boolean))];
}

function shotReferenceText(shot: StoryboardShot, kind: StoryboardReferenceKind): string {
  const values = kind === 'character'
    ? [
        ...(shot.characters ?? []),
        shot.description,
        shot.action,
        shot.content,
        shot.note,
      ]
    : kind === 'scene'
      ? [shot.sceneRef, shot.description, shot.note]
      : [...(shot.props ?? []), shot.description, shot.action, shot.note];
  return normalize(values.map((value) => text(value)).filter(Boolean).join('|'));
}

export function storyboardReferenceMatchesShot(
  reference: StoryboardConnectedReference,
  shot: StoryboardShot,
): boolean {
  const haystack = shotReferenceText(shot, reference.kind);
  return Boolean(haystack && referenceNames(reference).some((name) => haystack.includes(name)));
}

/** Keep only references relevant to this page when metadata is available; fall back per kind to avoid silent loss. */
export function selectStoryboardReferencesForShots(
  references: StoryboardConnectedReference[],
  shots: StoryboardShot[],
  maxImages = STORYBOARD_REFERENCE_MAX_IMAGES,
): StoryboardConnectedReference[] {
  const selected: StoryboardConnectedReference[] = [];
  for (const kind of ['character', 'scene', 'prop'] as const) {
    const candidates = references.filter((reference) => reference.kind === kind && reference.dataUrl);
    const matched = candidates.filter((reference) =>
      shots.some((shot) => storyboardReferenceMatchesShot(reference, shot)),
    );
    selected.push(...(matched.length ? matched : candidates));
  }
  return prioritizeStoryboardReferences(selected).slice(0, maxImages);
}

export function buildStoryboardPanelReferenceInstruction(
  shot: StoryboardShot,
  references: StoryboardConnectedReference[],
): string {
  const ordered = prioritizeStoryboardReferences(references)
    .filter((reference) => reference.dataUrl)
    .slice(0, STORYBOARD_REFERENCE_MAX_IMAGES);
  const bindings = ordered.flatMap((reference, index) => {
    if (!storyboardReferenceMatchesShot(reference, shot)) return [];
    const targetName = reference.entityName || reference.name;
    const rule = reference.kind === 'character'
      ? `角色「${targetName}」必须使用参考图${index + 1}的同一张脸、年龄、发型和服装，禁止换脸`
      : reference.kind === 'scene'
        ? `场景「${targetName}」必须使用参考图${index + 1}的空间、材质和主光方向`
        : `道具「${targetName}」必须使用参考图${index + 1}的轮廓、材质和纹理`;
    return [rule];
  });
  return bindings.length ? `本格参考绑定：${bindings.join('；')}。` : '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value: string): string {
  return value.replace(/\s+/gu, '').toLocaleLowerCase();
}

function guessReferenceKind(label: string): StoryboardReferenceKind {
  if (/(场景|环境|地点|内景|外景|location|scene)/iu.test(label)) return 'scene';
  if (/(道具|物件|武器|车辆|prop|object)/iu.test(label)) return 'prop';
  return 'character';
}

function entityKey(entity: StoryboardBreakdownEntity): string {
  return `${entity.kind}:${normalize(entity.name)}`;
}

function splitEntityNames(value: string): string[] {
  return [...new Set(value.split(/[、,，;；|/]+/u).map((item) => item.trim()).filter(Boolean))];
}

function noteEntityNames(note: string, label: '角色' | '道具'): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([^\\n]+)`, 'gu');
  for (const match of note.matchAll(pattern)) values.push(...splitEntityNames(match[1] ?? ''));
  return [...new Set(values)];
}

function recordTextList(record: Record<string, unknown>, keys: string[]): string[] {
  const normalizedKeys = new Set(keys.map((key) => normalize(key)));
  const values: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!normalizedKeys.has(normalize(key))) continue;
    const items = Array.isArray(value) ? value : typeof value === 'string' ? splitEntityNames(value) : [value];
    for (const item of items) {
      if (typeof item === 'string' || typeof item === 'number') values.push(String(item).trim());
      else if (item && typeof item === 'object') values.push(text((item as Record<string, unknown>).name));
    }
  }
  return [...new Set(values.filter(Boolean))];
}

const KNOWN_CHARACTER_PATTERN = /小沙弥|小和尚|老和尚|老僧|年轻僧人|僧人|和尚|老者|老人|少年|少女|男孩|女孩|小孩|儿童|婴儿|男子|女子|男人|女人|师父|师傅|徒弟|弟子|父亲|母亲|儿子|女儿|丈夫|妻子|军官|士兵|警察|医生|护士|掌柜|店主|侍卫|皇帝|皇后|王爷|公主|书生|侠客|刺客|男主|女主|主角/gu;
const SUBJECT_ACTION_PATTERN = /(?:^|[，。；！？、\s])(?:特写|近景|中景|远景|全景|画面中|只见)?([\p{Script=Han}]{2,5})(?=缓缓|突然|轻轻|猛地|正在|站|坐|跪|走|看|望|抬|低|伸|拿|握|开口|说|问|答|转身|推|抱|递|点头|闭眼|睁眼|沉默|凝视)/gu;
const SUBJECT_STOP_WORDS = new Set(['镜头', '画面', '特写', '近景', '中景', '远景', '全景', '烛火', '窗外', '室内', '禅房']);
const KNOWN_PROP_PATTERN = /摩托车|自行车|录音笔|佛珠|念珠|木鱼|经书|香炉|烛台|蜡烛|油灯|灯笼|手机|钥匙|铜钥匙|照片|信件|书本|酒杯|茶杯|药瓶|背包|木箱|箱子|盒子|匕首|长剑|宝剑|手枪|步枪|长矛|弓箭|盾牌|面具|戒指|项链|玉佩|手套|披风|帽子|拐杖|扇子|雨伞|相机|电脑|硬盘/gu;
const PROP_ACTION_PATTERN = /(?:手持|拿着|拿起|握着|握住|捧着|捧起|递出|放下|捡起|掏出|取出|举起|端起|打开|合上|擦拭|拨动|攥紧|佩戴|戴上|背着|提着|抽出)(?:一(?:个|把|本|串|盏|支|张|封|枚|件|块|柄))?([\p{Script=Han}]{1,6}?)(?=缓缓|轻轻|突然|随后|然后|并|后|，|。|；|！|？|、|\s|$)/gu;
const PROP_STOP_WORDS = new Set(['双手', '右手', '左手', '手中', '怀中', '东西', '物件', '衣角', '目光', '房门']);

function describedCharacters(shot: Record<string, unknown>): string[] {
  // 对白正文里的称谓（如“师父”）通常是关系称呼，不应重复创建成另一个角色；对白只读取冒号前说话人。
  const combined = [text(shot.description), text(shot.action), text(shot.note)].filter(Boolean).join('\n');
  const names = new Set<string>();
  for (const match of combined.matchAll(KNOWN_CHARACTER_PATTERN)) names.add(match[0]);
  for (const label of ['角色', '人物', '出场人物', '出镜人物']) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([^\\n]+)`, 'gu');
    for (const match of combined.matchAll(pattern)) splitEntityNames(match[1] ?? '').forEach((name) => names.add(name));
  }
  const content = text(shot.content);
  const speaker = content.match(/^\s*([\p{Script=Han}]{2,5})\s*[:：]/u)?.[1];
  if (speaker && !SUBJECT_STOP_WORDS.has(speaker)) names.add(speaker);
  return [...names];
}

function describedProps(shot: Record<string, unknown>): string[] {
  const combined = [text(shot.description), text(shot.action), text(shot.note)].filter(Boolean).join('\n');
  const names = new Set<string>();
  for (const match of combined.matchAll(KNOWN_PROP_PATTERN)) names.add(match[0]);
  for (const label of ['道具', '关键道具', '物件']) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]\\s*([^\\n]+)`, 'gu');
    for (const match of combined.matchAll(pattern)) splitEntityNames(match[1] ?? '').forEach((name) => names.add(name));
  }
  for (const match of combined.matchAll(PROP_ACTION_PATTERN)) {
    const candidate = match[1]?.trim();
    if (candidate && !PROP_STOP_WORDS.has(candidate)) names.add(candidate);
  }
  return [...names];
}

function storyboardEntities(record: Record<string, unknown>): StoryboardBreakdownEntity[] {
  const shots = Array.isArray(record.shots) ? record.shots : [];
  const entities: StoryboardBreakdownEntity[] = [];
  const subjectCandidateCounts = new Map<string, number>();
  for (const value of shots) {
    if (!value || typeof value !== 'object') continue;
    const shot = value as Record<string, unknown>;
    const scene = text(shot.sceneRef);
    if (scene) {
      entities.push({
        id: `storyboard-scene-${normalize(scene)}`,
        name: scene,
        kind: 'scene',
        detail: '来自分镜表',
      });
    }
    const note = text(shot.note);
    const explicitCharacters = [
      ...recordTextList(shot, ['characters', 'character', 'roles', 'role', '角色', '人物', '出场人物']),
      ...noteEntityNames(note, '角色'),
      ...describedCharacters(shot),
    ];
    for (const match of `${text(shot.description)} ${text(shot.action)}`.matchAll(SUBJECT_ACTION_PATTERN)) {
      const candidate = match[1]?.trim();
      if (candidate && !SUBJECT_STOP_WORDS.has(candidate)) {
        subjectCandidateCounts.set(candidate, (subjectCandidateCounts.get(candidate) ?? 0) + 1);
      }
    }
    for (const name of [...new Set(explicitCharacters)]) {
      entities.push({
        id: `storyboard-character-${normalize(name)}`,
        name,
        kind: 'character',
        detail: '来自分镜表',
      });
    }
    const explicitProps = [
      ...recordTextList(shot, ['props', 'prop', '道具', '关键道具', '道具服化']),
      ...noteEntityNames(note, '道具'),
      ...describedProps(shot),
    ];
    for (const name of [...new Set(explicitProps)]) {
      entities.push({
        id: `storyboard-prop-${normalize(name)}`,
        name,
        kind: 'prop',
        detail: '来自分镜表',
      });
    }
  }
  for (const [name, count] of subjectCandidateCounts) {
    if (count < 2 || entities.some((entity) => entity.kind === 'character' && normalize(entity.name) === normalize(name))) continue;
    entities.push({
      id: `storyboard-character-${normalize(name)}`,
      name,
      kind: 'character',
      detail: '来自分镜描述',
    });
  }
  return entities;
}

function entitiesFromOutput(output: unknown): StoryboardBreakdownEntity[] {
  if (!output || typeof output !== 'object') return [];
  const record = output as Record<string, unknown>;
  const module = text(record.module);
  const entities: StoryboardBreakdownEntity[] = [];

  entities.push(...storyboardEntities(record));

  if (module === 'script_scenes' || module === 'script_package') {
    const scenes = Array.isArray(record.scenes) ? record.scenes : [];
    scenes.forEach((value, index) => {
      if (!value || typeof value !== 'object') return;
      const scene = value as Record<string, unknown>;
      const sceneNo = typeof scene.sceneNo === 'number' ? scene.sceneNo : index + 1;
      const title = text(scene.title) || text(scene.location) || `第 ${sceneNo} 场`;
      const location = text(scene.location);
      entities.push({
        id: text(scene.id) || `scene-${sceneNo}`,
        name: title,
        kind: 'scene',
        detail: [`第 ${sceneNo} 场`, location && location !== title ? location : ''].filter(Boolean).join(' · '),
      });
    });
  }

  if (module === 'script_characters' || module === 'script_package') {
    const characters = Array.isArray(record.characters) ? record.characters : [];
    characters.forEach((value, index) => {
      if (!value || typeof value !== 'object') return;
      const character = value as Record<string, unknown>;
      const name = text(character.name);
      if (!name) return;
      entities.push({
        id: text(character.id) || `character-${index + 1}`,
        name,
        kind: 'character',
        detail: Array.isArray(character.sceneNos) && character.sceneNos.length
          ? `出场：${character.sceneNos.join('、')}`
          : undefined,
      });
    });
  }

  if (module === 'script_props' || module === 'script_package') {
    const props = Array.isArray(record.props) ? record.props : [];
    props.forEach((value, index) => {
      if (!value || typeof value !== 'object') return;
      const prop = value as Record<string, unknown>;
      const name = text(prop.name);
      if (!name) return;
      entities.push({
        id: text(prop.id) || `prop-${index + 1}`,
        name,
        kind: 'prop',
        detail: text(prop.category) || undefined,
      });
    });
  }

  return entities;
}

function upstreamNodes(storyboardNodeId: string, nodes: StudioRFNode[], edges: Edge[]): StudioRFNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>([storyboardNodeId]);
  const queue = [storyboardNodeId];
  const result: StudioRFNode[] = [];
  while (queue.length) {
    const targetId = queue.shift() as string;
    for (const edge of edges) {
      if (edge.target !== targetId || visited.has(edge.source)) continue;
      visited.add(edge.source);
      queue.push(edge.source);
      const node = byId.get(edge.source);
      if (node) result.push(node);
    }
  }
  return result;
}

function isProjectBreakdownNode(node: StudioRFNode): boolean {
  if (!node.data.output || typeof node.data.output !== 'object') return false;
  const module = text((node.data.output as Record<string, unknown>).module);
  return module === 'script_scenes' || module === 'script_characters' || module === 'script_props' || module === 'script_package';
}

export function resolveStoryboardReferenceContext(
  storyboardNodeId: string,
  nodes: StudioRFNode[],
  edges: Edge[],
  savedBindings: StoryboardReferenceBinding[] = [],
): StoryboardReferenceContext {
  const directIncomingNodes = edges
    .filter((edge) => edge.target === storyboardNodeId)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is StudioRFNode => Boolean(node));

  const connectedNodes = upstreamNodes(storyboardNodeId, nodes, edges);
  const connectedIds = new Set(connectedNodes.map((node) => node.id));
  const sourceNodes: StudioRFNode[] = [];
  const seenSourceIds = new Set<string>();
  for (const node of [...connectedNodes, ...nodes.filter(isProjectBreakdownNode)]) {
    if (seenSourceIds.has(node.id)) continue;
    seenSourceIds.add(node.id);
    sourceNodes.push(node);
  }

  const entityMap = new Map<string, StoryboardBreakdownEntity>();
  const entitySourceNodeIds: string[] = [];
  for (const node of sourceNodes) {
    const nodeEntities = entitiesFromOutput(node.data.output);
    if (nodeEntities.length) entitySourceNodeIds.push(node.id);
    for (const entity of nodeEntities) {
      entityMap.set(entityKey(entity), entity);
    }
  }
  const entities = [...entityMap.values()].sort((a, b) => {
    const kindOrder = { character: 0, scene: 1, prop: 2 } as const;
    return kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name, 'zh-CN');
  });

  const savedMap = new Map(savedBindings.map((binding) => [binding.imageNodeId, binding]));
  const imageNodes = directIncomingNodes.filter((node) => node.type === 'imageNode');
  const references = imageNodes.map((node, index): StoryboardConnectedReference => {
    const sourceLabel = text(node.data.label) || text(node.data.imageFileName) || `参考图 ${index + 1}`;
    const saved = savedMap.get(node.id);
    const kind = saved?.kind ?? guessReferenceKind(sourceLabel);
    const selectedEntity = entities.find(
      (entity) =>
        entity.kind === kind &&
        (entity.id === saved?.entityId ||
          normalize(entity.name) === normalize(saved?.entityName || '') ||
          normalize(entity.name) === normalize(sourceLabel)),
    );
    const entityId = selectedEntity?.id ?? saved?.entityId;
    const entityName = selectedEntity?.name ?? saved?.entityName;
    return {
      imageNodeId: node.id,
      sourceLabel,
      dataUrl: text(node.data.imageDataUrl) || undefined,
      mimeType: text(node.data.imageMimeType) || undefined,
      kind,
      name: text(saved?.name) || entityName || sourceLabel,
      entityId,
      entityName,
    };
  });

  return {
    references,
    entities,
    missingImageCount: references.filter((reference) => !reference.dataUrl).length,
    entitySourceNodeIds,
    entitySource: entitySourceNodeIds.some((nodeId) => connectedIds.has(nodeId))
      ? 'connected'
      : entitySourceNodeIds.length
        ? 'project'
        : 'none',
  };
}

export function buildStoryboardReferenceInstruction(
  references: StoryboardConnectedReference[],
  startIndex = 1,
): string {
  const usable = prioritizeStoryboardReferences(references)
    .filter((reference) => reference.dataUrl)
    .slice(0, STORYBOARD_REFERENCE_MAX_IMAGES);
  if (!usable.length) return '';
  const kindLabel: Record<StoryboardReferenceKind, string> = {
    character: '角色',
    scene: '场景',
    prop: '道具',
  };
  return [
    '参考图是必须遵守的视觉身份硬约束，按下列顺序对应。先读取图片本身，再读取对象名称；绑定名称只是身份标签，不得根据名称或分镜文字自行推断年龄、长相、服装、场景外观或道具造型。若名称“老和尚”绑定到年轻男性照片，就必须使用照片中的年轻面孔与服装；若名称“禅房”绑定到科幻空间照片，就必须使用照片中的科幻空间，不得按名称另画传统寺庙。',
    ...usable.map((reference, index) => {
      const entity = reference.entityName && reference.entityName !== reference.name
        ? `，对应分解表「${reference.entityName}」`
        : '';
      const constraint = reference.kind === 'character'
        ? '凡镜头出现该角色，必须复用参考图中的同一张脸、脸型、五官比例、发型、肤色、年龄观感和服装造型；不得只保留性别或人物类型后另造一张脸。'
        : reference.kind === 'scene'
          ? `这是场景环境底图，不是可忽略的氛围建议。凡镜头的 sceneRef、场景栏或画面描述指向「${reference.entityName || reference.name}」，无论大全景、中景、近景或特写，都必须复用参考图中的空间结构、建筑材质、陈设位置、色彩和主光方向；近景背景也必须来自同一空间，禁止另造相似场景。`
          : '凡镜头出现该道具，必须复用参考图中的轮廓、材质、颜色、纹理和可识别细节。';
      return `参考图 ${index + startIndex}：${kindLabel[reference.kind]}「${reference.name}」${entity}。${constraint}不要与其他参考对象混淆。`;
    }),
    '场景参考图优先级高于通用风格词和分镜 Skill 的美术发挥；若文字描述与参考图外观冲突，以参考图为准。角色名、称谓（例如“老和尚”）不代表视觉年龄。只在镜头描述涉及相应角色、场景或道具时使用该参考图；未涉及时不要强行加入画面。',
  ].join('\n');
}
