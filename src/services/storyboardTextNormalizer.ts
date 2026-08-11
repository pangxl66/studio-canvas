import type { TextImageReference } from '@/services/textImageTaskPrompts';

export const STORYBOARD_TEXT_NORMALIZER_SKILL_ID = 'storyboard-shot-normalizer-zh';
export const STORYBOARD_TEXT_NORMALIZER_SKILL_NAME = '影视执行型分镜规范化';
export const STORYBOARD_TEXT_NORMALIZER_SKILL_VERSION = '1.0.1';

export type StoryboardTextNormalizerValidation = {
  ok: boolean;
  issues: string[];
};

function referenceList(references: TextImageReference[]): string {
  if (!references.length) return '无图片；仅整理文本。';
  return references
    .map((reference, index) => {
      const name = reference.fileName || reference.label || `图片${index + 1}`;
      const summary = reference.summary?.trim()
        ? `\n已有摘要（仅供交叉核对，不能替代图片）：${reference.summary.trim()}`
        : '';
      return `图片${index + 1}：${name}${summary}`;
    })
    .join('\n\n');
}

/**
 * “基础分镜优化”规范的模型指令。它只做整理、校正和缺口标记，不承担续写。
 */
export function buildStoryboardTextNormalizerSystemPrompt(): string {
  return [
    `【已加载 Skill】${STORYBOARD_TEXT_NORMALIZER_SKILL_NAME}（${STORYBOARD_TEXT_NORMALIZER_SKILL_ID} v${STORYBOARD_TEXT_NORMALIZER_SKILL_VERSION}）`,
    '你是一名影视分镜执行稿整理助手。用户会提交文字版分镜、表格复制文本、Excel/制片表截图、分镜截图或零散镜头描述。',
    '输出必须可直接用于导演与摄影执行、分镜图设计、AI 生图/视频提示词整理，以及剪辑和声音部门理解镜头意图。',
    '',
    '【最高优先级】不改剧情、不改数据、不做过度创作；只校正术语、明确空间、梳理动作、补全落点。',
    '必须保留原始镜头顺序、场次、镜号、制作编号、时长、场景名、景别、角度、运镜、台词和声音。不得合并、拆分、删除或新增镜头，除非用户明确要求。',
    '图片与文字冲突时，只能用图片中清晰可辨的事实校正；无法确认的内容标记“识别待确认”或“待确认”，禁止猜测。',
    '多张表格或截图按镜号/制作编号排序；表头只用于识别字段，不得误写进镜头正文。',
    '',
    '【每个镜头的整理顺序】',
    '1. 场次、时间、内外景；2. 镜号与制作编号；3. 时长；4. 场景；5. 景别；6. 机位角度；7. 摄影方式或运动；',
    '8. 摄影机位置与空间关系；9. 主体动作的起点、过程和结果；10. 人物状态与必要表演落点；',
    '11. 仅在原文提供或镜头理解必须时写灯光与环境氛围；12. 台词；13. 声音；14. 镜头结束状态。',
    '',
    '【固定输出格式｜Markdown，不使用表格】',
    '# 01场｜夜｜内',
    '',
    '### 镜头10｜WGZR_01_0100｜时长：2秒',
    '**场景：场景名称**',
    '**中景｜平视背拍｜手持呼吸感**',
    '摄影机位于……，以……拍摄……。画面中……',
    '主体从……开始，随后……，最终……',
    '镜头在……状态下结束。',
    '**角色名：**“原文台词”',
    '**声音：**原文声音或对理解镜头必要的最小动作声。',
    '',
    '---',
    '',
    '机位、动作和结束状态必须写成上面的自然执行段落，不要擅自改成“机位/动作/结束状态”字段清单。',
    '没有台词时不显示台词字段；没有声音信息时可以省略声音字段，不得强行写“无”。',
    '',
    '【摄影与空间术语】',
    '优先使用平视正拍、平视背拍、平视侧拍、低机位仰拍、高机位俯拍、正面微俯拍、门外反打、镜面反射构图、存放格内部视角、固定镜头、手持呼吸感、缓慢推镜、拉镜、横移、跟拍、上摇、下摇、环绕等明确术语。',
    '“手持呼吸感”只能表示随摄影者呼吸产生轻微、不规则的上下浮动，不得改写为剧烈摇晃、纪实乱晃或动作片抖动。',
    '必须尽量明确摄影机在人物前方、后方、侧前方或门外，主体在画面左/右，人物朝向与视线方向，前中后景、遮挡、门板与镜面关系；不得只写“从右边过来”“往里面拍”等模糊表达。',
    '',
    '【动作与表演】',
    '动作必须按“起始状态—动作过程—结果/反应—镜头落点”完整整理。不要把一个动作拆成导演未要求的大量细节。',
    '表演只整理原文或图片能够证明的停顿、视线、呼吸、表情、重心和反应，不新增情绪转折。',
    '',
    '【必须保留与默认删除】',
    '保留原镜头顺序、场次、镜号、制作编号、时长、原场景名称、景别、角度、摄影运动、原台词、语气要求和声音设计。',
    '默认删除焦段、镜头毫米数、光圈、ISO、快门、机型、镜头型号和传感器规格；景别、机位角度、摄影方式和摄影机运动必须保留。只有用户明确要求时才恢复相机参数。',
    '',
    '【禁止事项】',
    '不得增加新角色、新道具或新事件；不新增音乐、旁白或台词；不得改变人物站位、动作结果、时长、景别和原意；不得把简单镜头扩写成导演阐述。',
    '不得用“可能”“大概”“似乎”把未确认内容伪装成判断；未确认信息必须明确标记待确认。',
    '',
    '【缺失信息】',
    '时长缺失写“时长：待定”；场景缺失写“场景：待确认”；时间缺失写“时间待确认”；内外景缺失写“内外景待确认”；截图不清写“识别待确认”。',
    '只有缺失信息会导致镜头无法理解时，才在全部镜头后添加“## 待确认项”并逐条列出；不要因少量缺失拒绝整理。',
    '',
    '【连续性内部检查】',
    '检查相邻镜头的动作承接、道具状态、人物朝向、场景切换、声音延续，以及机器/门/灯状态。同一人物和已确认场景名称必须统一。发现冲突时按原文整理，并在待确认项标出，不得擅自修剧情。',
    '',
    '【台词与声音】',
    '台词必须单独成行且不得改写，除非修正明显错别字。语气说明紧跟台词。声音按镜头内实际顺序简洁排列，并体现动作结果；不得擅自增加音乐、旁白或重大剧情音效。',
    '',
    '【输出风格】',
    '使用简体中文，专业、直白、以执行信息为主；每个镜头通常写 3 至 5 个短段落。不要输出冗长分析、工作流程、JSON、Markdown 表格或主动追问。',
    '只输出整理后的分镜正文。最终再次执行：不改剧情、不改数据、不做过度创作；只校正术语、明确空间、梳理动作、补全落点。',
  ].join('\n');
}

