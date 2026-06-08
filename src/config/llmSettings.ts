import type { ModelGatewayConfig } from '@/services/ModelGateway';
import { isDesktopRuntime, isSaasHostedMode, isSaasMockEnabled } from '@/services/authClient';

// v7 keeps only API-backed generation in the user-facing product while keeping legacy settings readable.
const STORAGE_KEY = 'studio_canvas_llm_settings_v7';
const LEGACY_STORAGE_KEYS = [
  'studio_canvas_llm_settings_v6',
  'studio_canvas_llm_settings_v5',
  'tapnow_studio_llm_settings_v5',
];
const PROVIDER_STORAGE_KEY = 'studio_canvas_llm_provider_v1';

export type LlmProvider = 'gpt' | 'deepseek';
export type LlmMode = 'deep';
export type PipelineExecutionMode = 'rule' | 'model';

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'gpt';
export const DEFAULT_DEEP_LLM_MODEL = 'gpt-5.5';
export const DEFAULT_LLM_MODEL = DEFAULT_DEEP_LLM_MODEL;
export const DEFAULT_LLM_MODE: LlmMode = 'deep';
export const DEFAULT_LLM_TIMEOUT_MS = 420_000;
export const DEFAULT_PIPELINE_EXECUTION_MODE: PipelineExecutionMode = 'model';

export type LlmUserSettings = {
  proxyUrl: string;
  baseUrl: string;
  apiKey: string;
  mode: LlmMode;
  deepModel: string;
  timeoutMs: number;
  pipelineMode: PipelineExecutionMode;
};

type LegacyLlmUserSettings = Partial<LlmUserSettings> & Record<string, unknown>;

type ProviderEnvSettings = {
  proxyUrl: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  deepModel: string;
};

function envValue(key: string): string {
  return ((import.meta.env as Record<string, string | undefined>)[key] ?? '').trim();
}

function envProxyUrl(): string {
  return envValue('VITE_LLM_PROXY_URL');
}

function forcedBrowserProxyUrl(): string {
  const proxyUrl = envProxyUrl();
  if (!proxyUrl || isDesktopRuntime()) return '';
  if (isSaasHostedMode()) return proxyUrl;
  return envApiKey() ? '' : proxyUrl;
}

function envBaseUrl(): string {
  return envValue('VITE_LLM_BASE_URL');
}

function envApiKey(): string {
  return envValue('VITE_LLM_API_KEY');
}

function envModel(): string {
  return envValue('VITE_LLM_MODEL');
}

function envDeepModel(): string {
  return envValue('VITE_LLM_DEEP_MODEL') || envModel();
}

function parseModelList(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value.split(/[,;\n]/)) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function envMode(): LlmMode | null {
  return envValue('VITE_LLM_MODE') ? DEFAULT_LLM_MODE : null;
}

function envTimeoutMs(): number | null {
  const raw = envValue('VITE_LLM_TIMEOUT_MS');
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 5000 ? Math.max(n, DEFAULT_LLM_TIMEOUT_MS) : null;
}

function normalizeProvider(value: unknown): LlmProvider {
  return value === 'deepseek' ? 'deepseek' : DEFAULT_LLM_PROVIDER;
}

function envProvider(): LlmProvider | null {
  const raw = envValue('VITE_LLM_PROVIDER').toLowerCase();
  if (raw === 'gpt' || raw === 'deepseek') return raw;
  return null;
}

function providerPrefix(provider: LlmProvider): string {
  return provider === 'deepseek' ? 'DEEPSEEK' : 'GPT';
}

function providerDefaultModel(provider: LlmProvider): string {
  return provider === 'deepseek' ? 'deepseek-chat' : DEFAULT_LLM_MODEL;
}

function providerEnvValue(provider: LlmProvider, suffix: string): string {
  return envValue(`VITE_${providerPrefix(provider)}_LLM_${suffix}`);
}

function fallbackModelsForProvider(provider: LlmProvider, primaryModel: string): string[] {
  const configured = parseModelList(
    providerEnvValue(provider, 'FALLBACK_MODELS') || (providerUsesDefaultEnv(provider) ? envValue('VITE_LLM_FALLBACK_MODELS') : ''),
  );
  const inferred =
    provider !== 'deepseek' && primaryModel.trim().toLowerCase().includes('gpt-5.5') ? ['gpt-5.4'] : [];
  const primaryKey = primaryModel.trim().toLowerCase();
  return parseModelList([...configured, ...inferred].join(',')).filter((model) => model.toLowerCase() !== primaryKey);
}

function providerUsesDefaultEnv(provider: LlmProvider): boolean {
  return (envProvider() ?? DEFAULT_LLM_PROVIDER) === provider;
}

