const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createClient } = require('@supabase/supabase-js');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number.parseInt(process.env.PORT || '3000', 10);

const MAX_INPUT_CHARS = 80_000;
const MAX_PROJECT_SNAPSHOT_CHARS = 5_000_000;
const MAX_SCRIPT_ANALYSIS_CHARS = 100_000;
const PROJECT_LIST_LIMIT = 40;
const DEFAULT_MONTHLY_QUOTA = 30;
const LEGACY_DEFAULT_MONTHLY_QUOTA = 20;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MODEL = 'gpt-5.5';
const TEST_INVITE_TOKEN_PREFIX = 'test-invite';
const testInviteActivationPath = path.join(rootDir, '.data', 'test-invite-activations.json');
const testInviteActivations = new Set();
const testInviteQuotas = new Map();
let testInviteActivationsLoaded = false;

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
  const normalizedEmail = normalizeEmail(email) || 'tester@studio-canvas.local';
  const monthlyQuota = getTestInviteMonthlyQuota();
  const existing = testInviteQuotas.get(normalizedEmail);
  if (existing && (existing.isCustom || existing.monthlyQuota === monthlyQuota)) {
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
    const payload = JSON.stringify(
      {
        emails: [...testInviteActivations].sort(),
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
  saveTestInviteActivations();
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

function defaultModelForProvider(provider) {
  return provider === 'deepseek' ? 'deepseek-chat' : DEFAULT_MODEL;
}

function hasProviderLlmApiKey(provider) {
  return Boolean(envForProvider(provider, 'LLM_API_KEY'));
}

function hasProviderLlmUpstream(provider) {
  return Boolean(envForProvider(provider, 'LLM_PROXY_URL') || envForProvider(provider, 'LLM_BASE_URL'));
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

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
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

function inputChars(body) {
  return JSON.stringify(body.messages || []).length;
}

function outputChars(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.length;
  } catch {
    // Fall through to raw response length.
  }
  return rawText.length;
}

function chatContent(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
  } catch {
    // Fall through to raw response.
  }
  return String(rawText || '');
}

function parseJsonLoose(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Try fenced or surrounded JSON.
  }
  const withoutFence = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    // Try object substring.
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function cleanScriptText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableScriptId(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function confidence(value, fallback = 'medium') {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'high' || raw === 'medium' || raw === 'low' ? raw : fallback;
}

function evidenceType(value, fallback = 'explicit') {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'explicit' || raw === 'inferred' || raw === 'tbc' ? raw : fallback;
}

function listFromValue(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => compactWhitespace(item)).filter(Boolean))];
  }
  return [
    ...new Set(
      String(value || '')
        .split(/[,，、\n]+/)
        .map((item) => compactWhitespace(item))
        .filter(Boolean),
    ),
  ];
}

function buildScriptTextBlocks(scriptText) {
  const blocks = [];
  const paragraphPattern = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  let match;
  let orderNo = 1;
  while ((match = paragraphPattern.exec(scriptText)) != null) {
    const text = match[0].trim();
    if (!text) continue;
    blocks.push({
      id: `BLK-${String(orderNo).padStart(4, '0')}`,
      orderNo,
      pageNo: null,
      text,
      charStart: match.index,
      charEnd: match.index + match[0].length,
    });
    orderNo += 1;
  }
  return blocks;
}

function looksLikeSceneHeading(text) {
  const raw = compactWhitespace(text);
  if (!raw || raw.length > 80) return false;
  const sceneNo = '(?:\\d+|[一二三四五六七八九十百千万〇零两]+)';
  if (new RegExp(`^(第?\\s*${sceneNo}\\s*[场幕]|场景\\s*${sceneNo}|SCENE\\s*\\d+)`, 'i').test(raw)) return true;
  return /(内景|外景|内\/外|外\/内|INT\.?|EXT\.?|日|夜|晨|晚|黄昏|清晨)/i.test(raw) && /[—\-\/ ]/.test(raw);
}

function sceneTimeLabel(title) {
  const raw = String(title || '');
  if (/黄昏|傍晚|晚/.test(raw)) return '傍晚';
  if (/清晨|晨|早/.test(raw)) return '清晨';
  if (/夜|NIGHT/i.test(raw)) return '夜';
  if (/日|白天|DAY/i.test(raw)) return '日';
  return '';
}

