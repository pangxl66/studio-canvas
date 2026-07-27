export type StudioCanvasTimelineInterval = {
  start: number;
  end: number;
};

type TimelineMatch = StudioCanvasTimelineInterval & {
  index: number;
  length: number;
};

const STUDIO_CANVAS_TIMELINE_INTERVAL_RE =
  /(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*(?:至|到|-|—|~|～)\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?(?=\s*(?:[,，;；。]|$))/gi;

function formatTimelineSecond(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function timelineMatches(value: string): TimelineMatch[] {
  return Array.from(value.matchAll(STUDIO_CANVAS_TIMELINE_INTERVAL_RE)).map((match) => ({
    start: Number(match[1]),
    end: Number(match[2]),
    index: match.index,
    length: match[0].length,
  }));
}

export function parseStudioCanvasTimelineIntervals(
  value: string,
): StudioCanvasTimelineInterval[] {
  return timelineMatches(value).map(({ start, end }) => ({ start, end }));
}

function hasContinuousCoverage(
  intervals: StudioCanvasTimelineInterval[],
  duration: number,
): boolean {
  if (!intervals.length) return false;
  const tolerance = 0.01;
  let cursor = 0;
  for (const interval of intervals) {
    if (
      !Number.isFinite(interval.start) ||
      !Number.isFinite(interval.end) ||
      interval.end <= interval.start ||
      Math.abs(interval.start - cursor) > tolerance
    ) {
      return false;
    }
    cursor = interval.end;
  }
  return Math.abs(cursor - duration) <= tolerance;
}

function buildContinuousIntervals(
  matches: TimelineMatch[],
  duration: number,
): StudioCanvasTimelineInterval[] {
  const original = matches.map(({ start, end }) => ({ start, end }));
  if (hasContinuousCoverage(original, duration)) return original;

  const rawWeights = original.map(({ start, end }) =>
    Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0,
  );
  const hasUsableWeights = rawWeights.some((weight) => weight > 0);
  const weights = hasUsableWeights
    ? rawWeights.map((weight) => (weight > 0 ? weight : 1))
    : rawWeights.map(() => 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = 0;
  return weights.map((weight, index) => {
    const start = cursor;
    const end =
      index === weights.length - 1
        ? duration
        : Math.round((cursor + (duration * weight) / totalWeight) * 100) / 100;
    cursor = end;
    return { start, end };
  });
}

function normalizeTimelineBody(body: string, duration: number): string {
  const durationLabel = formatTimelineSecond(duration);
  const matches = timelineMatches(body);
  if (!matches.length) {
    const description = body
      .replace(/总时长\s*\d+(?:\.\d+)?\s*(?:秒|s)\s*[，,；;:]?/gi, '')
      .replace(/^[，,；;\s]+/, '')
      .trim();
    const fallbackDescription =
      description || '保持既定机位、运动方向、主体动作与焦点变化，连续完成本镜头。';
    return `总时长${durationLabel}秒；0至${durationLabel}秒，${fallbackDescription}`;
  }

  const normalizedIntervals = buildContinuousIntervals(matches, duration);
  let normalized = body;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const interval = normalizedIntervals[index];
    const replacement =
      `${formatTimelineSecond(interval.start)}至${formatTimelineSecond(interval.end)}秒`;
    normalized =
      normalized.slice(0, match.index) +
      replacement +
      normalized.slice(match.index + match.length);
  }

  if (/总时长\s*\d+(?:\.\d+)?\s*(?:秒|s)/i.test(normalized)) {
    return normalized.replace(
      /总时长\s*\d+(?:\.\d+)?\s*(?:秒|s)/i,
      `总时长${durationLabel}秒`,
    );
  }
  return `总时长${durationLabel}秒；${normalized.trim()}`;
}

export function repairStudioCanvasV25Timeline(seedanceCard: string): string {
  const card = seedanceCard.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const header = card
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  const duration = Number(
    header?.match(/^【分镜[^|]+\s*\|\s*(\d+(?:\.\d+)?)秒】$/)?.[1],
  );
  if (!Number.isFinite(duration) || duration <= 0) return card;

  const sectionPattern =
    /(^|\n)(摄影机动态参数：)([\s\S]*?)(?=\n镜头参数：)/;
  const match = card.match(sectionPattern);
  if (!match) return card;

  const normalizedBody = normalizeTimelineBody(match[3].trim(), duration);
  return card.replace(
    sectionPattern,
    `${match[1]}${match[2]}${normalizedBody}`,
  );
}
