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
  assert.match(client, /gpt-image-2/);
  assert.match(client, /\/api\/images\/generate/);
  assert.equal(fs.existsSync(path.join(root, 'api/images/generate.ts')), true);
  assert.match(read('server/index.cjs'), /url\.pathname === '\/api\/images\/generate'/);
  assert.match(read('src/components/ImageTableNode.tsx'), /生成九宫格/);
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