function sceneIntExt(title) {
  const raw = String(title || '');
  if (/内\/外|外\/内|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT/i.test(raw)) return 'INT/EXT';
  if (/内景|INT/i.test(raw)) return 'INT';
  if (/外景|EXT/i.test(raw)) return 'EXT';
  return '';
}

function sceneLocation(title) {
  let raw = String(title || '')
    .replace(/^(第?\s*(?:\d+|[一二三四五六七八九十百千万〇零两]+)\s*[场幕]|场景\s*(?:\d+|[一二三四五六七八九十百千万〇零两]+)|SCENE\s*\d+)/i, '')
    .replace(/内景|外景|内\/外|外\/内|INT\.?|EXT\.?/gi, '')
    .replace(/日|夜|清晨|晨|早|傍晚|黄昏|晚|DAY|NIGHT/gi, '')
    .replace(/[—\-\/:：]/g, ' ')
    .trim();
  raw = raw.split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
  return raw || '待确认地点';
}

function sceneSummary(text) {
  const first = compactWhitespace(text).slice(0, 120);
  return first || '待补充';
}

function sceneCharacters(text) {
  const names = [];
  for (const line of String(text || '').split(/\n+/)) {
    const match = line.trim().match(/^([\u4e00-\u9fa5A-Za-z0-9_·]{1,12})\s*[：:]/);
    if (!match) continue;
    const name = match[1].trim();
    if (/^(内景|外景|旁白|字幕|时间|地点|场景)$/.test(name)) continue;
    names.push(name);
  }
  return [...new Set(names)];
}

const SCRIPT_PROP_KEYWORDS = [
  '手机',
  '电话',
  '信',
  '照片',
  '钥匙',
  '枪',
  '刀',
  '车',
  '门票',
  '电脑',
  '盒子',
  '项链',
  '戒指',
  '文件',
  '合同',
  '酒杯',
  '药',
  '包',
];

function sceneProps(text) {
  return SCRIPT_PROP_KEYWORDS.filter((keyword) => String(text || '').includes(keyword));
}

function blockIdsForRange(blocks, start, end) {
  return blocks.filter((block) => block.charEnd >= start && block.charStart <= end).map((block) => block.id);
}

function sourceTextForRange(scriptText, start, end) {
  return cleanScriptText(scriptText.slice(start, end)).slice(0, 480);
}

