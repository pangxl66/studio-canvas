const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const port = Number.parseInt(process.env.PORT || '3000', 10);

const MAX_INPUT_CHARS = 80_000;
const MAX_PROJECT_SNAPSHOT_CHARS = 5_000_000;
const PROJECT_LIST_LIMIT = 40;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MODEL = 'gpt-5.5';

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

async function getAuthedContext(req) {
  const token = getBearerToken(req);
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
        monthly_quota: 50,
        remaining_quota: 50,
      },
      { onConflict: 'user_id', ignoreDuplicates: true },
    ),
  ]);
}

function hasLlmUpstream() {
  return Boolean(env('LLM_PROXY_URL') || env('LLM_BASE_URL'));
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

function getUpstreamUrl() {
  const proxyUrl = env('LLM_PROXY_URL');
  if (proxyUrl) return proxyUrl;
  const baseUrl = env('LLM_BASE_URL');
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

function estimateTokens(inChars, outChars) {
  return Math.ceil((inChars + outChars) / 2);
}

function quotaCostForFeature(feature, body) {
  if (feature === 'prompt-generate-multi') return 2;
  if (feature === 'prompt-review') return 1;
  if (feature === 'text-polish') return 1;
  if ((body.messages || []).length > 2) return 2;
  return 1;
}

function configuredModelForFeature(feature) {
  const normalizedFeature = String(feature || '').trim();
  if (normalizedFeature === 'text-polish') {
    return env('LLM_FAST_MODEL') || env('LLM_MODEL');
  }
  if (normalizedFeature === 'prompt-review') {
    return env('LLM_DEEP_MODEL') || env('LLM_MODEL');
  }
  return env('LLM_MODEL');
}

function normalizeModel(model, feature) {
  return configuredModelForFeature(feature) || String(model || '').trim() || DEFAULT_MODEL;
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

function buildUpstreamBody(body) {
  const maxTokens = body.max_tokens || body.maxOutputTokens;
  const upstreamBody = {
    messages: body.messages,
    model: normalizeModel(body.model, body.feature),
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

async function callUpstream(body) {
  const upstreamUrl = getUpstreamUrl();
  const apiKey = env('LLM_API_KEY');
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
      body: JSON.stringify(buildUpstreamBody(body)),
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
    llmApiKey: Boolean(env('LLM_API_KEY')),
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
    sendJson(res, 200, {
      displayName: profile?.display_name || null,
      email: profile?.email || auth.user.email || null,
      monthlyQuota: Number(wallet.monthly_quota || 0),
      plan: profile?.plan || 'free',
      remainingQuota: Number(wallet.remaining_quota || 0),
      resetAt: wallet.reset_at || null,
      updatedAt: wallet.updated_at || null,
      userId: auth.userId,
    });
  } catch (error) {
    sendJson(res, 500, { error: { message: sanitizeError(error) || '读取额度失败。' } });
  }
}

async function handleProjects(req, res) {
  const auth = await getAuthedContext(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: { message: auth.error.message } });
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
  const cost = quotaCostForFeature(feature, body);
  const inChars = inputChars(body);
  const model = normalizeModel(body.model, feature);

  console.log(
    'LLM chat request received',
    JSON.stringify({
      feature,
      model,
      requestedModel: String(body.model || '').trim() || null,
      inputChars: inChars,
    }),
  );

  try {
    await ensureUserRows(auth.serviceClient, auth.user);
  } catch (error) {
    sendJson(res, 500, { error: { message: sanitizeError(error) || '用户额度初始化失败。' } });
    return;
  }

  const reservation = await reserveQuota(auth.serviceClient, auth.userId, cost);
  if (!reservation.ok) {
    console.warn(
      'LLM quota reservation failed',
      JSON.stringify({
        feature,
        model,
        cost,
        remaining: reservation.remaining,
        message: sanitizeError(reservation.message),
      }),
    );
    await writeUsage(auth.serviceClient, {
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
    const upstreamResponse = await callUpstream(body);
    const rawText = await upstreamResponse.text();
    const outChars = outputChars(rawText);
    const isOk = upstreamResponse.ok;
    await writeUsage(auth.serviceClient, {
      user_id: auth.userId,
      project_id: body.projectId || null,
      feature,
      model,
      input_chars: inChars,
      output_chars: isOk ? outChars : 0,
      estimated_tokens: estimateTokens(inChars, isOk ? outChars : 0),
      quota_cost: isOk ? cost : 0,
      status: isOk ? 'success' : 'failed',
      error_message: isOk ? undefined : sanitizeError(rawText),
    });
    if (!isOk) {
      console.warn(
        'LLM upstream failed',
        JSON.stringify({
          status: upstreamResponse.status,
          model,
          feature,
          body: sanitizeError(rawText),
        }),
      );
      await refundQuota(auth.serviceClient, auth.userId, cost);
    }
    res.statusCode = upstreamResponse.status;
    res.setHeader('content-type', upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(rawText);
  } catch (error) {
    await refundQuota(auth.serviceClient, auth.userId, cost);
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? '模型请求超时，请稍后重试。'
        : sanitizeError(error) || '模型请求失败。';
    await writeUsage(auth.serviceClient, {
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
  fs.createReadStream(filePath).pipe(res);
}

async function route(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/health') {
      await handleHealth(req, res);
      return;
    }
    if (url.pathname === '/api/credits/status') {
      await handleCreditStatus(req, res);
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
