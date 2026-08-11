import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const STALE_CHUNK_RELOAD_KEY = 'studio-canvas:stale-chunk-reload:v1';
const STALE_CHUNK_RELOAD_GUARD_MS = 30_000;

function isStaleDynamicImportError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

function reloadAfterStaleChunk(): void {
  const now = Date.now();
  try {
    const lastReloadAt = Number.parseInt(
      window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) ?? '',
      10,
    );
    if (Number.isFinite(lastReloadAt) && now - lastReloadAt < STALE_CHUNK_RELOAD_GUARD_MS) {
      return;
    }
    window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Reloading still repairs a stale bundle when session storage is unavailable.
  }
  window.setTimeout(() => window.location.reload(), 0);
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadAfterStaleChunk();
});

window.addEventListener('unhandledrejection', (event) => {
  if (!isStaleDynamicImportError(event.reason)) return;
  event.preventDefault();
  reloadAfterStaleChunk();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
