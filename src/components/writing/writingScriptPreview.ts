import type { SceneRow, WritingOutput } from '@/types/studio';

export type ScriptLineBlock = { type: 'dialogue' | 'action'; text: string };

export type ScriptSceneSection = {
  globalSceneIndex: number;
  sceneNo: number;
  episodeNo: number | undefined;
  episodeTitle: string | null;
  /** 与上一场相比是否新集，用于纸张预览插入分集标题 */
  isNewEpisode: boolean;
  title: string;
  inOut: string;
  dayNight: string;
  charactersLine: string | null;
  blocks: ScriptLineBlock[];
  /** 对应 WritingOutput.scenes 中条目的稳定键，用于回写 narrativeDraft */
  rowKey: string;
};

export function sceneRowKey(s: SceneRow): string {
  return `${s.episodeId}|${s.episodeNo ?? ''}|${s.sceneNo}`;
}

export function sceneNarrativeSource(s: SceneRow): string {
  const d = (s.narrativeDraft ?? '').trim();
  if (d) return d;
  return [s.coreConflict, s.beat].filter(Boolean).join('\n');
}

function inferInOut(text: string): string {
  const t = text;
  if (/外景|外场|室外|户外|街边|马路|天台外|码头/.test(t)) return '外';
  if (/内景|室内|屋内|车里|车内|舱内/.test(t)) return '内';
  return '内';
}

function inferDayNight(text: string): string {
  const t = text;
  if (/深夜|夜里|夜晚|夜间|晚上|夜景|月色|月光|凌晨|暮色|午夜|子时/.test(t)) return '夜';
  if (/清晨|早晨|上午|正午|午后|白天|日光|黎明|拂晓/.test(t)) return '昼';
  return '昼';
}

/** 将场次说明拆成「动作 / 对话」块，便于纸张预览排版 */
export function splitNarrativeToBlocks(narrative: string): ScriptLineBlock[] {
  const raw = narrative.trim();
  if (!raw) return [];
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const blocks: ScriptLineBlock[] = [];
  for (const line of lines) {
    if (/^「[^」]+」$/.test(line) || /^".*"$/.test(line) || /^（[^）]{1,80}）$/.test(line)) {
      blocks.push({ type: 'dialogue', text: line });
      continue;
    }
    if (/^[^:：\n]{1,20}[：:]\s*\S+/.test(line)) {
      blocks.push({ type: 'dialogue', text: line });
      continue;
    }
    blocks.push({ type: 'action', text: line });
  }
  if (blocks.length === 0) blocks.push({ type: 'action', text: raw });
  return blocks;
}

/** 纯文本摘要（供 safeScript 等兜底展示） */
export function formatWritingDataDump(o: WritingOutput): string {
  const plan =
    o.plannedEpisodeCount != null ? `规划总集数：${o.plannedEpisodeCount}\n\n` : '';
  const ep = o.episodes
    .map((e) => {
      const n = e.episodeNo != null ? `第${e.episodeNo}集 ` : '';
      return `【${n}${e.title}】\n${e.summary}`;
    })
    .join('\n\n');
  const sc = o.scenes
    .map((s) => {
      const en = s.episodeNo != null ? `E${s.episodeNo}` : '';
      const c = s.coreConflict ?? s.beat ?? '';
      const ch = s.characters?.length ? `｜角色：${s.characters.join('、')}` : '';
      return `${en}·场${s.sceneNo} ${s.title} — ${c}${ch}`;
    })
    .join('\n');
  return `${plan}${ep}\n\n—— 场次表（场景 / 核心冲突 / 登场角色）——\n${sc}`;
}

export function sortWritingScenes(scenes: SceneRow[]): SceneRow[] {
  return [...scenes].sort((a, b) => {
    const an = a.episodeNo ?? 0;
    const bn = b.episodeNo ?? 0;
    if (an !== bn) return an - bn;
    return a.sceneNo - b.sceneNo;
  });
}

function episodeTitleForScene(output: WritingOutput, s: SceneRow): string | null {
  const ep = output.episodes?.find((e) => e.id === s.episodeId || e.episodeNo === s.episodeNo);
  if (!ep) return null;
  const n = ep.episodeNo != null ? `第${ep.episodeNo}集 ` : '';
  return `${n}${ep.title}`.trim();
}

export function buildWritingScriptSections(output: WritingOutput): ScriptSceneSection[] {
  const sorted = sortWritingScenes(output.scenes ?? []);
  let prevEpKey: string | number | undefined;
  return sorted.map((s, i) => {
    const narrative = sceneNarrativeSource(s);
    const blob = `${s.title}\n${narrative}`;
    const inOut = inferInOut(blob);
    const dayNight = inferDayNight(blob);
    const blocks = splitNarrativeToBlocks(narrative);
    const ch = s.characters?.filter(Boolean).length
      ? `登场：${s.characters!.filter(Boolean).join('、')}`
      : null;
    const epKey = s.episodeNo ?? s.episodeId ?? '—';
    const isNewEpisode = i === 0 || epKey !== prevEpKey;
    prevEpKey = epKey;
    return {
      globalSceneIndex: i + 1,
      sceneNo: s.sceneNo,
      episodeNo: s.episodeNo,
      episodeTitle: episodeTitleForScene(output, s),
      isNewEpisode,
      title: s.title,
      inOut,
      dayNight,
      charactersLine: ch,
      blocks,
      rowKey: sceneRowKey(s),
    };
  });
}