function ruleScriptAnalysis({ projectName, scriptText, sourceType = 'fallback', warnings = [] }) {
  const cleanText = cleanScriptText(scriptText);
  const blocks = buildScriptTextBlocks(cleanText);
  const headings = [];
  for (const block of blocks) {
    const firstLine = block.text.split('\n')[0]?.trim() || block.text;
    if (looksLikeSceneHeading(firstLine)) {
      headings.push({ block, title: firstLine });
    }
  }

  let sceneRanges;
  if (headings.length) {
    sceneRanges = headings.map((heading, index) => {
      const start = heading.block.charStart;
      const end = headings[index + 1]?.block.charStart ?? cleanText.length;
      return { title: heading.title, start, end };
    });
  } else {
    const groupSize = Math.max(1, Math.ceil(blocks.length / Math.min(8, Math.max(1, blocks.length))));
    sceneRanges = [];
    for (let index = 0; index < blocks.length; index += groupSize) {
      const group = blocks.slice(index, index + groupSize);
      if (!group.length) continue;
      sceneRanges.push({
        title: `片段 ${sceneRanges.length + 1}`,
        start: group[0].charStart,
        end: group[group.length - 1].charEnd,
      });
    }
    warnings.push('未识别到标准场景标题，已按文本段落生成片段，请人工确认场景边界。');
  }

  const scenes = sceneRanges.map((range, index) => {
    const sourceText = sourceTextForRange(cleanText, range.start, range.end);
    return {
      id: stableScriptId('SC', index),
      sceneNo: index + 1,
      title: range.title || `场景 ${index + 1}`,
      intExt: sceneIntExt(range.title),
      location: sceneLocation(range.title),
      timeLabel: sceneTimeLabel(range.title),
      summary: sceneSummary(sourceText),
      characters: sceneCharacters(sourceText),
      props: sceneProps(sourceText),
      sourceText,
      sourceBlockIds: blockIdsForRange(blocks, range.start, range.end),
      confidence: headings.length ? 'medium' : 'low',
      evidenceType: headings.length ? 'explicit' : 'inferred',
      notes: headings.length ? '' : '规则拆分结果，建议人工审核。',
      status: 'ai_generated',
    };
  });

  const characterMap = new Map();
  for (const scene of scenes) {
    for (const name of scene.characters) {
      const current = characterMap.get(name) || { sceneIds: [], sourceText: scene.sourceText, sourceBlockIds: [] };
      current.sceneIds.push(scene.id);
      current.sourceBlockIds.push(...scene.sourceBlockIds);
      characterMap.set(name, current);
    }
  }
  const characters = [...characterMap.entries()].map(([name, info], index) => ({
    id: stableScriptId('CHAR', index),
    name,
    aliases: [],
    description: `${name} 在 ${info.sceneIds.length} 个场景中出现。`,
    firstSceneId: info.sceneIds[0] || null,
    sceneCount: new Set(info.sceneIds).size,
    sourceText: info.sourceText.slice(0, 320),
    sourceBlockIds: [...new Set(info.sourceBlockIds)],
    confidence: 'medium',
    evidenceType: 'explicit',
    notes: '',
    status: 'ai_generated',
  }));

  const propMap = new Map();
  for (const scene of scenes) {
    for (const name of scene.props) {
      const current = propMap.get(name) || { sceneIds: [], sourceText: scene.sourceText, sourceBlockIds: [] };
      current.sceneIds.push(scene.id);
      current.sourceBlockIds.push(...scene.sourceBlockIds);
      propMap.set(name, current);
    }
  }
  const props = [...propMap.entries()].map(([name, info], index) => ({
    id: stableScriptId('PROP', index),
    name,
    category: '道具',
    ownerCharacterId: null,
    importance: info.sceneIds.length > 1 ? 'key' : 'normal',
    sceneIds: [...new Set(info.sceneIds)],
    sourceText: info.sourceText.slice(0, 320),
    sourceBlockIds: [...new Set(info.sourceBlockIds)],
    confidence: 'low',
    evidenceType: 'inferred',
    notes: '由关键词规则识别，建议人工确认。',
    status: 'ai_generated',
  }));

  const locations = [...new Set(scenes.map((scene) => scene.location).filter(Boolean))].map((name, index) => ({
    id: stableScriptId('LOC', index),
    name,
    type: 'location',
    sceneIds: scenes.filter((scene) => scene.location === name).map((scene) => scene.id),
    description: '',
  }));

  return {
    analysisId: `AN-${Date.now()}`,
    projectName: compactWhitespace(projectName) || '未命名剧本',
    sourceType,
    generatedAt: new Date().toISOString(),
    modelUsed: null,
    aiUsed: false,
    warnings,
    stats: {
      textChars: cleanText.length,
      blockCount: blocks.length,
      sceneCount: scenes.length,
      characterCount: characters.length,
      propCount: props.length,
    },
    textBlocks: blocks,
    scenes,
    characters,
    props,
    locations,
  };
}

function blockIdsForQuote(blocks, quote) {
  const compactQuote = compactWhitespace(quote).slice(0, 80);
  if (!compactQuote) return [];
  return blocks
    .filter((block) => compactWhitespace(block.text).includes(compactQuote) || compactQuote.includes(compactWhitespace(block.text).slice(0, 60)))
    .map((block) => block.id)
    .slice(0, 6);
}

