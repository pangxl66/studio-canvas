import assert from 'node:assert/strict';
import test from 'node:test';
import { imageNodeLayout } from '../src/utils/imageNodeLayout.ts';

test('portrait image node preserves the imported image ratio', () => {
  const layout = imageNodeLayout(3072, 5504);
  assert.equal(layout.nodeWidth, 360);
  assert.equal(layout.preservesSourceRatio, true);
  assert.ok(Math.abs(layout.nodeWidth / layout.mediaHeight - 3072 / 5504) < 0.002);
});

test('landscape and square images receive suitable node dimensions', () => {
  assert.deepEqual(
    { width: imageNodeLayout(1920, 1080).nodeWidth, height: imageNodeLayout(1920, 1080).mediaHeight },
    { width: 560, height: 315 },
  );
  assert.deepEqual(
    { width: imageNodeLayout(1024, 1024).nodeWidth, height: imageNodeLayout(1024, 1024).mediaHeight },
    { width: 480, height: 480 },
  );
});

test('extreme image ratios are bounded without stretching the image', () => {
  const tall = imageNodeLayout(400, 2000);
  const wide = imageNodeLayout(4000, 500);
  assert.equal(tall.mediaHeight, 680);
  assert.equal(wide.mediaHeight, 220);
  assert.equal(tall.preservesSourceRatio, false);
  assert.equal(wide.preservesSourceRatio, false);
});
