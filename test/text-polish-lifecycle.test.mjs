import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  recoverInterruptedTextPolish,
  TEXT_POLISH_INTERRUPTED_MESSAGE,
  TEXT_POLISH_TIMEOUT_MESSAGE,
  TEXT_POLISH_TIMEOUT_MS,
} from '../src/services/textPolishLifecycle.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('interrupted text polish keeps the original text editable', () => {
  assert.equal(TEXT_POLISH_TIMEOUT_MS, 120_000);
  assert.match(TEXT_POLISH_TIMEOUT_MESSAGE, /120 秒/);
  assert.match(TEXT_POLISH_INTERRUPTED_MESSAGE, /刷新或异常中断/);

  assert.deepEqual(recoverInterruptedTextPolish({ input: '原文', raw_text: '原文' }), {
    status: 'APPROVED',
    generation_error: TEXT_POLISH_INTERRUPTED_MESSAGE,
    streaming_preview: undefined,
    text_polish_started_at: undefined,
  });
  assert.equal(recoverInterruptedTextPolish({ input: '', raw_text: '' }).status, 'NOT_STARTED');
});

test('text polish has a hard timeout, exception rollback, and stale-task recovery', () => {
  const store = read('src/store/slices/textStore.ts');
  const node = read('src/components/TextNode.tsx');
  const pipeline = read('src/store/slices/pipelineStore.ts');
  const persistence = read('src/utils/studioNodePersistence.ts');

  assert.match(store, /text_polish_started_at:\s*Date\.now\(\)/);
  assert.match(store, /setTimeout\([\s\S]*?controller\.abort\(\)[\s\S]*?TEXT_POLISH_TIMEOUT_MS/);
  assert.match(store, /activeTaskAbortControllers\.get\(nodeId\) !== controller/);
  assert.match(store, /catch \(error\)[\s\S]*?文本润色失败/);
  assert.match(store, /clearTimeout\(timeoutId\)/);
  assert.match(node, /!busy \|\| typeof data\.text_polish_started_at === 'number'/);
  assert.match(node, /recoverInterruptedTextPolish\(data\)/);
  assert.match(pipeline, /没有正在执行的任务[\s\S]*?recoverInterruptedTextPolish|recoverInterruptedTextPolish[\s\S]*?没有正在执行的任务/);
  assert.match(persistence, /data\.type === 'text_node'[\s\S]*?recoverInterruptedTextPolish\(data\)/);
});
