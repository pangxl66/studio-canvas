import type { VideoPromptImageAnalysis, VideoPromptPanelAnalysis } from '@/types/studio';

export const VIDEO_PROMPT_DEFAULT_DURATION_SEC = 15;
export const VIDEO_PROMPT_PREVIEW_MAX_CHARS = 6000;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finitePanelIndex(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function stripJsonWrapper(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  return firstBrace >= 0 && lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1) : text;
}

export function hashVideoPromptSource(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  const value = parts.join('|');
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function resolveVideoPromptDurationSec(
  requestedDurationSec?: number,
  sourceDurationSec?: number,
): number {
  const requested = Number(requestedDurationSec);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.max(1, Math.round(requested * 10) / 10);
  }
  const source = Number(sourceDurationSec);
  if (Number.isFinite(source) && source > 0) {
    return Math.max(1, Math.round(source * 10) / 10);
  }
  return VIDEO_PROMPT_DEFAULT_DURATION_SEC;
}

export function buildVideoPromptAnalysisSystemPrompt(expectedPanelCount: number): string {
  return [
    'You are the vision-analysis stage of a storyboard-to-video pipeline.',
    'Analyze the attached rendered storyboard grid. Do not write the final video prompt yet.',
    `Read exactly ${expectedPanelCount} visible panels from left to right and top to bottom.`,
    'Visible image facts control appearance, composition, lighting, prop position, pose, gaze and spatial direction.',
    'The supplied shot facts control intended movement, duration, dialogue and sound. Never infer those from unreadable labels.',
    'Performance must be observable and executable: gaze, breath, micro-expression, shoulders, body weight, head angle, hands, prop interaction, distance, tempo and force.',
    'Do not use abstract emotion words without visible behavior. Do not invent crying, hugging, fighting, falling or destruction.',
    'Return only one JSON object. No markdown and no explanation.',
    'Required JSON schema:',
    JSON.stringify({
      readingOrder: 'left-to-right, top-to-bottom',
      sceneSummary: 'one concise scene description',
      globalVisualLock: 'identity, wardrobe, location, props, palette and lighting that must not drift',
      performanceBaseline: 'overall acting style, intensity and recurring physical behavior',
      spatialContinuity: 'screen direction and geography shared by all panels',
      panels: [
        {
          panelIndex: 1,
          sourceShotId: 'optional upstream shot id',
          visualSummary: 'only visible facts',
          camera: 'framing, angle and visible camera relationship',
          performance: 'concrete playable acting beat',
          gaze: 'gaze target and change',
          bodyLanguage: 'weight, shoulders, head and interpersonal distance',
          handAction: 'left/right hand and prop action',
          startState: 'pose at the beginning of this panel beat',
          endState: 'pose that the next panel must inherit',
          continuity: 'what must carry into the next panel',
          uncertainty: 'only when the image cannot prove something',
        },
      ],
      uncertainties: ['facts that need upstream metadata rather than visual guessing'],
    }),
  ].join('\n');
}

export function buildVideoPromptAnalysisUserPrompt(input: {
  imageLabel: string;
  expectedPanelCount: number;
  panelMappingText: string;
  storyboardFacts: string;
}): string {
  return [
    `Rendered storyboard image: ${input.imageLabel}`,
    `Expected visible panel count: ${input.expectedPanelCount}`,
    'Panel mapping supplied by the application:',
    input.panelMappingText || 'No explicit panel mapping was preserved; use visible reading order only.',
    '',
    'Upstream shot facts. Use these only for intent, motion, duration, dialogue and sound:',
    input.storyboardFacts || 'No upstream shot facts were preserved.',
  ].join('\n');
}

function normalizePanel(raw: unknown): VideoPromptPanelAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const panelIndex = finitePanelIndex(value.panelIndex);
  if (panelIndex == null) return null;
  return {
    panelIndex,
    sourceShotId: asText(value.sourceShotId) || undefined,
    visualSummary: asText(value.visualSummary),
    camera: asText(value.camera),
    performance: asText(value.performance),
    gaze: asText(value.gaze),
    bodyLanguage: asText(value.bodyLanguage),
    handAction: asText(value.handAction),
    startState: asText(value.startState),
    endState: asText(value.endState),
    continuity: asText(value.continuity),
    uncertainty: asText(value.uncertainty) || undefined,
  };
}

