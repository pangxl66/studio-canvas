const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createClient } = require('@supabase/supabase-js');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const execFileAsync = promisify(execFile);

function parseEnvMs(value, fallback, min, max) {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const MAX_INPUT_CHARS = 80_000;
const MAX_PROJECT_SNAPSHOT_CHARS = 5_000_000;
const PROJECT_LIST_LIMIT = 40;
const MAX_VIDEO_UPLOAD_BYTES = Number.parseInt(process.env.VIDEO_FRAME_MAX_UPLOAD_BYTES || '', 10) || 300 * 1024 * 1024;
const DEFAULT_MONTHLY_QUOTA = 10;
const LEGACY_DEFAULT_MONTHLY_QUOTA = 20;
const DEFAULT_TIMEOUT_MS = parseEnvMs(process.env.LLM_TIMEOUT_MS || process.env.VITE_LLM_TIMEOUT_MS, 420_000, 420_000, 900_000);
const DEFAULT_MODEL = 'gpt-5.5';
const PRIMARY_MODEL_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const PRIMARY_MODEL_COOLDOWN_MS = 10 * 60 * 1000;
const PRIMARY_MODEL_FAILURE_THRESHOLD = 2;
const TEST_INVITE_TOKEN_PREFIX = 'test-invite';
const testInviteActivationPath = path.join(rootDir, '.data', 'test-invite-activations.json');
const testInviteUsagePath = path.join(rootDir, '.data', 'test-invite-usage-events.json');
const testInviteActivations = new Set();
const testInviteActivationTimes = new Map();
const testInviteQuotas = new Map();
let testInviteUsageEvents = [];
let testInviteActivationsLoaded = false;
let testInviteUsageLoaded = false;
const modelFailureState = new Map();

loadLocalEnvFile(path.join(rootDir, '.env.local'));

function loadLocalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function env(name) {
  return String(process.env[name] || '').trim();
}

function normalizeInviteCode(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function parseTestInviteCodes(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeInviteCode).filter(Boolean);
    }
  } catch {
    // Fall back to a human-friendly comma/newline/space separated list.
  }

  return raw.split(/[\s,;\uFF0C\uFF1B]+/u).map(normalizeInviteCode).filter(Boolean);
}

function getTestInviteCode() {
  return normalizeInviteCode(env('TEST_INVITE_CODE'));
}

function getTestInviteCodes() {
  const codes = [
    ...parseTestInviteCodes(env('TEST_INVITE_CODES')),
    ...parseTestInviteCodes(getTestInviteCode()),
  ];
  return [...new Set(codes)];
}

function getTestInviteSecret() {
  return env('TEST_INVITE_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY') || getTestInviteCodes()[0];
}

function getTestInviteSecrets() {
  const secrets = [
    env('TEST_INVITE_SECRET'),
    env('SUPABASE_SERVICE_ROLE_KEY'),
    ...parseTestInviteCodes(env('TEST_INVITE_LEGACY_SECRETS')),
    getTestInviteCodes()[0],
  ].filter(Boolean);
  return [...new Set(secrets)];
}

function getTestInviteMonthlyQuota() {
  const value = Number.parseInt(env('TEST_INVITE_MONTHLY_QUOTA') || '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MONTHLY_QUOTA;
}

function getLegacyTestInviteMonthlyQuota() {
  const value = Number.parseInt(env('TEST_INVITE_LEGACY_MONTHLY_QUOTA') || '', 10);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signTestInvitePayload(payload) {
  const secret = getTestInviteSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function signTestInvitePayloadWithSecret(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createTestInviteToken(email) {
  const payload = base64UrlJson({
    email,
    iat: Math.floor(Date.now() / 1000),
  });
  const signature = signTestInvitePayload(payload);
  if (!signature) return '';
  return `${TEST_INVITE_TOKEN_PREFIX}.${payload}.${signature}`;
}

function getTestInviteUserId(email) {
  return `test-invite:${crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex').slice(0, 16)}`;
}

function readTestInviteToken(token) {
  const secrets = getTestInviteSecrets();
  if (!secrets.length || !token || !token.startsWith(`${TEST_INVITE_TOKEN_PREFIX}.`)) {
    return null;
  }

  const [, payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const actualBuffer = Buffer.from(signature);
  const isVerified = secrets.some((secret) => {
    const expected = signTestInvitePayloadWithSecret(payload, secret);
    const expectedBuffer = Buffer.from(expected);
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  });
  if (!isVerified) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const email = normalizeEmail(data.email) || normalizeEmail(env('TEST_INVITE_EMAIL')) || 'tester@studio-canvas.local';
    return {
      email,
      id: getTestInviteUserId(email),
    };
  } catch {
    return null;
  }
}

function readTestInviteQuota(email) {
  ensureTestInviteActivationsLoaded();
  const normalizedEmail = normalizeEmail(email) || 'tester@studio-canvas.local';
  const monthlyQuota = getTestInviteMonthlyQuotaForEmail(normalizedEmail);
  const existing = testInviteQuotas.get(normalizedEmail);
  if (existing) {
    return existing;
  }
  const nextQuota = {
    isCustom: false,
    monthlyQuota,
    remainingQuota: monthlyQuota,
    updatedAt: new Date().toISOString(),
  };
  testInviteQuotas.set(normalizedEmail, nextQuota);
  return nextQuota;
}

function reserveTestInviteQuota(email, cost) {
  const quota = readTestInviteQuota(email);
  const safeCost = Math.max(Number(cost) || 1, 1);
  if (quota.remainingQuota < safeCost) {
    return {
      ok: false,
      message: `测试额度不足，当前剩余 ${quota.remainingQuota} 次，本次需要 ${safeCost} 次。`,
      remaining: quota.remainingQuota,
    };
  }
  quota.remainingQuota -= safeCost;
  quota.updatedAt = new Date().toISOString();
  return { ok: true, remaining: quota.remainingQuota };
}

function refundTestInviteQuota(email, cost) {
  const quota = readTestInviteQuota(email);
  const safeCost = Math.max(Number(cost) || 1, 1);
  quota.remainingQuota = Math.min(quota.monthlyQuota, quota.remainingQuota + safeCost);
  quota.updatedAt = new Date().toISOString();
}

function writeTestInviteQuota(email, monthlyQuota, remainingQuota) {
  const normalizedEmail = normalizeEmail(email) || 'tester@studio-canvas.local';
  const nextQuota = {
    isCustom: true,
    monthlyQuota: Math.max(0, Number(monthlyQuota) || 0),
    remainingQuota: Math.max(0, Number(remainingQuota) || 0),
    updatedAt: new Date().toISOString(),
  };
  testInviteQuotas.set(normalizedEmail, nextQuota);
  return nextQuota;
}

function ensureTestInviteActivationsLoaded() {
  if (testInviteActivationsLoaded) return;
  testInviteActivationsLoaded = true;
  try {
    if (!fs.existsSync(testInviteActivationPath)) return;
    const raw = fs.readFileSync(testInviteActivationPath, 'utf8');
    const parsed = JSON.parse(raw);
    const emails = Array.isArray(parsed) ? parsed : parsed?.emails;
    const activations = parsed && !Array.isArray(parsed) && parsed.activations && typeof parsed.activations === 'object'
      ? parsed.activations
      : null;
    if (activations) {
      for (const [email, activatedAt] of Object.entries(activations)) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail) continue;
        testInviteActivations.add(normalizedEmail);
        if (typeof activatedAt === 'string' && activatedAt.trim()) {
          testInviteActivationTimes.set(normalizedEmail, activatedAt);
        }
      }
    }
    if (!Array.isArray(emails)) return;
    for (const email of emails) {
      const normalizedEmail = normalizeEmail(email);
      if (normalizedEmail) testInviteActivations.add(normalizedEmail);
    }
  } catch (error) {
    console.warn('Failed to read test invite activations', sanitizeError(error));
  }
}

function saveTestInviteActivations() {
  try {
    fs.mkdirSync(path.dirname(testInviteActivationPath), { recursive: true });
    const emails = [...testInviteActivations].sort();
    const payload = JSON.stringify(
      {
        activations: Object.fromEntries(emails.map((email) => [email, testInviteActivationTimes.get(email) || null])),
        emails,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const tempPath = `${testInviteActivationPath}.tmp`;
    fs.writeFileSync(tempPath, payload);
    fs.renameSync(tempPath, testInviteActivationPath);
  } catch (error) {
    console.warn('Failed to save test invite activations', sanitizeError(error));
  }
}

function hasActivatedTestInviteEmail(email) {
  ensureTestInviteActivationsLoaded();
  const normalizedEmail = normalizeEmail(email);
  return Boolean(normalizedEmail && (testInviteActivations.has(normalizedEmail) || testInviteQuotas.has(normalizedEmail)));
}

function rememberActivatedTestInviteEmail(email) {
  ensureTestInviteActivationsLoaded();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || testInviteActivations.has(normalizedEmail)) return;
  testInviteActivations.add(normalizedEmail);
  testInviteActivationTimes.set(normalizedEmail, new Date().toISOString());
  saveTestInviteActivations();
}

function isFreshTestInviteActivation(email) {
  const activatedAt = Date.parse(String(testInviteActivationTimes.get(email) || ''));
  return Number.isFinite(activatedAt) && activatedAt >= getNewUserDefaultQuotaEffectiveMs();
}

function getTestInviteMonthlyQuotaForEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail && testInviteActivations.has(normalizedEmail) && !isFreshTestInviteActivation(normalizedEmail)) {
    return getLegacyTestInviteMonthlyQuota();
  }
  return getTestInviteMonthlyQuota();
}

function ensureTestInviteUsageLoaded() {
  if (testInviteUsageLoaded) return;
  testInviteUsageLoaded = true;
  try {
    if (!fs.existsSync(testInviteUsagePath)) return;
    const raw = fs.readFileSync(testInviteUsagePath, 'utf8');
    const parsed = JSON.parse(raw);
    const events = Array.isArray(parsed) ? parsed : parsed?.events;
    if (Array.isArray(events)) {
      testInviteUsageEvents = events.filter((event) => event && typeof event === 'object').slice(-1000);
    }
  } catch (error) {
    console.warn('Failed to read test invite usage events', sanitizeError(error));
  }
}

function saveTestInviteUsageEvents() {
  try {
    fs.mkdirSync(path.dirname(testInviteUsagePath), { recursive: true });
    const payload = JSON.stringify(
      {
        events: testInviteUsageEvents.slice(-1000),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const tempPath = `${testInviteUsagePath}.tmp`;
    fs.writeFileSync(tempPath, payload);
    fs.renameSync(tempPath, testInviteUsagePath);
  } catch (error) {
    console.warn('Failed to save test invite usage events', sanitizeError(error));
  }
}

function writeTestInviteUsage(email, usage) {
  ensureTestInviteUsageLoaded();
  const normalizedEmail = normalizeEmail(email) || 'tester@studio-canvas.local';
  testInviteUsageEvents.push({
    created_at: new Date().toISOString(),
    email: normalizedEmail,
    error_message: usage.error_message || null,
    estimated_tokens: Number(usage.estimated_tokens || 0),
    feature: usage.feature || '',
    input_chars: Number(usage.input_chars || 0),
    model: usage.model || '',
    output_chars: Number(usage.output_chars || 0),
    project_id: usage.project_id || null,
    quota_cost: Number(usage.quota_cost || 0),
    status: usage.status || '',
    user_id: usage.user_id || getTestInviteUserId(normalizedEmail),
  });
  testInviteUsageEvents = testInviteUsageEvents.slice(-1000);
  saveTestInviteUsageEvents();
}

function readTestInviteUsageEvents(email, limit) {
  ensureTestInviteUsageLoaded();
  const normalizedEmail = normalizeEmail(email);
  return testInviteUsageEvents
    .filter((event) => !normalizedEmail || normalizeEmail(event.email) === normalizedEmail)
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, limit)
    .map((event) => ({
      ...normalizeUsageEvent(event),
      source: 'test-invite',
      user: {
        displayName: '测试邀请码',
        email: normalizeEmail(event.email) || 'tester@studio-canvas.local',
        plan: 'test',
        userId: event.user_id || getTestInviteUserId(event.email),
      },
    }));
}

function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'deepseek') return 'deepseek';
  if (raw === 'gpt') return 'gpt';
  return '';
}