function getProviderEnvSettings(provider: LlmProvider): ProviderEnvSettings {
  const usesDefaultEnv = providerUsesDefaultEnv(provider);
  const fallbackModel = providerDefaultModel(provider);
  const model = providerEnvValue(provider, 'MODEL') || (usesDefaultEnv ? envModel() : '') || fallbackModel;

  return {
    proxyUrl: providerEnvValue(provider, 'PROXY_URL') || (usesDefaultEnv ? envProxyUrl() : ''),
    baseUrl: providerEnvValue(provider, 'BASE_URL') || (usesDefaultEnv ? envBaseUrl() : ''),
    apiKey: providerEnvValue(provider, 'API_KEY') || (usesDefaultEnv ? envApiKey() : ''),
    model,
    deepModel: providerEnvValue(provider, 'DEEP_MODEL') || (usesDefaultEnv ? envDeepModel() : '') || model,
  };
}

function hasUsableGatewaySettings(settings: Pick<ProviderEnvSettings, 'proxyUrl' | 'baseUrl' | 'apiKey'>): boolean {
  return Boolean(settings.proxyUrl || (settings.baseUrl && settings.apiKey));
}

function getActiveProviderEnvSettings(): ProviderEnvSettings {
  const selectedProvider = getSelectedLlmProvider();
  const selectedSettings = getProviderEnvSettings(selectedProvider);
  if (hasUsableGatewaySettings(selectedSettings)) return selectedSettings;
  return getProviderEnvSettings(envProvider() ?? DEFAULT_LLM_PROVIDER);
}

function shouldPreferLocalEnvGateway(): boolean {
  return isSaasMockEnabled() && hasUsableGatewaySettings(getActiveProviderEnvSettings());
}

export function getSelectedLlmProvider(): LlmProvider {
  try {
    return normalizeProvider(localStorage.getItem(PROVIDER_STORAGE_KEY) ?? envProvider() ?? DEFAULT_LLM_PROVIDER);
  } catch {
    return envProvider() ?? DEFAULT_LLM_PROVIDER;
  }
}

export function saveSelectedLlmProvider(provider: LlmProvider): void {
  localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
}

export function getAvailableLocalLlmProviders(): Array<{ id: LlmProvider; label: string; configured: boolean }> {
  const hostedProxyReady = Boolean(forcedBrowserProxyUrl());
  const providers: Array<{ id: LlmProvider; label: string }> = [
    { id: 'gpt', label: 'GPT' },
    { id: 'deepseek', label: 'DeepSeek' },
  ];

  return providers.map((provider) => ({
    ...provider,
    configured: hostedProxyReady || hasUsableGatewaySettings(getProviderEnvSettings(provider.id)),
  }));
}

function normalizeMode(_mode: unknown): LlmMode {
  return DEFAULT_LLM_MODE;
}

function normalizePipelineMode(_mode: unknown): PipelineExecutionMode {
  return DEFAULT_PIPELINE_EXECUTION_MODE;
}

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 5000) {
    return Math.min(Math.max(value, DEFAULT_LLM_TIMEOUT_MS), 600_000);
  }
  return envTimeoutMs() ?? DEFAULT_LLM_TIMEOUT_MS;
}

function normalizeModelName(model: string, fallback: string): string {
  const trimmed = model.trim();
  if (!trimmed) return fallback;
  if (trimmed === 'gpt-5.3-codex-spark') return fallback;
  return trimmed;
}

export function pipelineModeForLlmMode(_mode: LlmMode = DEFAULT_LLM_MODE): PipelineExecutionMode {
  return DEFAULT_PIPELINE_EXECUTION_MODE;
}

export function loadLlmUserSettings(): LegacyLlmUserSettings | null {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find((value): value is string => Boolean(value));
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return null;
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, raw);
    }
    return value as LegacyLlmUserSettings;
  } catch {
    return null;
  }
}

