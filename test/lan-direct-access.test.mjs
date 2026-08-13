import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { __test } = require('../server/index.cjs');

function request(remoteAddress, host) {
  return {
    headers: { host },
    socket: { remoteAddress },
  };
}

test('LAN direct access only trusts private source and private destination addresses', () => {
  const previousLanDirect = process.env.LAN_DIRECT_ACCESS;
  const previousViteLanDirect = process.env.VITE_LAN_DIRECT_ACCESS;
  process.env.LAN_DIRECT_ACCESS = 'true';
  process.env.VITE_LAN_DIRECT_ACCESS = 'true';

  try {
    assert.equal(__test.isLanDirectRequest(request('192.168.1.88', '192.168.1.34:4173')), true);
    assert.equal(__test.isLanDirectRequest(request('10.0.0.21', '10.0.0.5:4173')), true);
    assert.equal(__test.isLanDirectRequest(request('8.8.8.8', '192.168.1.34:4173')), false);
    assert.equal(__test.isLanDirectRequest(request('192.168.1.88', 'studio.example.com')), false);
    assert.equal(__test.isLanDirectRequest(request('127.0.0.1', '192.168.1.34:4173')), false);
  } finally {
    if (previousLanDirect === undefined) delete process.env.LAN_DIRECT_ACCESS;
    else process.env.LAN_DIRECT_ACCESS = previousLanDirect;
    if (previousViteLanDirect === undefined) delete process.env.VITE_LAN_DIRECT_ACCESS;
    else process.env.VITE_LAN_DIRECT_ACCESS = previousViteLanDirect;
  }
});

test('LAN direct access can be disabled without changing online authentication', () => {
  const previousLanDirect = process.env.LAN_DIRECT_ACCESS;
  const previousViteLanDirect = process.env.VITE_LAN_DIRECT_ACCESS;
  process.env.LAN_DIRECT_ACCESS = 'false';
  process.env.VITE_LAN_DIRECT_ACCESS = 'false';

  try {
    assert.equal(__test.isLanDirectRequest(request('192.168.1.88', '192.168.1.34:4173')), false);
  } finally {
    if (previousLanDirect === undefined) delete process.env.LAN_DIRECT_ACCESS;
    else process.env.LAN_DIRECT_ACCESS = previousLanDirect;
    if (previousViteLanDirect === undefined) delete process.env.VITE_LAN_DIRECT_ACCESS;
    else process.env.VITE_LAN_DIRECT_ACCESS = previousViteLanDirect;
  }
});

test('unlimited quota is restricted to loopback or verified LAN direct access', () => {
  const previousLanDirect = process.env.LAN_DIRECT_ACCESS;
  const previousViteLanDirect = process.env.VITE_LAN_DIRECT_ACCESS;
  process.env.LAN_DIRECT_ACCESS = 'true';
  process.env.VITE_LAN_DIRECT_ACCESS = 'true';

  try {
    assert.equal(
      __test.isLocalUnlimitedQuotaRequest(
        request('192.168.1.88', '192.168.1.34:4173'),
        { isLanDirect: true },
      ),
      true,
    );
    assert.equal(
      __test.isLocalUnlimitedQuotaRequest(
        request('127.0.0.1', '127.0.0.1:4173'),
        {},
      ),
      true,
    );
    assert.equal(
      __test.isLocalUnlimitedQuotaRequest(
        request('127.0.0.1', 'studio.example.com'),
        {},
      ),
      false,
    );
    assert.equal(
      __test.isLocalUnlimitedQuotaRequest(
        request('8.8.8.8', 'studio.example.com'),
        { isLanDirect: true },
      ),
      false,
    );
  } finally {
    if (previousLanDirect === undefined) delete process.env.LAN_DIRECT_ACCESS;
    else process.env.LAN_DIRECT_ACCESS = previousLanDirect;
    if (previousViteLanDirect === undefined) delete process.env.VITE_LAN_DIRECT_ACCESS;
    else process.env.VITE_LAN_DIRECT_ACCESS = previousViteLanDirect;
  }
});

test('browser and server both require the explicit LAN direct access contract', () => {
  const authClient = fs.readFileSync(path.join(root, 'src/services/authClient.ts'), 'utf8');
  const authGate = fs.readFileSync(path.join(root, 'src/components/AuthGate.tsx'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server/index.cjs'), 'utf8');

  assert.match(authClient, /VITE_LAN_DIRECT_ACCESS/);
  assert.match(authClient, /LAN_DIRECT_ACCESS_TOKEN/);
  assert.match(authClient, /isPrivateNetworkHostname\(window\.location\.hostname\)/);
  assert.match(authGate, /if \(lanDirectAccessEnabled\) \{\s*return <>\{children\}<\/>;/);
  assert.match(server, /token === LAN_DIRECT_ACCESS_TOKEN && isLanDirectRequest\(req\)/);
});
