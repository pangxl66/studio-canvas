import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('all runtime targets use the shared defaults contract', () => {
  const defaults = JSON.parse(read('shared/runtime-defaults.json'));
  assert.equal(defaults.defaultMonthlyQuota, 10);
  assert.equal(defaults.defaultModel, 'gpt-5.6-terra');

  for (const file of [
    'server/index.cjs',
    'api/health.ts',
    'api/llm/chat.ts',
    'api/credits/status.ts',
    'api/admin/credits.ts',
  ]) {
    assert.match(read(file), /runtime-defaults\.json/);
  }

  const renderConfig = read('render.yaml');
  assert.doesNotMatch(renderConfig, /value:\s*gpt-5\.5\s*$/m);
  assert.match(renderConfig, /value:\s*gpt-5\.6-terra\s*$/m);
});

test('Vercel exposes every admin endpoint used by the browser client', () => {
  const client = read('src/services/adminCreditService.ts');
  const routeFiles = {
    '/api/admin/credits': 'api/admin/credits.ts',
    '/api/admin/usage': 'api/admin/usage.ts',
    '/api/admin/users': 'api/admin/users.ts',
  };
  for (const [route, file] of Object.entries(routeFiles)) {
    assert.match(client, new RegExp(route.replaceAll('/', '\\/')));
    assert.equal(fs.existsSync(path.join(root, file)), true, `${route} must have ${file}`);
  }
});

test('storyboard grid image generation is available in browser and both server targets', () => {
  const client = read('src/services/storyboardGridImage.ts');
  const imageModels = read('src/services/imageGenerationModels.ts');
  const filmStoryboardNode = read('src/components/AiFilmmakingNode.tsx');
  assert.match(imageModels, /gemini-3\.1-flash-image/);
  assert.doesNotMatch(imageModels, /gpt-image-2|gemini-3-pro-image-preview|gemini-3\.1-flash-image-preview/);
  assert.match(client, /\/api\/images\/generate/);
  assert.match(client, /explicitImageProxyUrl/);
  assert.match(client, /window\.location\.protocol !== 'file:'/);
  assert.match(client, /1536x1024/);
  assert.match(client, /1024x1536/);
  assert.match(client, /paginateStoryboardGridSources/);
  assert.doesNotMatch(client, /input_fidelity/);
  assert.doesNotMatch(read('api/images/generate.ts'), /input_fidelity/);
  assert.doesNotMatch(read('server/index.cjs'), /input_fidelity/);
  assert.doesNotMatch(client, /PANEL_COVERAGE/);
  assert.doesNotMatch(client, /index % selected\.length/);
  assert.equal(fs.existsSync(path.join(root, 'api/images/generate.ts')), true);
  assert.match(read('server/index.cjs'), /url\.pathname === '\/api\/images\/generate'/);
  assert.match(read('src/components/ImageTableNode.tsx'), /storyboardGridActionLabel/);
  assert.match(filmStoryboardNode, /resolveStoryboardGridSource/);
  assert.match(filmStoryboardNode, /storyboardGridActionLabel/);
  assert.match(filmStoryboardNode, /imageGenerationStatus/);
  assert.match(filmStoryboardNode, /resolveStoryboardReferenceContext/);
  assert.match(filmStoryboardNode, /prepareStoryboardReferenceImages/);
  assert.match(client, /\/images\/edits/);
  assert.match(read('api/images/generate.ts'), /image\[\]/);
  assert.match(read('server/index.cjs'), /image\[\]/);
});

test('known vulnerable xlsx package is not part of the application', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies.xlsx, undefined);
  assert.equal(packageJson.dependencies['read-excel-file'], '^9.3.1');
  assert.doesNotMatch(read('src/utils/storyboardWorkbook.ts'), /import\(['"]xlsx['"]\)/);
});

test('desktop packaging refuses to ship without an activation endpoint', () => {
  const buildScript = read('tools/build-desktop.cjs');
  assert.match(buildScript, /STUDIO_LICENSE_ENDPOINT/);
  assert.match(buildScript, /Desktop build blocked/);
  assert.match(buildScript, /--allow-unconfigured-license/);
});

test('local SaaS mock mode does not require a serverless proxy URL', () => {
  const checker = read('tools/check-saas-env.cjs');
  assert.match(
    checker,
    /key === 'VITE_LLM_PROXY_URL'/,
    'mock mode should allow the existing direct local LLM configuration',
  );
});

test('Vite development serves the same local API routes as the Node deployment', () => {
  const viteConfig = read('vite.config.ts');
  const nodeServer = read('server/index.cjs');
  assert.match(viteConfig, /studio-canvas-local-api/);
  assert.match(viteConfig, /require\('\.\/server\/index\.cjs'\)/);
  assert.match(viteConfig, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(viteConfig, /pathname\.startsWith\('\/assets\/'\)/);
  assert.match(viteConfig, /public, max-age=31536000, immutable/);
  assert.match(viteConfig, /attachLocalApi\(server, \{ cacheBuiltAssets: true \}\)/);
  assert.match(viteConfig, /return 'app-runtime'/);
  assert.match(viteConfig, /return 'studio-skills'/);
  assert.match(viteConfig, /return 'vendor-html2canvas'/);
  assert.match(viteConfig, /return 'vendor-jspdf'/);
  assert.match(viteConfig, /return 'vendor-pdf-support'/);
  assert.match(viteConfig, /node_modules\/html2pdf\.js\/src\/index\.js/);
  assert.doesNotMatch(viteConfig, /return 'vendor-pdf'/);
  assert.match(nodeServer, /if \(require\.main === module\)/);
  assert.match(nodeServer, /module\.exports = \{[\s\S]*?\broute\b[\s\S]*?\}/);
});