export function saveLlmUserSettings(settings: LlmUserSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearLlmUserSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

export function getResolvedPipelineExecutionMode(): PipelineExecutionMode {
  return DEFAULT_PIPELINE_EXECUTION_MODE;
}

export function pipelineModeNeedsGateway(mode: PipelineExecutionMode): boolean {
  return mode === 'model';
}

export function getResolvedLlmGatewayConfig(): ModelGatewayConfig | null {
  const saved = loadLlmUserSettings();
  const forcedSaasProxyUrl = forcedBrowserProxyUrl();
  const preferLocalEnv = shouldPreferLocalEnvGateway();
  const selectedProvider = getSelectedLlmProvider();
  const providerEnvSettings = getActiveProviderEnvSettings();
  const proxyUrl = (forcedSaasProxyUrl || (preferLocalEnv ? providerEnvSettings.proxyUrl : saved?.proxyUrl || envProxyUrl())).trim();
  const baseUrl = (preferLocalEnv ? providerEnvSettings.baseUrl : saved?.baseUrl ?? envBaseUrl()).trim();
  const apiKey = (preferLocalEnv ? providerEnvSettings.apiKey : saved?.apiKey ?? envApiKey()).trim();
  const deepModel = normalizeModelName(
    preferLocalEnv ? providerEnvSettings.deepModel : saved?.deepModel ?? envDeepModel(),
    DEFAULT_DEEP_LLM_MODEL,
  );
  const timeoutMs = normalizeTimeoutMs(preferLocalEnv ? envTimeoutMs() : saved?.timeoutMs);

  if (!proxyUrl && (!baseUrl || !apiKey)) return null;

  return {
    proxyUrl: proxyUrl || undefined,
    baseUrl: forcedSaasProxyUrl ? undefined : baseUrl || undefined,
    apiKey: forcedSaasProxyUrl ? undefined : apiKey || undefined,
    model: deepModel,
    fallbackModels: fallbackModelsForProvider(selectedProvider, deepModel),
    provider: selectedProvider,
    timeoutMs,
  };
}

export function getResolvedVisionLlmGatewayConfig(): ModelGatewayConfig | null {
  const saved = loadLlmUserSettings();
  const forcedSaasProxyUrl = forcedBrowserProxyUrl();
  const preferLocalEnv = shouldPreferLocalEnvGateway();
  const gptEnvSettings = getProviderEnvSettings('gpt');
  const fallbackEnvSettings = getActiveProviderEnvSettings();
  const providerEnvSettings = hasUsableGatewaySettings(gptEnvSettings) ? gptEnvSettings : fallbackEnvSettings;
  const preferProviderEnv = preferLocalEnv || hasUsableGatewaySettings(gptEnvSettings);
  const proxyUrl = (forcedSaasProxyUrl || (preferProviderEnv ? providerEnvSettings.proxyUrl : saved?.proxyUrl || envProxyUrl())).trim();
  const baseUrl = (preferProviderEnv ? providerEnvSettings.baseUrl : saved?.baseUrl ?? envBaseUrl()).trim();
  const apiKey = (preferProviderEnv ? providerEnvSettings.apiKey : saved?.apiKey ?? envApiKey()).trim();
  const visionModel = normalizeModelName(
    preferProviderEnv ? providerEnvSettings.model : saved?.deepModel ?? envModel() ?? envDeepModel(),
    providerDefaultModel('gpt'),
  );
  const timeoutMs = normalizeTimeoutMs(preferLocalEnv ? envTimeoutMs() : saved?.timeoutMs);

  if (!proxyUrl && (!baseUrl || !apiKey)) return null;

  return {
    proxyUrl: proxyUrl || undefined,
    baseUrl: forcedSaasProxyUrl ? undefined : baseUrl || undefined,
    apiKey: forcedSaasProxyUrl ? undefined : apiKey || undefined,
    model: visionModel,
    fallbackModels: fallbackModelsForProvider('gpt', visionModel),
    provider: 'gpt',
    timeoutMs,
  };
}

export function getLlmSettingsFormDefaults(): LlmUserSettings {
  const saved = loadLlmUserSettings();
  const preferLocalEnv = shouldPreferLocalEnvGateway();
  const forcedSaasProxyUrl = forcedBrowserProxyUrl();
  const providerEnvSettings = getActiveProviderEnvSettings();
  return {
    proxyUrl: (forcedSaasProxyUrl || (preferLocalEnv ? providerEnvSettings.proxyUrl : saved?.proxyUrl || envProxyUrl())).trim(),
    baseUrl: forcedSaasProxyUrl ? '' : (preferLocalEnv ? providerEnvSettings.baseUrl : saved?.baseUrl ?? envBaseUrl()).trim(),
    apiKey: forcedSaasProxyUrl ? '' : (preferLocalEnv ? providerEnvSettings.apiKey : saved?.apiKey ?? envApiKey()).trim(),
    mode: normalizeMode(saved?.mode ?? envMode()),
    deepModel: normalizeModelName(
      preferLocalEnv ? providerEnvSettings.deepModel : saved?.deepModel ?? envDeepModel(),
      DEFAULT_DEEP_LLM_MODEL,
    ),
    timeoutMs: normalizeTimeoutMs(preferLocalEnv ? envTimeoutMs() : saved?.timeoutMs),
    pipelineMode: normalizePipelineMode(saved?.pipelineMode),
  };
}
