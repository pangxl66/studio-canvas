import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ensureSeedance25CameraModel,
  extractSeedance25CameraModel,
  selectSeedance25CameraModel,
} from '../src/utils/seedance25Camera.ts';

const card = (cameraBody, scene = '室内日景') => `【Seedance 2.5｜多模态参考生成】

挂载： |@=场景|

【生成规格】
时长：3秒

【摄影机 / 镜头】
${cameraBody}

【机位与构图】
${scene}，中景平视。

【起幅】
人物站定。

【时间轴】
[0.0s–3.0s] 人物抬头。

【声音 / 对白】
环境声。

【最终落幅】
人物保持注视。

【文字与字幕限制】
不生成字幕。`;

test('adds a concrete camera model without rewriting the existing camera instructions', () => {
  const source = card('近景｜平视正拍｜50mm｜T2.8｜浅景深');
  const result = ensureSeedance25CameraModel(source);

  assert.equal(result.added, true);
  assert.equal(result.cameraModel, 'ARRI ALEXA 35');
  assert.match(result.card, /【摄影机 \/ 镜头】\n摄影机：ARRI ALEXA 35\n近景｜平视正拍｜50mm｜T2\.8｜浅景深/);
  assert.match(result.card, /【最终落幅】\n人物保持注视。/);
});

test('preserves an explicit camera model exactly', () => {
  const source = card('摄影机：RED V-RAPTOR XL\nCooke S8/i｜50mm｜T2.8｜浅景深');
  const result = ensureSeedance25CameraModel(source, 'ARRI ALEXA 35');

  assert.equal(result.added, false);
  assert.equal(result.cameraModel, 'RED V-RAPTOR XL');
  assert.equal(result.card, source);
});

test('does not mistake focal length or generic camera wording for a body model', () => {
  assert.equal(extractSeedance25CameraModel(card('摄影机：50mm\nT2.8｜浅景深')), null);
  assert.equal(extractSeedance25CameraModel(card('摄影机：数字电影摄影机\n50mm｜T2.8')), null);
});

test('inherits the scene camera before selecting a fallback', () => {
  const result = ensureSeedance25CameraModel(
    card('中景｜手持跟拍｜35mm｜T2.8｜中浅景深', '地下船坞夜景'),
    'ARRI ALEXA Mini LF',
  );

  assert.equal(result.cameraModel, 'ARRI ALEXA Mini LF');
  assert.equal(extractSeedance25CameraModel(result.card), 'ARRI ALEXA Mini LF');
});

test('selects a task-aware deterministic fallback', () => {
  assert.equal(selectSeedance25CameraModel(card('Probe 探针镜头进入机械缝隙')), 'ARRI ALEXA Mini LF');
  assert.equal(selectSeedance25CameraModel(card('中景跟拍', '地下船坞低照度夜景')), 'Sony VENICE 2');
  assert.equal(selectSeedance25CameraModel(card('中景跟拍', '室内日景')), 'ARRI ALEXA 35');
});
