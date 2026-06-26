import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

function assertNotIncludes(haystack, needle, label) {
  assert.ok(!haystack.includes(needle), `${label} should not include: ${needle}`);
}

function assertIncludesAll(haystack, needles, label) {
  for (const needle of needles) {
    assertIncludes(haystack, needle, label);
  }
}

function assertOccurrenceAtLeast(haystack, needle, expected, label) {
  const actual = haystack.split(needle).length - 1;
  assert.ok(actual >= expected, `${label} should include ${needle} at least ${expected} times, got ${actual}`);
}

function makePayload(overrides = {}) {
  return {
    version: 1,
    savedAt: 100,
    nodes: [{ id: 'n1' }],
    edges: [],
    projectId: 'project_a',
    projectName: 'Project A',
    ...overrides,
  };
}

function makeRecord(overrides = {}) {
  return {
    ...makePayload(overrides),
    projectId: overrides.projectId ?? 'project_a',
    projectName: overrides.projectName ?? 'Project A',
    updatedAt: overrides.updatedAt ?? 100,
  };
}

async function checkRestorePolicy() {
  const restorePolicyUrl = pathToFileURL(path.join(root, 'src/services/studioProjectRestorePolicy.ts')).href;
  const { chooseStudioProjectRestoreCandidate } = await import(restorePolicyUrl);

  assert.equal(
    chooseStudioProjectRestoreCandidate({
      activeRef: null,
      activeRecord: null,
      autosave: null,
      fallbackProjectName: 'Untitled',
    }),
    null,
    'empty workspace should not restore anything',
  );

  const activeOnly = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project_a', projectName: 'Project A Ref' },
    activeRecord: makeRecord({ updatedAt: 200, projectName: 'Project A Record' }),
    autosave: null,
    fallbackProjectName: 'Untitled',
  });
  assert.equal(activeOnly?.source, 'workspace');
  assert.equal(activeOnly?.projectName, 'Project A Record');

  const newerSameProjectAutosave = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project_a', projectName: 'Project A Ref' },
    activeRecord: makeRecord({ updatedAt: 200, projectName: 'Project A Record' }),
    autosave: makePayload({ savedAt: 250, projectName: 'Project A Autosave' }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(newerSameProjectAutosave?.source, 'autosave');
  assert.equal(newerSameProjectAutosave?.projectName, 'Project A Autosave');

  const olderSameProjectAutosave = chooseStudioProjectRestoreCandidate({
    activeRef: { projectId: 'project_a', projectName: 'Project A Ref' },
    activeRecord: makeRecord({ updatedAt: 300, projectName: 'Project A Record' }),
    autosave: makePayload({ savedAt: 250, projectName: 'Project A Autosave' }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(olderSameProjectAutosave?.source, 'workspace');
  assert.equal(olderSameProjectAutosave?.projectName, 'Project A Record');

  const fallbackAutosave = chooseStudioProjectRestoreCandidate({
    activeRef: null,
    activeRecord: null,
    autosave: makePayload({ projectId: 'project_b', projectName: 'Project B Autosave' }),
    fallbackProjectName: 'Untitled',
  });
  assert.equal(fallbackAutosave?.source, 'autosave');
  assert.equal(fallbackAutosave?.projectName, 'Project B Autosave');
}

function checkPersistenceBoundaries() {
  const menu = read('src/components/StudioProjectMenu.tsx');
  const hook = read('src/hooks/useStudioProjectPersistence.ts');
  const policy = read('src/services/studioProjectRestorePolicy.ts');
  const service = read('src/services/studioProjectPersistence.ts');

  assertIncludes(menu, 'useStudioProjectPersistence({ rememberRecent })', 'StudioProjectMenu');
  for (const forbidden of [
    'autosaveTimerRef',
    'persistenceReadyRef',
    'restoreLatestProject',
    'putStudioAutosave',
    'getActiveStudioProjectRef',
    'toPersistableNodesAndEdges',
  ]) {
    assertNotIncludes(menu, forbidden, 'StudioProjectMenu');
  }

  for (const required of [
    'const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000',
    'const AUTOSAVE_DEBOUNCE_MS = 1200',
    "window.addEventListener('pagehide'",
    "window.addEventListener('beforeunload'",
    "document.addEventListener('visibilitychange'",
    'chooseStudioProjectRestoreCandidate',
  ]) {
    assertIncludes(hook, required, 'useStudioProjectPersistence');
  }

  assertIncludes(policy, 'autosave.savedAt >= activeRecord.updatedAt', 'restore policy');
  assertIncludes(policy, "restoreSource === 'autosave'", 'restore policy');
  assertIncludes(service, 'export function studioProjectPayloadHasCanvasContent', 'studioProjectPersistence');
}

function checkSkillIsolation() {
  const skillLoader = read('src/services/skillLoader.ts');
  const aiNode = read('src/components/AiFilmmakingNode.tsx');
  const aiStore = read('src/store/slices/aiFilmmakingStore.ts');

  assertIncludes(
    skillLoader,
    'return getVisibleSkills().filter((s) => s.folder === kind);',
    'skillLoader pipeline folder filter',
  );
  assertIncludes(
    skillLoader,
    "normalizeSkillIdForPipelineKind('storyboard', id)",
    'storyboard skill normalization',
  );
  assertIncludes(
    skillLoader,
    "['prompt/seedance2_segmented_prompt_v1', DEFAULT_PROMPT_STYLE_SKILL_ID]",
    'hidden prompt storyboard alias',
  );
  assertIncludes(
    skillLoader,
    "'prompt/seedance2_segmented_prompt_v1'",
    'hidden prompt storyboard skill',
  );

  assertIncludes(aiNode, "listSkillsInFolder('storyboard')", 'AiFilmmakingNode storyboard selector');
  assertNotIncludes(aiNode, "listSkillsInFolder('prompt')", 'AiFilmmakingNode storyboard selector');
  assertIncludes(
    aiStore,
    "if (!skill || skill.folder !== 'storyboard') return undefined;",
    'AiFilmmakingStore storyboard skill guard',
  );
  assertIncludes(
    aiStore,
    'buildStoryboardGridUserPrompt(source.summary, storyboardSkill);',
    'AiFilmmakingStore storyboard prompt builder',
  );
  assertNotIncludes(
    aiStore,
    'DEFAULT_PROMPT_STYLE_SKILL_ID',
    'AiFilmmakingStore storyboard prompt isolation',
  );

  const skillFolders = ['prompt', 'storyboard', 'writing'];
  for (const folder of skillFolders) {
    const dir = path.join(root, 'src/skills', folder);
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    assert.ok(files.length > 0, `${folder} skill folder should not be empty`);
    for (const file of files) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const json = JSON.parse(raw);
      assert.equal(typeof json.name, 'string', `${folder}/${file} should have name`);
      assert.equal(typeof json.system_instruction, 'string', `${folder}/${file} should have system_instruction`);
      assert.equal(typeof json.description, 'string', `${folder}/${file} should have description`);
      assert.ok(!file.startsWith('../'), `${folder}/${file} should stay inside its skill folder`);
    }
  }

  const storyboardFiles = fs.readdirSync(path.join(root, 'src/skills/storyboard')).filter((name) => name.endsWith('.json'));
  const promptFiles = fs.readdirSync(path.join(root, 'src/skills/prompt')).filter((name) => name.endsWith('.json'));
  for (const forbidden of [
    'seedance2_segmented_prompt_v1.json',
    'storyboard-to-sd20-prompt.json',
    'storyboard_prompt_translator_v1.json',
    'studio_canvas_prompt_spec_v1.json',
  ]) {
    assert.ok(!storyboardFiles.includes(forbidden), `storyboard skill folder should not include prompt skill ${forbidden}`);
  }
  for (const forbidden of ['hong_kong_espionage_storyboard_v1.json', 'vertical_short_drama_storyboard_composition_v1.json']) {
    assert.ok(!promptFiles.includes(forbidden), `prompt skill folder should not include storyboard skill ${forbidden}`);
  }
}

function checkCanvasLazyBoundaries() {
  const canvas = read('src/components/StudioCanvas.tsx');

  assertNotIncludes(
    canvas,
    "from '@/components/AiFilmmakingNode'",
    'StudioCanvas should lazy-load AI filmmaking nodes',
  );
  assertNotIncludes(
    canvas,
    "from '@/components/ShotListNode'",
    'StudioCanvas should lazy-load shot list nodes',
  );
  assertIncludes(canvas, "import('@/components/AiFilmmakingNode')", 'StudioCanvas AI filmmaking lazy import');
  assertIncludes(canvas, "import('@/components/ShotListNode')", 'StudioCanvas shot list lazy import');
}

function checkPromptGenerationGuards() {
  const promptAgents = read('src/agents/promptAgents.ts');
  const promptSpec = read('src/agents/promptDeptSpec.ts');

  assertIncludesAll(
    promptAgents,
    [
      'const MAX_PROMPT_CHARS = 2500;',
      'const MIN_SEEDANCE_CARD_CHARS = 1000;',
      'const MAX_SEEDANCE_CARD_CHARS = 3200;',
      'const MIN_SEEDANCE2_SEGMENTED_CARD_CHARS = 2000;',
      'const MAX_SEEDANCE2_SEGMENTED_CARD_CHARS = 3500;',
    ],
    'promptAgents prompt length constants',
  );
  assertIncludesAll(
    promptSpec,
    [
      'Length budget: each seedanceCard must stay within 1000-3200 characters total.',
      'Target 1200-3000 characters for normal shots and 1800-3150 for multi-shot groups.',
      'If a card is below 1000 characters, expand cinematic space depth',
      'only compress when the card exceeds the upper limit.',
    ],
    'promptDeptSpec seedanceCard length budget',
  );
  assertIncludesAll(
    promptAgents,
    [
      'shotPrompts 必须是非空数组',
      'shotPrompts 内每一项都必须包含',
      'seedanceCard',
      'Array.from(prompt).length > MAX_PROMPT_CHARS',
      'Array.from(seedanceCard).length > MAX_SEEDANCE_CARD_CHARS',
      'Array.from(seedanceCard).length < MIN_SEEDANCE_CARD_CHARS',
      'assertSeedance2SegmentedCard(pack.shot_id, seedanceCard);',
      'if (!seedanceCard.startsWith(SEEDANCE2_SEGMENTED_HEADINGS[0])) return true;',
    ],
    'promptAgents PromptOutput validation guards',
  );
  assertIncludesAll(
    promptAgents,
    [
      'const SEEDANCE2_SEGMENTED_HEADINGS = [',
      'Do not use the default Studio Canvas card fields',
      'Each seedanceCard must be ${MIN_SEEDANCE2_SEGMENTED_CARD_CHARS}-${MAX_SEEDANCE2_SEGMENTED_CARD_CHARS} Chinese characters',
      'must contain a continuous [00.0s - 15.0s] timeline',
      'parseSeedance2TimelineIntervals(seedanceCard)',
      'timeline must be continuous from 00.0s',
      'timeline must end exactly at 15.0s',
    ],
    'Seedance2 segmented prompt isolation guards',
  );
}

function checkStoryboardShotScopeGuards() {
  const aiStore = read('src/store/slices/aiFilmmakingStore.ts');
  const studioStore = read('src/store/useStudioStore.ts');
  const shotWire = read('src/utils/shotListWire.ts');
  const graphInput = read('src/services/graphInput.ts');

  assertIncludesAll(
    shotWire,
    [
      "export const SHOT_LIST_ITEM_OUTPUT_HANDLE_PREFIX = 'shot-item-out:';",
      'export function makeShotListItemOutputHandleId(wireId: string): string {',
      'export function parseShotListItemOutputHandleId(handleId: string | null | undefined): string | null {',
      'handleId.startsWith(SHOT_LIST_ITEM_OUTPUT_HANDLE_PREFIX)',
    ],
    'shot list wire helpers',
  );

  assertIncludesAll(
    aiStore,
    [
      'function pickStoryboardOutputByHandle(',
      'const wireId = parseShotListItemOutputHandleId(sourceHandle);',
      'return shot ? { shots: [shot], narrativeBeats: [] } : null;',
      "if (sourceHandle != null && sourceHandle !== 'out') return null;",
      'const singleShotScope = parseShotListItemOutputHandleId(sourceHandle) != null;',
      'Scope: one selected storyboard shot output.',
      'const shotListFullOutput =',
      'parseShotListItemOutputHandleId(source.sourceHandle) == null;',
      'if (shotListFullOutput) continue;',
      'storyboardPanelCount += tableBlock.shotCount;',
    ],
    'AI filmmaking storyboard table shot scope',
  );

  assertIncludesAll(
    studioStore,
    [
      'function resolveShotListSourceHandlesForConnect(',
      'const draggedWireId = parseShotListItemOutputHandleId(sourceHandle);',
      'if (!draggedWireId) return [];',
      'const selectedWireIds = selectionMap[nodeId] ?? [];',
      'selectedWireIds.map((wireId) => makeShotListItemOutputHandleId(wireId))',
      'resolveShotListSourceHandlesForConnect(',
    ],
    'StudioStore shot-list selected wire connect guards',
  );
  assertOccurrenceAtLeast(
    studioStore,
    '请从镜头表里的逐镜头 Output 端口拖出连接。',
    2,
    'StudioStore should reject whole shot-list output for downstream prompt/storyboard creation',
  );

  assertIncludesAll(
    graphInput,
    [
      'parseShotListItemOutputHandleId(e.sourceHandle)',
      'const pickedWireId = parseShotListItemOutputHandleId(e.sourceHandle);',
    ],
    'graph input shot-list wire scope',
  );
}

function checkHeavyDependencyLoadingGuards() {
  const viteConfig = read('vite.config.ts');
  const storyboardExport = read('src/components/detailPanel/storyboardShotlistExport.ts');
  const writingExport = read('src/components/writing/writingScriptExport.ts');
  const storyboardWorkbook = read('src/utils/storyboardWorkbook.ts');
  const writingExportRunner = read('src/components/writing/writingExportRunner.ts');
  const writingHeaderActions = read('src/components/writing/WritingHeaderActions.tsx');
  const writingDetailWorkspace = read('src/components/writing/WritingDetailWorkspace.tsx');

  assertIncludesAll(
    viteConfig,
    ['manualChunks', 'vendor-pdf', 'vendor-xlsx', 'vendor-export', 'vendor-supabase'],
    'Vite heavy dependency chunk split',
  );
  assertIncludes(storyboardExport, "await import('html2pdf.js')", 'storyboard PDF export should lazy-load html2pdf');
  assertIncludes(writingExport, "await import('html2pdf.js')", 'writing PDF export should lazy-load html2pdf');
  assertIncludes(storyboardWorkbook, "await import('xlsx')", 'storyboard workbook import should lazy-load xlsx');
  assertIncludes(
    writingExportRunner,
    "await import('@/components/writing/writingScriptExport')",
    'writing export runner should lazy-load script export module',
  );
  assertIncludes(
    writingHeaderActions,
    "await import('@/components/writing/writingScriptExport')",
    'writing header actions should lazy-load script export module',
  );
  assertIncludes(
    writingDetailWorkspace,
    "await import(\r\n        '@/services/writingStandardDocxExport'",
    'writing detail workspace should lazy-load standard docx export module',
  );
  assertNotIncludes(storyboardExport, "import html2pdf from 'html2pdf.js'", 'storyboard PDF export');
  assertNotIncludes(writingExport, "import html2pdf from 'html2pdf.js'", 'writing PDF export');
  assertNotIncludes(storyboardWorkbook, "import XLSX from 'xlsx'", 'storyboard workbook parser');
}

function checkOperationalHealthGuards() {
  const server = read('server/index.cjs');
  const healthApi = read('api/health.ts');

  assertIncludesAll(
    server,
    [
      'function modelFailureHealthSummary(provider, primaryModel) {',
      'cooldownRemainingSec',
      'recentFailures',
      'function staticEtag(stat) {',
      'function normalizeStaticEtagToken(value) {',
      'function requestHasFreshStaticCache(req, etag, stat) {',
      'function getCachedGzipStaticFile(filePath, stat) {',
      'normalizeStaticEtagToken(item) === normalizedEtag',
      "res.setHeader('etag', etag);",
      "res.setHeader('last-modified', stat.mtime.toUTCString());",
      "res.statusCode = 304;",
      "providers = ['', 'gpt', 'deepseek'].map((provider) => {",
      'fallbackModels: fallbackModelsForProvider(provider, primaryModel)',
      'assetCache: \'public, max-age=31536000, immutable\'',
      'indexCache: \'no-cache, must-revalidate\'',
      'distExists: fs.existsSync(distDir)',
      'uptimeSec: Math.floor(process.uptime())',
    ],
    'node server health diagnostics',
  );
  assertIncludesAll(
    healthApi,
    [
      'function healthProviderDiagnostics(provider: string)',
      'fallbackModelsForProvider(normalizedProvider, primaryModel)',
      "providers: ['', 'gpt', 'deepseek'].map(healthProviderDiagnostics)",
      'defaultTimeoutMs: DEFAULT_TIMEOUT_MS',
      'assetCache: \'public, max-age=31536000, immutable\'',
      'indexCache: \'no-cache, must-revalidate\'',
      'uptimeSec: Math.floor(process.uptime())',
    ],
    'api health diagnostics',
  );
}

await checkRestorePolicy();
checkPersistenceBoundaries();
checkSkillIsolation();
checkCanvasLazyBoundaries();
checkPromptGenerationGuards();
checkStoryboardShotScopeGuards();
checkHeavyDependencyLoadingGuards();
checkOperationalHealthGuards();

console.log('stability checks passed');
