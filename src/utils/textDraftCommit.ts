export const FLUSH_TEXT_NODE_DRAFTS_EVENT = 'studio:flush-text-node-drafts';

export function flushTextNodeDrafts(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new Event(FLUSH_TEXT_NODE_DRAFTS_EVENT));
}
