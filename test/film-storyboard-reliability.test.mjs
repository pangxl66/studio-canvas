import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildStoryboardPanelReferenceInstruction,
  buildStoryboardReferenceInstruction,
} from '../src/services/storyboardReferenceImages.ts';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('layout reference keeps slot 1 and business references start at slot 2', () => {
  const references = [
    {
      imageNodeId: 'image-1',
      sourceLabel: '主角',
      dataUrl: 'data:image/jpeg;base64,abc',
      kind: 'character',
      name: '阿青',
      entityName: '阿青',
    },
  ];
  const shot = {
    id: 1,
    shotNo: 'S1',
    type: '中景',
    movement: '固定',
    description: '阿青走入房间',
    characters: ['阿青'],
  };

  assert.match(buildStoryboardReferenceInstruction(references, 2), /参考图 2/);
  assert.match(buildStoryboardPanelReferenceInstruction(shot, references, 2), /参考图2/);
});

test('storyboard image generation consumes the editable director prompt and tracks its signature', () => {
  const component = read('src/components/AiFilmmakingNode.tsx');

  assert.match(component, /data\.raw_text\?\.trim\(\)/);
  assert.match(component, /用户已生成或编辑的宫格导演提示词/);
  assert.match(component, /imageGenerationInstructionSignature:\s*storyboardInstructionSignature/);
  assert.match(component, /data\.imageGenerationInstructionSignature[\s\S]*storyboardInstructionSignature/);
});

test('storyboard generations always send layout plus business references and remove obsolete pages', () => {
  const component = read('src/components/AiFilmmakingNode.tsx');

  assert.match(component, /const requestReferences = \[layoutReference, \.\.\.preparedReferences\]/);
  assert.match(component, /hasLayoutReference:\s*true/);
  assert.match(component, /generatedFromStoryboardNodeId === id[\s\S]*!outputImageNodeIds\.includes/);
  assert.match(component, /removeNodesByIds\(obsoleteOutputNodeIds\)/);
});

test('storyboard source persists page metadata without duplicating image payloads', () => {
  const component = read('src/components/AiFilmmakingNode.tsx');

  assert.match(component, /const persistedPageMetadata[\s\S]*imageDataUrl:\s*undefined/);
  assert.match(component, /imageDataUrl:\s*undefined,[\s\S]*storyboardGridImages:\s*persistedPageMetadata/);
});

test('legacy storyboard payloads are deduplicated on save when complete output nodes exist', () => {
  const persistence = read('src/utils/studioNodePersistence.ts');

  assert.match(persistence, /imageOutputIdsWithPayload/);
  assert.match(persistence, /hasCompleteOutputCopy/);
  assert.match(persistence, /imageDataUrl:\s*undefined/);
  assert.match(persistence, /storyboardGridImages:[\s\S]*imageDataUrl:\s*undefined/);
});

test('model-facing storyboard copy is dynamic instead of claiming every request uses image2', () => {
  const component = read('src/components/AiFilmmakingNode.tsx');
  const imageService = read('src/services/storyboardGridImage.ts');

  assert.doesNotMatch(component, /调用一次 image2|传给 image2|image2 已接收|当前 image2 渠道/);
  assert.doesNotMatch(imageService, /传入 image2|image2 请求|由 image2 伪造/);
  assert.match(component, /selectedStoryboardModelOption\.label/);
  assert.match(imageService, /imageGenerationModelOption\(model\)\.label/);
});