function normalizeAiScriptAnalysis(raw, fallback, meta) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('AI response is not an object.');
  }
  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  if (!rawScenes.length) {
    throw new Error('AI response does not contain scenes.');
  }

  const scenes = rawScenes.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : { title: entry };
    const title = compactWhitespace(item.title || item.name || `场景 ${index + 1}`);
    const sourceText = compactWhitespace(item.source_text || item.sourceText || item.evidence || item.summary || '');
    return {
      id: compactWhitespace(item.id) || stableScriptId('SC', index),
      sceneNo: Number(item.scene_no || item.sceneNo || index + 1) || index + 1,
      title,
      intExt: compactWhitespace(item.int_ext || item.intExt || sceneIntExt(title)),
      location: compactWhitespace(item.location || sceneLocation(title)),
      timeLabel: compactWhitespace(item.time_label || item.timeLabel || sceneTimeLabel(title)),
      summary: compactWhitespace(item.summary || sourceText || '待补充'),
      characters: listFromValue(item.characters),
      props: listFromValue(item.props),
      sourceText: sourceText || fallback.scenes[index]?.sourceText || '',
      sourceBlockIds: listFromValue(item.source_block_ids || item.sourceBlockIds).length
        ? listFromValue(item.source_block_ids || item.sourceBlockIds)
        : blockIdsForQuote(fallback.textBlocks, sourceText),
      confidence: confidence(item.confidence),
      evidenceType: evidenceType(item.evidence_type || item.evidenceType),
      notes: compactWhitespace(item.notes),
      status: 'ai_generated',
    };
  });

  const rawCharacters = Array.isArray(raw.characters) ? raw.characters : [];
  const characterNames = rawCharacters.length
    ? rawCharacters
    : [...new Set(scenes.flatMap((scene) => scene.characters))].map((name) => ({ name }));
  const characters = characterNames.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : { name: entry };
    const name = compactWhitespace(item.name || `角色 ${index + 1}`);
    const sceneIds = scenes.filter((scene) => scene.characters.includes(name)).map((scene) => scene.id);
    const sourceText = compactWhitespace(item.source_text || item.sourceText || item.description || '');
    return {
      id: compactWhitespace(item.id) || stableScriptId('CHAR', index),
      name,
      aliases: listFromValue(item.aliases),
      description: compactWhitespace(item.description || (sceneIds.length ? `${name} 出现在 ${sceneIds.length} 个场景。` : '待补充')),
      firstSceneId: compactWhitespace(item.first_scene_id || item.firstSceneId) || sceneIds[0] || null,
      sceneCount: Number(item.scene_count || item.sceneCount || sceneIds.length) || sceneIds.length,
      sourceText,
      sourceBlockIds: listFromValue(item.source_block_ids || item.sourceBlockIds),
      confidence: confidence(item.confidence),
      evidenceType: evidenceType(item.evidence_type || item.evidenceType),
      notes: compactWhitespace(item.notes),
      status: 'ai_generated',
    };
  });

  const rawProps = Array.isArray(raw.props) ? raw.props : [];
  const propNames = rawProps.length ? rawProps : [...new Set(scenes.flatMap((scene) => scene.props))].map((name) => ({ name }));
  const props = propNames.map((entry, index) => {
    const item = entry && typeof entry === 'object' ? entry : { name: entry };
    const name = compactWhitespace(item.name || `道具 ${index + 1}`);
    const sceneIds = listFromValue(item.scene_ids || item.sceneIds);
    const inferredSceneIds = sceneIds.length ? sceneIds : scenes.filter((scene) => scene.props.includes(name)).map((scene) => scene.id);
    return {
      id: compactWhitespace(item.id) || stableScriptId('PROP', index),
      name,
      category: compactWhitespace(item.category) || '道具',
      ownerCharacterId: compactWhitespace(item.owner_character_id || item.ownerCharacterId) || null,
      importance: ['key', 'normal', 'background'].includes(String(item.importance)) ? String(item.importance) : 'normal',
      sceneIds: inferredSceneIds,
      sourceText: compactWhitespace(item.source_text || item.sourceText || ''),
      sourceBlockIds: listFromValue(item.source_block_ids || item.sourceBlockIds),
      confidence: confidence(item.confidence, 'low'),
      evidenceType: evidenceType(item.evidence_type || item.evidenceType, 'inferred'),
      notes: compactWhitespace(item.notes),
      status: 'ai_generated',
    };
  });

  const locations = [...new Set(scenes.map((scene) => scene.location).filter(Boolean))].map((name, index) => ({
    id: stableScriptId('LOC', index),
    name,
    type: 'location',
    sceneIds: scenes.filter((scene) => scene.location === name).map((scene) => scene.id),
    description: '',
  }));

  const warnings = [...fallback.warnings, ...listFromValue(raw.warnings)];
  return {
    ...fallback,
    analysisId: `AN-${Date.now()}`,
    projectName: meta.projectName,
    sourceType: meta.sourceType,
    generatedAt: new Date().toISOString(),
    modelUsed: meta.model,
    aiUsed: true,
    warnings,
    scenes,
    characters,
    props,
    locations,
    stats: {
      textChars: fallback.stats.textChars,
      blockCount: fallback.stats.blockCount,
      sceneCount: scenes.length,
      characterCount: characters.length,
      propCount: props.length,
    },
  };
}

