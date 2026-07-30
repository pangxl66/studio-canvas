import type { IncomingMessage, ServerResponse } from 'node:http';
import runtimeDefaults from '../shared/runtime-defaults.json';

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
const DEFAULT_MODEL = runtimeDefaults.defaultModel;
const PRIMARY_MODEL_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const PRIMARY_MODEL_COOLDOWN_MS = 10 * 60 * 1000;
const PRIMARY_MODEL_FAILURE_THRESHOLD = 2;
const SUPABASE_HEALTH_TIMEOUT_MS = parseEnvMs(env('SUPABASE_HEALTH_TIMEOUT_MS'), 4_000, 1_000, 15_000);
const SUPABASE_HEALTH_CACHE_MS = parseEnvMs(env('SUPABASE_HEALTH_CACHE_MS'), 30_000, 5_000, 300_000);
const DEFAULT_MONTHLY_QUOTA = runtimeDefaults.defaultMonthlyQuota;
const LEGACY_DEFAULT_MONTHLY_QUOTA = runtimeDefaults.legacyDefaultMonthlyQuota;
let supabaseHealthCache: {
  expiresAt: number;
  key: string;
  result: SupabaseHealthResult | null;
} = {
  expiresAt: 0,
  key: '',
  result: null,
};

type SupabaseHealthResult = {
  checkedAt: string;
  configured: boolean;
  error: string | null;
  reachable: boolean;
  statusCode: number | null;
};

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
  const normalizedPrimaryModel = String(primaryModel || '').trim().toLowerCase();
  const inferred =
    normalizedProvider !== 'deepseek' && normalizedPrimaryModel.includes('gpt-5.6-terra')
      ? ['gpt-5.5']
      : normalizedProvider !== 'deepseek' && normalizedPrimaryModel.includes('gpt-5.5')
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

async function probeSupabaseHealth(): Promise<SupabaseHealthResult> {
  const supabaseUrl = env('SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = env('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return {
      checkedAt: new Date().toISOString(),
      configured: false,
      error: 'configuration_incomplete',
      reachable: false,
      statusCode: null,
    };
  }

  const cacheKey = `${supabaseUrl}\n${Boolean(anonKey)}`;
  if (
    supabaseHealthCache.key === cacheKey
    && supabaseHealthCache.result
    && supabaseHealthCache.expiresAt > Date.now()
  ) {
    return supabaseHealthCache.result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_HEALTH_TIMEOUT_MS);
  let result: SupabaseHealthResult;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: anonKey },
      method: 'GET',
      signal: controller.signal,
    });
    result = {
      checkedAt: new Date().toISOString(),
      configured: true,
      error: response.ok ? null : `http_${response.status}`,
      reachable: response.ok,
      statusCode: response.status,
    };
  } catch (error) {
    const candidate = error as { cause?: { code?: unknown }; code?: unknown; name?: unknown } | null;
    const causeCode = String(candidate?.cause?.code ?? candidate?.code ?? '').trim().toLowerCase();
    result = {
      checkedAt: new Date().toISOString(),
      configured: true,
      error: causeCode || (candidate?.name === 'AbortError' ? 'timeout' : 'network_error'),
      reachable: false,
      statusCode: null,
    };
  } finally {
    clearTimeout(timeout);
  }
  supabaseHealthCache = {
    expiresAt: Date.now() + SUPABASE_HEALTH_CACHE_MS,
    key: cacheKey,
    result,
  };
  return result;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  const supabase = {
    anonKey: Boolean(env('SUPABASE_ANON_KEY')),
    serviceRoleKey: Boolean(env('SUPABASE_SERVICE_ROLE_KEY')),
    url: Boolean(env('SUPABASE_URL')),
  };
  const supabaseConfigured = Object.values(supabase).every(Boolean);
  const supabaseHealth = await probeSupabaseHealth();
  const checks = {
    llmApiKey: hasProviderLlmApiKey('') || hasProviderLlmApiKey('gpt') || hasProviderLlmApiKey('deepseek'),
    llmUpstream: hasLlmUpstream(),
    authBackend: supabaseConfigured,
    supabaseReachable: supabaseHealth.reachable,
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
      auth: {
        mode: supabaseConfigured ? 'supabase' : 'unconfigured',
        supabase: {
          ...supabase,
          ...supabaseHealth,
        },
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
