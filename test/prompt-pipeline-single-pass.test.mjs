import assert from 'node:assert/strict';
import test from 'node:test';

import { runPromptGenerationPipeline } from '../src/agents/promptPipeline.ts';

test('strict single-pass prompt skills never regenerate after validation failure', async () => {
  let modelCalls = 0;
  const draft = {
    system: 'single-pass',
    userTemplate: '{{input}}',
    negative: '',
    parameters: { engine: 'seedance-2.5', aspect: '16:9', format: 'test' },
    shotPrompts: [],
  };

  await assert.rejects(
    runPromptGenerationPipeline(
      {
        brief: 'test shot',
        approvedAssets: [],
        executionSystemPrompt: 'single-pass skill',
      },
      {
        defaultNegative: '',
        departmentSystemPrompt: 'department',
        departmentOutputShape: '{}',
        timingSystemRule: 'timing',
        resolveAssetRefs: () => ({}),
        parseSourceStoryboard: () => ({ shots: [{ id: '1' }] }),
        buildGenerationUserMessage: () => 'generate once',
        buildStructureRepairUserMessage: () => 'must not run',
        buildCompressionRepairUserMessage: () => 'must not run',
        buildCoverageRepairUserMessage: () => 'must not run',
        invokeWithStructureRepair: async () => {
          modelCalls += 1;
          return draft;
        },
        outputNeedsCompressionRepair: () => true,
        normalizeOutput: (output) => output,
        validateCoverage: () => {
          throw new Error('invalid single-pass output');
        },
        sanitizeEllipsis: (output) => output,
        enableRepairPasses: false,
      },
    ),
    /invalid single-pass output/,
  );

  assert.equal(modelCalls, 1);
});
