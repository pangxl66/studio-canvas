const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');

const requiredPublic = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_LLM_PROXY_URL'];
const requiredServer = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LLM_API_KEY',
];
const oneOfServer = ['LLM_BASE_URL', 'LLM_PROXY_URL'];
const args = new Set(process.argv.slice(2));
const forceProduction = args.has('--prod') || args.has('--production');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    result[key] = value;
  }
  return result;
}

function readConfig() {
  const fileEnv = parseEnvFile(envPath);
  return {
    ...fileEnv,
    ...process.env,
  };
}

function hasValue(config, key) {
  return Boolean(String(config[key] ?? '').trim());
}

function printCheck(label, ok, detail = '') {
  const mark = ok ? 'OK ' : 'MISS';
  console.log(`${mark} ${label}${detail ? ` - ${detail}` : ''}`);
}

const config = readConfig();
const hasEnvLocal = fs.existsSync(envPath);
const mockMode = String(config.VITE_SAAS_MOCK ?? '').trim().toLowerCase();
const configuredMock = mockMode === '1' || mockMode === 'true' || mockMode === 'yes';
const isMock = configuredMock && !forceProduction;

console.log('Studio Canvas SaaS env check');
console.log(`.env.local: ${hasEnvLocal ? 'found' : 'not found'}`);
console.log(`mode: ${isMock ? 'mock' : 'real'}${forceProduction ? ' (production check)' : ''}`);
console.log('');

let failed = false;

if (forceProduction && configuredMock) {
  printCheck('VITE_SAAS_MOCK', false, 'must be false or empty for production website deployment');
  failed = true;
}

if (!isMock && hasValue(config, 'VITE_LLM_API_KEY')) {
  printCheck('VITE_LLM_API_KEY', false, 'do not expose model API keys to the browser');
  failed = true;
}

if (!isMock && hasValue(config, 'VITE_LLM_BASE_URL')) {
  printCheck('VITE_LLM_BASE_URL', false, 'use server-only LLM_BASE_URL for the website build');
  failed = true;
}

for (const key of requiredPublic) {
  if (isMock && (key === 'VITE_SUPABASE_URL' || key === 'VITE_SUPABASE_ANON_KEY')) {
    printCheck(key, true, 'skipped in mock mode');
    continue;
  }
  const ok = hasValue(config, key);
  printCheck(key, ok, ok ? 'public browser config present' : 'required for website login/API proxy');
  failed ||= !ok;
}

for (const key of requiredServer) {
  if (isMock && key.startsWith('SUPABASE_')) {
    printCheck(key, true, 'skipped in mock mode');
    continue;
  }
  const ok = hasValue(config, key);
  printCheck(key, ok, ok ? 'server-only config present' : 'required by /api routes');
  failed ||= !ok;
}

const hasUpstream = oneOfServer.some((key) => hasValue(config, key));
printCheck(oneOfServer.join(' or '), hasUpstream, hasUpstream ? 'LLM upstream configured' : 'required by /api/llm/chat');
failed ||= !hasUpstream;

if (isMock) {
  console.log('');
  console.log('Note: VITE_SAAS_MOCK is enabled. Real Supabase auth/cloud APIs are intentionally bypassed in the browser.');
}

if (failed) {
  console.log('');
  console.log(`Result: SaaS ${isMock ? 'mock' : 'real'} mode is not ready yet. Fill the missing values in .env.local or your Vercel environment.`);
  process.exitCode = 1;
} else {
  console.log('');
  console.log(
    isMock
      ? 'Result: SaaS mock mode env looks ready. Run `npm run dev` for local UI + LLM testing.'
      : 'Result: SaaS real mode env looks ready. Run `npm run saas:dev` for local API + frontend testing.',
  );
}
