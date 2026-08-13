const STALE_CHUNK_RELOAD_KEY = 'studio-canvas:stale-chunk-reload:v1';
export const STALE_CHUNK_RELOAD_GUARD_MS = 30_000;

export function isStaleDynamicImportError(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

/**
 * Reload the current origin once when a browser tab still runs an older Vite
 * module graph. This is intentionally shared by global error handlers and by
 * workflows that catch their own errors before `unhandledrejection` can see
 * them (for example storyboard image-reference analysis).
 */
export function reloadAfterStaleChunk(value?: unknown): boolean {
  if (typeof window === 'undefined') return false;
  if (value !== undefined && !isStaleDynamicImportError(value)) return false;

  const now = Date.now();
  try {
    const lastReloadAt = Number.parseInt(
      window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) ?? '',
      10,
    );
    if (Number.isFinite(lastReloadAt) && now - lastReloadAt < STALE_CHUNK_RELOAD_GUARD_MS) {
      return false;
    }
    window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Reloading still repairs a stale bundle when session storage is unavailable.
  }

  // `reload()` keeps the current host. A LAN visitor therefore stays on the
  // LAN address instead of being redirected to this machine's loopback host.
  window.setTimeout(() => window.location.reload(), 0);
  return true;
}
