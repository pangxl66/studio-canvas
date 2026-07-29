import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildShipLightingPalettePrompt,
  SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT,
  SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH,
  SHIP_LIGHTING_PALETTE_REQUEST_SIZE,
  SHIP_LIGHTING_PALETTE_SKILL_ID,
} from '../src/services/shipLightingPaletteContract.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('palette prompt preserves the supplied Skill contract', () => {
  const prompt = buildShipLightingPalettePrompt('ship-reference.png');

  assert.equal(SHIP_LIGHTING_PALETTE_SKILL_ID, 'ship-interior-lighting-palette@1.0.0');
  assert.equal(SHIP_LIGHTING_PALETTE_REQUEST_SIZE, '1536x864');
  assert.equal(SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH, 1920);
  assert.equal(SHIP_LIGHTING_PALETTE_OUTPUT_HEIGHT, 1080);
  assert.match(prompt, /参考图 1“ship-reference\.png”/);
  assert.match(prompt, /参考图 2 是固定版式模板/);
  assert.equal(prompt.includes('飞船内景灯光色表  /  Extracted Color Palette'), true);
  assert.equal(prompt.includes('A. 画面主导色  /  Dominant palette'), true);
  assert.match(prompt, /20 个主导色/);
  assert.match(prompt, /四列×五行/);
  assert.equal(prompt.includes('B. 灯光与高光色  /  Practical & highlight colors'), true);
  assert.match(prompt, /4 个代表性灯光或高光色/);
  assert.match(prompt, /严禁凭空编造/);
  assert.match(prompt, /色彩比例基于原图像素聚类/);
});

test('image node sends source and layout references through the image model', () => {
  const component = read('src/components/ImageTableNode.tsx');
  const service = read('src/services/shipLightingPalette.ts');
  const types = read('src/types/studio.ts');
  const asset = path.join(
    root,
    'src/assets/ship-lighting-palette-layout-reference.png',
  );

  assert.equal(fs.existsSync(asset), true);
  assert.match(component, /prepareShipLightingPaletteReferences/);
  assert.match(component, /buildShipLightingPalettePrompt/);
  assert.match(
    component,
    /generateStoryboardGridImage\([\s\S]*?SHIP_LIGHTING_PALETTE_REQUEST_SIZE,[\s\S]*?references,[\s\S]*?selectedModel/,
  );
  assert.match(component, /normalizeShipLightingPaletteImage/);
  assert.match(component, /生成色表/);
  assert.match(component, /恢复来源图/);
  assert.match(component, /kind:\s*'image_color_palette'/);
  assert.match(service, /canvas\.width = SHIP_LIGHTING_PALETTE_OUTPUT_WIDTH/);
  assert.match(service, /canvas\.toDataURL\('image\/png'\)/);
  assert.match(types, /imageNodeMode\?: 'asset' \| 'storyboard-grid' \| 'edit' \| 'palette'/);
  assert.match(types, /imageGenerationTask\?: 'grid' \| 'edit' \| 'palette'/);
});
