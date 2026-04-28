import { Panel } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clearLlmUserSettings,
  DEFAULT_DEEP_LLM_MODEL,
  DEFAULT_FAST_LLM_MODEL,
  DEFAULT_LLM_TIMEOUT_MS,
  getLlmSettingsFormDefaults,
  getResolvedLlmGatewayConfig,
  pipelineModeForLlmMode,
  pipelineModeNeedsGateway,
  saveLlmUserSettings,
  type LlmMode,
  type LlmUserSettings,
} from '@/config/llmSettings';

export const STUDIO_OPEN_SETTINGS_EVENT = 'studio:open-settings';
export const STUDIO_SETTINGS_CHANGED_EVENT = 'studio:settings-changed';

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.52-.4-1.08-.73-1.69-.98l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.61.25-1.17.59-1.69.98l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.52.4 1.08.73 1.69.98l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.61-.25 1.17-.59 1.69-.98l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

function saveWithLlmMode(mode: LlmMode): LlmUserSettings {
  const current = getLlmSettingsFormDefaults();
  const next: LlmUserSettings = {
    ...current,
    mode,
    pipelineMode: pipelineModeForLlmMode(mode),
  };
  saveLlmUserSettings(next);
  window.dispatchEvent(new Event(STUDIO_SETTINGS_CHANGED_EVENT));
  return next;
}