function buildScriptAnalysisMessages(projectName, scriptText) {
  const clippedText = scriptText.slice(0, Math.min(scriptText.length, 46_000));
  return [
    {
      role: 'system',
      content:
        '你是影视统筹和剧本拆解专家。只返回合法 JSON 对象，不要 Markdown。必须基于原文证据，不确定的内容标记 confidence=low 和 evidence_type=tbc。',
    },
    {
      role: 'user',
      content: [
        `项目名：${projectName || '未命名剧本'}`,
        '',
        '请从剧本文本中提取 Phase 1 MVP 结构化数据。返回 JSON：',
        '{',
        '  "warnings": ["string"],',
        '  "scenes": [{"id":"SC-001","scene_no":1,"title":"string","int_ext":"INT/EXT/","location":"string","time_label":"string","summary":"string","characters":["string"],"props":["string"],"source_text":"string","source_block_ids":[],"confidence":"high|medium|low","evidence_type":"explicit|inferred|tbc","notes":"string"}],',
        '  "characters": [{"id":"CHAR-001","name":"string","aliases":[],"description":"string","first_scene_id":"SC-001","scene_count":1,"source_text":"string","source_block_ids":[],"confidence":"high|medium|low","evidence_type":"explicit|inferred|tbc","notes":"string"}],',
        '  "props": [{"id":"PROP-001","name":"string","category":"道具","importance":"key|normal|background","scene_ids":["SC-001"],"source_text":"string","source_block_ids":[],"confidence":"high|medium|low","evidence_type":"explicit|inferred|tbc","notes":"string"}]',
        '}',
        '',
        '剧本文本：',
        clippedText,
      ].join('\n'),
    },
  ];
}

function estimateTokens(inChars, outChars) {
  return Math.ceil((inChars + outChars) / 2);
}

function quotaCostForFeature(feature, body) {
  if (feature === 'script-analysis') return 2;
  if (feature === 'prompt-generate-multi') return 2;
  if (feature === 'prompt-review') return 1;
  if (feature === 'text-polish') return 1;
  if ((body.messages || []).length > 2) return 2;
  return 1;
}

