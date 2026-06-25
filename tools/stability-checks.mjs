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
    }
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

await checkRestorePolicy();
checkPersistenceBoundaries();
checkSkillIsolation();
checkCanvasLazyBoundaries();

console.log('stability checks passed');
