import { useCallback, useEffect, useRef } from 'react';
import {
  getActiveStudioProjectRef,
  getStudioAutosave,
  getStudioProjectRecord,
  putStudioAutosave,
  putStudioProjectRecord,
  setActiveStudioProjectRef,
  STUDIO_PROJECT_JSON_VERSION,
  type StudioProjectFilePayload,
  type StudioRecentProjectRef,
} from '@/services/studioProjectPersistence';
import { chooseStudioProjectRestoreCandidate } from '@/services/studioProjectRestorePolicy';
import { useStudioStore } from '@/store/useStudioStore';
import { toPersistableNodesAndEdges } from '@/utils/studioNodePersistence';

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
const AUTOSAVE_DEBOUNCE_MS = 1200;

type UseStudioProjectPersistenceOptions = {
  rememberRecent: (
    projectId: string,
    projectName: string,
    source: StudioRecentProjectRef['source'],
  ) => Promise<void>;
};

export function useStudioProjectPersistence({ rememberRecent }: UseStudioProjectPersistenceOptions): void {
  const autosaveTimerRef = useRef<number | null>(null);
  const persistenceReadyRef = useRef(false);

  const hydrateProject = useStudioStore((state) => state.hydrateProject);
  const currentProjectId = useStudioStore((state) => state.currentProjectId);
  const currentProjectName = useStudioStore((state) => state.currentProjectName);
  const nodes = useStudioStore((state) => state.nodes);
  const edges = useStudioStore((state) => state.edges);

  const persistCurrentProjectSnapshot = useCallback(async () => {
    const {
      nodes: liveNodes,
      edges: liveEdges,
      currentProjectId: liveProjectId,
      currentProjectName: liveProjectName,
    } = useStudioStore.getState();
    const { nodes: persistableNodes, edges: persistableEdges } = toPersistableNodesAndEdges(
      liveNodes,
      liveEdges,
    );

    if (persistableNodes.length === 0 && persistableEdges.length === 0 && !liveProjectId) {
      return;
    }

    const payload: StudioProjectFilePayload = {
      version: STUDIO_PROJECT_JSON_VERSION,
      savedAt: Date.now(),
      nodes: persistableNodes,
      edges: persistableEdges,
      projectId: liveProjectId ?? undefined,
      projectName: liveProjectName,
    };
    await putStudioAutosave(payload);
    if (liveProjectId) {
      await putStudioProjectRecord(liveProjectId, liveProjectName, liveNodes, liveEdges);
      await setActiveStudioProjectRef({
        projectId: liveProjectId,
        projectName: liveProjectName,
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restoreLatestProject = async () => {
      try {
        const current = useStudioStore.getState();
        if (current.nodes.length > 0 || current.edges.length > 0) {
          persistenceReadyRef.current = true;
          return;
        }

        const [activeRef, autosave] = await Promise.all([
          getActiveStudioProjectRef(),
          getStudioAutosave(),
        ]);
        const activeRecord = activeRef ? await getStudioProjectRecord(activeRef.projectId) : null;

        const restore = chooseStudioProjectRestoreCandidate({
          activeRef,
          activeRecord,
          autosave,
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
            restore.source === 'workspace' ? 'workspace' : 'autosave',
          );
        }
      } catch (error) {
        console.warn('Studio project restore failed', error);
      } finally {
        persistenceReadyRef.current = true;
      }
    };

    void restoreLatestProject();
    return () => {
      cancelled = true;
    };
  }, [hydrateProject, rememberRecent]);

  useEffect(() => {
    if (!persistenceReadyRef.current) return;
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistCurrentProjectSnapshot().catch((error) => {
        console.warn('IndexedDB autosave failed', error);
      });
      autosaveTimerRef.current = null;
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [currentProjectId, currentProjectName, edges, nodes, persistCurrentProjectSnapshot]);

  useEffect(() => {
    const tick = () => {
      if (!persistenceReadyRef.current) return;
      void persistCurrentProjectSnapshot().catch((error) => {
        console.warn('IndexedDB autosave failed', error);
      });
    };

    const id = window.setInterval(tick, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [persistCurrentProjectSnapshot]);

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
}