function providerEnvPrefix(provider) {
  if (provider === 'deepseek') return 'DEEPSEEK';
  if (provider === 'gpt') return 'GPT';
  return '';
}

function envForProvider(provider, name) {
  const prefix = providerEnvPrefix(provider);
  if (prefix) {
    const providerValue = env(`${prefix}_${name}`);
    if (providerValue) return providerValue;
  }
  return env(name);
}

function explicitEnvForProvider(provider, name) {
  const prefix = providerEnvPrefix(provider);
  if (prefix) return env(`${prefix}_${name}`);
  return env(name);
}

function defaultModelForProvider(provider) {
  return provider === 'deepseek' ? 'deepseek-chat' : DEFAULT_MODEL;
}

function parseModelList(value) {
  const seen = new Set();
  const result = [];
  for (const item of String(value || '').split(/[,;\n]/)) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function fallbackModelsForProvider(provider, primaryModel) {
  const configured = parseModelList(envForProvider(provider, 'LLM_FALLBACK_MODELS'));
  const inferred =
    provider !== 'deepseek' && String(primaryModel || '').trim().toLowerCase().includes('gpt-5.5')
      ? ['gpt-5.4']
      : [];
  const primaryKey = String(primaryModel || '').trim().toLowerCase();
  return parseModelList([...configured, ...inferred].join(',')).filter((model) => model.toLowerCase() !== primaryKey);
}

function modelFailureKey(provider, primaryModel) {
  return `${provider || 'default'}|${String(primaryModel || '').trim().toLowerCase()}`;
}

function isPrimaryModelCoolingDown(provider, primaryModel) {
  const state = modelFailureState.get(modelFailureKey(provider, primaryModel));
  return Boolean(state && state.cooldownUntil > Date.now());
}

function recordPrimaryModelFailure(provider, primaryModel) {
  const key = modelFailureKey(provider, primaryModel);
  const now = Date.now();
  const previous = modelFailureState.get(key);
  const hits = [...(previous?.hits || []), now].filter((time) => now - time <= PRIMARY_MODEL_FAILURE_WINDOW_MS);
  modelFailureState.set(key, {
    hits,
    cooldownUntil: hits.length >= PRIMARY_MODEL_FAILURE_THRESHOLD ? now + PRIMARY_MODEL_COOLDOWN_MS : previous?.cooldownUntil || 0,
  });
}

function clearPrimaryModelFailures(provider, primaryModel) {
  modelFailureState.delete(modelFailureKey(provider, primaryModel));
}

function modelAttemptPlan(provider, primaryModel) {
  const fallbacks = fallbackModelsForProvider(provider, primaryModel);
  if (!fallbacks.length) return [primaryModel];
  return isPrimaryModelCoolingDown(provider, primaryModel) ? fallbacks : [primaryModel, ...fallbacks];
}

function shouldRetrySameProviderFallback(status) {
  return status === 429 || status >= 500;
}

function hasProviderLlmApiKey(provider) {
  return Boolean(envForProvider(provider, 'LLM_API_KEY'));
}

function hasProviderLlmUpstream(provider) {
  return Boolean(envForProvider(provider, 'LLM_PROXY_URL') || envForProvider(provider, 'LLM_BASE_URL'));
}

function hasExplicitProviderLlmUpstream(provider) {
  return Boolean(explicitEnvForProvider(provider, 'LLM_PROXY_URL') || explicitEnvForProvider(provider, 'LLM_BASE_URL'));
}

function hasExplicitProviderLlmApiKey(provider) {
  return Boolean(explicitEnvForProvider(provider, 'LLM_API_KEY'));
}

function contentContainsImage(value) {
  if (Array.isArray(value)) {
    return value.some((part) => contentContainsImage(part));
  }
  if (value && typeof value === 'object') {
    const type = String(value.type || '').toLowerCase();
    return type.includes('image') || contentContainsImage(value.content) || contentContainsImage(value.image_url);
  }
  return false;
}

function requestNeedsVision(body) {
  if (String(body?.feature || '').trim() === 'image-text-polish') return true;
  return Array.isArray(body?.messages) && body.messages.some((message) => contentContainsImage(message?.content));
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(message);
}

function sanitizeError(raw) {
  return String(raw || '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/("api[_-]?key"\s*:\s*")([^"]+)(")/gi, '$1***$3')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractUpstreamErrorText(raw) {
  const parsed = parseJsonObject(raw);
  const error = parsed && typeof parsed.error === 'object' && parsed.error ? parsed.error : null;
  const parts = [
    error?.message,
    error?.code,
    error?.type,
    parsed?.message,
    parsed?.code,
    parsed?.type,
    raw,
  ]
    .filter((part) => typeof part === 'string' && part.trim())
    .map((part) => part.trim());
  return sanitizeError(parts.join(' '));
}

function classifyUpstreamError(status, raw) {
  const text = extractUpstreamErrorText(raw);
  const lower = text.toLowerCase();

  if (/concurrency|too many concurrent|并发/.test(lower)) {
    return '模型服务并发已达上限：上游当前太忙，请稍后再试。';
  }
  if (/rate.?limit|too many requests|request limit|请求过于频繁|限流/.test(lower)) {
    return '模型服务限流：请求过于频繁，请稍后再试。';
  }
  if (
    /insufficient[_ -]?quota|quota[_ -]?exceeded|tokenstatusexhausted|credit|billing|balance|prepaid|余额|额度不足|账户.*不足/.test(
      lower,
    ) ||
    status === 402
  ) {
    return '模型服务额度不足：上游模型账户余额或额度不足，请更换可用 Key 或充值后重试。';
  }
  if (
    /invalid.?api.?key|api key.*invalid|incorrect api key|invalid authorization|authentication|unauthorized|鉴权|认证失败/.test(
      lower,
    ) ||
    status === 401
  ) {
    return '模型服务鉴权失败：API Key 无效或未正确配置，请检查服务器 .env。';
  }
  if (
    /permission|forbidden|access denied|not have access|unsupported_country_region_territory|无权|权限|地区|国家/.test(
      lower,
    ) ||
    status === 403
  ) {
    return '模型服务权限不足：当前 Key 无权访问该模型，或当前服务器地区不被上游支持。';
  }
  if (/model.*not found|unknown model|model.*does not exist|invalid model|模型.*不存在|模型.*无效/.test(lower)) {
    return '模型名称不可用：当前配置的模型不存在或账号未开通，请检查 LLM_MODEL。';
  }
  if (
    /context.?length|maximum context|max tokens|too many tokens|token.*exceed|context_length_exceeded|上下文|输入过长/.test(
      lower,
    )
  ) {
    return '模型输入过长：当前内容超出模型上下文限制，请减少输入或拆分镜头后再试。';
  }
  if (
    status === 400 &&
    /unknown variant [`'"]?image_url|expected [`'"]?text|image[_ -]?url.*expected.*text|does not support.*image|vision.*not supported/.test(
      lower,
    )
  ) {
    return '当前模型通道不支持图片输入：图片节点需要走 GPT/视觉模型。请切换到 GPT，或在服务器配置支持图片理解的 GPT_LLM_MODEL / GPT_LLM_BASE_URL 后重试。';
  }
  if (status >= 500) {
    return '模型服务暂时不可用：上游服务异常，请稍后再试。';
  }
  if (status === 400) {
    return `模型请求参数无效：请检查模型名、Base URL 或请求格式。${text ? ` 上游返回：${text.slice(0, 220)}` : ''}`;
  }
  return `模型服务返回异常：HTTP ${status}${text ? `，${text.slice(0, 220)}` : ''}`;
}

function classifyLlmRequestException(error) {
  if (error instanceof Error && error.name === 'AbortError') {
    return '模型请求超时：上游响应时间过长，请稍后重试。';
  }
  const text = sanitizeError(error);
  if (/LLM upstream env is missing/i.test(text)) {
    return '模型服务未配置：服务器缺少 LLM_BASE_URL 或 LLM_API_KEY。';
  }
  if (/GPT vision upstream env is missing/i.test(text)) {
    return '图片理解服务未配置：服务器缺少 GPT_LLM_BASE_URL / GPT_LLM_API_KEY / GPT_LLM_MODEL，图片节点需要走支持视觉输入的 GPT 通道。';
  }
  if (/fetch failed|network|econn|enotfound|etimedout|connection|socket/i.test(text)) {
    return '无法访问模型服务：请检查 LLM_BASE_URL、服务器网络或上游服务状态。';
  }
  return text || '模型请求失败。';
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseVideoDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const buffer = Buffer.from(match[2], 'base64');
  return { buffer, mimeType };
}

function safeVideoExtension(fileName, mimeType) {
  const fromName = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  const allowed = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'qt']);
  if (fromName && allowed.has(fromName)) return fromName === 'qt' ? 'mov' : fromName;
  const lowerMime = String(mimeType || '').toLowerCase();
  if (lowerMime.includes('quicktime')) return 'mov';
  if (lowerMime.includes('mp4')) return 'mp4';
  if (lowerMime.includes('webm')) return 'webm';
  if (lowerMime.includes('x-matroska')) return 'mkv';
  if (lowerMime.includes('x-msvideo')) return 'avi';
  return 'mp4';
}

