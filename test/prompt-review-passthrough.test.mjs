import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const graphInputUrl = new URL('../src/services/graphInput.ts', import.meta.url);
const promptReviewNodeUrl = new URL('../src/components/PromptReviewNode.tsx', import.meta.url);

test('Prompt review passthrough does not rewrite generated cards or mount tokens', async () => {
  const [graphInput, promptReviewNode] = await Promise.all([
    readFile(graphInputUrl, 'utf8'),
    readFile(promptReviewNodeUrl, 'utf8'),
  ]);

  assert.match(
    graphInput,
    /consumer === 'prompt_review_node'[\s\S]*?formatSeedanceCards\(o\.shotPrompts, null\)/,
  );
  assert.doesNotMatch(
    graphInput,
    /consumer === 'prompt_review_node'[\s\S]*?resolvePromptAssetPlaceholders/,
  );
  assert.match(promptReviewNode, /const text = rawText;/);
  assert.doesNotMatch(promptReviewNode, /restoreResolvedMountLines|sanitizePromptAssetPlaceholders/);
  assert.match(promptReviewNode, /\{busy \? '调整中' : '原始输出'\}/);
});
