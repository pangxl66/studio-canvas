import { Panel } from '@xyflow/react';
import { saveAs } from 'file-saver';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useStudioProjectPersistence } from '@/hooks/useStudioProjectPersistence';
import { isSaasAuthEnabled, isSaasMockEnabled } from '@/services/authClient';
import {
  getCloudProject,
  listCloudProjects,
  saveCloudProject,
  type CloudProjectSummary,
} from '@/services/cloudProjectService';
import {
  getDiskProjectVersionSnapshot,
  getDiskProjectSnapshot,
  listDiskProjectVersions,
  listDiskProjectSummaries,
  LOCAL_DISK_AUTOSAVE_PROJECT_ID,
  type DiskProjectVersionSummary,
} from '@/services/localProjectDiskService';
import {
  createStudioProjectPayload,
  createStudioProjectRecoveryBundle,
  createStudioProjectId,
  getStudioAutosave,
  getStudioProjectRecord,
  hydrateStudioProjectPayloadImages,
  importStudioProjectRecoveryBundle,
  listStudioProjectSummaries,
  listStudioRecentProjects,
  parseStudioProjectPayload,
  parseStudioProjectRecoveryBundleJson,
  parseStudioProjectJsonFile,
  putStudioProjectRecord,
  pushStudioRecentProject,
  queueStudioProjectSnapshot,
  setActiveStudioProjectRef,
  stringifyStudioProjectPayloadWithMeta,
  studioProjectPayloadHasCanvasContent,
  STUDIO_IDB_AUTOSAVE_KEY,
  type StudioRecentProjectRef,
} from '@/services/studioProjectPersistence';
import { useStudioStore } from '@/store/useStudioStore';

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'studio-project';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function sourceLabel(source: StudioRecentProjectRef['source']): string {
  if (source === 'disk') return '磁盘工程';
  if (source === 'file') return '文件导入';
  if (source === 'autosave') return '自动存档';
  return '工作区';
}

