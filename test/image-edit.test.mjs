import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  imageEditOutputSize,
  resolveImageEditSource,
} from '../src/services/imageEdit.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function imageNode(id, data = {}) {
  return {
    id,
    type: 'imageNode',
    position: { x: 0, y: 0 },
    data: {
      id,
      type: 'image_node',
      label: id,
      version: 1,
      ...data,
    },
  };
}

test('image node resolves itself as the in-place edit source', () => {
  const node = imageNode('image', {
    label: '原始场景',
    imageDataUrl: 'data:image/jpeg;base64,AAAA',
    imageWidth: 1920,
    imageHeight: 1080,
  });
  const context = resolveImageEditSource(node.id, [node]);

  assert.equal(context.source?.nodeId, node.id);
  assert.equal(context.source?.label, '原始场景');
  assert.equal(context.source?.width, 1920);
  assert.match(context.source?.signature ?? '', /^image:1:/);
});

test('source aspect ratio maps to a supported edit output size', () => {
  assert.equal(imageEditOutputSize('source', 1920, 1080), '1536x864');
  assert.equal(imageEditOutputSize('source', 1080, 1920), '864x1536');
  assert.equal(imageEditOutputSize('source', 1200, 1200), '1536x1536');
  assert.equal(imageEditOutputSize('16:9', 100, 100), '1536x864');
});

test('image-to-image edit connections and quick creation are disabled', () => {
  const rules = read('src/utils/studioConnectionRules.ts');
  const store = read('src/store/useStudioStore.ts');

  assert.match(
    rules,
    /if \(a\.type === 'imageNode' && b\.type === 'imageNode'\) \{\s*return false;\s*\}/,
  );
  assert.doesNotMatch(store, /已创建下游图片节点并进入编辑模式/);
  assert.doesNotMatch(store, /已创建上游图片节点；载入图片后/);
});

test('selected image node opens an in-place editor and keeps a restorable baseline', () => {
  const component = read('src/components/ImageTableNode.tsx');
  const types = read('src/types/studio.ts');
  const client = read('src/services/storyboardGridImage.ts');
  const canvas = read('src/components/StudioCanvas.tsx');

  assert.match(component, /resolveImageEditSource\(id, nodes\)/);
  assert.match(component, /prepareImageEditReference/);
  assert.match(component, /kind:\s*'image_edit'/);
  assert.match(component, /imageEditBaseDataUrl:\s*data\.imageEditBaseDataUrl \?\? editSource\.dataUrl/);
  assert.match(component, /恢复原图/);
  assert.match(component, /原地编辑/);
  assert.match(component, /image-table-node__composer/);
  assert.match(component, /image-table-node__composer-reference/);
  assert.match(component, /editSource\?\.dataUrl && selected/);
  assert.match(component, /role="dialog"[\s\S]*aria-label="图片编辑器"/);
  assert.match(component, /aria-label="输出画幅"/);
  assert.match(component, /标准画质 · 1张/);
  assert.match(component, /展开编辑器/);
  assert.match(types, /imageEditBaseDataUrl\?: string/);
  assert.match(client, /referenceImages\.length[\s\S]*directImageEditUrl/);
  assert.match(canvas, /PANE_CREATE_MENU_KINDS[\s\S]*?'image_node'/);

  const styles = read('src/index.css');
  assert.match(styles, /\.image-table-node__body--edit\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(styles, /\.image-table-node__body--edit\s*\{[\s\S]*?top:\s*calc\(100% \+ 24px\)/);
});