export function parseVideoPromptImageAnalysis(
  raw: string,
  input: {
    expectedPanelCount: number;
    sourceImageNodeId: string;
    sourceImageSignature: string;
    analyzedAt?: number;
  },
): VideoPromptImageAnalysis {
  const parsed = JSON.parse(stripJsonWrapper(raw)) as Record<string, unknown>;
  const panels = Array.isArray(parsed.panels)
    ? parsed.panels.map(normalizePanel).filter((panel): panel is VideoPromptPanelAnalysis => panel != null)
    : [];
  const uniquePanels = [...new Map(panels.map((panel) => [panel.panelIndex, panel])).values()]
    .filter((panel) => panel.panelIndex <= input.expectedPanelCount)
    .sort((a, b) => a.panelIndex - b.panelIndex);
  if (uniquePanels.length !== input.expectedPanelCount) {
    throw new Error(`图片分析只识别到 ${uniquePanels.length}/${input.expectedPanelCount} 个有效面板。`);
  }
  for (const panel of uniquePanels) {
    if (!panel.visualSummary || !panel.performance || !panel.startState || !panel.endState) {
      throw new Error(`图片分析缺少面板 ${panel.panelIndex} 的画面、表演或起止状态。`);
    }
  }
  return {
    readingOrder: asText(parsed.readingOrder) || '从左到右、从上到下',
    sceneSummary: asText(parsed.sceneSummary),
    globalVisualLock: asText(parsed.globalVisualLock),
    performanceBaseline: asText(parsed.performanceBaseline),
    spatialContinuity: asText(parsed.spatialContinuity),
    panels: uniquePanels,
    uncertainties: Array.isArray(parsed.uncertainties)
      ? parsed.uncertainties.map(asText).filter(Boolean)
      : [],
    sourceImageNodeId: input.sourceImageNodeId,
    sourceImageSignature: input.sourceImageSignature,
    analyzedAt: input.analyzedAt ?? Date.now(),
  };
}

export function buildVideoPromptCompositionUserPrompt(input: {
  analysis: VideoPromptImageAnalysis;
  mode: 'B' | 'C';
  durationSec: number;
  imageReferenceLines: string[];
  storyboardFacts: string;
  sourceDurationSec?: number;
}): string {
  const sourceDurationNote =
    typeof input.sourceDurationSec === 'number' && input.sourceDurationSec > input.durationSec
      ? `The upstream shots total ${input.sourceDurationSec}s. The user selected ${input.durationSec}s; compress pacing without dropping or reordering panels.`
      : '';
  return [
    `Mode: Variant ${input.mode} — rendered storyboard grid${input.mode === 'C' ? ' plus character references' : ''}.`,
    `Total duration: ${input.durationSec} seconds. The timeline must cover it continuously.`,
    sourceDurationNote,
    'Reference numbering:',
    ...input.imageReferenceLines,
    '',
    'Verified visual and performance analysis:',
    JSON.stringify(input.analysis, null, 2),
    '',
    'Upstream shot facts for motion, timing, dialogue and sound:',
    input.storyboardFacts || 'No additional shot facts.',
    '',
    'Compose the final paste-ready video prompt now. Include every panel exactly once and preserve every start/end performance handoff.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function validateVideoPromptText(
  text: string,
  expectedPanelCount: number,
): string[] {
  const issues: string[] = [];
  const normalized = text.trim();
  if (!normalized) return ['模型没有返回视频提示词。'];
  for (const heading of [
    'REFERENCE',
    'FORMAT',
    'VISUAL LOCK',
    'PERFORMANCE BASELINE',
    'TIMELINE',
    'AUDIO',
    'CONTINUITY',
    'NEGATIVE',
  ]) {
    if (!normalized.includes(heading)) issues.push(`缺少 ${heading} 模块。`);
  }
  for (let panelIndex = 1; panelIndex <= expectedPanelCount; panelIndex += 1) {
    if (!new RegExp(`面板\\s*${panelIndex}(?!\\d)`, 'u').test(normalized)) {
      issues.push(`时间轴没有明确覆盖面板 ${panelIndex}。`);
    }
  }
  if (/\[[A-Z_ -]{3,}\]|\{[^{}]+\}/.test(normalized)) issues.push('输出仍包含未填写占位符。');
  if (/^```|```$/m.test(normalized)) issues.push('输出不应包含代码围栏。');
  return issues;
}
