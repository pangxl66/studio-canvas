import type { WritingExportTemplateKind } from '@/components/writing/writingExportSkillBridge';
import type { WritingOutput } from '@/types/studio';
import { buildWritingScriptSections, sceneRowKey, type ScriptSceneSection } from './writingScriptPreview';

export type StandardScriptCover = {
  title: string;
  subtitle: string;
  lines: string[];
};

export type StandardScriptOutlineItem = {
  episodeNo?: number;
  title: string;
  summary: string;
};

export type StandardScriptSceneBlock = { kind: 'action' | 'dialogue'; text: string };

export type StandardScriptScene = {
  globalIndex: number;
  sceneNo: number;
  episodeNo?: number;
  episodeTitle: string | null;
  isNewEpisode: boolean;
  /** 第[X]场　场景名　内/外　昼/夜 */
  headingLine: string;
  /** 场景名（不含场次号） */
  sceneTitle: string;
  /** 内 / 外 */
  inOut: string;
  /** 昼 / 夜 */
  dayNight: string;
  charactersLine: string | null;
  blocks: StandardScriptSceneBlock[];
  /** 勾选「分镜建议」时写入；否则为 null */
  storyboardComment: string | null;
};

export type StandardScriptDocument = {
  cover: StandardScriptCover;
  plannedEpisodeCount?: number;
  outline: StandardScriptOutlineItem[];
  scenes: StandardScriptScene[];
  /** 导出构建用（与挂载 Skill 一致） */
  exportTemplate: WritingExportTemplateKind;
};

function heuristicStoryboardNote(sec: ScriptSceneSection): string {
  const place = sec.inOut === '外' ? '外景广角建立场地' : '内景交代空间层次';
  return `【分镜】${place}；${sec.title}场以人物关系入戏，对白建议正反打，高潮保留镜头调度余地（供分镜部细化）。`;
}

function sortEpisodesByNo(episodes: WritingOutput['episodes']) {
  return [...(episodes ?? [])].sort((a, b) => (a.episodeNo ?? 0) - (b.episodeNo ?? 0));
}

export type FormatStandardScriptOptions = {
  template?: WritingExportTemplateKind;
  includeStoryboardNotes?: boolean;
};

/**
 * 将编剧部 AI 生成的场次 JSON（WritingOutput）转为标准剧本文档结构，
 * 并可供导出为纯文本 / Word / PDF。
 */
export function formatToStandardScript(
  output: WritingOutput,
  meta: { workTitle: string },
  opts?: FormatStandardScriptOptions,
): StandardScriptDocument {
  const exportTemplate = opts?.template ?? 'standard';
  const includeStoryboardNotes = opts?.includeStoryboardNotes ?? false;

  const sections = buildWritingScriptSections(output);
  const outline = sortEpisodesByNo(output.episodes).map((e) => ({
    episodeNo: e.episodeNo,
    title: e.title,
    summary: (e.summary ?? '').trim(),
  }));

  const scenes: StandardScriptScene[] = sections.map((sec) => {
    const row = output.scenes.find((s) => sceneRowKey(s) === sec.rowKey);
    let storyboardComment: string | null = null;
    if (includeStoryboardNotes) {
      const raw = row?.storyboardSuggestion?.trim();
      storyboardComment = raw || heuristicStoryboardNote(sec);
    }
    return {
      globalIndex: sec.globalSceneIndex,
      sceneNo: sec.sceneNo,
      episodeNo: sec.episodeNo,
      episodeTitle: sec.episodeTitle,
      isNewEpisode: sec.isNewEpisode,
      headingLine: `第${sec.globalSceneIndex}场　${sec.title}　${sec.inOut}　${sec.dayNight}`,
      sceneTitle: sec.title,
      inOut: sec.inOut,
      dayNight: sec.dayNight,
      charactersLine: sec.charactersLine,
      blocks: sec.blocks.map((b) => ({ kind: b.type, text: b.text })),
      storyboardComment,
    };
  });

  const dateStr = new Date().toLocaleDateString('zh-CN', { dateStyle: 'long' });
  const coverLines: string[] = [];
  if (output.plannedEpisodeCount != null) {
    coverLines.push(`规划总集数：${output.plannedEpisodeCount}`);
  }
  coverLines.push(`导出日期：${dateStr}`);
  coverLines.push('本文件由 Studio Canvas 编剧部节点根据场次 JSON 自动生成');

  const subtitle =
    exportTemplate === 'vertical_short'
      ? '竖屏短剧剧本（模版 · 约 1–2 分钟/页 节拍）'
      : exportTemplate === 'hollywood'
        ? '电影长片剧本（好莱坞阅读格式）'
        : '文学剧本（结构化导出）';

  return {
    cover: {
      title: meta.workTitle.trim() || '未命名剧本',
      subtitle,
      lines: coverLines,
    },
    plannedEpisodeCount: output.plannedEpisodeCount,
    outline,
    scenes,
    exportTemplate,
  };
}

/** 标准文本流（纯文本），便于校验或接入其它工具链 */
export function standardScriptToPlainText(doc: StandardScriptDocument): string {
  const lines: string[] = [];
  lines.push(doc.cover.title, '');
  lines.push(doc.cover.subtitle);
  for (const l of doc.cover.lines) lines.push(l);
  lines.push('', '━━━━━━━━ 集数大纲 ━━━━━━━━', '');
  for (const ep of doc.outline) {
    const n = ep.episodeNo != null ? `第${ep.episodeNo}集 ` : '';
    lines.push(`【${n}${ep.title}】`, ep.summary || '（无梗概）', '');
  }
  lines.push('━━━━━━━━ 分场正文 ━━━━━━━━', '');
  for (const sc of doc.scenes) {
    if (sc.isNewEpisode && sc.episodeTitle) {
      lines.push('', `—— ${sc.episodeTitle} ——`, '');
    }
    lines.push(sc.headingLine);
    if (sc.charactersLine) lines.push(sc.charactersLine);
    if (sc.storyboardComment) {
      lines.push(`〔分镜建议〕${sc.storyboardComment}`);
    }
    for (const b of sc.blocks) {
      lines.push(b.kind === 'dialogue' ? `　　　　${b.text}` : `　　${b.text}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}
