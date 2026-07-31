import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildShipLightingPalettePrompt,
  lightingPaletteTitle,
  normalizeLightingPaletteSceneName,
  SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT,
  SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH,
  SHIP_LIGHTING_PALETTE_REQUEST_SIZE,
  SHIP_LIGHTING_PALETTE_SKILL_ID,
} from '../src/services/shipLightingPaletteContract.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('palette prompt identifies and names the current scene while preserving the layout contract', () => {
  const prompt = buildShipLightingPalettePrompt('ship-reference.png', '飞船内景');

  assert.equal(SHIP_LIGHTING_PALETTE_SKILL_ID, 'scene-lighting-palette@1.1.0');
  assert.equal(SHIP_LIGHTING_PALETTE_REQUEST_SIZE, '1536x864');
  assert.equal(SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH, 1920);
  assert.equal(SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT, 1080);
  assert.match(prompt, /参考图 1“ship-reference\.png”已经过场景识别/);
  assert.match(prompt, /参考图 2 是固定版式模板/);
  assert.equal(prompt.includes('飞船内景色表  /  Extracted Color Palette'), true);
  assert.equal(prompt.includes('A. 画面主导色  /  Dominant palette'), true);
  assert.match(prompt, /20 个主导色/);
  assert.match(prompt, /四列×五行/);
  assert.equal(prompt.includes('B. 灯光与高光色  /  Practical & highlight colors'), true);
  assert.match(prompt, /4 个代表性灯光或高光色/);
  assert.match(prompt, /严禁凭空编造/);
  assert.match(prompt, /色彩比例基于原图像素聚类/);
  assert.match(prompt, /不得把所有图片都写成舱壁、舱道或飞船设备/);
});

test('scene names are normalized to one consistent palette title', () => {
  assert.equal(
    normalizeLightingPaletteSceneName('{"sceneName":"飞船内景"}'),
    '飞船内景',
  );
  assert.equal(lightingPaletteTitle('飞船内景灯光色表'), '飞船内景色表');
  assert.equal(lightingPaletteTitle('场景名：古寺大殿'), '古寺大殿色表');
});

test('palette generation creates a derived image node without replacing the source image', () => {
  const component = read('src/components/ImageTableNode.tsx');
  const service = read('src/services/shipLightingPalette.ts');
  const sceneService = read('src/services/lightingPaletteScene.ts');
  const types = read('src/types/studio.ts');
  const asset = path.join(
    root,
    'src/assets/ship-lighting-palette-layout-reference.png',
  );

  assert.equal(fs.existsSync(asset), true);
  assert.match(component, /identifyLightingPaletteScene/);
  assert.match(component, /const paletteNodeId = addImageNode\(/);
  assert.match(component, /patchNodeData\(\s*paletteNodeId,[\s\S]*?imageDataUrl: result\.imageDataUrl/);
  assert.match(component, /sourceImageNodeId: id/);
  assert.match(component, /focusNode\(paletteNodeId, \{ openDetail: false \}\)/);
  const focusIndex = component.indexOf('focusNode(paletteNodeId');
  const sourceResetStart = component.lastIndexOf('patchNodeData(', focusIndex);
  const sourceReset = component.slice(sourceResetStart, focusIndex);
  assert.match(sourceReset, /patchNodeData\(\s*id,/);
  assert.doesNotMatch(sourceReset, /imageDataUrl/);
  assert.match(component, /来源图片未被覆盖/);

  assert.match(sceneService, /image-palette-scene-identify/);
  assert.match(sceneService, /"sceneName":"场景名"/);
  assert.match(component, /prepareShipLightingPaletteReferences/);
  assert.match(component, /buildShipLightingPalettePrompt\(sourceLabel, sceneName\)/);
  assert.match(
    component,
    /generateStoryboardGridImage\([\s\S]*?SHIP_LIGHTING_PALETTE_REQUEST_SIZE,[\s\S]*?references,[\s\S]*?selectedModel/,
  );
  assert.match(component, /normalizeShipLightingPaletteImage/);
  assert.match(component, /kind:\s*'image_color_palette'/);
  assert.match(service, /canvas\.width = SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH/);
  assert.match(service, /canvas\.height = SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT/);
  assert.match(service, /canvas\.toDataURL\('image\/png'\)/);
  assert.match(types, /imageNodeMode\?: 'asset' \| 'storyboard-grid' \| 'edit' \| 'palette'/);
  assert.match(types, /imageGenerationTask\?: 'grid' \| 'edit' \| 'palette'/);
});
