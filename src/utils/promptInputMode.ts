import type { StoryboardOutput } from '@/types/studio';

function summarizeSingleShotDescription(raw: string, maxChars = 140): string {
  const normalized = raw.replace(/\r/g, '').trim();
  if (!normalized) return '文本直连单镜头';
  const headline = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  const source = headline || normalized;
  const clipped = Array.from(source).slice(0, maxChars).join('').trim();
  if (!clipped) return '文本直连单镜头';
  const boundary = Math.max(
    clipped.lastIndexOf('。'),
    clipped.lastIndexOf('！'),
    clipped.lastIndexOf('？'),
    clipped.lastIndexOf('；'),
    clipped.lastIndexOf('，'),
    clipped.lastIndexOf(' '),
  );
  return boundary >= Math.floor(maxChars * 0.55) ? clipped.slice(0, boundary).trim() : clipped;
}

export function looksLikeStructuredPromptInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  return /"shots"\s*:|"narrativeBeats"\s*:|"scenes"\s*:|"episodes"\s*:/.test(trimmed);
}

export function buildPromptSingleShotStoryboardFromText(raw: string): StoryboardOutput | null {
  const trimmed = raw.replace(/\r/g, '').trim();
  if (!trimmed) return null;
  return {
    shots: [
      {
        id: 1,
        type: '中景',
        movement: '固定',
        description: summarizeSingleShotDescription(trimmed),
        content: '',
        sceneRef: '文本直连',
        action: trimmed,
        note: '文本直连单镜头模式：将整段输入视为一个镜头的定稿依据，只生成 1 条 shotPrompt。',
      },
    ],
    narrativeBeats: ['文本直连单镜头：围绕同一画面命题完成生成，不再拆分多镜头。'],
  };
}
