import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Prompt nodes expose a fixed-height live stream preview while generating', () => {
  const component = read('src/components/DepartmentNode.tsx');
  const css = read('src/index.css');

  assert.match(component, /showPromptStream = isPromptNode && data\.status === 'IN_PROGRESS'/);
  assert.match(component, /aria-label="提示词实时生成预览"/);
  assert.match(component, /promptStreamRef\.current/);
  assert.match(component, /preview\.scrollTop = preview\.scrollHeight/);
  assert.match(component, /prompt-node__stream-content/);
  assert.match(css, /\.prompt-node__stream-content\s*\{[\s\S]*height: 150px/);
  assert.match(css, /animation: prompt-stream-pulse/);
});

test('Prompt model chunks update the preview during the real request without fake replay', () => {
  const store = read('src/store/useStudioStore.ts');

  assert.match(store, /onModelStreamChunk: \(_delta: string, accumulated: string\)/);
  assert.match(store, /window\.requestAnimationFrame\(publishModelStreamPreview\)/);
  assert.match(store, /hasModelStreamOutput \|\|= Boolean\(accumulated\.trim\(\)\)/);
  assert.match(store, /if \(!\(kind === 'prompt' && hasModelStreamOutput\)\)/);
});

test('both local and hosted LLM proxies forward upstream SSE without buffering', () => {
  const localServer = read('server/index.cjs');
  const hostedApi = read('api/llm/chat.ts');
  const modelGateway = read('src/services/ModelGateway.ts');

  for (const source of [localServer, hostedApi]) {
    assert.match(source, /async function pipeUpstreamStream/);
    assert.match(source, /upstreamResponse\.body\?\.getReader\(\)/);
    assert.match(source, /res\.setHeader\('x-accel-buffering', 'no'\)/);
    assert.match(source, /res\.write\(Buffer\.from\(value\)\)/);
    assert.match(source, /data:\\s\*\\\[DONE\\\]/);
    assert.match(source, /finish_reason/);
    assert.match(source, /reader\.cancel/);
  }
  assert.match(modelGateway, /data:\\s\*\\\[DONE\\\]/);
  assert.match(modelGateway, /streamFinished/);
  assert.match(modelGateway, /finish_reason/);
  assert.match(modelGateway, /params\.jsonMode && safeJsonParse\(accumulated\)\.ok/);
  assert.match(modelGateway, /void reader\.cancel\(\)\.catch/);
  assert.match(hostedApi, /if \(body\.stream === true\)/);
});
