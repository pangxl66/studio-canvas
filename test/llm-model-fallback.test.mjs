import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import server from '../server/index.cjs';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('same-provider fallback recognizes model subscription and access failures', () => {
  const { isModelAccessUnavailable, shouldRetrySameProviderFallback } = server.__test;

  assert.equal(
    isModelAccessUnavailable(403, JSON.stringify({ error: { message: 'No active subscription found for this group' } })),
    true,
  );
  assert.equal(isModelAccessUnavailable(404, 'The requested model does not exist'), true);
  assert.equal(isModelAccessUnavailable(400, 'This model is not available for the current key'), true);
  assert.equal(isModelAccessUnavailable(403, 'Request blocked by an unrelated account policy'), false);
  assert.equal(isModelAccessUnavailable(401, 'Invalid API key'), false);

  assert.equal(shouldRetrySameProviderFallback(524, ''), true);
  assert.equal(shouldRetrySameProviderFallback(429, ''), true);
  assert.equal(shouldRetrySameProviderFallback(403, 'No active subscription found for this group'), true);
  assert.equal(shouldRetrySameProviderFallback(400, 'Invalid request payload'), false);
});

test('Node, serverless, and browser gateways keep the model-access fallback contract', () => {
  const nodeServer = read('server/index.cjs');
  const serverless = read('api/llm/chat.ts');
  const browserGateway = read('src/services/ModelGateway.ts');

  for (const source of [nodeServer, serverless]) {
    assert.match(source, /no active subscription found for this group/);
    assert.match(source, /response\.clone\(\)\.text\(\)/);
    assert.match(source, /shouldRetrySameProviderFallback\(response\.status, failedText\)/);
    assert.match(source, /retrying primary model once/);
  }
  assert.match(browserGateway, /error\.code === 'HTTP_403'/);
  assert.match(nodeServer, /shouldRetryTextRequestWithDeepseek\(upstreamResponse\.status, body, provider, firstFailureText\)/);
});
