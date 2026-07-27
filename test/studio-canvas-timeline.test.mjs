import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseStudioCanvasTimelineIntervals,
  repairStudioCanvasV25Timeline,
} from '../src/utils/studioCanvasTimeline.ts';

function cardWithTimeline(timeline, duration = 10) {
  return [
    `【分镜1 | ${duration}秒】`,
    '挂载：无',
    '摄影机动态参数：' + timeline,
    '镜头参数：16:9',
  ].join('\n');
}

function repairedTimeline(card) {
  return card.match(/摄影机动态参数：([\s\S]*?)\n镜头参数：/)?.[1] ?? '';
}

test('keeps a valid continuous Studio Canvas 2.5 timeline', () => {
  const repaired = repairStudioCanvasV25Timeline(
    cardWithTimeline('总时长10秒；镜头1，0至3秒，缓推；镜头2，3至6秒，固定；镜头3，6至10秒，后拉。'),
  );
  assert.deepEqual(parseStudioCanvasTimelineIntervals(repairedTimeline(repaired)), [
    { start: 0, end: 3 },
    { start: 3, end: 6 },
    { start: 6, end: 10 },
  ]);
});

test('normalizes common second-before-separator and latin-s interval forms', () => {
  const repaired = repairStudioCanvasV25Timeline(
    cardWithTimeline('镜头1，0秒至3秒，缓推；镜头2，3s-10s，后拉。'),
  );
  assert.match(repaired, /总时长10秒/);
  assert.match(repaired, /0至3秒/);
  assert.match(repaired, /3至10秒/);
});

test('adds a full-duration interval when the model omitted time ranges', () => {
  const repaired = repairStudioCanvasV25Timeline(
    cardWithTimeline('总时长8秒；摄影机缓慢推进后沿原轴线退出。', 8),
  );
  assert.match(
    repairedTimeline(repaired),
    /^总时长8秒；0至8秒，摄影机缓慢推进后沿原轴线退出。$/,
  );
});

test('repairs gaps and preserves the original segment descriptions', () => {
  const repaired = repairStudioCanvasV25Timeline(
    cardWithTimeline('镜头1，0至3秒，缓推到人物；镜头2，5至8秒，沿原轴线后拉。'),
  );
  const timeline = repairedTimeline(repaired);
  assert.deepEqual(parseStudioCanvasTimelineIntervals(timeline), [
    { start: 0, end: 5 },
    { start: 5, end: 10 },
  ]);
  assert.match(timeline, /缓推到人物/);
  assert.match(timeline, /沿原轴线后拉/);
});

test('makes the declared total duration agree with the card header', () => {
  const repaired = repairStudioCanvasV25Timeline(
    cardWithTimeline('总时长15秒；0至4秒，缓推；4至10秒，固定。'),
  );
  assert.match(repairedTimeline(repaired), /^总时长10秒/);
});
