import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createStudioProjectPayload,
  getActiveStudioProjectRef,
  getStudioAutosave,
  getStudioProjectRecord,
  hydrateStudioProjectPayloadImages,
  parseStudioProjectPayload,
  queueStudioProjectSnapshot,
  setActiveStudioProjectRef,
  type StudioRecentProjectRef,
} from '@/services/studioProjectPersistence';
import { getActiveDiskProjectSnapshot } from '@/services/localProjectDiskService';
import { chooseStudioProjectRestoreCandidate } from '@/services/studioProjectRestorePolicy';
import {
  clearStudioRecoveryDraft,
  mergeStudioRecoveryDraftVisuals,
  readStudioRecoveryDraft,
  writeStudioRecoveryDraft,
} from '@/services/studioProjectRecoveryDraft';
import { useStudioStore } from '@/store/useStudioStore';

const RECOVERY_DRAFT_DEBOUNCE_MS = 600;

type UseStudioProjectPersistenceOptions = {
  rememberRecent: (
    projectId: string,
    projectName: string,
    source: StudioRecentProjectRef['source'],
  ) => Promise<void>;
};

export type StudioProjectSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type StudioProjectPersistenceController = {
  error: string | null;
  flushCurrentProjectSnapshot: () => Promise<void>;
  lastSavedAt: number | null;
  saveStatus: StudioProjectSaveStatus;
};

