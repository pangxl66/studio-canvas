import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildImageTextAlignmentInstruction,
  cleanImageReferenceName,
  inferImageReferenceKind,
  matchImageNameToTextReferences,
  normalizeReferenceEntityName,
  resolveImageReferenceName,
  resolveImageReferenceTarget,
} from '../src/utils/imageReferenceNaming.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const textReferences = [
  { nodeId: 'sophie', label: '角色｜苏菲', role: 'reference_notes' },
  { nodeId: 'dock', label: '场景｜地下船坞', role: 'story_content' },
  { nodeId: 'rules', label: '项目总规范', role: 'project_constraints' },
];

test('keeps a semantic image name separate from the original file name', () => {
  assert.equal(
    resolveImageReferenceName({
      imageReferenceName: '苏菲',
      imageFileName: 'IMG_8934.png',
      label: '图片节点 · a1b2',
    }),
    '苏菲',
  );
  assert.equal(cleanImageReferenceName('地下船坞｜场景角色站位图.png'), '地下船坞｜场景角色站位图');
});

test('normalizes decorated role and scene labels before exact matching', () => {
  assert.equal(normalizeReferenceEntityName('苏菲｜角色参考图'), '苏菲');
  assert.equal(normalizeReferenceEntityName('角色｜苏菲'), '苏菲');
  assert.equal(normalizeReferenceEntityName('地下船坞｜场景角色站位图'), '地下船坞');
  assert.equal(normalizeReferenceEntityName('场景｜地下船坞'), '地下船坞');

  const roleMatches = matchImageNameToTextReferences('苏菲｜角色参考图', textReferences);
  assert.deepEqual(roleMatches.map((match) => match.nodeId), ['sophie']);
  const sceneMatches = matchImageNameToTextReferences('地下船坞｜场景角色站位图', textReferences);
  assert.deepEqual(sceneMatches.map((match) => match.nodeId), ['dock']);
});

test('recognizes a blocking map and targets its scene name', () => {
  const data = {
    imageReferenceName: '地下船坞｜场景角色站位图',
    imageReferenceKind: 'auto',
  };
  assert.equal(inferImageReferenceKind(data), 'blocking');
  assert.equal(resolveImageReferenceTarget(data), '地下船坞');

  const instruction = buildImageTextAlignmentInstruction(
    { ...data, imageReferenceScope: 'continuity' },
    textReferences,
  );
  assert.match(instruction, /类型“场景角色站位图”/);
  assert.match(instruction, /已匹配文本节点 “场景｜地下船坞”/);
  assert.match(instruction, /角色相对位置、前中后景、朝向与视线、摄影轴线/);
  assert.match(instruction, /文本剧情事实与明确动作高于站位图/);
});

test('unmatched names remain isolated instead of replacing named entities', () => {
  const instruction = buildImageTextAlignmentInstruction(
    {
      imageReferenceName: '未知机械结构',
      imageReferenceKind: 'prop',
      imageReferenceScope: 'current_input',
    },
    textReferences,
  );
  assert.match(instruction, /未找到名称为“未知机械结构”的文本节点/);
  assert.match(instruction, /不得擅自替换其他已命名主体/);
});

test('image node UI and department prompts carry semantic naming and blocking responsibilities', () => {
  const component = read('src/components/ImageTableNode.tsx');
  const graphInput = read('src/services/graphInput.ts');
  const storyboardSpec = read('src/agents/storyboardDeptSpec.ts');
  const promptSpec = read('src/agents/promptDeptSpec.ts');
  const types = read('src/types/studio.ts');

  assert.match(component, /aria-label="图片素材名称"/);
  assert.match(component, /aria-label="图片素材类型"/);
  assert.match(component, /aria-label="图片参考作用范围"/);
  assert.match(component, /双击修改图片素材名称/);
  assert.match(types, /imageReferenceName\?: string/);
  assert.match(types, /imageReferenceKind\?: 'auto' \| 'character' \| 'scene' \| 'prop' \| 'blocking' \| 'palette'/);
  assert.match(graphInput, /【场景角色站位图/);
  assert.match(graphInput, /站位图冲突/);
  assert.match(storyboardSpec, /场景角色站位图/);
  assert.match(promptSpec, /PROMPT_NAMED_REFERENCE_RULE/);
});
