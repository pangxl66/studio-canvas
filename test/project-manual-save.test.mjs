import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/components/StudioProjectMenu.tsx'), 'utf8');

test('an existing project saves immediately without asking for its name again', () => {
  assert.match(
    source,
    /const projectName = projectIdInState\s*\?\s*suggestedName\.trim\(\)\s*:\s*window\.prompt/,
  );
  assert.match(
    source,
    /if \(projectIdInState\) \{\s*await persistence\.flushCurrentProjectSnapshot\(\)/,
  );
  assert.match(source, /else \{\s*await queueStudioProjectSnapshot/);
});
