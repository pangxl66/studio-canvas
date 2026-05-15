import { Panel } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clearLlmUserSettings,
  DEFAULT_DEEP_LLM_MODEL,
  DEFAULT_LLM_TIMEOUT_MS,
  getAvailableLocalLlmProviders,
  getLlmSettingsFormDefaults,
  getSelectedLlmProvider,
  saveLlmUserSettings,
  saveSelectedLlmProvider,
  type LlmProvider,
  type LlmUserSettings,
} from '@/config/llmSettings';

export const STUDIO_OPEN_SETTINGS_EVENT = 'studio:open-settings';
export const STUDIO_SETTINGS_CHANGED_EVENT = 'studio:settings-changed';

function LlmProviderButtons({
  value,
  options,
  onChange,
}: {
  value: LlmProvider;
  options: Array<{ id: LlmProvider; label: string; configured: boolean }>;
  onChange: (next: LlmProvider) => void;
}) {
  return (
    <div className="studio-run-mode-toggle studio-run-provider-toggle" role="group" aria-label="API provider switch">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`studio-run-mode-toggle__btn ${value === option.id ? 'studio-run-mode-toggle__btn--active' : ''}`}
          disabled={!option.configured}
          title={option.configured ? `Use ${option.label}` : `${option.label} 未配置`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StudioSettings() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LlmUserSettings>(() => getLlmSettingsFormDefaults());
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<LlmProvider>(() => getSelectedLlmProvider());
  const localProviderOptions = useMemo(() => getAvailableLocalLlmProviders(), [open, savedHint, selectedProvider]);
  const showProviderSwitch = localProviderOptions.some((option) => option.configured);

  const openModal = useCallback(() => {
    setForm(getLlmSettingsFormDefaults());
    setSavedHint(null);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = () => openModal();
    const onChanged = () => {
      setSelectedProvider(getSelectedLlmProvider());
      if (open) {
        setForm(getLlmSettingsFormDefaults());
      }
    };
    window.addEventListener(STUDIO_OPEN_SETTINGS_EVENT, onOpen);
    window.addEventListener(STUDIO_SETTINGS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(STUDIO_OPEN_SETTINGS_EVENT, onOpen);
      window.removeEventListener(STUDIO_SETTINGS_CHANGED_EVENT, onChanged);
    };
  }, [open, openModal]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const onProviderChange = useCallback((nextProvider: LlmProvider) => {
    saveSelectedLlmProvider(nextProvider);
    const defaults = getLlmSettingsFormDefaults();
    setSelectedProvider(nextProvider);
    setForm(defaults);
    setSavedHint(`API 已切换到 ${nextProvider === 'deepseek' ? 'DeepSeek' : 'GPT'}。`);
    window.dispatchEvent(new Event(STUDIO_SETTINGS_CHANGED_EVENT));
  }, []);

  const onSave = useCallback(() => {
    const next: LlmUserSettings = {
      proxyUrl: form.proxyUrl.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      mode: 'deep',
      deepModel: form.deepModel.trim(),
      timeoutMs: Math.max(5000, Math.min(600_000, form.timeoutMs || DEFAULT_LLM_TIMEOUT_MS)),
      pipelineMode: 'model',
    };
    saveLlmUserSettings(next);
    window.dispatchEvent(new Event(STUDIO_SETTINGS_CHANGED_EVENT));
    setSavedHint(
      next.proxyUrl
        ? '已保存代理模式配置。后续生成会统一走 API 模型。'
        : '已保存直连配置。正式环境仍建议使用代理，避免在浏览器暴露 API Key。',
    );
    setForm(next);
  }, [form]);

  const onClear = useCallback(() => {
    clearLlmUserSettings();
    window.dispatchEvent(new Event(STUDIO_SETTINGS_CHANGED_EVENT));
    setForm(getLlmSettingsFormDefaults());
    setSavedHint('已清除本地保存的模型设置，仍会继续读取 `.env` 里的环境配置。');
  }, []);

  const currentModel = form.deepModel.trim() || DEFAULT_DEEP_LLM_MODEL;
  const usingProxy = form.proxyUrl.trim().length > 0;
  const formGatewayReady = Boolean(form.proxyUrl.trim() || (form.baseUrl.trim() && form.apiKey.trim()));

  return (
    <>
      <Panel position="top-right" className="studio-run-mode-panel-anchor">
        <div className="studio-run-mode-panel nodrag nopan">
          {showProviderSwitch ? (
            <div className="studio-settings-quick-group">
              <span className="studio-settings-quick-label">API</span>
              <LlmProviderButtons value={selectedProvider} options={localProviderOptions} onChange={onProviderChange} />
            </div>
          ) : null}
        </div>
      </Panel>

      {open
        ? createPortal(
            <div className="studio-settings-backdrop" role="presentation">
              <div
                className="studio-settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="studio-settings-title"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="studio-settings-modal__head">
                  <h2 id="studio-settings-title" className="studio-settings-modal__title">
                    模型设置
                  </h2>
                  <button type="button" className="studio-settings-modal__close" onClick={() => setOpen(false)}>
                    关闭
                  </button>
                </div>
                <div className="studio-settings-modal__body">
                  <section className="studio-settings-section" aria-labelledby="llm-api-heading">
                    <h3 id="llm-api-heading" className="studio-settings-section__title">
                      API 模型
                    </h3>
                    <p className="studio-settings-section__desc">
                      快速模式已移除。现在所有 LLM 功能统一走 API 模型，推荐填写代理 URL，避免在浏览器暴露 API Key。
                    </p>
                    <label className="studio-settings-field">
                      <span>代理 URL</span>
                      <input
                        value={form.proxyUrl}
                        onChange={(event) => setForm((prev) => ({ ...prev, proxyUrl: event.target.value }))}
                        placeholder="/api/llm/chat"
                      />
                      <small>优先使用后端代理。线上环境建议保持这个配置。</small>
                    </label>
                    <label className="studio-settings-field">
                      <span>Base URL</span>
                      <input
                        value={form.baseUrl}
                        onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                        placeholder="https://api.openai.com/v1"
                      />
                    </label>
                    <label className="studio-settings-field">
                      <span>API Key</span>
                      <input
                        value={form.apiKey}
                        onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                        type="password"
                        placeholder="sk-..."
                        autoComplete="off"
                      />
                      <small>只有本地调试建议直连填写；线上请放到服务端环境变量。</small>
                    </label>
                    <label className="studio-settings-field">
                      <span>模型</span>
                      <input
                        value={form.deepModel}
                        onChange={(event) => setForm((prev) => ({ ...prev, deepModel: event.target.value }))}
                        placeholder={DEFAULT_DEEP_LLM_MODEL}
                      />
                    </label>
                    <label className="studio-settings-field">
                      <span>超时时间（毫秒）</span>
                      <input
                        value={form.timeoutMs}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            timeoutMs: Number(event.target.value) || DEFAULT_LLM_TIMEOUT_MS,
                          }))
                        }
                        type="number"
                        min={5000}
                        max={600000}
                        step={1000}
                      />
                    </label>
                    <div className={`studio-settings-status ${formGatewayReady ? 'studio-settings-status--ok' : ''}`}>
                      {formGatewayReady
                        ? `API 模型已就绪，${usingProxy ? '会优先走代理' : '将使用直连模式'}，当前模型为 ${currentModel}。`
                        : '请至少填写代理 URL，或填写 Base URL 与 API Key。'}
                    </div>
                    {savedHint ? <p className="studio-settings-hint">{savedHint}</p> : null}
                    <div className="studio-settings-actions">
                      <button type="button" className="studio-settings-primary" onClick={onSave}>
                        保存设置
                      </button>
                      <button type="button" className="studio-settings-secondary" onClick={onClear}>
                        清除本地设置
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
