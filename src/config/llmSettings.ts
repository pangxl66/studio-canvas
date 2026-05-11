import type { ModelGatewayConfig } from '@/services/ModelGateway';
import { isDesktopRuntime, isSaasHostedMode, isSaasMockEnabled } from '@/services/authClient';

// Bump the storage key so stale browser-cached settings do not override the GPT-5.5 defaults.
const STORAGE_KEY = 'studio_canvas_llm_settings_v6';
const LEGACY_STORAGE_KEYS = ['studio_canvas_llm_settings_v5', 'tapnow_studio_llm_settings_v5'];
const PROVIDER_STORAGE_KEY = 'studio_canvas_llm_provider_v1';

export type LlmProvider = 'gpt' | 'deepseek';
export type LlmMode = 'fast' | 'deep';
export type PipelineExecutionMode = 'rule' | 'model';

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'gpt';
export const DEFAULT_FAST_LLM_MODEL = 'gpt-5.5';
export const DEFAULT_DEEP_LLM_MODEL = 'gpt-5.5';
export const DEFAULT_LLM_MODEL = DEFAULT_FAST_LLM_MODEL;
export const DEFAULT_LLM_MODE: LlmMode = 'fast';
export const DEFAULT_LLM_TIMEOUT_MS = 180_000;
export const DEFAULT_PIPELINE_EXECUTION_MODE: PipelineExecutionMode = 'rule';

export type LlmUserSettings = {
  proxyUrl: string;
  baseUrl: string;
  apiKey: string;
  mode: LlmMode;
  fastModel: string;
  deepModel: string;
  timeoutMs: number;
  pipelineMode: PipelineExecutionMode;
};

type ProviderEnvSettings = {
  proxyUrl: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fastModel: string;
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

function envFastModel(): string {
  return envValue('VITE_LLM_FAST_MODEL') || envModel();
}

function envDeepModel(): string {
  return envValue('VITE_LLM_DEEP_MODEL') || envModel();
}

function envMode(): LlmMode | null {
  const raw = envValue('VITE_LLM_MODE').toLowerCase();
  if (raw === 'fast' || raw === 'deep') return raw;
  return null;
}

function envPipelineMode(): PipelineExecutionMode | null {
  const raw =
    ((import.meta.env.VITE_PIPELINE_MODE as string | undefined) ??
      (import.meta.env.VITE_PIPELINE_EXECUTION_MODE as string | undefined) ??
      '')
      .trim()
      .toLowerCase();
  if (raw === 'rule' || raw === 'model') return raw;
  return null;
}

function envTimeoutMs(): number | null {
  const raw = envValue('VITE_LLM_TIMEOUT_MS');
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 5000 ? n : null;
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
    fastModel: providerEnvValue(provider, 'FAST_MODEL') || (usesDefaultEnv ? envFastModel() : '') || model,
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
  const providers: Array<{ id: LlmProvider; label: string }> = [
    { id: 'gpt', label: 'GPT' },
    { id: 'deepseek', label: 'DeepSeek' },
  ];

  return providers.map((provider) => ({
    ...provider,
    configured: hasUsableGatewaySettings(getProviderEnvSettings(provider.id)),
  }));
}

function normalizeMode(mode: unknown): LlmMode {
  return mode === 'deep' ? 'deep' : DEFAULT_LLM_MODE;
}

function normalizePipelineMode(mode: unknown): PipelineExecutionMode {
  if (mode === 'rule') return mode;
  return DEFAULT_PIPELINE_EXECUTION_MODE;
}

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 5000) {
    return Math.min(value, 600_000);
  }
  return envTimeoutMs() ?? DEFAULT_LLM_TIMEOUT_MS;
}

function normalizeModelName(model: string, fallback: string): string {
  const trimmed = model.trim();
  if (!trimmed) return fallback;
  if (trimmed === 'gpt-5.3-codex-spark' || trimmed === 'gpt-5.4') return fallback;
  return trimmed;
}

export function pipelineModeForLlmMode(mode: LlmMode): PipelineExecutionMode {
  return mode === 'deep' ? 'model' : 'rule';
}

