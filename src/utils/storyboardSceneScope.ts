import type { StoryboardOutput, WritingOutput } from '@/types/studio';

function extractLeadingJsonObject(text: string): unknown {
  if (!text.startsWith('{')) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char !== '}') continue;
    depth -= 1;
    if (depth !== 0) continue;
    try {
      return JSON.parse(text.slice(0, index + 1)) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

function structuredSceneCount(raw: string): number | null {
  const parsed = extractLeadingJsonObject(raw.trim());
  if (!parsed || typeof parsed !== 'object') return null;
  const scenes = (parsed as Partial<WritingOutput>).scenes;
  return Array.isArray(scenes) ? scenes.length : null;
}

const SCENE_HEADING_PATTERN =
  /^(?:第\s*[一二三四五六七八九十百零\d]+\s*场|场\s*(?:景|次)\s*[一二三四五六七八九十百零\d]*|scene\s*\d+|(?:int|ext)\.|(?:内景|外景|内外景)(?:\s|[·./-]))/i;

export function countStoryboardInputScenes(raw: string): number {
  const text = raw.trim();
  if (!text) return 0;
  const structuredCount = structuredSceneCount(text);
  if (structuredCount != null) return structuredCount;

  const headingCount = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => SCENE_HEADING_PATTERN.test(line)).length;
  return Math.max(1, headingCount);
}

export function storyboardOutputSceneRefs(output: StoryboardOutput): string[] {
  return Array.from(
    new Set(
      output.shots
        .map((shot) => shot.sceneRef?.trim())
        .filter((sceneRef): sceneRef is string => Boolean(sceneRef)),
    ),
  );
}

export function hasMultipleStoryboardOutputScenes(output: StoryboardOutput): boolean {
  return storyboardOutputSceneRefs(output).length > 1;
}
