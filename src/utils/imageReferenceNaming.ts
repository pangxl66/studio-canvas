export type ImageReferenceKind =
  | 'auto'
  | 'character'
  | 'scene'
  | 'prop'
  | 'blocking'
  | 'palette';

export type ImageReferenceScope = 'current_input' | 'shot' | 'scene' | 'continuity';

export type NamedTextReference = {
  nodeId: string;
  label: string;
  role: 'project_constraints' | 'story_content' | 'reference_notes';
};

export type ImageTextReferenceMatch = NamedTextReference & {
  score: number;
};

const GENERIC_ENTITY_PARTS =
  /(?:场景角色站位图|角色场景站位图|角色站位图|人物站位图|场面调度图|站位关系图|站位示意图|站位图|blocking\s*(?:map|diagram)?|灯光色表|色表|调色板|palette|图片节点|图像节点|图片素材|视觉素材|角色设定图|角色参考图|场景参考图|道具参考图|人物参考图|角色设定|角色参考|场景参考|道具参考|人物参考|参考图片|参考图|素材图|图片|图像|素材|角色|人物|场景|道具|image|picture|photo|reference|asset|node|ref)/giu;

const TEXT_ROLE_LABEL: Record<NamedTextReference['role'], string> = {
  project_constraints: '项目约束',
  story_content: '分镜正文',
  reference_notes: '参考资料',
};

export const IMAGE_REFERENCE_KIND_LABEL: Record<ImageReferenceKind, string> = {
  auto: '自动识别',
  character: '角色参考图',
  scene: '场景参考图',
  prop: '道具参考图',
  blocking: '场景角色站位图',
  palette: '灯光色表',
};

export const IMAGE_REFERENCE_SCOPE_LABEL: Record<ImageReferenceScope, string> = {
  current_input: '当前连接输入',
  shot: '当前镜头',
  scene: '当前场景',
  continuity: '后续连续镜头',
};

export function stripImageFileExtension(value: string): string {
  return value.replace(/\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/iu, '');
}

export function cleanImageReferenceName(value: string, fallback = '图片参考'): string {
  const cleaned = stripImageFileExtension(value)
    .replace(/[\r\n【】]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function resolveImageReferenceName(
  data: { imageReferenceName?: string; imageFileName?: string; label?: string },
  fallback = '图片参考',
): string {
  const preferred =
    data.imageReferenceName?.trim() ||
    (data.imageFileName ? stripImageFileExtension(data.imageFileName).trim() : '') ||
    data.label?.trim() ||
    fallback;
  return cleanImageReferenceName(preferred, fallback);
}

export function inferImageReferenceKind(data: {
  imageReferenceKind?: ImageReferenceKind;
  imageReferenceName?: string;
  imageFileName?: string;
  label?: string;
  imageNodeMode?: string;
}): ImageReferenceKind {
  if (data.imageReferenceKind && data.imageReferenceKind !== 'auto') return data.imageReferenceKind;
  if (data.imageNodeMode === 'palette') return 'palette';
  const metadata = [data.imageReferenceName, data.label, data.imageFileName]
    .filter(Boolean)
    .join(' ');
  if (/场景角色站位|角色场景站位|角色站位|人物站位|场面调度|站位关系|blocking/i.test(metadata)) return 'blocking';
  if (/(?:灯光)?色表|调色板|color\s*(?:chart|palette)|palette/i.test(metadata)) return 'palette';
  if (/角色|人物|character|cast/i.test(metadata)) return 'character';
  if (/场景|环境|scene|location/i.test(metadata)) return 'scene';
  if (/道具|物件|prop|object/i.test(metadata)) return 'prop';
  return 'auto';
}

export function normalizeReferenceEntityName(value: string): string {
  return stripImageFileExtension(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(GENERIC_ENTITY_PARTS, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function resolveImageReferenceTarget(data: {
  imageReferenceTarget?: string;
  imageReferenceName?: string;
  imageFileName?: string;
  label?: string;
}): string {
  const explicit = data.imageReferenceTarget?.trim();
  if (explicit) return cleanImageReferenceName(explicit);
  const name = resolveImageReferenceName(data);
  const inferredTarget = name
    .replace(GENERIC_ENTITY_PARTS, '')
    .replace(/^[｜|·_\-]+|[｜|·_\-]+$/g, '')
    .trim();
  return cleanImageReferenceName(inferredTarget, name);
}

export function matchImageNameToTextReferences(
  targetName: string,
  references: NamedTextReference[],
): ImageTextReferenceMatch[] {
  const imageKey = normalizeReferenceEntityName(targetName);
  if (!imageKey) return [];

  return references
    .map((reference, order) => {
      const textKey = normalizeReferenceEntityName(reference.label);
      if (!textKey) return null;
      let score = 0;
      if (imageKey === textKey) score = 100;
      else {
        const shorter = imageKey.length <= textKey.length ? imageKey : textKey;
        const longer = imageKey.length > textKey.length ? imageKey : textKey;
        if (shorter.length >= 2 && longer.includes(shorter)) score = 80;
      }
      return score ? { ...reference, score, order } : null;
    })
    .filter(
      (match): match is ImageTextReferenceMatch & { order: number } => match != null,
    )
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ order: _order, ...match }) => match);
}

export function buildImageTextAlignmentInstruction(
  data: {
    imageReferenceName?: string;
    imageReferenceKind?: ImageReferenceKind;
    imageReferenceTarget?: string;
    imageReferenceScope?: ImageReferenceScope;
    imageFileName?: string;
    label?: string;
    imageNodeMode?: string;
  },
  references: NamedTextReference[],
): string {
  const imageName = resolveImageReferenceName(data);
  const kind = inferImageReferenceKind(data);
  const target = resolveImageReferenceTarget(data);
  const scope = data.imageReferenceScope ?? 'current_input';
  const matches = matchImageNameToTextReferences(target, references);
  const header = `素材语义：名称“${imageName}”；类型“${IMAGE_REFERENCE_KIND_LABEL[kind]}”；对应目标“${target}”；作用范围“${IMAGE_REFERENCE_SCOPE_LABEL[scope]}”。`;
  const alignment = matches.length
    ? `命名对标：已匹配文本节点 ${matches
        .map((match) => `“${match.label}”（${TEXT_ROLE_LABEL[match.role]}）`)
        .join('、')}。`
    : `命名对标：未找到名称为“${target}”的文本节点；按当前直接连接范围使用，不得擅自替换其他已命名主体。`;

  const usage = kind === 'blocking'
    ? '站位图职责：只约束角色相对位置、前中后景、朝向与视线、摄影轴线、屏幕运动方向、出入口、动线和连续镜头衔接；不负责角色长相、服装细节、场景美术或灯光色彩。文本剧情事实与明确动作高于站位图；发生冲突时保留文本并报告冲突。'
    : kind === 'character'
      ? '角色图职责：只补充对应角色的面貌、发型、体型、服装和配饰；不得把外观串用给其他角色。'
      : kind === 'scene'
        ? '场景图职责：只补充对应场景的空间、美术、建筑、设备、材质和环境；不得覆盖文本剧情与人物身份。'
        : kind === 'prop'
          ? '道具图职责：只补充对应道具的外观、结构、材质和可见状态；不得替换其他角色或场景。'
          : kind === 'palette'
            ? '色表职责：只控制灯光、色彩与明暗关系；不得带入图中的人物、道具或剧情事件。'
            : '普通参考图职责：只补充与对应文本不冲突的可见信息；文本决定身份、剧情、动作和关系。';
  return [header, alignment, usage].join('\n');
}
