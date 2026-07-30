import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('admin can generate persistent test invite codes', () => {
  const server = read('server/index.cjs');
  assert.match(server, /test-invite-codes\.json/);
  assert.match(server, /createRandomTestInviteCode/);
  assert.match(server, /saveGeneratedTestInviteCodes/);
  assert.match(server, /url\.pathname === '\/api\/admin\/invites'/);
  assert.match(server, /count < 1 \|\| count > 50/);
  assert.match(server, /\.\.\.getGeneratedTestInviteCodes\(\)\.map/);
});

test('admin workspace exposes invite generation and copy controls', () => {
  const component = read('src/components/AdminWorkspace.tsx');
  const client = read('src/services/adminCreditService.ts');
  assert.match(component, /id: 'invites'/);
  assert.match(component, /function InvitesPanel/);
  assert.match(component, /生成新邀请码/);
  assert.match(component, /复制本批/);
  assert.match(client, /fetchAdminInvites/);
  assert.match(client, /generateAdminInvites/);
  assert.match(client, /\/api\/admin\/invites/);
});
