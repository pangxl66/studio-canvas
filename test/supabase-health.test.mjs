import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { __test } = require('../server/index.cjs');

test('Supabase health probe reports a reachable Auth endpoint', async () => {
  const result = await __test.probeSupabaseHealth({
    anonKey: 'sb_publishable_test',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://project-ref.supabase.co/auth/v1/health');
      assert.equal(options.headers.apikey, 'sb_publishable_test');
      assert.equal(options.method, 'GET');
      return { ok: true, status: 200 };
    },
    url: 'https://project-ref.supabase.co/',
  });

  assert.equal(result.configured, true);
  assert.equal(result.reachable, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.error, null);
});

test('Supabase health probe reports DNS failures without exposing credentials', async () => {
  const dnsError = new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND project-ref.supabase.co'), {
      code: 'ENOTFOUND',
    }),
  });
  const result = await __test.probeSupabaseHealth({
    anonKey: 'sb_publishable_test',
    fetchImpl: async () => {
      throw dnsError;
    },
    url: 'https://project-ref.supabase.co',
  });

  assert.equal(result.configured, true);
  assert.equal(result.reachable, false);
  assert.equal(result.statusCode, null);
  assert.equal(result.error, 'enotfound');
  assert.match(__test.describeSupabaseFailure(dnsError), /SUPABASE_URL/);
  assert.doesNotMatch(__test.describeSupabaseFailure(dnsError), /project-ref/);
});

test('Supabase health probe reports incomplete configuration', async () => {
  const result = await __test.probeSupabaseHealth({
    anonKey: '',
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    },
    url: '',
  });

  assert.deepEqual(
    {
      configured: result.configured,
      error: result.error,
      reachable: result.reachable,
      statusCode: result.statusCode,
    },
    {
      configured: false,
      error: 'configuration_incomplete',
      reachable: false,
      statusCode: null,
    },
  );
});