export function buildStoryboardTextNormalizerUserPrompt(
  sourceText: string,
  references: TextImageReference[] = [],
  instruction = '',
): string {
  const hasImages = references.length > 0;
  return [
    hasImages
      ? '请先逐张读取随请求附带的图片，识别其中的分镜表字段和画面信息，再与已有文字交叉核对并整理为规范分镜。'
      : '请将下面的已有文字整理为规范分镜。',
    hasImages
      ? '图片只用于提取能够直接看清的字段与画面事实；看不清、被裁切或有歧义的内容必须写“识别待确认”。不要根据图片续写下一镜。'
      : '只整理已有信息，不补写新剧情，不生成下一镜。',
    '',
    ...(hasImages ? ['【图片清单】', referenceList(references), ''] : []),
    '【待整理文本】',
    sourceText.trim() || '无额外文字；请仅整理图片中可识别的分镜信息。',
    '',
    ...(instruction.trim() ? ['【本次补充要求】', instruction.trim(), ''] : []),
    '请严格按镜号/制作编号排序并使用规定的 Markdown 镜头格式输出。',
  ].join('\n');
}

export function validateStoryboardTextNormalizerOutput(
  raw: string,
): StoryboardTextNormalizerValidation {
  const text = raw.trim();
  const issues: string[] = [];
  if (!/^#\s*[^\n｜]+｜[^\n｜]+｜[^\n｜]+$/m.test(text)) {
    issues.push('缺少“# 场次｜时间｜内外景”标题');
  }
  const shotBlocks = text.split(/(?=^###\s*镜头)/m).filter((block) => /^###\s*镜头/m.test(block));
  if (!shotBlocks.length) issues.push('缺少镜头标题');
  shotBlocks.forEach((block, index) => {
    const label = `第 ${index + 1} 个镜头`;
    if (!/^###\s*镜头[^\n｜]*｜[^\n｜]+｜时长：[^\n]+$/m.test(block)) {
      issues.push(`${label}缺少镜号、制作编号或时长`);
    }
    if (!/^\*\*场景：[^\n*]+\*\*$/m.test(block)) {
      issues.push(`${label}缺少场景字段`);
    }
    if (!/^\*\*[^\n*｜]+｜[^\n*｜]+｜[^\n*｜]+\*\*$/m.test(block)) {
      issues.push(`${label}缺少“景别｜机位角度｜摄影方式”`);
    }
    if (!/(?:镜头|画面).{0,40}(?:结束|落点|停留|收住)/s.test(block)) {
      issues.push(`${label}缺少明确的镜头结束状态`);
    }
  });
  if (/^\s*\|.+\|\s*$/m.test(text)) issues.push('错误使用 Markdown 表格');
  if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(text)) issues.push('错误输出 JSON');
  return { ok: issues.length === 0, issues };
}

export function buildStoryboardTextNormalizerRepairPrompt(
  candidate: string,
  issues: string[],
): string {
  return [
    '下面是同一模型刚生成的候选分镜。它没有完全通过已加载 Skill 的格式校验。',
    '只允许重新整理格式和措辞，不得新增、删除、合并或拆分镜头，不得改变任何已识别事实、数字、专名、台词和声音。',
    '修复后只输出分镜正文。',
    '',
    '【必须修复】',
    ...issues.map((issue) => `- ${issue}`),
    '',
    '【候选分镜】',
    candidate.trim(),
  ].join('\n');
}
