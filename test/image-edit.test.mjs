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

test('multi-selected images can create one downstream image edit node', () => {
  const rules = read('src/utils/studioConnectionRules.ts');
  const canvas = read('src/components/StudioCanvas.tsx');
  const styles = read('src/index.css');

  assert.match(
    rules,
    /if \(a\.type === 'imageNode' && b\.type === 'imageNode'\)[\s\S]*?IMAGE_NODE_INPUT_HANDLE_ID[\s\S]*?return true;/,
  );
  assert.match(canvas, /MultiSelectionOutputLayer/);
  assert.match(canvas, /completeMultiSelectionPick/);
  assert.match(canvas, /已把选中的 \$\{sourceNodeIds\.length\} 个节点统一接入新节点/);
  assert.match(canvas, /selectedNodeCount > 1/);
  assert.match(canvas, /studio-canvas--multi-select/);
  assert.match(
    styles,
    /\.studio-canvas--multi-select \.text-node__workspace,[\s\S]*?\.image-table-node__composer[\s\S]*?display:\s*none !important/,
  );
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
  assert.match(client, /form\.append\('image',/);
  assert.doesNotMatch(client, /form\.append\('image\[\]',/);
  assert.match(canvas, /PANE_CREATE_MENU_KINDS[\s\S]*?'image_node'/);

  const styles = read('src/index.css');
  assert.match(styles, /\.image-table-node__body--edit\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(styles, /\.image-table-node__body--edit\s*\{[\s\S]*?top:\s*calc\(100% \+ 24px\)/);
});

test('image generation state is not blocked by the workflow guard and stale drawing state recovers', () => {
  const component = read('src/components/ImageTableNode.tsx');
  const store = read('src/store/useStudioStore.ts');
  const persistence = read('src/utils/studioNodePersistence.ts');

  assert.match(
    store,
    /target\.data\.type !== 'text_node'\s*&&\s*target\.data\.type !== 'image_node'/,
  );
  assert.match(component, /const generationInFlightRef = useRef\(false\)/);
  assert.match(component, /generationInFlightRef\.current && !isGenerating/);
  assert.match(component, /generationInFlightRef\.current = true/);
  assert.match(component, /generationInFlightRef\.current = false/);
  assert.match(
    persistence,
    /if \(data\.imageGenerationStatus === 'generating'\)/,
  );
  assert.match(persistence, /const isImageNode = data\.type === 'image_node'/);
  assert.match(persistence, /imageGenerationStatus:\s*'idle'/);
});

test('credit refresh requests preserve the local mock user identity', () => {
  const creditService = read('src/services/creditService.ts');

  assert.doesNotMatch(
    creditService,
    /if \(isSaasMockEnabled\(\)\) \{\s*return readMockCredit\(\);\s*\}/,
  );
  assert.match(creditService, /const mockEnabled = isSaasMockEnabled\(\)/);
  assert.match(
    creditService,
    /\(mockEnabled \|\| isLanDirectAccessEnabled\(\)\) && session\.user\?\.email/,
  );
  assert.match(creditService, /headers\['X-Studio-Mock-Email'\] = session\.user\.email/);
  assert.match(creditService, /fetch\('\/api\/credits\/status', \{\s*headers\s*\}\)/);
  assert.match(creditService, /if \(mockEnabled && status\) writeMockCredit\(status\)/);
});
