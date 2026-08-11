import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODELS,
  STORYBOARD_GRID_IMAGE_MODELS,
  imageGenerationModelOption,
  imageNodeModelOption,
  resolveImageGenerationModel,
} from '../src/services/imageGenerationModels.ts';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const require = createRequire(import.meta.url);

test('ordinary image nodes and storyboard grids both expose Banana 2 and image2', () => {
  assert.deepEqual(
    IMAGE_GENERATION_MODELS.map((model) => model.id),
    ['gemini-3.1-flash-image', 'image2'],
  );
  assert.deepEqual(
    STORYBOARD_GRID_IMAGE_MODELS.map((model) => model.id),
    ['gemini-3.1-flash-image', 'image2'],
  );
  assert.equal(DEFAULT_IMAGE_GENERATION_MODEL, 'gemini-3.1-flash-image');
  assert.equal(imageNodeModelOption('image2').description, '图片编辑与灯光色表生成');
});

test('image2 resolves directly and unknown selections fall back to Nano Banana 2', () => {
  assert.equal(resolveImageGenerationModel('image2'), 'image2');
  assert.equal(imageGenerationModelOption('image2').label, 'image2');
  assert.equal(resolveImageGenerationModel(undefined), 'gemini-3.1-flash-image');
  assert.equal(resolveImageGenerationModel('unknown-model'), 'gemini-3.1-flash-image');
  assert.equal(imageGenerationModelOption('gemini-3-pro-image-preview').label, 'Nano Banana 2');
});

test('selected image model is persisted and sent through client and server', () => {
  const component = read('src/components/ImageTableNode.tsx');
  const client = read('src/services/storyboardGridImage.ts');
  const server = read('server/index.cjs');
  const store = read('src/store/useStudioStore.ts');

  assert.match(component, /imageGenerationSelectedModel/);
  assert.match(component, /选择图片生成模型/);
  assert.match(component, /generateStoryboardGridImage\([\s\S]*?selectedModel/);
  assert.match(client, /body = JSON\.stringify\(\{[\s\S]*?model,/);
  assert.match(server, /resolveRequestedImageModel\(body\.model\)/);
  assert.match(store, /imageGenerationSelectedModel:\s*'gemini-3\.1-flash-image'/);
});

test('both image API targets keep UI model ids and retry the Nano Banana 2 preview channel', () => {
  const server = read('server/index.cjs');
  const api = read('api/images/generate.ts');

  assert.doesNotMatch(server, /gemini-3-pro-image-preview/);
  assert.doesNotMatch(api, /gemini-3-pro-image-preview/);
  assert.doesNotMatch(server, /IMAGE_ALLOWED_MODELS/);
  assert.doesNotMatch(api, /IMAGE_ALLOWED_MODELS/);
  assert.match(server, /BUILTIN_IMAGE_MODELS\.has\(requested\)/);
  assert.match(api, /BUILTIN_IMAGE_MODELS\.has\(requested\)/);
  assert.match(server, /'image2'/);
  assert.match(api, /'image2'/);
  assert.match(server, /\['image2', 'gpt-image-2'\]/);
  assert.match(api, /\['image2', 'gpt-image-2'\]/);
  assert.match(server, /resolveUpstreamImageModel\(model\)/);
  assert.match(api, /resolveUpstreamImageModel\(model\)/);
  assert.match(server, /upstreamImageModelCandidates\(model, size\)/);
  assert.match(api, /upstreamImageModelCandidates\(model, size\)/);
  assert.match(server, /gemini-3\.1-flash-image-preview/);
  assert.match(api, /gemini-3\.1-flash-image-preview/);
  assert.match(server, /measureImageBuffer\(imageBuffer\)/);
  assert.match(api, /measureImageBuffer\(Buffer\.from\(b64, 'base64'\)\)/);
  assert.match(server, /form\.append\('image',/);
  assert.match(api, /form\.append\('image',/);
  assert.doesNotMatch(server, /form\.append\('image\[\]',/);
  assert.doesNotMatch(api, /form\.append\('image\[\]',/);
});

test('local image proxy resolves the provider alias and measures returned pixels', () => {
  const { __test } = require('../server/index.cjs');
  assert.equal(__test.resolveUpstreamImageModel('image2'), 'gpt-image-2');
  assert.equal(
    __test.resolveUpstreamImageModel('gemini-3.1-flash-image'),
    'gemini-3.1-flash-image',
  );
  assert.deepEqual(__test.upstreamImageModelCandidates('gemini-3.1-flash-image'), [
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-image-preview',
  ]);
  assert.deepEqual(__test.upstreamImageModelCandidates('gemini-3.1-flash-image', '1536x576'), [
    'gemini-3.1-flash-image',
  ]);
  assert.deepEqual(__test.upstreamImageModelCandidates('image2'), ['gpt-image-2']);
  assert.equal(__test.shouldRetryImageUpstream(503, '{"error":"无可用渠道"}'), true);
  assert.equal(__test.shouldRetryImageUpstream(400, '{"error":"invalid size"}'), false);
  assert.equal(__test.imageAspectMatchesSize({ width: 2048, height: 768 }, '1536x576'), true);
  assert.equal(__test.imageAspectMatchesSize({ width: 1672, height: 941 }, '1536x576'), false);
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(1536, 16);
  png.writeUInt32BE(864, 20);
  assert.deepEqual(__test.measureImageBuffer(png), {
    width: 1536,
    height: 864,
    mimeType: 'image/png',
  });
});

test('film storyboard node selects and forwards the shared image model', () => {
  const component = read('src/components/AiFilmmakingNode.tsx');
  const api = read('api/images/generate.ts');
  const store = read('src/store/useStudioStore.ts');

  assert.match(component, /aria-label="影视分镜图片模型"/);
  assert.match(component, /STORYBOARD_GRID_IMAGE_MODELS\.map/);
  assert.match(component, /imageGenerationSelectedModel:\s*nextModel/);
  assert.match(
    component,
    /generateStoryboardGridImage\([\s\S]*?requestReferences,\s*selectedStoryboardModel,\s*\)/,
  );
  assert.match(
    store,
    /film_storyboard_skill_id:[\s\S]*?imageGenerationSelectedModel:\s*'gemini-3\.1-flash-image'/,
  );
  assert.match(api, /resolveRequestedImageModel\(body\.model\)/);
  assert.match(api, /imageRequestBody\(body,\s*upstreamModel,/);
  assert.match(api, /body:\s*JSON\.stringify\(\{[\s\S]*?\n\s*model,/);
  assert.match(api, /sendJson\(res,\s*200,[\s\S]*?\n\s*model,/);
});