function resolveServerFrameTimes(duration) {
  if (!Number.isFinite(duration) || duration <= 0.2) return [0, 0, 0];
  const start = Math.min(0.3, duration * 0.08);
  const mid = duration * 0.5;
  const end = Math.max(start, duration - Math.min(0.35, duration * 0.08));
  return [start, mid, end];
}

async function probeVideoFile(filePath) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      filePath,
    ],
    { timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout || '{}');
  const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : null;
  const format = parsed.format || {};
  return {
    width: Number(stream?.width) || undefined,
    height: Number(stream?.height) || undefined,
    durationSec: Number(format.duration) || undefined,
  };
}

async function extractVideoFrame(filePath, outputPath, time) {
  await execFileAsync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(Math.max(0, Number(time) || 0)),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      outputPath,
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 },
  );
}

async function handleVideoContactSheet(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { message: '请求体不是合法 JSON。' } });
    return;
  }

  const parsed = parseVideoDataUrl(body.videoDataUrl);
  if (!parsed) {
    sendJson(res, 400, { error: { message: '缺少可处理的视频 Data URL。' } });
    return;
  }
  if (parsed.buffer.length > MAX_VIDEO_UPLOAD_BYTES) {
    sendJson(res, 413, { error: { message: '视频文件过大，无法在线抽帧。请先压缩或转成较小的 H.264 MP4。' } });
    return;
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'studio-video-'));
  try {
    const mimeType = String(body.mimeType || parsed.mimeType || '').trim();
    const ext = safeVideoExtension(body.fileName, mimeType);
    const inputPath = path.join(tmpDir, `input.${ext}`);
    await fs.promises.writeFile(inputPath, parsed.buffer);

    const meta = await probeVideoFile(inputPath);
    const times = resolveServerFrameTimes(meta.durationSec || 0);
    const frameDataUrls = [];

    for (let index = 0; index < times.length; index += 1) {
      const outputPath = path.join(tmpDir, `frame-${index}.jpg`);
      try {
        await extractVideoFrame(inputPath, outputPath, times[index]);
      } catch (error) {
        if ((times[index] || 0) > 0) {
          await extractVideoFrame(inputPath, outputPath, 0);
        } else {
          throw error;
        }
      }
      const frame = await fs.promises.readFile(outputPath);
      frameDataUrls.push(`data:image/jpeg;base64,${frame.toString('base64')}`);
    }

    sendJson(res, 200, {
      ok: true,
      frameDataUrls,
      times,
      durationSec: meta.durationSec,
      width: meta.width,
      height: meta.height,
    });
  } catch (error) {
    const text = sanitizeError(error);
    const errorCode = error && typeof error === 'object' ? String(error.code || '') : '';
    const isMissingFfmpeg = errorCode === 'ENOENT' || /\bENOENT\b|not found|not recognized/i.test(text);
    console.warn('Video contact sheet extraction failed', text);
    sendJson(res, 500, {
      error: {
        message: isMissingFfmpeg
          ? '服务器视频抽帧组件不可用：请确认线上容器已安装 ffmpeg 并重新部署。'
          : `服务器视频抽帧失败：${text || '无法读取当前视频编码。'}`,
      },
    });
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function isTruthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function isLocalMockAuthEnabled() {
  return isTruthyEnv(env('SAAS_MOCK')) || isTruthyEnv(env('VITE_SAAS_MOCK'));
}

function getAuthClients(token) {
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseAnonKey = env('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error('Server Supabase env is missing.');
  }

  return {
    authClient: createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }),
    serviceClient: createClient(supabaseUrl, supabaseServiceRoleKey),
  };
}

