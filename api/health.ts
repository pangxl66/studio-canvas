import type { IncomingMessage, ServerResponse } from 'node:http';

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function parseEnvMs(value: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

const DEFAULT_TIMEOUT_MS = parseEnvMs(env('LLM_TIMEOUT_MS') || env('VITE_LLM_TIMEOUT_MS'), 420_000, 420_000, 900_000);
const DEFAULT_MODEL = 'gpt-5.5';
const PRIMARY_MODEL_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const PRIMARY_MODEL_COOLDOWN_MS = 10 * 60 * 1000;
const PRIMARY_MODEL_FAILURE_THRESHOLD = 2;
const DEFAULT_MONTHLY_QUOTA = 10;
const LEGACY_DEFAULT_MONTHLY_QUOTA = 20;

function normalizeProvider(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'deepseek') return 'deepseek';
  if (raw === 'gpt') return 'gpt';
  return '';
}

function providerEnvPrefix(provider: string): string {
  if (provider === 'deepseek') return 'DEEPSEEK';
  if (provider === 'gpt') return 'GPT';
  return '';
}

function envForProvider(provider: string, name: string): string {
  const prefix = providerEnvPrefix(normalizeProvider(provider));
  if (prefix) {
    const providerValue = env(`${prefix}_${name}`);
    if (providerValue) return providerValue;
  }
  return env(name);
}

function explicitEnvForProvider(provider: string, name: string): string {
  const prefix = providerEnvPrefix(normalizeProvider(provider));
  if (prefix) return env(`${prefix}_${name}`);
  return env(name);
}

function hasProviderLlmApiKey(provider: string): boolean {
  return Boolean(envForProvider(provider, 'LLM_API_KEY'));
}

function hasProviderLlmUpstream(provider: string): boolean {
  return Boolean(envForProvider(provider, 'LLM_PROXY_URL') || envForProvider(provider, 'LLM_BASE_URL'));
}

function hasExplicitProviderLlmApiKey(provider: string): boolean {
  return Boolean(explicitEnvForProvider(provider, 'LLM_API_KEY'));
}

function hasExplicitProviderLlmUpstream(provider: string): boolean {
  return Boolean(explicitEnvForProvider(provider, 'LLM_PROXY_URL') || explicitEnvForProvider(provider, 'LLM_BASE_URL'));
}

function hasLlmUpstream(): boolean {
  return hasProviderLlmUpstream('') || hasProviderLlmUpstream('gpt') || hasProviderLlmUpstream('deepseek');
}

function defaultModelForProvider(provider: string): string {
  return normalizeProvider(provider) === 'deepseek' ? 'deepseek-chat' : DEFAULT_MODEL;
}

function parseModelList(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
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

function fallbackModelsForProvider(provider: string, primaryModel: string): string[] {
  const normalizedProvider = normalizeProvider(provider);
  const configured = parseModelList(envForProvider(normalizedProvider, 'LLM_FALLBACK_MODELS'));
  const inferred =
    normalizedProvider !== 'deepseek' && String(primaryModel || '').trim().toLowerCase().includes('gpt-5.5')
      ? ['gpt-5.4']
      : [];
  const primaryKey = String(primaryModel || '').trim().toLowerCase();
  return parseModelList([...configured, ...inferred].join(',')).filter((model) => model.toLowerCase() !== primaryKey);
}

function normalizeModel(provider: string): string {
  return envForProvider(provider, 'LLM_MODEL') || defaultModelForProvider(provider);
}

function healthProviderDiagnostics(provider: string) {
  const normalizedProvider = normalizeProvider(provider);
  const primaryModel = normalizeModel(normalizedProvider);
  return {
    provider: normalizedProvider || 'default',
    apiKey: hasProviderLlmApiKey(normalizedProvider),
    upstream: hasProviderLlmUpstream(normalizedProvider),
    explicitApiKey: hasExplicitProviderLlmApiKey(normalizedProvider),
    explicitUpstream: hasExplicitProviderLlmUpstream(normalizedProvider),
    primaryModel,
    fallbackModels: fallbackModelsForProvider(normalizedProvider, primaryModel),
    failureState: {
      coolingDown: false,
      cooldownRemainingSec: 0,
      recentFailures: 0,
    },
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'Method not allowed.' });
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

  json(res, ok ? 200 : 503, {
    ok,
    checks,
    diagnostics: {
      llm: {
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        failureWindowMs: PRIMARY_MODEL_FAILURE_WINDOW_MS,
        failureThreshold: PRIMARY_MODEL_FAILURE_THRESHOLD,
        cooldownMs: PRIMARY_MODEL_COOLDOWN_MS,
        providers: ['', 'gpt', 'deepseek'].map(healthProviderDiagnostics),
      },
      quota: {
        defaultMonthlyQuota: DEFAULT_MONTHLY_QUOTA,
        legacyDefaultMonthlyQuota: LEGACY_DEFAULT_MONTHLY_QUOTA,
      },
      staticAssets: {
        indexCache: 'no-cache, must-revalidate',
        assetCache: 'public, max-age=31536000, immutable',
      },
      server: {
        node: process.version,
        platform: process.platform,
        uptimeSec: Math.floor(process.uptime()),
      },
    },
    runtime: 'vercel-node',
    service: 'studio-canvas-saas',
    timestamp: new Date().toISOString(),
  });
}
