import { Panel } from '@xyflow/react';
import { saveAs } from 'file-saver';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { isSaasAuthEnabled } from '@/services/authClient';
import {
  getCloudProject,
  listCloudProjects,
  saveCloudProject,
  type CloudProjectSummary,
} from '@/services/cloudProjectService';
import {
  createStudioProjectId,
  getActiveStudioProjectRef,
  getStudioAutosave,
  getStudioProjectRecord,
  listStudioProjectSummaries,
  listStudioRecentProjects,
  parseStudioProjectJsonFile,
  putStudioAutosave,
  putStudioProjectRecord,
  pushStudioRecentProject,
  setActiveStudioProjectRef,
  stringifyStudioProjectPayloadWithMeta,
  STUDIO_PROJECT_JSON_VERSION,
  type StudioProjectFilePayload,
  type StudioRecentProjectRef,
} from '@/services/studioProjectPersistence';
import { useStudioStore } from '@/store/useStudioStore';
import { toPersistableNodesAndEdges } from '@/utils/studioNodePersistence';

const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
const AUTOSAVE_DEBOUNCE_MS = 1200;
const MAX_RECENT_PROJECTS = 10;
const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'studio-project';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function payloadHasCanvasContent(
  payload: Pick<StudioProjectFilePayload, 'nodes' | 'edges'> | null | undefined,
): boolean {
  return Boolean(payload && (payload.nodes.length > 0 || payload.edges.length > 0));
}

function sourceLabel(source: StudioRecentProjectRef['source']): string {
  if (source === 'file') return '文件导入';
  if (source === 'autosave') return '自动存档';
  return '工作区';
}

