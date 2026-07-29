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
import { useStudioStore } from '@/store/useStudioStore';

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
      updateSaveStatus(
        dirtyRevisionRef.current === revisionAtSaveStart ? 'saved' : 'dirty',
      );
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '工程保存失败';
      setError(message);
      updateSaveStatus('error');
      throw saveError;
    }
  }, [updateSaveStatus]);

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
    });
  }, [updateSaveStatus]);

  useEffect(() => {
    let cancelled = false;

    const restoreLatestProject = async () => {
      try {
        const current = useStudioStore.getState();
        if (current.nodes.length > 0 || current.edges.length > 0) {
          persistenceReadyRef.current = true;
          return;
        }

        const [activeRef, autosave, rawDiskSnapshot] = await Promise.all([
          getActiveStudioProjectRef(),
          getStudioAutosave(),
          getActiveDiskProjectSnapshot(),
        ]);
        const activeRecord = activeRef ? await getStudioProjectRecord(activeRef.projectId) : null;
        const diskSnapshot = await hydrateStudioProjectPayloadImages(
          parseStudioProjectPayload(rawDiskSnapshot),
        );

        const restore = chooseStudioProjectRestoreCandidate({
          activeRef,
          activeRecord,
          autosave,
          diskSnapshot,
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
  }, [persistCurrentProjectSnapshot]);

  return {
    error,
    flushCurrentProjectSnapshot: persistCurrentProjectSnapshot,
    lastSavedAt,
    saveStatus,
  };
}
