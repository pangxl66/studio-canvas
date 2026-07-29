import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('dragging uses cached semantic graph content instead of full position updates', () => {
  const hook = read('src/hooks/useStudioGraphContent.ts');
  const textNode = read('src/components/TextNode.tsx');
  const imageNode = read('src/components/ImageTableNode.tsx');
  const filmNode = read('src/components/AiFilmmakingNode.tsx');
  const detailPanel = read('src/components/DetailPanel.tsx');
  const canvas = read('src/components/StudioCanvas.tsx');
  const store = read('src/store/useStudioStore.ts');

  assert.match(hook, /node\.data === next\[index\]\?\.data/);
  assert.match(hook, /let cachedSourceNodes: StudioRFNode\[\] \| null = null/);
  assert.match(hook, /cachedSourceNodes === next/);
  assert.doesNotMatch(hook, /useMemo/);
  for (const source of [textNode, imageNode, filmNode, detailPanel]) {
    assert.match(source, /useStudioGraphContentNodes\(\)/);
  }
  assert.match(canvas, /const graphContentNodes = useStudioGraphContentNodes\(\)/);
  assert.match(canvas, /disabledShotListSourceIds: ReadonlySet<string>/);
  assert.doesNotMatch(canvas, /const source = nodes\.find\(\(node\) => node\.id === edge\.source\)/);
  assert.match(store, /function trackNodeGestureUndo/);
  assert.match(store, /const activeDragUndoNodeIds = new Set<string>\(\)/);
  assert.match(store, /const activeResizeUndoNodeIds = new Set<string>\(\)/);
  assert.match(store, /gesture\.liveGestureFrame/);
  assert.doesNotMatch(textNode, /const nodes = useStudioStore\(\(s\) => s\.nodes\)/);
  assert.doesNotMatch(imageNode, /const nodes = useStudioStore\(\(state\) => state\.nodes\)/);
  assert.doesNotMatch(filmNode, /const nodes = useStudioStore\(\(state\) => state\.nodes\)/);
});

test('canvas node implementations load only when the graph needs them', () => {
  const canvas = read('src/components/StudioCanvas.tsx');
  const connectionRules = read('src/utils/studioConnectionRules.ts');

  for (const component of [
    'DepartmentNode',
    'TextNode',
    'ImageTableNode',
    'VideoNode',
    'PromptReviewNode',
    'StoryboardFileNode',
  ]) {
    assert.match(canvas, new RegExp(`const Lazy${component} = lazy`));
    assert.equal(
      canvas.includes(`import { ${component} } from '@/components/${component}'`),
      false,
    );
    assert.equal(
      connectionRules.includes(`from '@/components/${component}'`),
      false,
    );
  }
});

test('connection magnet work is cached and throttled to one pointer frame', () => {
  const canvas = read('src/components/StudioCanvas.tsx');

  assert.match(canvas, /connectionTargetBoundsRef/);
  assert.match(canvas, /window\.requestAnimationFrame/);
  assert.match(canvas, /window\.addEventListener\('pointermove'/);
  assert.doesNotMatch(canvas, /window\.addEventListener\('mousemove', onMove/);
  assert.doesNotMatch(canvas, /window\.addEventListener\('touchmove', onMove/);
});

test('expensive translucent effects are disabled during node drag', () => {
  const css = read('src/index.css');

  assert.match(css, /\.studio-canvas--node-dragging \.detail-panel/);
  assert.match(css, /\.studio-canvas--node-dragging \.chat-dock/);
  assert.match(css, /backdrop-filter: none/);
  assert.match(css, /\.react-flow__node\.dragging \.text-node/);
});

test('project persistence does not save on graph changes or a five minute interval', () => {
  const persistence = read('src/hooks/useStudioProjectPersistence.ts');

  assert.doesNotMatch(persistence, /AUTOSAVE_DEBOUNCE_MS/);
  assert.doesNotMatch(persistence, /AUTOSAVE_INTERVAL_MS/);
  assert.doesNotMatch(persistence, /window\.setInterval/);
  assert.doesNotMatch(
    persistence,
    /\[currentProjectId, currentProjectName, edges, nodes, persistCurrentProjectSnapshot\]/,
  );
  assert.match(persistence, /window\.addEventListener\('pagehide', flushSnapshot\)/);
  assert.match(persistence, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.match(persistence, /const saveStatusRef = useRef<StudioProjectSaveStatus>\('idle'\)/);
  assert.match(persistence, /saveStatusRef\.current !== 'dirty'/);
  assert.doesNotMatch(persistence, /setSaveStatus\(\(current\)/);
});

test('node deletion records a structural undo snapshot without deep serialization', () => {
  const store = read('src/store/useStudioStore.ts');

  assert.match(store, /data: node\.data/);
  assert.match(store, /function appendUndoSnapshot/);
  assert.match(store, /undoStack: captureUndo \? appendUndoSnapshot\(s\) : s\.undoStack/);
  assert.match(store, /const removedStoryboardIds = new Set<string>\(\)/);
  assert.doesNotMatch(store, /function undoSnapshotSignature/);
  assert.doesNotMatch(store, /return JSON\.stringify\(snapshot\)/);
});

test('drag and resize gestures record one undo origin instead of every frame', () => {
  const store = read('src/store/useStudioStore.ts');

  assert.match(store, /change\.resizing === true/);
  assert.match(store, /change\.resizing === false/);
  assert.match(store, /change\.dragging === true/);
  assert.match(store, /change\.dragging === false/);
  assert.match(store, /gesture\.captureUndo\s*\?\s*appendUndoSnapshot\(state\)/);
  assert.doesNotMatch(store, /change\.type === 'dimensions' \|\|/);
});
