/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_BASE_URL?: string;
  readonly VITE_LLM_API_KEY?: string;
  readonly VITE_LLM_MODEL?: string;
  readonly VITE_LLM_DEEP_MODEL?: string;
  readonly VITE_LLM_MODE?: string;
  readonly VITE_LLM_TIMEOUT_MS?: string;
  readonly VITE_LLM_PROVIDER?: string;
  readonly VITE_GPT_LLM_PROXY_URL?: string;
  readonly VITE_GPT_LLM_BASE_URL?: string;
  readonly VITE_GPT_LLM_API_KEY?: string;
  readonly VITE_GPT_LLM_MODEL?: string;
  readonly VITE_GPT_LLM_DEEP_MODEL?: string;
  readonly VITE_DEEPSEEK_LLM_PROXY_URL?: string;
  readonly VITE_DEEPSEEK_LLM_BASE_URL?: string;
  readonly VITE_DEEPSEEK_LLM_API_KEY?: string;
  readonly VITE_DEEPSEEK_LLM_MODEL?: string;
  readonly VITE_DEEPSEEK_LLM_DEEP_MODEL?: string;
  readonly VITE_PIPELINE_MODE?: string;
  readonly VITE_PIPELINE_EXECUTION_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SAAS_MOCK?: string;
  readonly VITE_ADMIN_TOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
