const shotListPendingEditFlushers = new Map<string, () => void>();

export function registerShotListPendingEditFlusher(nodeId: string, flush: () => void): void {
  shotListPendingEditFlushers.set(nodeId, flush);
}

export function unregisterShotListPendingEditFlusher(nodeId: string, flush: () => void): void {
  if (shotListPendingEditFlushers.get(nodeId) === flush) {
    shotListPendingEditFlushers.delete(nodeId);
  }
}

export function flushShotListPendingEdits(nodeId: string | null | undefined): void {
  if (!nodeId) return;
  try {
    shotListPendingEditFlushers.get(nodeId)?.();
  } catch (error) {
    console.error('Failed to flush pending shot list edits.', error);
  }
}
