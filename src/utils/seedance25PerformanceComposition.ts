const PERFORMANCE_HEADING = '【表演】';
const TIMELINE_HEADING = '【时间轴】';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripOptionalHeading(body: string, heading: string): string {
  return body
    .replace(new RegExp(`^\\s*${escapeRegExp(heading)}\\s*`), '')
    .trim();
}

function replaceSectionBody(card: string, heading: string, replacement: string): string {
  const headingStart = card.indexOf(heading);
  if (headingStart < 0) {
    throw new Error(`Seedance 2.5 v10 基础卡缺少${heading}。`);
  }

  const bodyStart = headingStart + heading.length;
  const nextHeading = card.indexOf('\n【', bodyStart);
  const bodyEnd = nextHeading < 0 ? card.length : nextHeading;
  const originalBody = card.slice(bodyStart, bodyEnd);
  const leadingWhitespace = originalBody.match(/^\s*/)?.[0] ?? '';
  const trailingWhitespace = originalBody.match(/\s*$/)?.[0] ?? '';
  const normalizedReplacement = stripOptionalHeading(replacement, heading);

  if (!normalizedReplacement) {
    throw new Error(`${heading}模块接管结果为空。`);
  }

  return [
    card.slice(0, bodyStart),
    leadingWhitespace,
    normalizedReplacement,
    trailingWhitespace,
    card.slice(bodyEnd),
  ].join('');
}

/**
 * Deterministically replaces only the v10 Performance and Timeline bodies.
 * Every byte outside these two section bodies is inherited from the base card.
 */
export function composeSeedance25PerformanceCard(
  baseCard: string,
  performance: string,
  timeline: string,
): string {
  const withPerformance = replaceSectionBody(baseCard, PERFORMANCE_HEADING, performance);
  return replaceSectionBody(withPerformance, TIMELINE_HEADING, timeline);
}

/** Test/audit helper: removes only the two replaceable bodies. */
export function seedance25FrozenModuleFingerprint(card: string): string {
  return replaceSectionBody(
    replaceSectionBody(card, PERFORMANCE_HEADING, '__PERFORMANCE__'),
    TIMELINE_HEADING,
    '__TIMELINE__',
  );
}
