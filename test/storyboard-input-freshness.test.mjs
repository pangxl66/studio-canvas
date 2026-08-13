import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasDepartmentInputConnections,
  hasUsableImageReference,
  resolveFreshDepartmentInput,
} from '../src/utils/departmentInputFreshness.ts';

test('connected upstream is authoritative and an empty graph never resurrects its old snapshot', () => {
  const edges = [{ source: 'text-1', target: 'storyboard-1', targetHandle: 'in' }];
  assert.equal(hasDepartmentInputConnections('storyboard-1', edges), true);
  assert.equal(
    resolveFreshDepartmentInput(null, '旧输入：黑洞与旧图片资料', true),
    '',
  );
  assert.equal(
    resolveFreshDepartmentInput('新输入：地下船坞', '旧输入：黑洞', true),
    '新输入：地下船坞',
  );
});

test('manual input remains available only when the department has no graph input', () => {
  assert.equal(hasDepartmentInputConnections('storyboard-1', []), false);
  assert.equal(
    resolveFreshDepartmentInput(null, '手动输入：地下船坞', false),
    '手动输入：地下船坞',
  );
  assert.equal(
    resolveFreshDepartmentInput('图输入：旧黑洞', '手动输入：地下船坞', true, true),
    '手动输入：地下船坞',
  );
});

test('cached visual analysis is unusable after its source image is cleared', () => {
  assert.equal(
    hasUsableImageReference({
      imageDataUrl: undefined,
      imageAnalysisSummary: '旧分析：画面中央存在黑洞',
    }),
    false,
  );
  assert.equal(hasUsableImageReference({ imageDataUrl: 'data:image/png;base64,AA==' }), true);
});