function getServiceClient() {
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Server Supabase service env is missing.');
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

async function getAuthedContext(req) {
  const token = getBearerToken(req);
  const testInvite = readTestInviteToken(token);
  if (testInvite) {
    const now = new Date().toISOString();
    return {
      isTestInvite: true,
      serviceClient: null,
      user: {
        app_metadata: { provider: 'test-invite' },
        aud: 'authenticated',
        created_at: now,
        email: testInvite.email,
        id: testInvite.id,
        role: 'authenticated',
        updated_at: now,
        user_metadata: { testInvite: true },
      },
      userId: testInvite.id,
    };
  }
  if (isLocalMockAuthEnabled() && token === 'mock-access-token') {
    const headerEmail = Array.isArray(req.headers['x-studio-mock-email'])
      ? req.headers['x-studio-mock-email'][0]
      : req.headers['x-studio-mock-email'];
    const email = normalizeEmail(headerEmail) || 'mock-user@studio-canvas.local';
    const now = new Date().toISOString();
    const userId = `mock:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
    return {
      isTestInvite: true,
      serviceClient: null,
      user: {
        app_metadata: { provider: 'mock' },
        aud: 'authenticated',
        created_at: now,
        email,
        id: userId,
        role: 'authenticated',
        updated_at: now,
        user_metadata: { mockAuth: true },
      },
      userId,
    };
  }
  if (!token) {
    return { error: { status: 401, message: '请先登录。' } };
  }

  try {
    const { authClient, serviceClient } = getAuthClients(token);
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) {
      return { error: { status: 401, message: '登录状态已失效，请重新登录。' } };
    }
    return { serviceClient, user: data.user, userId: data.user.id };
  } catch (error) {
    return { error: { status: 500, message: sanitizeError(error) || '服务器鉴权配置缺失。' } };
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function configuredAdminEmails() {
  return env('ADMIN_EMAILS')
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function isAdminUser(user) {
  const email = normalizeEmail(user?.email);
  return Boolean(email && configuredAdminEmails().includes(email));
}

async function getAdminContext(req) {
  const auth = await getAuthedContext(req);
  if (auth.error) return auth;

  const admins = configuredAdminEmails();
  if (!admins.length) {
    return { error: { status: 403, message: '管理员功能未启用：请先在服务器 .env 配置 ADMIN_EMAILS。' } };
  }
  if (!isAdminUser(auth.user)) {
    return { error: { status: 403, message: '当前账号不是管理员，无法管理额度。' } };
  }
  if (!auth.serviceClient) {
    try {
      return { ...auth, serviceClient: getServiceClient() };
    } catch (error) {
      return { error: { status: 500, message: sanitizeError(error) || 'Server admin env is missing.' } };
    }
  }
  return auth;
}

async function ensureUserRows(serviceClient, user) {
  await Promise.all([
    serviceClient.from('profiles').upsert(
      {
        id: user.id,
        email: user.email || null,
      },
      { onConflict: 'id' },
    ),
    serviceClient.from('credit_wallets').upsert(
      {
        user_id: user.id,
        monthly_quota: DEFAULT_MONTHLY_QUOTA,
        remaining_quota: DEFAULT_MONTHLY_QUOTA,
      },
      { onConflict: 'user_id', ignoreDuplicates: true },
    ),
  ]);
  await normalizeFreshUserDefaultQuota(serviceClient, user);
}

function getNewUserDefaultQuotaEffectiveMs() {
  const fallback = '2026-06-03T11:30:00+08:00';
  const parsed = Date.parse(env('NEW_USER_DEFAULT_QUOTA_EFFECTIVE_AT') || fallback);
  return Number.isFinite(parsed) ? parsed : Date.parse(fallback);
}

function isNewQuotaPolicyUser(user) {
  const createdAt = Date.parse(String(user?.created_at || user?.createdAt || ''));
  return Number.isFinite(createdAt) && createdAt >= getNewUserDefaultQuotaEffectiveMs();
}

function isUntouchedHigherDefaultWallet(wallet) {
  if (!wallet) return false;
  const monthlyQuota = Number(wallet.monthly_quota || 0);
  const remainingQuota = Number(wallet.remaining_quota || 0);
  return monthlyQuota > DEFAULT_MONTHLY_QUOTA && remainingQuota === monthlyQuota;
}

async function normalizeFreshUserDefaultQuota(serviceClient, user) {
  if (!isNewQuotaPolicyUser(user)) return null;

  const { data: wallet, error } = await serviceClient
    .from('credit_wallets')
    .select('monthly_quota,remaining_quota,reset_at,updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !isUntouchedHigherDefaultWallet(wallet)) {
    if (error) console.warn('Fresh default quota read failed', sanitizeError(error.message));
    return wallet || null;
  }

  const nextUpdatedAt = new Date().toISOString();
  const { data, error: updateError } = await serviceClient
    .from('credit_wallets')
    .update({
      monthly_quota: DEFAULT_MONTHLY_QUOTA,
      remaining_quota: DEFAULT_MONTHLY_QUOTA,
      updated_at: nextUpdatedAt,
    })
    .eq('user_id', user.id)
    .eq('monthly_quota', Number(wallet.monthly_quota || 0))
    .eq('remaining_quota', Number(wallet.remaining_quota || 0))
    .select('monthly_quota,remaining_quota,reset_at,updated_at')
    .maybeSingle();

  if (updateError) {
    console.warn('Fresh default quota normalization failed', sanitizeError(updateError.message));
    return wallet;
  }

  return data || {
    ...wallet,
    monthly_quota: DEFAULT_MONTHLY_QUOTA,
    remaining_quota: DEFAULT_MONTHLY_QUOTA,
    updated_at: nextUpdatedAt,
  };
}

function shouldUpgradeLegacyDefaultQuota(wallet) {
  if (DEFAULT_MONTHLY_QUOTA <= LEGACY_DEFAULT_MONTHLY_QUOTA) return false;
  if (!wallet) return false;

  const monthlyQuota = Number(wallet.monthly_quota || 0);
  const remainingQuota = Number(wallet.remaining_quota || 0);
  return monthlyQuota === LEGACY_DEFAULT_MONTHLY_QUOTA && remainingQuota <= LEGACY_DEFAULT_MONTHLY_QUOTA;
}

async function upgradeLegacyDefaultQuota(serviceClient, userId, wallet) {
  if (!shouldUpgradeLegacyDefaultQuota(wallet)) return wallet;

  const nextUpdatedAt = new Date().toISOString();
  const { data, error } = await serviceClient
    .from('credit_wallets')
    .update({
      monthly_quota: DEFAULT_MONTHLY_QUOTA,
      remaining_quota: DEFAULT_MONTHLY_QUOTA,
      updated_at: nextUpdatedAt,
    })
    .eq('user_id', userId)
    .eq('monthly_quota', LEGACY_DEFAULT_MONTHLY_QUOTA)
    .select('monthly_quota,remaining_quota,reset_at,updated_at')
    .maybeSingle();

  if (error) {
    console.warn('Legacy default quota upgrade failed', sanitizeError(error.message));
    return wallet;
  }

  return data || {
    ...wallet,
    monthly_quota: DEFAULT_MONTHLY_QUOTA,
    remaining_quota: DEFAULT_MONTHLY_QUOTA,
    updated_at: nextUpdatedAt,
  };
}

async function upgradeLegacyDefaultQuotaForUser(serviceClient, userId) {
  const { data: wallet, error } = await serviceClient
    .from('credit_wallets')
    .select('monthly_quota,remaining_quota,reset_at,updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !wallet) {
    if (error) console.warn('Legacy default quota read failed', sanitizeError(error.message));
    return null;
  }

  return upgradeLegacyDefaultQuota(serviceClient, userId, wallet);
}

function hasLlmUpstream() {
  return hasProviderLlmUpstream('') || hasProviderLlmUpstream('gpt') || hasProviderLlmUpstream('deepseek');
}

function buildProxyHeaders(req, body) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === 'host' ||
      lowerKey === 'connection' ||
      lowerKey === 'content-length' ||
      lowerKey === 'accept-encoding'
    ) {
      continue;
    }
    if (value !== undefined) headers[key] = value;
  }
  if (body?.length) {
    headers['content-length'] = String(body.length);
  }
  return headers;
}

async function handleSupabaseProxy(req, res, url) {
  const supabaseUrl = env('SUPABASE_URL');
  if (!supabaseUrl) {
    sendJson(res, 500, { error: { message: 'SUPABASE_URL is missing.' } });
    return;
  }

  const upstreamPath = url.pathname.replace(/^\/supabase\/?/, '/');
  const upstreamUrl = new URL(`${upstreamPath}${url.search}`, supabaseUrl);
  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRawBody(req);

  await new Promise((resolve) => {
    const upstreamRequest = https.request(
      {
        headers: buildProxyHeaders(req, body),
        hostname: upstreamUrl.hostname,
        method,
        path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
        port: upstreamUrl.port || 443,
        protocol: upstreamUrl.protocol,
        timeout: DEFAULT_TIMEOUT_MS,
      },
      (upstreamResponse) => {
        const chunks = [];
        upstreamResponse.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        upstreamResponse.on('end', () => {
          const payload = Buffer.concat(chunks);
          res.statusCode = upstreamResponse.statusCode || 502;
          res.setHeader(
            'content-type',
            upstreamResponse.headers['content-type'] || 'application/json; charset=utf-8',
          );
          const location = upstreamResponse.headers.location;
          if (location) res.setHeader('location', Array.isArray(location) ? location[0] : location);
          res.setHeader('cache-control', 'no-store');
          res.end(payload);
          resolve();
        });
        upstreamResponse.on('error', (error) => {
          if (!res.headersSent) {
            sendText(res, 502, sanitizeError(error) || 'Supabase proxy response failed.');
          } else {
            res.destroy(error);
          }
          resolve();
        });
      },
    );

    upstreamRequest.on('timeout', () => {
      upstreamRequest.destroy(new Error('Supabase proxy request timed out.'));
    });
    upstreamRequest.on('error', (error) => {
      if (res.headersSent) {
        res.destroy(error);
      } else {
        sendText(res, 502, sanitizeError(error) || 'Supabase proxy request failed.');
      }
      resolve();
    });

    if (body?.length) {
      upstreamRequest.write(body);
    }
    upstreamRequest.end();
  });
}

function normalizeBaseUrl(baseUrl) {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  try {
    const url = new URL(normalized);
    const pathName = url.pathname.replace(/\/+$/, '');
    if (!pathName) {
      url.pathname = '/v1';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return normalized;
  }
  return normalized;
}

function getUpstreamUrl(provider = '') {
  const proxyUrl = envForProvider(provider, 'LLM_PROXY_URL');
  if (proxyUrl) return proxyUrl;
  const baseUrl = envForProvider(provider, 'LLM_BASE_URL');
  if (!baseUrl) return '';
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function messageContentChars(value) {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) {
    return value.reduce((total, part) => {
      if (!part || typeof part !== 'object') return total + messageContentChars(part);
      const partType = String(part.type || '').toLowerCase();
      if (partType.includes('image')) return total + 1200;
      return total + messageContentChars(part.text) + messageContentChars(part.content);
    }, 0);
  }
  if (value && typeof value === 'object') {
    const type = String(value.type || '').toLowerCase();
    if (type.includes('image')) return 1200;
    return messageContentChars(value.text) + messageContentChars(value.content);
  }
  return 0;
}

function inputChars(body) {
  if (!Array.isArray(body.messages)) return 0;
  return body.messages.reduce((total, message) => total + String(message?.role || '').length + messageContentChars(message?.content), 0);
}

function streamContentChars(rawText) {
  if (!/^data:\s*/m.test(rawText)) return null;
  let content = '';
  for (const line of rawText.split(/\r?\n/)) {
    const match = line.match(/^data:\s*(.*)$/);
    if (!match) continue;
    const payload = match[1].trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      const delta = parsed?.choices?.[0]?.delta?.content;
      const message = parsed?.choices?.[0]?.message?.content;
      const text = parsed?.choices?.[0]?.text ?? parsed?.output_text ?? parsed?.delta ?? parsed?.content;
      for (const value of [delta, message, text]) {
        if (typeof value === 'string') content += value;
      }
    } catch {
      // Ignore malformed SSE utility frames.
    }
  }
  return content ? content.length : rawText.length;
}

function outputChars(rawText) {
  const streamChars = streamContentChars(rawText);
  if (typeof streamChars === 'number') return streamChars;
  try {
    const parsed = JSON.parse(rawText);
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.length;
  } catch {
    // Fall through to raw response length.
  }
  return rawText.length;
}

function estimateTokens(inChars, outChars) {
  return Math.ceil((inChars + outChars) / 2);
}

function quotaCostForFeature(feature, body) {
  if (feature === 'prompt-generate-multi') return 2;
  if (feature === 'prompt-review') return 1;
  if (feature === 'text-polish-simple') return 1;
  if (feature === 'text-polish') return 1;
  if ((body.messages || []).length > 2) return 2;
  return 1;
}

function configuredModelForFeature(feature, provider = '') {
  const normalizedFeature = String(feature || '').trim();
  if (normalizedFeature === 'image-text-polish') {
    return explicitEnvForProvider(provider || 'gpt', 'LLM_MODEL');
  }
  if (normalizedFeature === 'text-polish-simple') {
    return envForProvider(provider, 'LLM_MODEL');
  }
  if (normalizedFeature === 'text-polish') {
    return envForProvider(provider, 'LLM_DEEP_MODEL') || envForProvider(provider, 'LLM_MODEL');
  }
  if (normalizedFeature === 'prompt-review') {
    return envForProvider(provider, 'LLM_DEEP_MODEL') || envForProvider(provider, 'LLM_MODEL');
  }
  return envForProvider(provider, 'LLM_MODEL');
}

function normalizeModel(model, feature, provider = '') {
  return configuredModelForFeature(feature, provider) || String(model || '').trim() || defaultModelForProvider(provider);
}

function validateChatBody(body) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return '请求缺少 messages。';
  }
  if (body.messages.some((message) => typeof message.role !== 'string')) {
    return 'messages 中存在无效 role。';
  }
  const size = inputChars(body);
  if (size > MAX_INPUT_CHARS) {
    return `单次输入过长，当前约 ${size} 字符，上限 ${MAX_INPUT_CHARS}。`;
  }
  return null;
}

function buildUpstreamBody(body, provider = '', modelOverride = '') {
  const maxTokens = body.max_tokens || body.maxOutputTokens;
  const upstreamBody = {
    messages: body.messages,
    model: modelOverride || normalizeModel(body.model, body.feature, provider),
    stream: body.stream === true,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.35,
  };
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    upstreamBody.max_tokens = Math.floor(maxTokens);
  }
  if (body.response_format) {
    upstreamBody.response_format = body.response_format;
  }
  return upstreamBody;
}

function firstRpcRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  if (data && typeof data === 'object') return data;
  return null;
}

async function reserveQuota(serviceClient, userId, cost) {
  await upgradeLegacyDefaultQuotaForUser(serviceClient, userId);

  const { data, error } = await serviceClient.rpc('reserve_credit_quota', {
    p_cost: cost,
    p_user_id: userId,
  });
  if (error) {
    console.warn('Credit reservation RPC failed', sanitizeError(error.message));
    return {
      ok: false,
      message: '站内次数预扣失败，请更新 Supabase SQL 后重试。',
      remaining: 0,
    };
  }
  const row = firstRpcRow(data);
  const remaining = Number(row?.remaining_quota || 0);
  if (!row?.ok) {
    return {
      ok: false,
      message: `额度不足，当前剩余 ${remaining} 次，本次需要 ${cost} 次。`,
      remaining,
    };
  }
  return { ok: true, remaining };
}

async function refundQuota(serviceClient, userId, cost) {
  const { error } = await serviceClient.rpc('refund_credit_quota', {
    p_cost: cost,
    p_user_id: userId,
  });
  if (error) {
    console.warn('Credit refund failed', sanitizeError(error.message));
  }
}

async function writeUsage(serviceClient, usage) {
  await serviceClient.from('usage_events').insert(usage);
}

async function callUpstream(body, provider = '', modelOverride = '') {
  if (provider === 'gpt' && requestNeedsVision(body) && (!hasExplicitProviderLlmUpstream('gpt') || !hasExplicitProviderLlmApiKey('gpt'))) {
    throw new Error('GPT vision upstream env is missing.');
  }
  const upstreamUrl = getUpstreamUrl(provider);
  const apiKey = envForProvider(provider, 'LLM_API_KEY');
  if (!upstreamUrl || !apiKey) {
    throw new Error('LLM upstream env is missing.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildUpstreamBody(body, provider, modelOverride)),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callUpstreamWithModelFallback(body, provider, primaryModel) {
  const attempts = modelAttemptPlan(provider, primaryModel);
  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attemptModel = attempts[index];
    try {
      const response = await callUpstream(body, provider, attemptModel);
      if (response.ok) {
        if (attemptModel === primaryModel) clearPrimaryModelFailures(provider, primaryModel);
        return { response, model: attemptModel, failedText: '' };
      }
      const hasNext = index < attempts.length - 1;
      if (!hasNext || !shouldRetrySameProviderFallback(response.status)) {
        return { response, model: attemptModel, failedText: '' };
      }
      const failedText = await response.text();
      if (attemptModel === primaryModel) recordPrimaryModelFailure(provider, primaryModel);
      console.warn(
        'LLM primary model failed, retrying same-provider fallback',
        JSON.stringify({
          status: response.status,
          model: attemptModel,
          fallbackModel: attempts[index + 1],
          provider: provider || null,
          feature: String(body.feature || '').trim() || 'llm-chat',
          body: sanitizeError(failedText),
        }),
      );
    } catch (error) {
      lastError = error;
      const hasNext = index < attempts.length - 1;
      if (!hasNext) throw error;
      if (attemptModel === primaryModel) recordPrimaryModelFailure(provider, primaryModel);
      console.warn(
        'LLM primary model request failed, retrying same-provider fallback',
        JSON.stringify({
          model: attemptModel,
          fallbackModel: attempts[index + 1],
          provider: provider || null,
          feature: String(body.feature || '').trim() || 'llm-chat',
          error: sanitizeError(error),
        }),
      );
    }
  }
  throw lastError || new Error('LLM fallback failed.');
}

function shouldRetryTextRequestWithDeepseek(status, body, provider = '') {
  if (provider !== 'gpt') return false;
  if (requestNeedsVision(body)) return false;
  if (status !== 429 && status < 500) return false;
  return hasExplicitProviderLlmUpstream('deepseek') && hasExplicitProviderLlmApiKey('deepseek');
}

function buildDeepseekFallbackBody(body) {
  const fallbackBody = { ...body, provider: 'deepseek' };
  delete fallbackBody.model;
  return fallbackBody;
}

async function pipeUpstreamStream(upstreamResponse, _req, res) {
  const reader = upstreamResponse.body?.getReader();
  if (!reader) {
    throw new Error('LLM stream response has no readable body.');
  }

  const contentType = upstreamResponse.headers.get('content-type') || 'text/event-stream; charset=utf-8';
  res.statusCode = upstreamResponse.status;
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const decoder = new TextDecoder();
  let rawText = '';
  let clientClosed = false;
  const onClose = () => {
    if (!res.writableEnded) {
      clientClosed = true;
      reader.cancel().catch(() => {});
    }
  };
  res.on('close', onClose);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      rawText += decoder.decode(value, { stream: true });
      if (clientClosed || res.destroyed || res.writableEnded) {
        throw new Error('Client disconnected during LLM stream.');
      }
      res.write(Buffer.from(value));
    }
    rawText += decoder.decode();
    if (!res.writableEnded) res.end();
    return rawText;
  } finally {
    res.off('close', onClose);
  }
}

function isSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return false;
  return JSON.stringify(value).length <= MAX_PROJECT_SNAPSHOT_CHARS;
}

function normalizeProjectName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.slice(0, 120) || '未命名工程';
}

function normalizeProjectRow(row) {
  const nodes = Array.isArray(row.snapshot?.nodes) ? row.snapshot.nodes : [];
  const edges = Array.isArray(row.snapshot?.edges) ? row.snapshot.edges : [];
  return {
    id: row.id,
    name: row.name,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    snapshot: {
      ...row.snapshot,
      projectId: row.id,
      projectName: row.name,
    },
    updatedAt: Date.parse(row.updated_at) || Date.now(),
  };
}

async function handleHealth(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }
  const checks = {
    llmApiKey: hasProviderLlmApiKey('') || hasProviderLlmApiKey('gpt') || hasProviderLlmApiKey('deepseek'),
    llmUpstream: hasLlmUpstream(),
    supabaseAnonKey: Boolean(env('SUPABASE_ANON_KEY')),
    supabaseServiceRoleKey: Boolean(env('SUPABASE_SERVICE_ROLE_KEY')),
    supabaseUrl: Boolean(env('SUPABASE_URL')),
  };
  const ok = Object.values(checks).every(Boolean);
  sendJson(res, ok ? 200 : 503, {
    ok,
    checks,
    runtime: 'node-http',
    service: 'studio-canvas-saas',
    timestamp: new Date().toISOString(),
  });
}

async function handleTestInvite(req, res, url) {
  if (req.method === 'GET') {
    const inviteCodes = getTestInviteCodes();
    const email = normalizeEmail(url?.searchParams?.get('email') || '');
    sendJson(res, 200, {
      activated: email ? hasActivatedTestInviteEmail(email) : false,
      enabled: Boolean(inviteCodes.length),
      inviteCount: inviteCodes.length,
    });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  const inviteCodes = getTestInviteCodes();
  if (!inviteCodes.length) {
    sendJson(res, 404, { error: { message: '测试邀请码登录未启用。' } });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { message: '请求体不是合法 JSON。' } });
    return;
  }

  const email = normalizeEmail(body?.email) || normalizeEmail(env('TEST_INVITE_EMAIL')) || 'tester@studio-canvas.local';
  const isActivatedEmail = hasActivatedTestInviteEmail(email);
  const inviteCode = normalizeInviteCode(body?.inviteCode || body?.code || '');
  if (!inviteCode && !isActivatedEmail) {
    sendJson(res, 400, { error: { message: '请输入测试邀请码。' } });
    return;
  }
  if (inviteCode && !inviteCodes.includes(inviteCode)) {
    console.warn(
      'Invalid test invite code',
      JSON.stringify({
        inviteCount: inviteCodes.length,
        providedLength: inviteCode.length,
        providedPrefix: inviteCode.slice(0, 8),
      }),
    );
    sendJson(res, 401, { error: { message: '测试邀请码无效。' } });
    return;
  }

  if (inviteCode) {
    rememberActivatedTestInviteEmail(email);
  }
  const accessToken = createTestInviteToken(email);
  if (!accessToken) {
    sendJson(res, 500, { error: { message: '无法创建测试登录令牌，请检查 TEST_INVITE_SECRET 或 TEST_INVITE_CODE。' } });
    return;
  }

  const quota = readTestInviteQuota(email);
  sendJson(res, 200, {
    ok: true,
    accessToken,
    email,
    monthlyQuota: quota.monthlyQuota,
    remainingQuota: quota.remainingQuota,
    tokenType: 'bearer',
  });
}

async function handleCreditStatus(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }
  const auth = await getAuthedContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
    return;
  }
  if (auth.isTestInvite) {
    const quota = readTestInviteQuota(auth.user?.email || auth.userId);
    sendJson(res, 200, {
      displayName: '测试邀请码',
      email: auth.user?.email || null,
      isAdmin: isAdminUser(auth.user),
      monthlyQuota: quota.monthlyQuota,
      plan: 'test',
      remainingQuota: quota.remainingQuota,
      resetAt: null,
      updatedAt: quota.updatedAt,
      userId: auth.userId,
    });
    return;
  }
  try {
    await ensureUserRows(auth.serviceClient, auth.user);
    const [{ data: profile }, { data: wallet, error: walletError }] = await Promise.all([
      auth.serviceClient.from('profiles').select('plan,email,display_name').eq('id', auth.userId).maybeSingle(),
      auth.serviceClient
        .from('credit_wallets')
        .select('monthly_quota,remaining_quota,reset_at,updated_at')
        .eq('user_id', auth.userId)
        .maybeSingle(),
    ]);
    if (walletError || !wallet) {
      sendJson(res, 500, { error: { message: walletError?.message || '读取额度失败。' } });
      return;
    }
    const nextWallet = await upgradeLegacyDefaultQuota(auth.serviceClient, auth.userId, wallet);
    sendJson(res, 200, {
      displayName: profile?.display_name || null,
      email: profile?.email || auth.user.email || null,
      isAdmin: isAdminUser(auth.user),
      monthlyQuota: Number(nextWallet.monthly_quota || 0),
      plan: profile?.plan || 'free',
      remainingQuota: Number(nextWallet.remaining_quota || 0),
      resetAt: nextWallet.reset_at || null,
      updatedAt: nextWallet.updated_at || null,
      userId: auth.userId,
    });
  } catch (error) {
    sendJson(res, 500, { error: { message: sanitizeError(error) || '读取额度失败。' } });
  }
}

function normalizeUsageEvent(row) {
  return {
    createdAt: row.created_at || null,
    errorMessage: row.error_message || null,
    estimatedTokens: Number(row.estimated_tokens || 0),
    feature: row.feature || '',
    inputChars: Number(row.input_chars || 0),
    model: row.model || '',
    outputChars: Number(row.output_chars || 0),
    quotaCost: Number(row.quota_cost || 0),
    status: row.status || '',
  };
}

function normalizeAdminUsageEvent(row, profileById = new Map()) {
  const event = normalizeUsageEvent(row);
  const profile = profileById.get(row.user_id) || {};
  return {
    ...event,
    source: 'supabase',
    user: {
      displayName: profile.display_name || null,
      email: profile.email || row.user_id || '',
      plan: profile.plan || 'free',
      userId: row.user_id || '',
    },
  };
}

function isCurrentTestInviteEmail(auth, email) {
  return Boolean(auth?.isTestInvite && normalizeEmail(auth.user?.email) === normalizeEmail(email));
}

function isKnownTestInviteEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  if (hasActivatedTestInviteEmail(normalizedEmail)) return true;
  ensureTestInviteUsageLoaded();
  return testInviteUsageEvents.some((event) => normalizeEmail(event.email) === normalizedEmail);
}

function readTestInviteAdminCreditDetails(email) {
  const normalizedEmail = normalizeEmail(email);
  const quota = readTestInviteQuota(normalizedEmail);
  return {
    usageEvents: [],
    user: {
      displayName: '测试邀请码',
      email: normalizedEmail,
      plan: 'test',
      userId: getTestInviteUserId(normalizedEmail),
    },
    wallet: {
      monthlyQuota: quota.monthlyQuota,
      remainingQuota: quota.remainingQuota,
      resetAt: null,
      updatedAt: quota.updatedAt,
    },
  };
}

function updateTestInviteAdminCredits(email, action, rawAmount) {
  const current = readTestInviteQuota(email);
  const currentMonthly = Number(current.monthlyQuota || 0);
  const currentRemaining = Number(current.remainingQuota || 0);
  let nextMonthly = currentMonthly;
  let nextRemaining = currentRemaining;

  if (action === 'reset') {
    nextMonthly = getTestInviteMonthlyQuotaForEmail(email);
    nextRemaining = nextMonthly;
  } else if (action === 'add') {
    const amount = readCreditAmount(rawAmount);
    if (!amount) {
      return { error: { status: 400, message: '增加次数必须是 1-9999 的整数。' } };
    }
    nextMonthly = currentMonthly + amount;
    nextRemaining = currentRemaining + amount;
  } else if (action === 'set') {
    const amount = readCreditAmount(rawAmount);
    if (amount === null) {
      return { error: { status: 400, message: '设置次数必须是 0-9999 的整数。' } };
    }
    nextMonthly = amount;
    nextRemaining = amount;
  } else {
    return { error: { status: 400, message: '未知操作，请使用 add、reset 或 set。' } };
  }

  writeTestInviteQuota(email, nextMonthly, nextRemaining);
  return { details: readTestInviteAdminCreditDetails(email) };
}

async function readAdminCreditDetails(serviceClient, email) {
  const normalizedEmail = normalizeEmail(email);
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('id,email,display_name,plan')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message || '读取用户资料失败。');
  }
  if (!profile?.id) {
    return { notFound: true };
  }

  const { data: wallet, error: walletError } = await serviceClient
    .from('credit_wallets')
    .select('monthly_quota,remaining_quota,reset_at,updated_at')
    .eq('user_id', profile.id)
    .maybeSingle();

  if (walletError) {
    throw new Error(walletError.message || '读取用户额度失败。');
  }

  let nextWallet = wallet;
  if (!nextWallet) {
    const { error: createWalletError } = await serviceClient.from('credit_wallets').upsert(
      {
        monthly_quota: DEFAULT_MONTHLY_QUOTA,
        remaining_quota: DEFAULT_MONTHLY_QUOTA,
        user_id: profile.id,
      },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
    if (createWalletError) {
      throw new Error(createWalletError.message || '创建用户额度失败。');
    }
    const { data: createdWallet, error: readCreatedError } = await serviceClient
      .from('credit_wallets')
      .select('monthly_quota,remaining_quota,reset_at,updated_at')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (readCreatedError || !createdWallet) {
      throw new Error(readCreatedError?.message || '读取新额度失败。');
    }
    nextWallet = createdWallet;
  }
  nextWallet = await upgradeLegacyDefaultQuota(serviceClient, profile.id, nextWallet);

  const { data: usageEvents, error: usageError } = await serviceClient
    .from('usage_events')
    .select('feature,model,input_chars,output_chars,estimated_tokens,quota_cost,status,error_message,created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (usageError) {
    throw new Error(usageError.message || '读取调用记录失败。');
  }

  return {
    usageEvents: (usageEvents || []).map(normalizeUsageEvent),
    user: {
      displayName: profile.display_name || null,
      email: profile.email || normalizedEmail,
      plan: profile.plan || 'free',
      userId: profile.id,
    },
    wallet: {
      monthlyQuota: Number(nextWallet.monthly_quota || 0),
      remainingQuota: Number(nextWallet.remaining_quota || 0),
      resetAt: nextWallet.reset_at || null,
      updatedAt: nextWallet.updated_at || null,
    },
  };
}

async function readAdminUsageEvents(serviceClient, options = {}) {
  const limit = Math.min(Math.max(Number.parseInt(String(options.limit || '80'), 10) || 80, 1), 200);
  const email = normalizeEmail(options.email);
  let query = serviceClient
    .from('usage_events')
    .select('user_id,feature,model,input_chars,output_chars,estimated_tokens,quota_cost,status,error_message,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  let filteredProfile = null;
  if (email) {
    const { data: profile, error: profileError } = await serviceClient
      .from('profiles')
      .select('id,email,display_name,plan')
      .ilike('email', email)
      .maybeSingle();
    if (profileError) {
      throw new Error(profileError.message || '读取用户资料失败。');
    }
    filteredProfile = profile || null;
    query = filteredProfile?.id
      ? query.eq('user_id', filteredProfile.id)
      : query.eq('user_id', '00000000-0000-0000-0000-000000000000');
  }

  const { data: usageEvents, error: usageError } = await query;
  if (usageError) {
    throw new Error(usageError.message || '读取使用记录失败。');
  }

  const profileById = new Map();
  if (filteredProfile?.id) {
    profileById.set(filteredProfile.id, filteredProfile);
  } else {
    const userIds = [...new Set((usageEvents || []).map((event) => event.user_id).filter(Boolean))];
    if (userIds.length) {
      const { data: profiles, error: profilesError } = await serviceClient
        .from('profiles')
        .select('id,email,display_name,plan')
        .in('id', userIds);
      if (profilesError) {
        throw new Error(profilesError.message || '读取用户资料失败。');
      }
      for (const profile of profiles || []) {
        profileById.set(profile.id, profile);
      }
    }
  }

  const supabaseEvents = (usageEvents || []).map((event) => normalizeAdminUsageEvent(event, profileById));
  const testEvents = readTestInviteUsageEvents(email, limit);
  const events = [...supabaseEvents, ...testEvents]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit);

  return {
    email: email || null,
    events,
    limit,
    totalReturned: events.length,
  };
}

function normalizeAdminUserStatus(authUser) {
  if (authUser?.banned_until) return 'banned';
  if (authUser?.email_confirmed_at || authUser?.confirmed_at) return 'active';
  return 'pending';
}

function createEmptyUsageSummary() {
  return {
    failedUsage: 0,
    lastUsageAt: null,
    successUsage: 0,
    totalCost: 0,
    totalUsage: 0,
  };
}

function summarizeUsageEvents(events = []) {
  const summary = createEmptyUsageSummary();
  const sortedEvents = events
    .filter((event) => event && typeof event === 'object')
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  for (const event of sortedEvents) {
    if (!summary.lastUsageAt && event.created_at) {
      summary.lastUsageAt = event.created_at;
    }
    summary.totalUsage += 1;
    summary.totalCost += Number(event.quota_cost || 0);
    if (event.status === 'success') {
      summary.successUsage += 1;
    } else if (event.status === 'failed') {
      summary.failedUsage += 1;
    }
  }
  return summary;
}

function readAdminTestInviteUsers(email = '') {
  ensureTestInviteActivationsLoaded();
  ensureTestInviteUsageLoaded();
  const filterEmail = normalizeEmail(email);
  const emails = new Set([...testInviteActivations]);
  for (const event of testInviteUsageEvents) {
    const eventEmail = normalizeEmail(event.email);
    if (eventEmail) emails.add(eventEmail);
  }

  return [...emails]
    .map(normalizeEmail)
    .filter(Boolean)
    .filter((item) => !filterEmail || item.includes(filterEmail))
    .map((item) => {
      const quota = readTestInviteQuota(item);
      const usageSummary = summarizeUsageEvents(
        testInviteUsageEvents.filter((event) => normalizeEmail(event.email) === item),
      );
      return {
        createdAt: null,
        displayName: '测试邀请码',
        email: item,
        emailConfirmedAt: null,
        failedUsage: usageSummary.failedUsage,
        lastSignInAt: null,
        lastUsageAt: usageSummary.lastUsageAt,
        monthlyQuota: quota.monthlyQuota,
        plan: 'test',
        projectCount: 0,
        provider: 'test-invite',
        remainingQuota: quota.remainingQuota,
        source: 'test-invite',
        status: 'active',
        successUsage: usageSummary.successUsage,
        totalCost: usageSummary.totalCost,
        totalUsage: usageSummary.totalUsage,
        updatedAt: quota.updatedAt,
        userId: getTestInviteUserId(item),
        walletUpdatedAt: quota.updatedAt,
      };
    });
}

async function fetchAuthUsersByProfiles(serviceClient, profiles = []) {
  const users = [];
  for (const profile of profiles) {
    if (!profile?.id) continue;
    try {
      const { data, error } = await serviceClient.auth.admin.getUserById(profile.id);
      if (!error && data?.user) {
        users.push(data.user);
      } else {
        users.push({
          id: profile.id,
          email: profile.email,
          created_at: profile.created_at,
          updated_at: profile.updated_at,
        });
      }
    } catch {
      users.push({
        id: profile.id,
        email: profile.email,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      });
    }
  }
  return users;
}

async function readAdminUsers(serviceClient, options = {}) {
  const limit = Math.min(Math.max(Number.parseInt(String(options.limit || '80'), 10) || 80, 1), 200);
  const page = Math.max(Number.parseInt(String(options.page || '1'), 10) || 1, 1);
  const email = normalizeEmail(options.email);
  let authUsers = [];
  let profileRows = [];
  let totalAuthUsers = null;

  if (email) {
    const { data: profiles, error: profileError, count } = await serviceClient
      .from('profiles')
      .select('id,email,display_name,plan,created_at,updated_at', { count: 'exact' })
      .ilike('email', `%${email}%`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (profileError) {
      throw new Error(profileError.message || '读取用户列表失败。');
    }
    profileRows = profiles || [];
    totalAuthUsers = count ?? profileRows.length;
    authUsers = await fetchAuthUsersByProfiles(serviceClient, profileRows);
  } else {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: limit,
    });
    if (error) {
      throw new Error(error.message || '读取注册用户失败。');
    }
    authUsers = data?.users || [];
    totalAuthUsers = data?.total ?? authUsers.length;
  }

  const userIds = [...new Set(authUsers.map((user) => user.id).filter(Boolean))];
  const [profilesResult, walletsResult, usageResult, projectsResult] = userIds.length
    ? await Promise.all([
        email
          ? Promise.resolve({ data: profileRows, error: null })
          : serviceClient
              .from('profiles')
              .select('id,email,display_name,plan,created_at,updated_at')
              .in('id', userIds),
        serviceClient
          .from('credit_wallets')
          .select('user_id,monthly_quota,remaining_quota,reset_at,updated_at')
          .in('user_id', userIds),
        serviceClient
          .from('usage_events')
          .select('user_id,status,quota_cost,created_at')
          .in('user_id', userIds)
          .order('created_at', { ascending: false })
          .limit(Math.min(Math.max(limit * 80, 1000), 5000)),
        serviceClient
          .from('projects')
          .select('user_id,updated_at')
          .in('user_id', userIds)
          .limit(Math.min(Math.max(limit * 40, 1000), 5000)),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (profilesResult.error) throw new Error(profilesResult.error.message || '读取用户资料失败。');
  if (walletsResult.error) throw new Error(walletsResult.error.message || '读取用户点数失败。');
  if (usageResult.error) throw new Error(usageResult.error.message || '读取用户使用统计失败。');
  if (projectsResult.error) throw new Error(projectsResult.error.message || '读取用户项目统计失败。');

  const profileById = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
  const walletById = new Map((walletsResult.data || []).map((wallet) => [wallet.user_id, wallet]));
  const usageById = new Map(userIds.map((userId) => [userId, createEmptyUsageSummary()]));
  for (const event of usageResult.data || []) {
    const summary = usageById.get(event.user_id);
    if (!summary) continue;
    if (!summary.lastUsageAt && event.created_at) {
      summary.lastUsageAt = event.created_at;
    }
    summary.totalUsage += 1;
    summary.totalCost += Number(event.quota_cost || 0);
    if (event.status === 'success') {
      summary.successUsage += 1;
    } else if (event.status === 'failed') {
      summary.failedUsage += 1;
    }
  }
  const projectCountById = new Map();
  for (const project of projectsResult.data || []) {
    projectCountById.set(project.user_id, (projectCountById.get(project.user_id) || 0) + 1);
  }

  const users = authUsers.map((authUser) => {
    const profile = profileById.get(authUser.id) || {};
    const wallet = walletById.get(authUser.id) || {};
    const usage = usageById.get(authUser.id) || createEmptyUsageSummary();
    return {
      createdAt: authUser.created_at || profile.created_at || null,
      displayName: profile.display_name || authUser.user_metadata?.name || null,
      email: normalizeEmail(profile.email || authUser.email) || authUser.id,
      emailConfirmedAt: authUser.email_confirmed_at || authUser.confirmed_at || null,
      failedUsage: usage.failedUsage,
      lastSignInAt: authUser.last_sign_in_at || null,
      lastUsageAt: usage.lastUsageAt,
      monthlyQuota: Number(wallet.monthly_quota || 0),
      plan: profile.plan || 'free',
      projectCount: Number(projectCountById.get(authUser.id) || 0),
      provider: authUser.app_metadata?.provider || 'email',
      remainingQuota: Number(wallet.remaining_quota || 0),
      source: 'supabase',
      status: normalizeAdminUserStatus(authUser),
      successUsage: usage.successUsage,
      totalCost: usage.totalCost,
      totalUsage: usage.totalUsage,
      updatedAt: profile.updated_at || authUser.updated_at || null,
      userId: authUser.id,
      walletUpdatedAt: wallet.updated_at || null,
    };
  });

  const testUsers = page === 1 ? readAdminTestInviteUsers(email) : [];
  const allUsers = [...users, ...testUsers]
    .sort((a, b) => {
      const aTime = a.lastSignInAt || a.lastUsageAt || a.createdAt || '';
      const bTime = b.lastSignInAt || b.lastUsageAt || b.createdAt || '';
      return String(bTime).localeCompare(String(aTime));
    })
    .slice(0, limit);

  return {
    email: email || null,
    limit,
    page,
    totalAuthUsers,
    totalReturned: allUsers.length,
    totalTestInviteUsers: testUsers.length,
    users: allUsers,
  };
}

function readCreditAmount(value) {
  const amount = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999) {
    return null;
  }
  return amount;
}

async function handleAdminUsers(req, res, url) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  const auth = await getAdminContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
    return;
  }

  try {
    const users = await readAdminUsers(auth.serviceClient, {
      email: url.searchParams.get('email'),
      limit: url.searchParams.get('limit'),
      page: url.searchParams.get('page'),
    });
    sendJson(res, 200, users);
  } catch (error) {
    sendJson(res, 500, { error: { message: sanitizeError(error) || '读取用户列表失败。' } });
  }
}

async function handleAdminUsage(req, res, url) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  const auth = await getAdminContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
    return;
  }

  try {
    const usage = await readAdminUsageEvents(auth.serviceClient, {
      email: url.searchParams.get('email'),
      limit: url.searchParams.get('limit'),
    });
    sendJson(res, 200, usage);
  } catch (error) {
    sendJson(res, 500, { error: { message: sanitizeError(error) || '读取使用记录失败。' } });
  }
}

async function handleAdminCredits(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  const auth = await getAdminContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
    return;
  }

  try {
    if (req.method === 'GET') {
      const email = normalizeEmail(url.searchParams.get('email'));
      if (!email) {
        sendJson(res, 400, { error: { message: '请输入要查询的用户邮箱。' } });
        return;
      }
      if (isCurrentTestInviteEmail(auth, email)) {
        sendJson(res, 200, readTestInviteAdminCreditDetails(email));
        return;
      }
      const details = await readAdminCreditDetails(auth.serviceClient, email);
      if (details.notFound) {
        if (isKnownTestInviteEmail(email)) {
          sendJson(res, 200, readTestInviteAdminCreditDetails(email));
          return;
        }
        sendJson(res, 404, { error: { message: '未找到该邮箱用户。请确认对方已经登录过一次。' } });
        return;
      }
      sendJson(res, 200, details);
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: { message: '请求体不是合法 JSON。' } });
      return;
    }

    const email = normalizeEmail(body.email);
    const action = String(body.action || '').trim();
    if (!email) {
      sendJson(res, 400, { error: { message: '请输入要操作的用户邮箱。' } });
      return;
    }

    if (isCurrentTestInviteEmail(auth, email)) {
      const result = updateTestInviteAdminCredits(email, action, body.amount);
      if (result.error) {
        sendJson(res, result.error.status, { error: { message: result.error.message } });
        return;
      }
      sendJson(res, 200, result.details);
      return;
    }

    const details = await readAdminCreditDetails(auth.serviceClient, email);
    if (details.notFound) {
      if (isKnownTestInviteEmail(email)) {
        const result = updateTestInviteAdminCredits(email, action, body.amount);
        if (result.error) {
          sendJson(res, result.error.status, { error: { message: result.error.message } });
          return;
        }
        sendJson(res, 200, result.details);
        return;
      }
      sendJson(res, 404, { error: { message: '未找到该邮箱用户。请确认对方已经登录过一次。' } });
      return;
    }

    const currentMonthly = Number(details.wallet.monthlyQuota || 0);
    const currentRemaining = Number(details.wallet.remainingQuota || 0);
    let nextMonthly = currentMonthly;
    let nextRemaining = currentRemaining;

    if (action === 'reset') {
      nextMonthly = DEFAULT_MONTHLY_QUOTA;
      nextRemaining = DEFAULT_MONTHLY_QUOTA;
    } else if (action === 'add') {
      const amount = readCreditAmount(body.amount);
      if (!amount) {
        sendJson(res, 400, { error: { message: '增加次数必须是 1-9999 的整数。' } });
        return;
      }
      nextMonthly = currentMonthly + amount;
      nextRemaining = currentRemaining + amount;
    } else if (action === 'set') {
      const amount = readCreditAmount(body.amount);
      if (amount === null) {
        sendJson(res, 400, { error: { message: '设置次数必须是 0-9999 的整数。' } });
        return;
      }
      nextMonthly = amount;
      nextRemaining = amount;
    } else {
      sendJson(res, 400, { error: { message: '未知操作，请使用 add、reset 或 set。' } });
      return;
    }

    const { error: updateError } = await auth.serviceClient
      .from('credit_wallets')
      .update({
        monthly_quota: nextMonthly,
        remaining_quota: nextRemaining,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', details.user.userId);

    if (updateError) {
      sendJson(res, 500, { error: { message: updateError.message || '更新额度失败。' } });
      return;
    }

    const nextDetails = await readAdminCreditDetails(auth.serviceClient, email);
    sendJson(res, 200, nextDetails);
  } catch (error) {
    sendJson(res, 500, { error: { message: sanitizeError(error) || '管理员额度操作失败。' } });
  }
}

async function handleProjects(req, res) {
  const auth = await getAuthedContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
    return;
  }
  if (auth.isTestInvite) {
    if (req.method === 'GET') {
      sendJson(res, 200, { projects: [] });
      return;
    }
    sendJson(res, 403, { error: { message: '测试邀请码用户暂不支持云端工程保存，请先导出工程文件。' } });
    return;
  }

  if (req.method === 'GET') {
    const { data, error } = await auth.serviceClient
      .from('projects')
      .select('id,name,snapshot,updated_at')
      .eq('user_id', auth.userId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(PROJECT_LIST_LIMIT);
    if (error) {
      sendJson(res, 500, { error: { message: error.message || '读取云端工程失败。' } });
      return;
    }
    const projects = (data || []).map(normalizeProjectRow).map((item) => ({
      id: item.id,
      name: item.name,
      nodeCount: item.nodeCount,
      edgeCount: item.edgeCount,
      updatedAt: item.updatedAt,
    }));
    sendJson(res, 200, { projects });
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: { message: '请求体不是合法 JSON。' } });
      return;
    }
    if (!isSnapshot(body.snapshot)) {
      sendJson(res, 400, { error: { message: '工程 snapshot 无效或超过大小限制。' } });
      return;
    }
    const name = normalizeProjectName(body.name);
    const { data, error } = await auth.serviceClient
      .from('projects')
      .insert({
        name,
        snapshot: {
          ...body.snapshot,
          projectName: name,
        },
        updated_at: new Date().toISOString(),
        user_id: auth.userId,
      })
      .select('id,name,snapshot,updated_at')
      .single();
    if (error) {
      sendJson(res, 500, { error: { message: error.message || '创建云端工程失败。' } });
      return;
    }
    sendJson(res, 201, { project: normalizeProjectRow(data) });
    return;
  }

  sendJson(res, 405, { error: { message: 'Method not allowed.' } });
}

async function handleProjectById(req, res, projectId) {
  const auth = await getAuthedContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
    return;
  }
  if (!projectId) {
    sendJson(res, 400, { error: { message: '缺少工程 ID。' } });
    return;
  }
  if (auth.isTestInvite) {
    sendJson(res, 403, { error: { message: '测试邀请码用户暂不支持云端工程管理，请先导出工程文件。' } });
    return;
  }

  if (req.method === 'GET') {
    const { data, error } = await auth.serviceClient
      .from('projects')
      .select('id,name,snapshot,updated_at')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('archived_at', null)
      .maybeSingle();
    if (error) {
      sendJson(res, 500, { error: { message: error.message || '读取云端工程失败。' } });
      return;
    }
    if (!data) {
      sendJson(res, 404, { error: { message: '找不到该云端工程。' } });
      return;
    }
    sendJson(res, 200, { project: normalizeProjectRow(data) });
    return;
  }

  if (req.method === 'PUT') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: { message: '请求体不是合法 JSON。' } });
      return;
    }
    if (!isSnapshot(body.snapshot)) {
      sendJson(res, 400, { error: { message: '工程 snapshot 无效或超过大小限制。' } });
      return;
    }
    const name = normalizeProjectName(body.name);
    const { data, error } = await auth.serviceClient
      .from('projects')
      .update({
        name,
        snapshot: {
          ...body.snapshot,
          projectId,
          projectName: name,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('archived_at', null)
      .select('id,name,snapshot,updated_at')
      .maybeSingle();
    if (error) {
      sendJson(res, 500, { error: { message: error.message || '保存云端工程失败。' } });
      return;
    }
    if (!data) {
      sendJson(res, 404, { error: { message: '找不到该云端工程。' } });
      return;
    }
    sendJson(res, 200, { project: normalizeProjectRow(data) });
    return;
  }

  if (req.method === 'DELETE') {
    const { error } = await auth.serviceClient
      .from('projects')
      .update({
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('archived_at', null);
    if (error) {
      sendJson(res, 500, { error: { message: error.message || '删除云端工程失败。' } });
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: { message: 'Method not allowed.' } });
}

async function handleLlmChat(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: { message: 'Method not allowed.' } });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { message: '请求体不是合法 JSON。' } });
    return;
  }

  const validationError = validateChatBody(body);
  if (validationError) {
    sendJson(res, 400, { error: { message: validationError } });
    return;
  }

  const auth = await getAuthedContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
    return;
  }

  const feature = String(body.feature || '').trim() || 'llm-chat';
  const provider = normalizeProvider(body.provider);
  const cost = quotaCostForFeature(feature, body);
  const inChars = inputChars(body);
  const model = normalizeModel(body.model, feature, provider);
  const isTestInvite = Boolean(auth.isTestInvite);
  const testInviteEmail = normalizeEmail(auth.user?.email) || 'tester@studio-canvas.local';
  const recordUsage = async (event) => {
    if (isTestInvite) {
      writeTestInviteUsage(testInviteEmail, event);
      return;
    }
    await writeUsage(auth.serviceClient, event);
  };
  const refundReservedQuota = async () => {
    if (isTestInvite) {
      refundTestInviteQuota(testInviteEmail, cost);
      return;
    }
    await refundQuota(auth.serviceClient, auth.userId, cost);
  };

  console.log(
    'LLM chat request received',
    JSON.stringify({
      feature,
      provider: provider || null,
      model,
      requestedModel: String(body.model || '').trim() || null,
      inputChars: inChars,
    }),
  );

  if (!isTestInvite) {
    try {
      await ensureUserRows(auth.serviceClient, auth.user);
    } catch (error) {
      sendJson(res, 500, { error: { message: sanitizeError(error) || '用户额度初始化失败。' } });
      return;
    }
  }

  const reservation = isTestInvite
    ? reserveTestInviteQuota(testInviteEmail, cost)
    : await reserveQuota(auth.serviceClient, auth.userId, cost);
  if (!reservation.ok) {
    console.warn(
      'LLM quota reservation failed',
      JSON.stringify({
        feature,
        provider: provider || null,
        model,
        cost,
        remaining: reservation.remaining,
        message: sanitizeError(reservation.message),
      }),
    );
    await recordUsage({
      user_id: auth.userId,
      project_id: body.projectId || null,
      feature,
      model,
      input_chars: inChars,
      output_chars: 0,
      estimated_tokens: estimateTokens(inChars, 0),
      quota_cost: 0,
      status: 'failed',
      error_message: reservation.message,
    });
    sendJson(res, 402, { error: { message: reservation.message } });
    return;
  }

  try {
    const firstAttempt = await callUpstreamWithModelFallback(body, provider, model);
    let upstreamResponse = firstAttempt.response;
    let responseProvider = provider;
    let responseModel = firstAttempt.model;
    let failedText = firstAttempt.failedText;
    if (!upstreamResponse.ok && shouldRetryTextRequestWithDeepseek(upstreamResponse.status, body, provider)) {
      failedText = await upstreamResponse.text();
      const fallbackBody = buildDeepseekFallbackBody(body);
      const fallbackModel = normalizeModel(undefined, feature, 'deepseek');
      console.warn(
        'LLM upstream failed, retrying DeepSeek fallback',
        JSON.stringify({
          status: upstreamResponse.status,
          model,
          provider: provider || null,
          fallbackModel,
          fallbackProvider: 'deepseek',
          feature,
          body: sanitizeError(failedText),
        }),
      );
      const fallbackResponse = await callUpstream(fallbackBody, 'deepseek');
      if (fallbackResponse.ok) {
        upstreamResponse = fallbackResponse;
        failedText = '';
        responseProvider = 'deepseek';
        responseModel = fallbackModel;
      } else {
        const fallbackText = await fallbackResponse.text();
        console.warn(
          'DeepSeek fallback failed',
          JSON.stringify({
            status: fallbackResponse.status,
            model: fallbackModel,
            provider: 'deepseek',
            feature,
            body: sanitizeError(fallbackText),
          }),
        );
        upstreamResponse = fallbackResponse;
        failedText = fallbackText;
        responseProvider = 'deepseek';
        responseModel = fallbackModel;
      }
    }

    if (body.stream === true) {
      if (!upstreamResponse.ok) {
        const rawText = failedText || (await upstreamResponse.text());
        const failureMessage = classifyUpstreamError(upstreamResponse.status, rawText);
        await recordUsage({
          user_id: auth.userId,
          project_id: body.projectId || null,
          feature,
          model: responseModel,
          input_chars: inChars,
          output_chars: 0,
          estimated_tokens: estimateTokens(inChars, 0),
          quota_cost: 0,
          status: 'failed',
          error_message: failureMessage,
        });
        console.warn(
          'LLM upstream failed',
          JSON.stringify({
            status: upstreamResponse.status,
            model: responseModel,
            provider: responseProvider || null,
            feature,
            body: sanitizeError(rawText),
          }),
        );
        await refundReservedQuota();
        sendJson(res, upstreamResponse.status, {
          error: {
            message: failureMessage,
            upstreamStatus: upstreamResponse.status,
          },
        });
        return;
      }

      const rawText = await pipeUpstreamStream(upstreamResponse, req, res);
      const outChars = outputChars(rawText);
      try {
        await recordUsage({
          user_id: auth.userId,
          project_id: body.projectId || null,
          feature,
          model: responseModel,
          input_chars: inChars,
          output_chars: outChars,
          estimated_tokens: estimateTokens(inChars, outChars),
          quota_cost: cost,
          status: 'success',
          error_message: null,
        });
      } catch (error) {
        console.warn('LLM stream usage record failed', sanitizeError(error));
      }
      return;
    }

    let rawText = failedText || (await upstreamResponse.text());
    const outChars = outputChars(rawText);
    const isOk = upstreamResponse.ok;
    const failureMessage = isOk ? undefined : classifyUpstreamError(upstreamResponse.status, rawText);
    await recordUsage({
      user_id: auth.userId,
      project_id: body.projectId || null,
      feature,
      model: responseModel,
      input_chars: inChars,
      output_chars: isOk ? outChars : 0,
      estimated_tokens: estimateTokens(inChars, isOk ? outChars : 0),
      quota_cost: isOk ? cost : 0,
      status: isOk ? 'success' : 'failed',
      error_message: failureMessage,
    });
    if (!isOk) {
      console.warn(
        'LLM upstream failed',
        JSON.stringify({
          status: upstreamResponse.status,
          model: responseModel,
          provider: responseProvider || null,
          feature,
          body: sanitizeError(rawText),
        }),
      );
      await refundReservedQuota();
      sendJson(res, upstreamResponse.status, {
        error: {
          message: failureMessage,
          upstreamStatus: upstreamResponse.status,
        },
      });
      return;
    }
    res.statusCode = upstreamResponse.status;
    res.setHeader('content-type', upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(rawText);
  } catch (error) {
    await refundReservedQuota();
    const message = classifyLlmRequestException(error);
    await recordUsage({
      user_id: auth.userId,
      project_id: body.projectId || null,
      feature,
      model,
      input_chars: inChars,
      output_chars: 0,
      estimated_tokens: estimateTokens(inChars, 0),
      quota_cost: 0,
      status: 'failed',
      error_message: message,
    });
    if (!res.headersSent) {
      sendJson(res, 502, { error: { message } });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function safeStaticPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0] || '/');
  const normalized = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = path.join(distDir, normalized);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(distDir)) return null;
  return resolved;
}

function serveStatic(req, res) {
  let filePath = safeStaticPath(req.url || '/');
  if (!filePath) {
    sendJson(res, 400, { error: { message: 'Invalid path.' } });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    sendJson(res, 500, { error: { message: 'dist/index.html not found. Run npm run build first.' } });
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', contentTypeFor(filePath));
  if (filePath !== path.join(distDir, 'index.html')) {
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  }
  const stat = fs.statSync(filePath);
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  const shouldGzip = acceptsGzip && /\.(?:html|js|css|json|svg)$/i.test(filePath);
  if (req.method === 'HEAD') {
    if (shouldGzip) {
      const gzipped = zlib.gzipSync(fs.readFileSync(filePath));
      res.setHeader('content-encoding', 'gzip');
      res.setHeader('vary', 'Accept-Encoding');
      res.setHeader('content-length', gzipped.length);
    } else {
      res.setHeader('content-length', stat.size);
    }
    res.end();
    return;
  }
  if (shouldGzip) {
    const gzipped = zlib.gzipSync(fs.readFileSync(filePath));
    res.setHeader('content-encoding', 'gzip');
    res.setHeader('vary', 'Accept-Encoding');
    res.setHeader('content-length', gzipped.length);
    res.end(gzipped);
    return;
  }
  res.setHeader('content-length', stat.size);
  fs.createReadStream(filePath).pipe(res);
}

async function route(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/health') {
      await handleHealth(req, res);
      return;
    }
    if (url.pathname === '/api/auth/test-invite') {
      await handleTestInvite(req, res, url);
      return;
    }
    if (url.pathname === '/api/credits/status') {
      await handleCreditStatus(req, res);
      return;
    }
    if (url.pathname === '/api/admin/credits') {
      await handleAdminCredits(req, res, url);
      return;
    }
    if (url.pathname === '/api/admin/usage') {
      await handleAdminUsage(req, res, url);
      return;
    }
    if (url.pathname === '/api/admin/users') {
      await handleAdminUsers(req, res, url);
      return;
    }
    if (url.pathname === '/api/projects') {
      await handleProjects(req, res);
      return;
    }
    if (url.pathname.startsWith('/api/projects/')) {
      const projectId = decodeURIComponent(url.pathname.replace('/api/projects/', '').trim());
      await handleProjectById(req, res, projectId);
      return;
    }
    if (url.pathname === '/api/llm/chat') {
      await handleLlmChat(req, res);
      return;
    }
    if (url.pathname === '/api/video/contact-sheet') {
      await handleVideoContactSheet(req, res);
      return;
    }
    if (url.pathname === '/supabase' || url.pathname.startsWith('/supabase/')) {
      await handleSupabaseProxy(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: { message: 'API route not found.' } });
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    console.error('Server error', sanitizeError(error));
    sendJson(res, 500, { error: { message: '服务器内部错误。' } });
  }
}

http.createServer((req, res) => {
  void route(req, res);
}).listen(port, '0.0.0.0', () => {
  console.log(`Studio Canvas server listening on http://0.0.0.0:${port}`);
});
