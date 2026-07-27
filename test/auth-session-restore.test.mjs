import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('browser auth persists and restores a trusted session', () => {
  const authClient = read('src/services/authClient.ts');

  assert.match(authClient, /autoRefreshToken:\s*true/);
  assert.match(authClient, /persistSession:\s*true/);
  assert.match(authClient, /client\.auth\.getSession\(\)/);
  assert.match(authClient, /REMEMBERED_LOGIN_EMAIL_KEY/);
});

test('auth listener does not re-enter Supabase session reads', () => {
  const authGate = read('src/components/AuthGate.tsx');
  const listener = authGate.match(/client\?\.auth\.onAuthStateChange\([\s\S]*?\}\)\s*\?\?\s*\{\}/)?.[0] ?? '';

  assert.match(listener, /setSession\(nextSession \?\? getLocalAuthSnapshot\(\)\.session\)/);
  assert.doesNotMatch(listener, /getAuthSnapshot/);
  assert.match(listener, /getLocalAuthSnapshot/);
  assert.match(authGate, /useState\(\(\) => getRememberedLoginEmail\(\)\)/);
});

test('hosted mode never treats a remembered email as an authenticated session', () => {
  const authClient = read('src/services/authClient.ts');

  assert.match(authClient, /stored\?\.accessToken\?\.startsWith\('test-invite\.'\)/);
  assert.doesNotMatch(authClient, /return stored \? buildMockAuthSnapshot/);
});