export function useStudioProjectPersistence({
  rememberRecent,
}: UseStudioProjectPersistenceOptions): StudioProjectPersistenceController {
  const persistenceReadyRef = useRef(false);
  const dirtyRevisionRef = useRef(0);
  const recoveryDraftTimerRef = useRef<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<StudioProjectSaveStatus>('idle');
  const saveStatusRef = useRef<StudioProjectSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hydrateProject = useStudioStore((state) => state.hydrateProject);
  const updateSaveStatus = useCallback((next: StudioProjectSaveStatus) => {
    if (saveStatusRef.current === next) return;
    saveStatusRef.current = next;
    setSaveStatus(next);
  }, []);

  const flushRecoveryDraft = useCallback(() => {
    if (!persistenceReadyRef.current) return;
    if (recoveryDraftTimerRef.current != null) {
      window.clearTimeout(recoveryDraftTimerRef.current);
      recoveryDraftTimerRef.current = null;
    }
    const {
      nodes: liveNodes,
      edges: liveEdges,
      currentProjectId: liveProjectId,
      currentProjectName: liveProjectName,
    } = useStudioStore.getState();
    if (liveNodes.length === 0 && liveEdges.length === 0 && !liveProjectId) {
      clearStudioRecoveryDraft();
      return;
    }
    writeStudioRecoveryDraft(
      createStudioProjectPayload(liveNodes, liveEdges, {
        projectId: liveProjectId ?? undefined,
        projectName: liveProjectName,
      }),
    );
  }, []);

  const persistCurrentProjectSnapshot = useCallback(async () => {
    const {
      nodes: liveNodes,
      edges: liveEdges,
      currentProjectId: liveProjectId,
      currentProjectName: liveProjectName,
    } = useStudioStore.getState();
    if (liveNodes.length === 0 && liveEdges.length === 0 && !liveProjectId) {
      return;
    }
    updateSaveStatus('saving');
    setError(null);
    const revisionAtSaveStart = dirtyRevisionRef.current;
    try {
      const payload = createStudioProjectPayload(liveNodes, liveEdges, {
        projectId: liveProjectId ?? undefined,
        projectName: liveProjectName,
      });
      await queueStudioProjectSnapshot(payload);
      setLastSavedAt(payload.savedAt);
      if (dirtyRevisionRef.current === revisionAtSaveStart) {
        clearStudioRecoveryDraft();
        updateSaveStatus('saved');
      } else {
        flushRecoveryDraft();
        updateSaveStatus('dirty');
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '工程保存失败';
      setError(message);
      updateSaveStatus('error');
      throw saveError;
    }
  }, [flushRecoveryDraft, updateSaveStatus]);

  useEffect(() => {
    let previousNodes = useStudioStore.getState().nodes;
    let previousEdges = useStudioStore.getState().edges;
    return useStudioStore.subscribe((state) => {
      if (state.nodes === previousNodes && state.edges === previousEdges) return;
      previousNodes = state.nodes;
      previousEdges = state.edges;
      if (!persistenceReadyRef.current) return;
      dirtyRevisionRef.current += 1;
      if (
        saveStatusRef.current !== 'saving' &&
        saveStatusRef.current !== 'dirty'
      ) {
        updateSaveStatus('dirty');
      }
      if (recoveryDraftTimerRef.current != null) {
        window.clearTimeout(recoveryDraftTimerRef.current);
      }
      recoveryDraftTimerRef.current = window.setTimeout(() => {
        recoveryDraftTimerRef.current = null;
        flushRecoveryDraft();
      }, RECOVERY_DRAFT_DEBOUNCE_MS);
    });
  }, [flushRecoveryDraft, updateSaveStatus]);

  useEffect(() => {
    let cancelled = false;

    const restoreLatestProject = async () => {
      try {
        const current = useStudioStore.getState();
        if (current.nodes.length > 0 || current.edges.length > 0) {
          persistenceReadyRef.current = true;
          return;
        }

        const rawRecoveryDraft = parseStudioProjectPayload(
          readStudioRecoveryDraft(),
        );
        const [activeRef, autosave, rawDiskSnapshot] = await Promise.all([
          getActiveStudioProjectRef(),
          getStudioAutosave(),
          getActiveDiskProjectSnapshot(),
        ]);
        const activeRecord = activeRef ? await getStudioProjectRecord(activeRef.projectId) : null;
        const diskSnapshot = await hydrateStudioProjectPayloadImages(
          parseStudioProjectPayload(rawDiskSnapshot),
        );
        const recoveryDraft = rawRecoveryDraft
          ? mergeStudioRecoveryDraftVisuals(rawRecoveryDraft, [
              activeRecord,
              autosave,
              diskSnapshot,
            ])
          : null;

        const restore = chooseStudioProjectRestoreCandidate({
          activeRef,
          activeRecord,
          autosave,
          diskSnapshot,
          recoveryDraft,
          fallbackProjectName: useStudioStore.getState().currentProjectName,
        });

        if (!restore || cancelled) return;

        hydrateProject(restore.payload.nodes, restore.payload.edges, {
          projectId: restore.payload.projectId ?? null,
          projectName: restore.projectName,
          broadcastText: restore.broadcastText,
        });

        if (restore.payload.projectId) {
          await setActiveStudioProjectRef({
            projectId: restore.payload.projectId,
            projectName: restore.projectName,
          });
          await rememberRecent(
            restore.payload.projectId,
            restore.projectName,
            restore.source,
          );
        }
      } catch (error) {
        console.warn('Studio project restore failed', error);
        setError(error instanceof Error ? error.message : '工程恢复失败');
        updateSaveStatus('error');
      } finally {
        persistenceReadyRef.current = true;
      }
    };

    void restoreLatestProject();
    return () => {
      cancelled = true;
    };
  }, [hydrateProject, rememberRecent, updateSaveStatus]);

  useEffect(() => {
    const flushSnapshot = () => {
      if (!persistenceReadyRef.current) return;
      flushRecoveryDraft();
      void persistCurrentProjectSnapshot().catch((error) => {
        console.warn('IndexedDB autosave failed', error);
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushSnapshot();
      }
    };

    window.addEventListener('pagehide', flushSnapshot);
    window.addEventListener('beforeunload', flushSnapshot);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushSnapshot);
      window.removeEventListener('beforeunload', flushSnapshot);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushRecoveryDraft, persistCurrentProjectSnapshot]);

  useEffect(() => {
    return () => {
      if (recoveryDraftTimerRef.current != null) {
        window.clearTimeout(recoveryDraftTimerRef.current);
      }
    };
  }, []);

  return {
    error,
    flushCurrentProjectSnapshot: persistCurrentProjectSnapshot,
    lastSavedAt,
    saveStatus,
  };
}