function configuredModelForFeature(feature, provider = '') {
  const normalizedFeature = String(feature || '').trim();
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

function buildUpstreamBody(body, provider = '') {
  const maxTokens = body.max_tokens || body.maxOutputTokens;
  const upstreamBody = {
    messages: body.messages,
    model: normalizeModel(body.model, body.feature, provider),
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

async function callUpstream(body, provider = '') {
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
      body: JSON.stringify(buildUpstreamBody(body, provider)),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
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

async function handleTestInvite(req, res) {
  if (req.method === 'GET') {
    const inviteCodes = getTestInviteCodes();
    sendJson(res, 200, { enabled: Boolean(inviteCodes.length), inviteCount: inviteCodes.length });
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

function isCurrentTestInviteEmail(auth, email) {
  return Boolean(auth?.isTestInvite && normalizeEmail(auth.user?.email) === normalizeEmail(email));
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
    nextMonthly = getTestInviteMonthlyQuota();
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

function readCreditAmount(value) {
  const amount = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999) {
    return null;
  }
  return amount;
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

async function handleScriptAnalyze(req, res) {
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

  const scriptText = cleanScriptText(body.scriptText);
  const projectName = compactWhitespace(body.projectName) || '未命名剧本';
  const sourceType = body.sourceType === 'file' ? 'file' : 'paste';
  if (!scriptText) {
    sendJson(res, 400, { error: { message: '请先提供剧本文本。' } });
    return;
  }
  if (scriptText.length > MAX_SCRIPT_ANALYSIS_CHARS) {
    sendJson(res, 400, {
      error: { message: `剧本文本过长，当前 ${scriptText.length} 字符，上限 ${MAX_SCRIPT_ANALYSIS_CHARS}。` },
    });
    return;
  }

  const auth = await getAuthedContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
    return;
  }

  const provider = normalizeProvider(body.provider);
  const feature = 'script-analysis';
  const messages = buildScriptAnalysisMessages(projectName, scriptText);
  const requestBody = {
    feature,
    messages,
    model: body.model,
    provider,
    response_format: { type: 'json_object' },
    temperature: 0.18,
    max_tokens: 6000,
  };
  const model = normalizeModel(requestBody.model, feature, provider);
  const fallback = ruleScriptAnalysis({
    projectName,
    scriptText,
    sourceType,
    warnings: [],
  });

  if (!hasProviderLlmApiKey(provider) || !hasProviderLlmUpstream(provider)) {
    sendJson(res, 200, {
      ...fallback,
      warnings: [...fallback.warnings, '模型服务尚未配置，已使用规则拆解生成可编辑底稿。'],
    });
    return;
  }

  const cost = quotaCostForFeature(feature, requestBody);
  const inChars = inputChars(requestBody);
  const isTestInvite = Boolean(auth.isTestInvite);
  const testInviteEmail = normalizeEmail(auth.user?.email) || 'tester@studio-canvas.local';
  const recordUsage = async (event) => {
    if (isTestInvite) return;
    await writeUsage(auth.serviceClient, event);
  };
  const refundReservedQuota = async () => {
    if (isTestInvite) {
      refundTestInviteQuota(testInviteEmail, cost);
      return;
    }
    await refundQuota(auth.serviceClient, auth.userId, cost);
  };

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
    await recordUsage({
      user_id: auth.userId,
      project_id: null,
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
    const upstreamResponse = await callUpstream(requestBody, provider);
    const rawText = await upstreamResponse.text();
    const content = chatContent(rawText);
    const parsed = upstreamResponse.ok ? parseJsonLoose(content) : null;
    if (!upstreamResponse.ok || !parsed) {
      throw new Error(upstreamResponse.ok ? '模型返回内容不是合法 JSON。' : classifyUpstreamError(upstreamResponse.status, rawText));
    }

    const result = normalizeAiScriptAnalysis(parsed, fallback, {
      model,
      projectName,
      sourceType,
    });
    const outChars = JSON.stringify(result).length;
    await recordUsage({
      user_id: auth.userId,
      project_id: null,
      feature,
      model,
      input_chars: inChars,
      output_chars: outChars,
      estimated_tokens: estimateTokens(inChars, outChars),
      quota_cost: cost,
      status: 'success',
      error_message: null,
    });
    sendJson(res, 200, result);
  } catch (error) {
    await refundReservedQuota();
    const message = sanitizeError(error) || '模型分析失败。';
    await recordUsage({
      user_id: auth.userId,
      project_id: null,
      feature,
      model,
      input_chars: inChars,
      output_chars: 0,
      estimated_tokens: estimateTokens(inChars, 0),
      quota_cost: 0,
      status: 'failed',
      error_message: message,
    });
    sendJson(res, 200, {
      ...fallback,
      warnings: [...fallback.warnings, `AI 分析失败，已使用规则拆解底稿：${message}`],
    });
  }
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
    if (isTestInvite) return;
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
    const upstreamResponse = await callUpstream(body, provider);
    const rawText = await upstreamResponse.text();
    const outChars = outputChars(rawText);
    const isOk = upstreamResponse.ok;
    const failureMessage = isOk ? undefined : classifyUpstreamError(upstreamResponse.status, rawText);
    await recordUsage({
      user_id: auth.userId,
      project_id: body.projectId || null,
      feature,
      model,
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
          model,
          provider: provider || null,
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
    sendJson(res, 502, { error: { message } });
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
      await handleTestInvite(req, res);
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
    if (url.pathname === '/api/projects') {
      await handleProjects(req, res);
      return;
    }
    if (url.pathname.startsWith('/api/projects/')) {
      const projectId = decodeURIComponent(url.pathname.replace('/api/projects/', '').trim());
      await handleProjectById(req, res, projectId);
      return;
    }
    if (url.pathname === '/api/script/analyze') {
      await handleScriptAnalyze(req, res);
      return;
    }
    if (url.pathname === '/api/llm/chat') {
      await handleLlmChat(req, res);
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
