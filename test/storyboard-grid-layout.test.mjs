import assert from 'node:assert/strict';
import test from 'node:test';
import {
  storyboardGridActionLabel,
  storyboardGridCanvasSize,
  storyboardGridGeometryInstruction,
  storyboardGridLayout,
  storyboardGridPagePanelCounts,
  storyboardGridName,
} from '../src/utils/storyboardGridLayout.ts';
import { storyboardGridImageQuality } from '../src/services/imageGenerationModels.ts';

test('storyboard grid names and layouts follow the exact panel count', () => {
  assert.equal(storyboardGridName(1), '单镜头');
  assert.equal(storyboardGridName(6), '六宫格');
  assert.equal(storyboardGridName(9), '九宫格');
  assert.match(storyboardGridLayout(1), /单幅画面/);
  assert.match(storyboardGridLayout(6), /六个面板/);
  assert.match(storyboardGridLayout(6, '9:16'), /三行两列/);
  assert.equal(storyboardGridCanvasSize(4, '16:9'), '1536x864');
  assert.equal(storyboardGridCanvasSize(9, '16:9'), '1536x864');
  assert.equal(storyboardGridCanvasSize(6, '16:9'), '1536x576');
  assert.equal(storyboardGridCanvasSize(6, '9:16'), '576x1536');
  assert.equal(storyboardGridCanvasSize(6, '21:9'), '1536x576');
  assert.match(storyboardGridGeometryInstruction(6, '21:9'), /21:9/);
  assert.match(storyboardGridGeometryInstruction(6, '16:9'), /整张画布为 8:3/);
  assert.match(storyboardGridGeometryInstruction(6, '16:9'), /宽度 1\/3、高度 1\/2/);
});

test('storyboard shots paginate without padding, repetition, or truncation', () => {
  assert.deepEqual(storyboardGridPagePanelCounts(0), []);
  assert.deepEqual(storyboardGridPagePanelCounts(1), [1]);
  assert.deepEqual(storyboardGridPagePanelCounts(6), [6]);
  assert.deepEqual(storyboardGridPagePanelCounts(9), [9]);
  assert.deepEqual(storyboardGridPagePanelCounts(10), [9, 1]);
  assert.deepEqual(storyboardGridPagePanelCounts(18), [9, 9]);
  assert.deepEqual(storyboardGridPagePanelCounts(20), [9, 9, 2]);
});

test('storyboard image action label reflects shots and generated pages', () => {
  assert.equal(storyboardGridActionLabel(1), '生成单镜头图片');
  assert.equal(storyboardGridActionLabel(6), '生成六宫格图片');
  assert.equal(storyboardGridActionLabel(9), '生成九宫格图片');
  assert.equal(storyboardGridActionLabel(10), '生成 2 张分镜宫格');
});

test('multi-reference storyboard grids use standard quality to avoid upstream timeouts', () => {
  const character = (name) => ({ dataUrl: 'data:image/jpeg;base64,AA==', name, kind: 'character' });
  assert.equal(storyboardGridImageQuality([character('A')]), 'high');
  assert.equal(storyboardGridImageQuality([character('A'), character('B')]), 'high');
  assert.equal(
    storyboardGridImageQuality([character('A'), character('B'), character('C')]),
    'medium',
  );
  assert.equal(
    storyboardGridImageQuality([{ ...character('Layout'), kind: 'layout' }]),
    'medium',
  );
});
