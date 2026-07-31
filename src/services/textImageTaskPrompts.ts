import type { TextImageTaskMode } from '@/types/studio';

export type TextImageReference = {
  label: string;
  fileName: string;
  summary?: string;
};

function imageReferencePrompt(references: TextImageReference[]): string {
  return references
    .map((reference, index) => {
      const name = reference.fileName || reference.label || '未命名图片';
      const summary = reference.summary ? `\n已有图片摘要：${reference.summary}` : '';
      return `图片${index + 1}：${name}${summary}`;
    })
    .join('\n\n');
}

export function buildImageShotExtractionSystemPrompt(): string {
  return [
    '你是一位专业影视分镜师，当前任务是“从单张图片逆向提取当前镜头信息”。',
    '只记录图片能够证明的画面事实。禁止续写剧情，禁止推算下一镜，禁止把静态图片臆测成确定的运镜或动作结果。',
    '无法从单帧确认的焦段、运镜、时间、人物身份或前后动作，必须标为“无法从单帧确认”，不得虚构。',
    '用户已有文字和补充要求只作为命名、纠错与上下文参考；与图片冲突时以图片可见事实为准。',
    '',
    '输出纯中文，固定使用以下结构：',
    '【场景与时间】地点类型、内外景、日夜/天气；不确定项明确说明。',
    '【景别与机位】景别、视角高度、俯仰关系、主体朝向；焦段感只能写“偏广角/标准/偏长焦”等视觉判断。',
    '【构图与空间】画幅内主体位置、前中后景、视觉焦点、纵深、遮挡、出入口与负空间。',
    '【人物与物件】只列可见人物、服装、姿态、视线、道具、场景物件及空间关系。',
    '【动作与表演】只写当前帧已经成立的动作状态、重心、表情和关系，不写尚未发生的后续动作。',
    '【光影与色彩】主光方向、环境光、明暗层次、主色、点睛色、材质反应与气氛。',
    '【镜头运动判断】能从画面证据支持时写可能性；否则写“静态单帧无法确认运镜”。',
    '【连续性锚点】列出后续镜头必须保持的主体、方向、站位、道具状态、光源方位与空间关系。',
    '【不确定项】集中列出图片无法证明、需要人工补充的信息。',
    '',
    '不要输出 JSON、Markdown 表格、生成模型参数、下一镜建议或新剧情。',
  ].join('\n');
}

export function buildImageShotExtractionUserPrompt(
  sourceText: string,
  references: TextImageReference[],
  instruction = '',
): string {
  return [
    '请读取随请求附带的图片，逆向提取当前画面的分镜信息。',
    '本任务到当前帧为止，不推演后续镜头。',
    '',
    '【图片】',
    imageReferencePrompt(references) || '请直接读取附带图片。',
    '',
    ...(sourceText ? ['【文本卡片已有说明｜仅作上下文】', sourceText, ''] : []),
    ...(instruction ? ['【本次补充要求】', instruction, ''] : []),
  ].join('\n');
}

export function buildStoryboardSkillImageAnalysisSystemPrompt(
  skillName: string,
  skillInstruction: string,
): string {
  return [
    '你是一位负责“单张图片逆向分镜分析”的导演与分镜师。',
    '你必须使用下方分镜 Skill 的导演方法分析图片内容，但本任务不是续写剧本，也不是从当前画面推算下一镜。',
    'Skill 中若要求生成多镜头、镜头表 JSON、宫格文字或扩写剧情，本任务优先级更高：只分析图片当前已经呈现的单镜头事实和导演价值。',
    '不得编造画外人物、隐藏空间、未发生动作、下一镜结果或图片无法证明的剧情。',
    '',
    '固定输出结构：',
    '【画面事实】忠实描述场景、主体、动作状态、构图、光影和色彩。',
    '【场面命题】用一句话概括当前画面的戏剧关系，不新增剧情。',
    '【机制判断】按 Skill 判断当前画面已经体现的主机制/次机制，并说明视觉证据。',
    '【空间结构】分析纵深、高低差、遮挡、出入口、危险边缘、可借力物和力量关系；不存在则明确写无。',
    '【英雄画面】说明当前画面为何成立或缺少什么，不另造新画面。',
    '【镜头执行信息】景别、机位、构图锚点、主体朝向、当前动作状态、光线任务与色彩关系。',
    '【连续性锚点】列出后续制作必须保持的方向、站位、道具、光源、空间和主体状态。',
    '【信息缺口】列出单帧无法判断且需要人工补充的内容。',
    '',
    `【当前分镜 Skill：${skillName}】`,
    skillInstruction,
    '',
    '输出纯中文正文，不要 JSON，不要 Markdown 表格，不要解释执行过程。',
  ].join('\n');
}

export function buildStoryboardSkillImageAnalysisUserPrompt(
  sourceText: string,
  references: TextImageReference[],
  instruction = '',
): string {
  return [
    '请依据随请求附带的图片和已加载的分镜 Skill，完成当前单帧的逆向分镜分析。',
    '仅分析图片内容，不推算下一镜。',
    '',
    '【图片】',
    imageReferencePrompt(references) || '请直接读取附带图片。',
    '',
    ...(sourceText ? ['【文本卡片已有说明｜仅作上下文与纠错】', sourceText, ''] : []),
    ...(instruction ? ['【本次导演要求】', instruction, ''] : []),
  ].join('\n');
}

export function imageTaskLabel(mode: TextImageTaskMode): string {
  if (mode === 'skill_analysis') return '分镜 Skill 分析';
  if (mode === 'continue_shot') return '下一镜推算';
  return '提取当前分镜';
}
