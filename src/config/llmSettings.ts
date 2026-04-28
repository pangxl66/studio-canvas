import type { ModelGatewayConfig } from '@/services/ModelGateway';

// Bump the storage key so stale browser-cached settings do not override the GPT-5.5 defaults.
const STORAGE_KEY = 'studio_canvas_llm_settings_v6';
const LEGACY_STORAGE_KEYS = ['studio_canvas_llm_settings_v5', 'tapnow_studio_llm_settings_v5'];

export type LlmMode = 'fast' | 'deep';
export type PipelineExecutionMode = 'rule' | 'model';

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

function envProxyUrl(): string {
  return (import.meta.env.VITE_LLM_PROXY_URL as string | undefined)?.trim() ?? '';
}

function envBaseUrl(): string {
  return (import.meta.env.VITE_LLM_BASE_URL as string | undefined)?.trim() ?? '';
}

function envApiKey(): string {
  return (import.meta.env.VITE_LLM_API_KEY as string | undefined)?.trim() ?? '';
}

function envModel(): string {
  return (import.meta.env.VITE_LLM_MODEL as string | undefined)?.trim() ?? '';
}

function envFastModel(): string {
  return (import.meta.env.VITE_LLM_FAST_MODEL as string | undefined)?.trim() ?? envModel();
}

function envDeepModel(): string {
  return (import.meta.env.VITE_LLM_DEEP_MODEL as string | undefined)?.trim() ?? envModel();
}

function envMode(): LlmMode | null {
  const raw = (import.meta.env.VITE_LLM_MODE as string | undefined)?.trim().toLowerCase() ?? '';
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
  const raw = (import.meta.env.VITE_LLM_TIMEOUT_MS as string | undefined)?.trim() ?? '';
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 5000 ? n : null;
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
  const proxyUrl = (saved?.proxyUrl ?? envProxyUrl()).trim();
  const baseUrl = (saved?.baseUrl ?? envBaseUrl()).trim();
  const apiKey = (saved?.apiKey ?? envApiKey()).trim();
  const mode = normalizeMode(saved?.mode ?? envMode());
  const fastModel = normalizeModelName(saved?.fastModel ?? envFastModel(), DEFAULT_FAST_LLM_MODEL);
  const deepModel = normalizeModelName(saved?.deepModel ?? envDeepModel(), DEFAULT_DEEP_LLM_MODEL);
  const timeoutMs = normalizeTimeoutMs(saved?.timeoutMs);

  if (!proxyUrl && (!baseUrl || !apiKey)) return null;

  return {
    proxyUrl: proxyUrl || undefined,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    model: mode === 'deep' ? deepModel : fastModel,
    timeoutMs,
  };
}

export function getLlmSettingsFormDefaults(): LlmUserSettings {
  const saved = loadLlmUserSettings();
  const mode = normalizeMode(saved?.mode ?? envMode());
  return {
    proxyUrl: (saved?.proxyUrl ?? envProxyUrl()).trim(),
    baseUrl: (saved?.baseUrl ?? envBaseUrl()).trim(),
    apiKey: (saved?.apiKey ?? envApiKey()).trim(),
    mode,
    fastModel: normalizeModelName(saved?.fastModel ?? envFastModel(), DEFAULT_FAST_LLM_MODEL),
    deepModel: normalizeModelName(saved?.deepModel ?? envDeepModel(), DEFAULT_DEEP_LLM_MODEL),
    timeoutMs: normalizeTimeoutMs(saved?.timeoutMs),
    pipelineMode:
      saved?.mode === 'fast' || saved?.mode === 'deep' || envResolvedModeExists(saved?.mode, envMode())
        ? pipelineModeForLlmMode(mode)
        : normalizePipelineMode(saved?.pipelineMode ?? envPipelineMode()),
  };
}

function envResolvedModeExists(savedMode: unknown, envModeValue: LlmMode | null): boolean {
  return savedMode === 'fast' || savedMode === 'deep' || envModeValue === 'fast' || envModeValue === 'deep';
}