export function StudioProjectMenu() {
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hydrateProject = useStudioStore((state) => state.hydrateProject);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const createNewProject = useStudioStore((state) => state.createNewProject);
  const setCurrentProjectMeta = useStudioStore((state) => state.setCurrentProjectMeta);
  const currentProjectName = useStudioStore((state) => state.currentProjectName);
  const currentProjectId = useStudioStore((state) => state.currentProjectId);
  const nodeCount = useStudioStore((state) => state.nodes.length);
  const edgeCount = useStudioStore((state) => state.edges.length);

  const [recentProjects, setRecentProjects] = useState<StudioRecentProjectRef[]>([]);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [projectActionBusy, setProjectActionBusy] = useState(false);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyVersions, setHistoryVersions] = useState<DiskProjectVersionSummary[]>([]);
  const cloudEnabled = isSaasAuthEnabled();
  const cloudIsLocalMock = isSaasMockEnabled();
  const historyProjectId = currentProjectId ?? LOCAL_DISK_AUTOSAVE_PROJECT_ID;

  const refreshProjectData = useCallback(async () => {
    try {
      const [recents, summaries, autosave, diskSummaries] = await Promise.all([
        listStudioRecentProjects(),
        listStudioProjectSummaries(),
        getStudioAutosave(),
        listDiskProjectSummaries(),
      ]);
      const merged = new Map<string, StudioRecentProjectRef>();
      for (const item of recents) {
        merged.set(item.projectId, item);
      }
      if (autosave && studioProjectPayloadHasCanvasContent(autosave)) {
        const autosaveProjectId = autosave.projectId ?? STUDIO_IDB_AUTOSAVE_KEY;
        const autosaveName = autosave.projectName?.trim() || '未命名自动存档';
        const current = merged.get(autosaveProjectId);
        const nextItem: StudioRecentProjectRef = {
          projectId: autosaveProjectId,
          projectName: autosaveName,
          openedAt: autosave.savedAt,
          source: 'autosave',
        };
        if (!current || nextItem.openedAt > current.openedAt) {
          merged.set(autosaveProjectId, nextItem);
        }
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
      for (const item of diskSummaries) {
        if (item.isAutosave) continue;
        const current = merged.get(item.projectId);
        if (current && current.openedAt >= item.updatedAt) continue;
        merged.set(item.projectId, {
          projectId: item.projectId,
          projectName: item.projectName,
          openedAt: item.updatedAt,
          source: 'disk',
        });
      }
      setRecentProjects(
        Array.from(merged.values())
          .sort((a, b) => b.openedAt - a.openedAt),
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

  const persistence = useStudioProjectPersistence({ rememberRecent });

  const refreshVersionHistory = useCallback(async () => {
    setHistoryBusy(true);
    try {
      setHistoryVersions(await listDiskProjectVersions(historyProjectId));
    } catch (error) {
      console.warn('Disk project version list failed', error);
      setHistoryVersions([]);
    } finally {
      setHistoryBusy(false);
    }
  }, [historyProjectId]);

  const closeMenus = useCallback(() => {
    setMenuOpen(false);
    setRecentOpen(false);
    setHistoryOpen(false);
  }, []);

  const reportProjectActionError = useCallback(
    (prefix: string, error: unknown) => {
      const message = error instanceof Error ? error.message : '未知错误';
      setProjectActionError(`${prefix}：${message}`);
      pushMessage({
        role: 'system',
        text: `${prefix}：${message}`,
      });
    },
    [pushMessage],
  );

  const restoreProjectVersion = useCallback(
    async (version: DiskProjectVersionSummary) => {
      setProjectActionBusy(true);
      setProjectActionError(null);
      try {
        const rawSnapshot = await getDiskProjectVersionSnapshot(historyProjectId, version.id);
        const snapshot = await hydrateStudioProjectPayloadImages(
          parseStudioProjectPayload(rawSnapshot),
        );
        if (!snapshot) {
          throw new Error('该历史版本已经损坏或不存在。');
        }
        const confirmed = window.confirm(
          `恢复 ${formatTime(version.savedAt)} 的版本将替换当前画布。当前状态会先保存为新版本，是否继续？`,
        );
        if (!confirmed) return;

        await persistence.flushCurrentProjectSnapshot();
        const projectId = currentProjectId ?? snapshot.projectId;
        const projectName = snapshot.projectName?.trim() || currentProjectName || '未命名项目';
        const restoredSnapshot = createStudioProjectPayload(snapshot.nodes, snapshot.edges, {
          projectId,
          projectName,
        });
        await queueStudioProjectSnapshot(restoredSnapshot);
        hydrateProject(restoredSnapshot.nodes, restoredSnapshot.edges, {
          projectId: projectId ?? null,
          projectName,
          broadcastText: `已恢复 ${formatTime(version.savedAt)} 的历史版本。`,
        });
        if (projectId) {
          await setActiveStudioProjectRef({ projectId, projectName });
          await rememberRecent(projectId, projectName, 'disk');
        } else {
          await rememberRecent(STUDIO_IDB_AUTOSAVE_KEY, projectName, 'autosave');
        }
        pushMessage({
          role: 'broadcast',
          text: '历史版本恢复成功；恢复前的当前画布已保留在版本历史中。',
        });
        closeMenus();
      } catch (error) {
        reportProjectActionError('恢复历史版本失败，当前画布未被替换', error);
      } finally {
        setProjectActionBusy(false);
      }
    },
    [
      closeMenus,
      currentProjectId,
      currentProjectName,
      historyProjectId,
      hydrateProject,
      persistence,
      pushMessage,
      rememberRecent,
      reportProjectActionError,
    ],
  );

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

  const exportRecoveryBundle = useCallback(async () => {
    setProjectActionBusy(true);
    setProjectActionError(null);
    try {
      await persistence.flushCurrentProjectSnapshot();
      const bundle = await createStudioProjectRecoveryBundle();
      const stamp = new Date(bundle.exportedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      saveAs(blob, `studio-canvas-recovery-${stamp}.json`);
      pushMessage({
        role: 'broadcast',
        text: `已导出本地工程恢复包，共 ${bundle.entries.length} 条存储记录。`,
      });
      closeMenus();
    } catch (error) {
      reportProjectActionError('导出恢复包失败', error);
    } finally {
      setProjectActionBusy(false);
    }
  }, [closeMenus, persistence, pushMessage, reportProjectActionError]);

  const openProjectRecord = useCallback(
    async (projectId: string) => {
      setProjectActionBusy(true);
      setProjectActionError(null);
      try {
        const autosaveRecord = projectId === STUDIO_IDB_AUTOSAVE_KEY ? await getStudioAutosave() : null;
        const idbRecord = autosaveRecord ? null : await getStudioProjectRecord(projectId);
        const rawDiskRecord = await getDiskProjectSnapshot(projectId);
        const diskRecord = await hydrateStudioProjectPayloadImages(
          parseStudioProjectPayload(rawDiskRecord),
        );
        const storedRecord = autosaveRecord
          ? {
              ...autosaveRecord,
              projectId: autosaveRecord.projectId ?? null,
              projectName: autosaveRecord.projectName?.trim() || '未命名自动存档',
            }
          : idbRecord;
        const openedFromDisk = Boolean(
          diskRecord && (!storedRecord || diskRecord.savedAt > storedRecord.savedAt),
        );
        const record = openedFromDisk && diskRecord
          ? {
              ...diskRecord,
              projectId: diskRecord.projectId ?? null,
              projectName: diskRecord.projectName?.trim() || '未命名磁盘工程',
            }
          : storedRecord;
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
        await persistence.flushCurrentProjectSnapshot();
        hydrateProject(record.nodes, record.edges, {
          projectId: record.projectId,
          projectName: record.projectName,
          broadcastText: `已打开工程“${record.projectName}”。`,
        });
        if (record.projectId) {
          await setActiveStudioProjectRef({
            projectId: record.projectId,
            projectName: record.projectName,
          });
          await rememberRecent(
            record.projectId,
            record.projectName,
            openedFromDisk ? 'disk' : autosaveRecord ? 'autosave' : 'workspace',
          );
        } else {
          await rememberRecent(STUDIO_IDB_AUTOSAVE_KEY, record.projectName, 'autosave');
        }
        closeMenus();
      } catch (error) {
        reportProjectActionError('打开工程失败，当前画布未被替换', error);
      } finally {
        setProjectActionBusy(false);
      }
    },
    [
      closeMenus,
      hydrateProject,
      persistence,
      pushMessage,
      refreshProjectData,
      rememberRecent,
      reportProjectActionError,
    ],
  );

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        setProjectActionBusy(true);
        setProjectActionError(null);
        try {
          const text = typeof reader.result === 'string' ? reader.result : '';
          const recoveryBundle = parseStudioProjectRecoveryBundleJson(text);
          if (recoveryBundle) {
            const result = await importStudioProjectRecoveryBundle(recoveryBundle);
            await refreshProjectData();
            pushMessage({
              role: 'broadcast',
              text:
                `已导入工程恢复包：恢复 ${result.importedCount} 条记录`
                + (result.skippedCount > 0 ? `，保留 ${result.skippedCount} 条较新的本机记录。` : '。'),
            });
            closeMenus();
            return;
          }
          const payload = parseStudioProjectJsonFile(text);
          if (!payload) {
            pushMessage({ role: 'system', text: '打开工程失败：文件格式无效或已损坏。' });
            return;
          }

          const nextProjectId = payload.projectId ?? createStudioProjectId();
          const nextProjectName = payload.projectName ?? file.name.replace(/\.json$/i, '');
          await persistence.flushCurrentProjectSnapshot();
          await queueStudioProjectSnapshot(
            createStudioProjectPayload(payload.nodes, payload.edges, {
              projectId: nextProjectId,
              projectName: nextProjectName,
            }),
          );
          hydrateProject(payload.nodes, payload.edges, {
            projectId: nextProjectId,
            projectName: nextProjectName,
            broadcastText: `已导入工程文件，包含 ${payload.nodes.length} 个节点和 ${payload.edges.length} 条连线。`,
          });
          await rememberRecent(nextProjectId, nextProjectName, 'file');
          closeMenus();
        } catch (error) {
          reportProjectActionError('导入工程失败，当前画布未被替换', error);
        } finally {
          setProjectActionBusy(false);
        }
      };
      reader.onerror = () => {
        pushMessage({ role: 'system', text: '打开工程失败：无法读取所选文件。' });
      };
      reader.readAsText(file, 'UTF-8');
    },
    [
      closeMenus,
      hydrateProject,
      persistence,
      pushMessage,
      rememberRecent,
      reportProjectActionError,
      refreshProjectData,
    ],
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
    const projectName = projectIdInState
      ? suggestedName.trim()
      : window.prompt('工程名称', suggestedName)?.trim();
    if (!projectName) return;

    const projectId = projectIdInState ?? createStudioProjectId();
    setProjectActionBusy(true);
    setProjectActionError(null);
    try {
      if (projectIdInState) {
        await persistence.flushCurrentProjectSnapshot();
      } else {
        await queueStudioProjectSnapshot(
          createStudioProjectPayload(liveNodes, liveEdges, {
            projectId,
            projectName,
          }),
        );
      }
      setCurrentProjectMeta(projectId, projectName);
      await rememberRecent(projectId, projectName, 'workspace');
      pushMessage({
        role: 'broadcast',
        text: `已将工程“${projectName}”保存到工作区。`,
      });
      closeMenus();
    } catch (error) {
      reportProjectActionError('保存工程失败', error);
    } finally {
      setProjectActionBusy(false);
    }
  }, [
    closeMenus,
    persistence,
    pushMessage,
    rememberRecent,
    reportProjectActionError,
    setCurrentProjectMeta,
  ]);

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

        await persistence.flushCurrentProjectSnapshot();
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
    [
      closeMenus,
      cloudEnabled,
      hydrateProject,
      persistence,
      pushMessage,
      refreshProjectData,
      rememberRecent,
    ],
  );

  const createProject = useCallback(async () => {
    const current = useStudioStore.getState();
    if (current.nodes.length > 0) {
      const ok = window.confirm('新建工程会清空当前画布，是否继续？');
      if (!ok) return;
    }

    const projectName = window.prompt('新项目名称', currentProjectName || '未命名项目')?.trim();
    if (projectName == null) return;

    setProjectActionBusy(true);
    setProjectActionError(null);
    try {
      await persistence.flushCurrentProjectSnapshot();
      const projectId = createNewProject(projectName);
      const { currentProjectName: nextProjectName } = useStudioStore.getState();
      await queueStudioProjectSnapshot(
        createStudioProjectPayload([], [], {
          projectId,
          projectName: nextProjectName,
        }),
      );
      await rememberRecent(projectId, nextProjectName, 'workspace');
      await refreshProjectData();
      closeMenus();
    } catch (error) {
      reportProjectActionError('新建工程失败', error);
    } finally {
      setProjectActionBusy(false);
    }
  }, [
    closeMenus,
    createNewProject,
    currentProjectName,
    persistence,
    refreshProjectData,
    rememberRecent,
    reportProjectActionError,
  ]);

  const currentSummaryText = useMemo(
    () => `${nodeCount} 个节点 · ${edgeCount} 条连线`,
    [edgeCount, nodeCount],
  );
  const persistenceStatusText = useMemo(() => {
    if (projectActionBusy || persistence.saveStatus === 'saving') return '保存中…';
    if (projectActionError || persistence.saveStatus === 'error') return '保存失败';
    if (persistence.saveStatus === 'dirty') return '有未保存修改';
    if (persistence.lastSavedAt) {
      return `已保存 ${new Date(persistence.lastSavedAt).toLocaleTimeString()}`;
    }
    return '等待保存';
  }, [
    persistence.lastSavedAt,
    persistence.saveStatus,
    projectActionBusy,
    projectActionError,
  ]);

  useEffect(() => {
    void refreshProjectData();
  }, [refreshProjectData]);

  useEffect(() => {
    setHistoryVersions([]);
    setHistoryOpen(false);
  }, [historyProjectId]);

  useEffect(() => {
    if (!menuOpen) return;
    void refreshProjectData();
  }, [menuOpen, refreshProjectData]);

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
              setHistoryOpen(false);
            }}
          >
            文件
          </button>
          <div className="studio-project-hub__current">
            <strong className="studio-project-hub__name">{currentProjectName}</strong>
            <span className="studio-project-hub__meta">{currentSummaryText}</span>
            <span
              className={`studio-project-hub__save-state${
                projectActionError || persistence.saveStatus === 'error'
                  ? ' studio-project-hub__save-state--error'
                  : persistence.saveStatus === 'dirty'
                    ? ' studio-project-hub__save-state--dirty'
                  : ''
              }`}
              role="status"
            >
              {persistenceStatusText}
            </span>
          </div>
          <button
            type="button"
            className="studio-project-hub__quick"
            disabled={projectActionBusy}
            onClick={() => void saveProjectToWorkspace()}
          >
            {projectActionBusy ? '处理中…' : '保存'}
          </button>
        </div>

        {menuOpen ? (
          <div className="studio-project-menu" role="menu" aria-label="文件菜单">
            <button
              type="button"
              className="studio-project-menu__item"
              disabled={projectActionBusy}
              onClick={() => void createProject()}
            >
              <span>新建工程</span>
            </button>
            <button
              type="button"
              className="studio-project-menu__item"
              disabled={projectActionBusy}
              onClick={openFilePicker}
            >
              <span>打开工程文件 / 恢复包</span>
            </button>
            <button
              type="button"
              className="studio-project-menu__item"
              disabled={projectActionBusy}
              onClick={saveProjectToFile}
            >
              <span>导出工程文件</span>
            </button>
            <button
              type="button"
              className="studio-project-menu__item"
              disabled={projectActionBusy}
              onClick={() => void exportRecoveryBundle()}
            >
              <span>导出全部恢复包</span>
            </button>
            <button
              type="button"
              className="studio-project-menu__item"
              disabled={projectActionBusy}
              onClick={() => void saveProjectToWorkspace()}
            >
              <span>保存到工作区</span>
            </button>
            {projectActionError || persistence.error ? (
              <div className="studio-project-menu__save-error" role="alert">
                {projectActionError || `工程保存失败：${persistence.error}`}
              </div>
            ) : null}
            {cloudEnabled ? (
              <div
                className="studio-project-menu__cloud"
                role="group"
                aria-label={cloudIsLocalMock ? '本机备份' : '云端工程'}
              >
                <button
                  type="button"
                  className="studio-project-menu__item"
                  disabled={cloudBusy}
                  onClick={() => void saveProjectToCloud()}
                >
                  <span>
                    {cloudBusy
                      ? '处理中...'
                      : cloudIsLocalMock
                        ? '保存到本机备份'
                        : '保存到云端'}
                  </span>
                </button>
                <div className="studio-project-menu__section-title">
                  {cloudIsLocalMock ? '本机备份（浏览器）' : '云端工程'}
                </div>
                {cloudProjects.length > 0 ? (
                  cloudProjects.map((item) => (
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
                  <div className="studio-project-menu__empty">
                    {cloudIsLocalMock ? '暂无本机备份' : '暂无云端工程'}
                  </div>
                )}
              </div>
            ) : null}
            <div
              className={`studio-project-menu__item studio-project-menu__item--submenu ${
                historyOpen ? 'studio-project-menu__item--open' : ''
              }`}
              onMouseEnter={() => {
                setHistoryOpen(true);
                setRecentOpen(false);
                void refreshVersionHistory();
              }}
              onMouseLeave={() => setHistoryOpen(false)}
            >
              <button
                type="button"
                className="studio-project-menu__submenu-trigger"
                onClick={() => {
                  const nextOpen = !historyOpen;
                  setHistoryOpen(nextOpen);
                  setRecentOpen(false);
                  if (nextOpen) void refreshVersionHistory();
                }}
              >
                <span>版本历史</span>
                <span className="studio-project-menu__caret">▸</span>
              </button>
              {historyOpen ? (
                <div
                  className="studio-project-menu__submenu studio-project-menu__submenu--history"
                  role="menu"
                  aria-label="版本历史"
                >
                  <div className="studio-project-menu__history-note">
                    自动保留最近 30 个磁盘版本
                  </div>
                  {historyBusy ? (
                    <div className="studio-project-menu__empty">正在读取版本…</div>
                  ) : historyVersions.length > 0 ? (
                    historyVersions.map((version, index) => (
                      <button
                        key={version.id}
                        type="button"
                        className="studio-project-menu__recent"
                        disabled={projectActionBusy}
                        onClick={() => void restoreProjectVersion(version)}
                      >
                        <strong>{index === 0 ? '最新备份' : '历史备份'}</strong>
                        <span>
                          {version.nodeCount} 节点 / {version.edgeCount} 连线
                        </span>
                        <time>{formatTime(version.savedAt)}</time>
                      </button>
                    ))
                  ) : (
                    <div className="studio-project-menu__empty">暂无磁盘历史版本</div>
                  )}
                </div>
              ) : null}
            </div>
            <div
              className={`studio-project-menu__item studio-project-menu__item--submenu ${
                recentOpen ? 'studio-project-menu__item--open' : ''
              }`}
              onMouseEnter={() => {
                setRecentOpen(true);
                setHistoryOpen(false);
              }}
              onMouseLeave={() => setRecentOpen(false)}
            >
              <button
                type="button"
                className="studio-project-menu__submenu-trigger"
                onClick={() => {
                  setRecentOpen((prev) => !prev);
                  setHistoryOpen(false);
                }}
              >
                <span>全部本地工程</span>
                <span className="studio-project-menu__caret">▸</span>
              </button>
              {recentOpen ? (
                <div className="studio-project-menu__submenu" role="menu" aria-label="全部本地工程">
                  {recentProjects.length > 0 ? (
                    recentProjects.map((item) => (
                      <button
                        key={`${item.projectId}:${item.openedAt}`}
                        type="button"
                        className="studio-project-menu__recent"
                        disabled={projectActionBusy}
                        onClick={() => void openProjectRecord(item.projectId)}
                      >
                        <strong>{item.projectName}</strong>
                        <span>{sourceLabel(item.source)}</span>
                        <time>{formatTime(item.openedAt)}</time>
                      </button>
                    ))
                  ) : (
                    <div className="studio-project-menu__empty">暂无本地工程</div>
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
