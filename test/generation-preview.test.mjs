import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  limitModelStreamPreview,
  MODEL_STREAM_PREVIEW_MAX_CHARS,
  storyboardGenerationPhaseCopy,
} from '../src/utils/generationPreview.ts';

const storyboardAgentsSource = readFileSync(
  new URL('../src/agents/storyboardAgents.ts', import.meta.url),
  'utf8',
);

test('model stream preview keeps small payloads intact and truncates old content', () => {
  assert.equal(limitModelStreamPreview('abc'), 'abc');

  const longText = `${'a'.repeat(4_000)}${'b'.repeat(MODEL_STREAM_PREVIEW_MAX_CHARS)}`;
  const limited = limitModelStreamPreview(longText);
  assert.match(limited, /^\[已省略前 4,000 个字符\]/);
  assert.equal(limited.endsWith('b'.repeat(MODEL_STREAM_PREVIEW_MAX_CHARS)), true);
  assert.equal(limited.includes('a'), false);
});

test('storyboard generation phases explain fallback, repair and finalization', () => {
  assert.match(storyboardGenerationPhaseCopy('fallback').message, /兼容模式/);
  assert.match(storyboardGenerationPhaseCopy('repairing').message, /JSON/);
  assert.match(storyboardGenerationPhaseCopy('finalizing').message, /分镜表节点/);
});

test('storyboard requests are auditable and scene parsing does not truncate after 24 scenes', () => {
  assert.match(storyboardAgentsSource, /feature: 'storyboard-generate'/);
  assert.doesNotMatch(storyboardAgentsSource, /slice\(0, 24\)/);
  assert.match(storyboardAgentsSource, /const idMap = new Map/);
  assert.match(storyboardAgentsSource, /inheritsFromShotId/);
  assert.match(storyboardAgentsSource, /countStoryboardSourceScenes/);
});
