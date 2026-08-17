import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const graphInputUrl = new URL('../src/services/graphInput.ts', import.meta.url);
const promptReviewNodeUrl = new URL('../src/components/PromptReviewNode.tsx', import.meta.url);
const promptReviewStoreUrl = new URL('../src/store/slices/promptReviewStore.ts', import.meta.url);

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
  assert.match(promptReviewNode, /\{busy \? '对话调整中' : '当前内容'\}/);
});

test('Prompt review GPT edit is isolated from project and prompt skill specifications', async () => {
  const source = await readFile(promptReviewStoreUrl, 'utf8');

  assert.match(source, /只依据本轮用户消息中提供的“调整指令”和“当前内容”完成工作/);
  assert.match(source, /不得加载、推断或套用任何外部 Skill、项目默认规范/);
  assert.match(source, /没有被要求修改的内容尽量原样保留/);
  assert.match(source, /请先输入本轮要让 GPT 完成的调整指令/);
  assert.doesNotMatch(source, /PROMPT_CARD_SECTION_HEADINGS/);
  assert.doesNotMatch(source, /buildPromptReviewRepairUserPrompt/);
  assert.doesNotMatch(source, /validatePromptReviewText/);
  assert.doesNotMatch(source, /LLM 初稿未完全符合提示词规范/);
});