function LlmModeButtons({
  value,
  onChange,
}: {
  value: LlmMode;
  onChange: (next: LlmMode) => void;
}) {
  const options: Array<{ value: LlmMode; label: string }> = [
    { value: 'fast', label: 'Fast' },
    { value: 'deep', label: 'Deep' },
  ];

  return (
    <div className="studio-run-mode-toggle" role="group" aria-label="运行模式切换">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`studio-run-mode-toggle__btn ${value === option.value ? 'studio-run-mode-toggle__btn--active' : ''}`}
          onClick={() => onChange(option.value)}
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
  const [quickLlmMode, setQuickLlmMode] = useState<LlmMode>(() => getLlmSettingsFormDefaults().mode);

  const gatewayReady = useMemo(() => getResolvedLlmGatewayConfig() != null, [open, savedHint, quickLlmMode]);
  const gatewayRequired = pipelineModeNeedsGateway(pipelineModeForLlmMode(form.mode));

  const openModal = useCallback(() => {
    const defaults = getLlmSettingsFormDefaults();
    setForm(defaults);
    setQuickLlmMode(defaults.mode);
    setSavedHint(null);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = () => openModal();
    const onChanged = () => {
      const defaults = getLlmSettingsFormDefaults();
      setQuickLlmMode(defaults.mode);
      if (!open) return;
      setForm(defaults);
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
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const onQuickLlmModeChange = useCallback((nextMode: LlmMode) => {
    const next = saveWithLlmMode(nextMode);
    setQuickLlmMode(nextMode);
    setForm(next);
    const activeModel =
      nextMode === 'deep'
        ? next.deepModel.trim() || DEFAULT_DEEP_LLM_MODEL
        : next.fastModel.trim() || DEFAULT_FAST_LLM_MODEL;
    setSavedHint(
      nextMode === 'deep'
        ? `已切换到 Deep：后续任务优先使用深度模型，当前模型为 ${activeModel}。`
        : `已切换到 Fast：后续任务优先使用快速模式，当前模型为 ${activeModel}。`,
    );
  }, []);

  const onSave = useCallback(() => {
    const next: LlmUserSettings = {
      proxyUrl: form.proxyUrl.trim(),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      mode: form.mode,
      fastModel: form.fastModel.trim(),
      deepModel: form.deepModel.trim(),
      timeoutMs: Math.max(5000, Math.min(600_000, form.timeoutMs || DEFAULT_LLM_TIMEOUT_MS)),
      pipelineMode: pipelineModeForLlmMode(form.mode),
    };
    saveLlmUserSettings(next);
    window.dispatchEvent(new Event(STUDIO_SETTINGS_CHANGED_EVENT));
    setQuickLlmMode(next.mode);
    setSavedHint(
      next.proxyUrl
        ? '已保存代理模式配置。优先通过代理 URL 发起模型请求。'
        : '已保存直连配置。请注意浏览器直连会暴露 API Key，正式环境更推荐代理模式。',
    );
    setForm(next);
  }, [form]);

  const onClear = useCallback(() => {
    clearLlmUserSettings();
    window.dispatchEvent(new Event(STUDIO_SETTINGS_CHANGED_EVENT));
    const defaults = getLlmSettingsFormDefaults();
    setForm(defaults);
    setQuickLlmMode(defaults.mode);
    setSavedHint('已清除本地保存的设置，仍会继续读取 `.env` 里的 VITE_* 配置。');
  }, []);

  const currentModel =
    form.mode === 'deep'
      ? form.deepModel.trim() || DEFAULT_DEEP_LLM_MODEL
      : form.fastModel.trim() || DEFAULT_FAST_LLM_MODEL;
  const usingProxy = form.proxyUrl.trim().length > 0;

  return (
    <>
      <Panel position="top-right" className="studio-run-mode-panel-anchor">
        <div className="studio-run-mode-panel nodrag nopan">
          <div className="studio-settings-quick-group">
            <span className="studio-settings-quick-label">模式</span>
            <LlmModeButtons value={quickLlmMode} onChange={onQuickLlmModeChange} />
          </div>
          <button
            type="button"
            className="studio-run-mode-settings-btn nodrag nopan"
            title="打开模型设置"
            aria-label="打开模型设置"
            onClick={openModal}
          >
            <IconGear />
            <span>模型设置</span>
          </button>
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
                      模式与网关
                    </h3>
                    <p className="studio-settings-section__desc">
                      推荐优先填写 <code>代理 URL</code>，让浏览器通过你的后端代理访问模型，这样不需要把 API Key 暴露给前端。
                      如果暂时没有代理，也可以使用 <code>Base URL + API Key</code> 直连兼容接口。
                    </p>

                    <div className="studio-settings-quick-group">
                      <span className="studio-settings-quick-label">当前模式</span>
                      <LlmModeButtons
                        value={form.mode}
                        onChange={(mode) =>
                          setForm((current) => ({
                            ...current,
                            mode,
                            pipelineMode: pipelineModeForLlmMode(mode),
                          }))
                        }
                      />
                    </div>

                    <label className="studio-settings-field">
                      <span className="studio-settings-field__label">代理 URL</span>
                      <input
                        type="text"
                        className="studio-settings-field__input"
                        placeholder="/api/chat/completions"
                        value={form.proxyUrl}
                        onChange={(event) => setForm((current) => ({ ...current, proxyUrl: event.target.value }))}
                        autoComplete="off"
                      />
                    </label>

                    <label className="studio-settings-field">
                      <span className="studio-settings-field__label">Base URL</span>
                      <input
                        type="url"
                        className="studio-settings-field__input"
                        placeholder="https://api.openai.com/v1"
                        value={form.baseUrl}
                        onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
                        autoComplete="off"
                      />
                    </label>

                    <label className="studio-settings-field">
                      <span className="studio-settings-field__label">API Key</span>
                      <input
                        type="password"
                        className="studio-settings-field__input"
                        placeholder={usingProxy ? '使用代理模式时可留空' : 'sk-...'}
                        value={form.apiKey}
                        onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                        autoComplete="off"
                      />
                    </label>

                    <label className="studio-settings-field">
                      <span className="studio-settings-field__label">Fast 模型</span>
                      <input
                        type="text"
                        className="studio-settings-field__input"
                        placeholder={DEFAULT_FAST_LLM_MODEL}
                        value={form.fastModel}
                        onChange={(event) => setForm((current) => ({ ...current, fastModel: event.target.value }))}
                        autoComplete="off"
                      />
                    </label>

                    <label className="studio-settings-field">
                      <span className="studio-settings-field__label">Deep 模型</span>
                      <input
                        type="text"
                        className="studio-settings-field__input"
                        placeholder={DEFAULT_DEEP_LLM_MODEL}
                        value={form.deepModel}
                        onChange={(event) => setForm((current) => ({ ...current, deepModel: event.target.value }))}
                        autoComplete="off"
                      />
                    </label>

                    <label className="studio-settings-field">
                      <span className="studio-settings-field__label">超时（毫秒）</span>
                      <input
                        type="number"
                        className="studio-settings-field__input"
                        min={5000}
                        max={600000}
                        step={1000}
                        value={form.timeoutMs}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            timeoutMs: Number.parseInt(event.target.value, 10) || DEFAULT_LLM_TIMEOUT_MS,
                          }))
                        }
                      />
                    </label>

                    <div className={`studio-settings-status ${!gatewayRequired || gatewayReady ? 'studio-settings-status--ok' : ''}`}>
                      {!gatewayRequired
                        ? `当前 Fast 模式已就绪，当前模型为 ${currentModel}。`
                        : gatewayReady
                          ? `当前 Deep 模式已就绪，${usingProxy ? '会优先走代理' : '将使用直连模式'}，当前模型为 ${currentModel}。`
                          : '当前 Deep 模式需要模型网关。请至少填写代理 URL，或填写 Base URL 与 API Key。'}
                    </div>

                    {savedHint ? <p className="studio-settings-hint">{savedHint}</p> : null}

                    <div className="studio-settings-actions">
                      <button
                        type="button"
                        className="studio-settings-btn studio-settings-btn--primary"
                        onClick={onSave}
                      >
                        保存设置
                      </button>
                      <button type="button" className="studio-settings-btn studio-settings-btn--ghost" onClick={onClear}>
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