export function loadLlmUserSettings(): Partial<LlmUserSettings> | null {
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
    return value as Partial<LlmUserSettings>;
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
  const saved = loadLlmUserSettings();
  const savedMode = saved?.mode;
  const envResolvedMode = envMode();
  if (savedMode === 'fast' || savedMode === 'deep') {
    return pipelineModeForLlmMode(savedMode);
  }
  if (envResolvedMode === 'fast' || envResolvedMode === 'deep') {
    return pipelineModeForLlmMode(envResolvedMode);
  }
  return normalizePipelineMode(saved?.pipelineMode ?? envPipelineMode());
}

export function pipelineModeNeedsGateway(mode: PipelineExecutionMode): boolean {
  return mode === 'model';
}

export function getResolvedLlmGatewayConfig(): ModelGatewayConfig | null {
  const saved = loadLlmUserSettings();
  const forcedSaasProxyUrl = forcedBrowserProxyUrl();
  const preferLocalEnv = shouldPreferLocalEnvGateway();
  const providerEnvSettings = getActiveProviderEnvSettings();
  const proxyUrl = (forcedSaasProxyUrl || (preferLocalEnv ? providerEnvSettings.proxyUrl : saved?.proxyUrl || envProxyUrl())).trim();
  const baseUrl = (preferLocalEnv ? providerEnvSettings.baseUrl : saved?.baseUrl ?? envBaseUrl()).trim();
  const apiKey = (preferLocalEnv ? providerEnvSettings.apiKey : saved?.apiKey ?? envApiKey()).trim();
  const mode = normalizeMode(saved?.mode ?? envMode());
  const fastModel = normalizeModelName(
    preferLocalEnv ? providerEnvSettings.fastModel : saved?.fastModel ?? envFastModel(),
    DEFAULT_FAST_LLM_MODEL,
  );
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
    model: mode === 'deep' ? deepModel : fastModel,
    timeoutMs,
  };
}

export function getLlmSettingsFormDefaults(): LlmUserSettings {
  const saved = loadLlmUserSettings();
  const preferLocalEnv = shouldPreferLocalEnvGateway();
  const mode = normalizeMode(saved?.mode ?? envMode());
  const forcedSaasProxyUrl = forcedBrowserProxyUrl();
  const providerEnvSettings = getActiveProviderEnvSettings();
  return {
    proxyUrl: (forcedSaasProxyUrl || (preferLocalEnv ? providerEnvSettings.proxyUrl : saved?.proxyUrl || envProxyUrl())).trim(),
    baseUrl: forcedSaasProxyUrl ? '' : (preferLocalEnv ? providerEnvSettings.baseUrl : saved?.baseUrl ?? envBaseUrl()).trim(),
    apiKey: forcedSaasProxyUrl ? '' : (preferLocalEnv ? providerEnvSettings.apiKey : saved?.apiKey ?? envApiKey()).trim(),
    mode,
    fastModel: normalizeModelName(
      preferLocalEnv ? providerEnvSettings.fastModel : saved?.fastModel ?? envFastModel(),
      DEFAULT_FAST_LLM_MODEL,
    ),
    deepModel: normalizeModelName(
      preferLocalEnv ? providerEnvSettings.deepModel : saved?.deepModel ?? envDeepModel(),
      DEFAULT_DEEP_LLM_MODEL,
    ),
    timeoutMs: normalizeTimeoutMs(preferLocalEnv ? envTimeoutMs() : saved?.timeoutMs),
    pipelineMode:
      preferLocalEnv || saved?.mode === 'fast' || saved?.mode === 'deep' || envResolvedModeExists(saved?.mode, envMode())
        ? pipelineModeForLlmMode(mode)
        : normalizePipelineMode(saved?.pipelineMode ?? envPipelineMode()),
  };
}

function envResolvedModeExists(savedMode: unknown, envModeValue: LlmMode | null): boolean {
  return savedMode === 'fast' || savedMode === 'deep' || envModeValue === 'fast' || envModeValue === 'deep';
}