export function StudioProjectMenu() {
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const persistenceReadyRef = useRef(false);

  const hydrateProject = useStudioStore((state) => state.hydrateProject);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const createNewProject = useStudioStore((state) => state.createNewProject);
  const setCurrentProjectMeta = useStudioStore((state) => state.setCurrentProjectMeta);
  const currentProjectId = useStudioStore((state) => state.currentProjectId);
  const currentProjectName = useStudioStore((state) => state.currentProjectName);
  const nodes = useStudioStore((state) => state.nodes);
  const edges = useStudioStore((state) => state.edges);
  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  const [recentProjects, setRecentProjects] = useState<StudioRecentProjectRef[]>([]);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const cloudEnabled = isSaasAuthEnabled();

  const refreshProjectData = useCallback(async () => {
    try {
      const [recents, summaries] = await Promise.all([
        listStudioRecentProjects(),
        listStudioProjectSummaries(),
      ]);
      const merged = new Map<string, StudioRecentProjectRef>();
      for (const item of recents) {
        merged.set(item.projectId, item);
      }
      for (const item of summaries) {
        if (merged.has(item.projectId)) continue;
        merged.set(item.projectId, {
          projectId: item.projectId,
          projectName: item.projectName,
          openedAt: item.updatedAt,
          source: 'workspace',
        });
      }
      setRecentProjects(
        Array.from(merged.values())
          .sort((a, b) => b.openedAt - a.openedAt)
          .slice(0, MAX_RECENT_PROJECTS),
      );
      if (cloudEnabled) {
        try {
          setCloudProjects(await listCloudProjects());
        } catch (error) {
          console.warn('Cloud project list failed', error);
        }
      } else {
        setCloudProjects([]);
      }
    } catch (error) {
      console.warn(error);
    }
  }, [cloudEnabled]);

  const rememberRecent = useCallback(
    async (projectId: string, projectName: string, source: StudioRecentProjectRef['source']) => {
      await pushStudioRecentProject({ projectId, projectName, source });
      await refreshProjectData();
    },
    [refreshProjectData],
  );

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

  const closeMenus = useCallback(() => {
    setMenuOpen(false);
    setRecentOpen(false);
  }, []);

  const saveProjectToFile = useCallback(() => {
    const {
      nodes: liveNodes,
      edges: liveEdges,
      currentProjectId: projectId,
      currentProjectName: projectName,
    } = useStudioStore.getState();
    const body = stringifyStudioProjectPayloadWithMeta(liveNodes, liveEdges, {
      projectId: projectId ?? undefined,
      projectName,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([body], { type: 'application/json;charset=utf-8' });
    saveAs(blob, `${sanitizeFileName(projectName)}-${stamp}.json`);
    pushMessage({
      role: 'broadcast',
      text: `已导出工程文件，包含 ${liveNodes.length} 个节点和 ${liveEdges.length} 条连线。`,
    });
    closeMenus();
  }, [closeMenus, pushMessage]);

  const openProjectRecord = useCallback(
    async (projectId: string) => {
      const record = await getStudioProjectRecord(projectId);
      if (!record) {
        pushMessage({ role: 'system', text: '打开失败：找不到该工程记录。' });
        await refreshProjectData();
        return;
      }
      const current = useStudioStore.getState();
      if (current.nodes.length > 0) {
        const ok = window.confirm(`打开工程“${record.projectName}”将替换当前画布，是否继续？`);
        if (!ok) return;
      }
      hydrateProject(record.nodes, record.edges, {
        projectId: record.projectId,
        projectName: record.projectName,
        broadcastText: `已打开工程“${record.projectName}”。`,
      });
      await setActiveStudioProjectRef({
        projectId: record.projectId,
        projectName: record.projectName,
      });
      await rememberRecent(record.projectId, record.projectName, 'workspace');
      closeMenus();
    },
    [closeMenus, hydrateProject, pushMessage, refreshProjectData, rememberRecent],
  );

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const payload = parseStudioProjectJsonFile(text);
        if (!payload) {
          pushMessage({ role: 'system', text: '打开工程失败：文件格式无效或已损坏。' });
          return;
        }

        const nextProjectId = payload.projectId ?? createStudioProjectId();
        const nextProjectName = payload.projectName ?? file.name.replace(/\.json$/i, '');
        hydrateProject(payload.nodes, payload.edges, {
          projectId: nextProjectId,
          projectName: nextProjectName,
          broadcastText: `已导入工程文件，包含 ${payload.nodes.length} 个节点和 ${payload.edges.length} 条连线。`,
        });
        await putStudioProjectRecord(nextProjectId, nextProjectName, payload.nodes, payload.edges);
        await setActiveStudioProjectRef({
          projectId: nextProjectId,
          projectName: nextProjectName,
        });
        await rememberRecent(nextProjectId, nextProjectName, 'file');
        closeMenus();
      };
      reader.onerror = () => {
        pushMessage({ role: 'system', text: '打开工程失败：无法读取所选文件。' });
      };
      reader.readAsText(file, 'UTF-8');
    },
    [closeMenus, hydrateProject, pushMessage, rememberRecent],
  );

  const openFilePicker = useCallback(() => {
    const current = useStudioStore.getState();
    if (current.nodes.length > 0) {
      const ok = window.confirm('当前画布已有内容。导入工程文件将替换当前内容，是否继续？');
      if (!ok) return;
    }
    fileRef.current?.click();
  }, []);

  const saveProjectToWorkspace = useCallback(async () => {
    const {
      nodes: liveNodes,
      edges: liveEdges,
      currentProjectId: projectIdInState,
      currentProjectName: projectNameInState,
    } = useStudioStore.getState();
    const suggestedName = projectNameInState || '未命名项目';
    const projectName = window.prompt('工程名称', suggestedName)?.trim();
    if (!projectName) return;

    const projectId = projectIdInState ?? createStudioProjectId();
    setCurrentProjectMeta(projectId, projectName);
    await putStudioProjectRecord(projectId, projectName, liveNodes, liveEdges);
    await setActiveStudioProjectRef({ projectId, projectName });
    await rememberRecent(projectId, projectName, 'workspace');
    pushMessage({
      role: 'broadcast',
      text: `已将工程“${projectName}”保存到工作区。`,
    });
    closeMenus();
  }, [closeMenus, pushMessage, rememberRecent, setCurrentProjectMeta]);

  const saveProjectToCloud = useCallback(async () => {
    if (!cloudEnabled) return;

    const {
      nodes: liveNodes,
      edges: liveEdges,
      currentProjectId: projectIdInState,
      currentProjectName: projectNameInState,
    } = useStudioStore.getState();
    const suggestedName = projectNameInState || '未命名工程';
    const projectName = window.prompt('云端工程名称', suggestedName)?.trim();
    if (!projectName) return;

    setCloudBusy(true);
    try {
      const record = await saveCloudProject({
        projectId: projectIdInState && UUID_LIKE_RE.test(projectIdInState) ? projectIdInState : null,
        projectName,
        nodes: liveNodes,
        edges: liveEdges,
      });
      setCurrentProjectMeta(record.id, record.name);
      await putStudioProjectRecord(record.id, record.name, liveNodes, liveEdges);
      await setActiveStudioProjectRef({ projectId: record.id, projectName: record.name });
      await rememberRecent(record.id, record.name, 'workspace');
      await refreshProjectData();
      pushMessage({
        role: 'broadcast',
        text: `已保存到云端工程「${record.name}」。`,
      });
      closeMenus();
    } catch (error) {
      pushMessage({
        role: 'system',
        text: `云端保存失败：${error instanceof Error ? error.message : '未知错误'}`,
      });
    } finally {
      setCloudBusy(false);
    }
  }, [
    closeMenus,
    cloudEnabled,
    pushMessage,
    refreshProjectData,
    rememberRecent,
    setCurrentProjectMeta,
  ]);

  const openCloudProjectRecord = useCallback(
    async (projectId: string) => {
      if (!cloudEnabled) return;

      setCloudBusy(true);
      try {
        const record = await getCloudProject(projectId);
        if (!record) {
          pushMessage({ role: 'system', text: '打开云端工程失败：找不到该工程。' });
          await refreshProjectData();
          return;
        }

        const current = useStudioStore.getState();
        if (current.nodes.length > 0) {
          const ok = window.confirm(`打开云端工程「${record.name}」将替换当前画布，是否继续？`);
          if (!ok) return;
        }

        hydrateProject(record.snapshot.nodes, record.snapshot.edges, {
          projectId: record.id,
          projectName: record.name,
          broadcastText: `已打开云端工程「${record.name}」。`,
        });
        await putStudioProjectRecord(record.id, record.name, record.snapshot.nodes, record.snapshot.edges);
        await setActiveStudioProjectRef({ projectId: record.id, projectName: record.name });
        await rememberRecent(record.id, record.name, 'workspace');
        await refreshProjectData();
        closeMenus();
      } catch (error) {
        pushMessage({
          role: 'system',
          text: `打开云端工程失败：${error instanceof Error ? error.message : '未知错误'}`,
        });
      } finally {
        setCloudBusy(false);
      }
    },
    [closeMenus, cloudEnabled, hydrateProject, pushMessage, refreshProjectData, rememberRecent],
  );

  const createProject = useCallback(async () => {
    const current = useStudioStore.getState();
    if (current.nodes.length > 0) {
      const ok = window.confirm('新建工程会清空当前画布，是否继续？');
      if (!ok) return;
    }

    const projectName = window.prompt('新项目名称', currentProjectName || '未命名项目')?.trim();
    if (projectName == null) return;

    const projectId = createNewProject(projectName);
    const { currentProjectName: nextProjectName } = useStudioStore.getState();
    await putStudioProjectRecord(projectId, nextProjectName, [], []);
    await setActiveStudioProjectRef({
      projectId,
      projectName: nextProjectName,
    });
    await rememberRecent(projectId, nextProjectName, 'workspace');
    await refreshProjectData();
    closeMenus();
  }, [closeMenus, createNewProject, currentProjectName, refreshProjectData, rememberRecent]);

  const currentSummaryText = useMemo(
    () => `${nodeCount} 个节点 · ${edgeCount} 条连线`,
    [edgeCount, nodeCount],
  );

  useEffect(() => {
    void refreshProjectData();
  }, [refreshProjectData]);

  useEffect(() => {
    if (!menuOpen) return;
    void refreshProjectData();
  }, [menuOpen, refreshProjectData]);

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

        let restorePayload: StudioProjectFilePayload | null = null;
        let restoreSource: StudioRecentProjectRef['source'] = 'autosave';

        if (activeRecord && payloadHasCanvasContent(activeRecord)) {
          restorePayload = activeRecord;
          restoreSource = 'workspace';
        }

        if (
          autosave &&
          payloadHasCanvasContent(autosave) &&
          activeRecord?.projectId &&
          autosave.projectId === activeRecord.projectId &&
          autosave.savedAt >= activeRecord.updatedAt
        ) {
          restorePayload = autosave;
          restoreSource = 'autosave';
        } else if (!restorePayload && autosave && payloadHasCanvasContent(autosave)) {
          restorePayload = autosave;
          restoreSource = 'autosave';
        }

        if (!restorePayload || cancelled) return;

        const restoredProjectName =
          restorePayload.projectName ??
          activeRef?.projectName ??
          useStudioStore.getState().currentProjectName;
        const restoreBroadcastText =
          restoreSource === 'autosave'
            ? `已恢复上次自动存档「${restoredProjectName}」。`
            : `已恢复上次工程「${restoredProjectName}」。`;

        hydrateProject(restorePayload.nodes, restorePayload.edges, {
          projectId: restorePayload.projectId ?? null,
          projectName: restoredProjectName,
          broadcastText: restoreBroadcastText,
        });

        if (restorePayload.projectId) {
          await setActiveStudioProjectRef({
            projectId: restorePayload.projectId,
            projectName: restoredProjectName,
          });
          await rememberRecent(
            restorePayload.projectId,
            restoredProjectName,
            restoreSource === 'workspace' ? 'workspace' : 'autosave',
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

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        closeMenus();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [closeMenus, menuOpen]);

  return (
    <Panel
      position="top-left"
      className={`studio-project-panel${menuOpen ? ' studio-project-panel--menu-open' : ''}`}
    >
      <div ref={menuRef} className="studio-project-hub nodrag nopan">
        <div className="studio-project-hub__rail">
          <button
            type="button"
            className="studio-project-hub__menu-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((prev) => !prev);
              setRecentOpen(false);
            }}
          >
            文件
          </button>
          <div className="studio-project-hub__current">
            <strong className="studio-project-hub__name">{currentProjectName}</strong>
            <span className="studio-project-hub__meta">{currentSummaryText}</span>
          </div>
          <button
            type="button"
            className="studio-project-hub__quick"
            onClick={() => void saveProjectToWorkspace()}
          >
            保存
          </button>
        </div>

        {menuOpen ? (
          <div className="studio-project-menu" role="menu" aria-label="文件菜单">
            <button type="button" className="studio-project-menu__item" onClick={() => void createProject()}>
              <span>新建工程</span>
            </button>
            <button type="button" className="studio-project-menu__item" onClick={openFilePicker}>
              <span>打开工程文件</span>
            </button>
            <button type="button" className="studio-project-menu__item" onClick={saveProjectToFile}>
              <span>导出工程文件</span>
            </button>
            <button
              type="button"
              className="studio-project-menu__item"
              onClick={() => void saveProjectToWorkspace()}
            >
              <span>保存到工作区</span>
            </button>
            {cloudEnabled ? (
              <div className="studio-project-menu__cloud" role="group" aria-label="云端工程">
                <button
                  type="button"
                  className="studio-project-menu__item"
                  disabled={cloudBusy}
                  onClick={() => void saveProjectToCloud()}
                >
                  <span>{cloudBusy ? '云端处理中...' : '保存到云端'}</span>
                </button>
                <div className="studio-project-menu__section-title">云端工程</div>
                {cloudProjects.length > 0 ? (
                  cloudProjects.slice(0, 6).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="studio-project-menu__recent"
                      disabled={cloudBusy}
                      onClick={() => void openCloudProjectRecord(item.id)}
                    >
                      <strong>{item.name}</strong>
                      <span>
                        {item.nodeCount} 节点 / {item.edgeCount} 连线
                      </span>
                      <time>{formatTime(item.updatedAt)}</time>
                    </button>
                  ))
                ) : (
                  <div className="studio-project-menu__empty">暂无云端工程</div>
                )}
              </div>
            ) : null}
            <div
              className={`studio-project-menu__item studio-project-menu__item--submenu ${
                recentOpen ? 'studio-project-menu__item--open' : ''
              }`}
              onMouseEnter={() => setRecentOpen(true)}
              onMouseLeave={() => setRecentOpen(false)}
            >
              <button
                type="button"
                className="studio-project-menu__submenu-trigger"
                onClick={() => setRecentOpen((prev) => !prev)}
              >
                <span>最近工程</span>
                <span className="studio-project-menu__caret">▸</span>
              </button>
              {recentOpen ? (
                <div className="studio-project-menu__submenu" role="menu" aria-label="最近工程">
                  {recentProjects.length > 0 ? (
                    recentProjects.map((item) => (
                      <button
                        key={`${item.projectId}:${item.openedAt}`}
                        type="button"
                        className="studio-project-menu__recent"
                        onClick={() => void openProjectRecord(item.projectId)}
                      >
                        <strong>{item.projectName}</strong>
                        <span>{sourceLabel(item.source)}</span>
                        <time>{formatTime(item.openedAt)}</time>
                      </button>
                    ))
                  ) : (
                    <div className="studio-project-menu__empty">暂无最近工程</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="studio-project-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={onFileChange}
      />
    </Panel>
  );
}
