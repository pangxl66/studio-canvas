import type { SceneRow } from '@/types/studio';

/** 从节拍文中启发式提取「钩子」类表述 */
function hookFromBeat(beat?: string): string {
  const t = (beat ?? '').trim();
  if (!t) return '';
  const labeled = t.match(
    /(?:钩子|悬念|反转|伏笔|章末|下集预告|待续|卡点)[：:]\s*([^\n]+)/,
  );
  if (labeled?.[1]) return labeled[1].trim();
  const lines = t
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const last = lines[lines.length - 1];
    if (last.length <= 220) return last;
  }
  if (t.length <= 220) return t;
  return `${t.slice(0, 200)}…`;
}

function conflictFallback(s: SceneRow): string {
  const beat = (s.beat ?? '').trim();
  if (!beat) return '';
  const first = beat.split(/\n/)[0]?.trim() ?? '';
  return first.slice(0, 360);
}

/**
 * 供 Leader 快速扫读：冲突点优先 coreConflict，钩子优先 storyHook，否则从 beat 提取。
 */
export function extractSceneLeaderHighlights(s: SceneRow): { conflict: string; hook: string } {
  const conflict = (s.coreConflict ?? '').trim() || conflictFallback(s);
  const hook = (s.storyHook ?? '').trim() || hookFromBeat(s.beat);
  return {
    conflict: conflict || '（本场冲突见正文或 AI 未单列 coreConflict）',
    hook: hook || '（钩子/悬念见正文或节拍）',
  };
}
