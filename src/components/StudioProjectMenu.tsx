import { Panel } from '@xyflow/react';
import { saveAs } from 'file-saver';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useStudioProjectPersistence } from '@/hooks/useStudioProjectPersistence';
import { isSaasAuthEnabled } from '@/services/authClient';
import {
  getCloudProject,
  listCloudProjects,
  saveCloudProject,
  type CloudProjectSummary,
} from '@/services/cloudProjectService';
import {
  createStudioProjectId,
  getStudioAutosave,
  getStudioProjectRecord,
  listStudioProjectSummaries,
  listStudioRecentProjects,
  parseStudioProjectJsonFile,
  putStudioProjectRecord,
  pushStudioRecentProject,
  setActiveStudioProjectRef,
  stringifyStudioProjectPayloadWithMeta,
  studioProjectPayloadHasCanvasContent,
  STUDIO_IDB_AUTOSAVE_KEY,
  type StudioRecentProjectRef,
} from '@/services/studioProjectPersistence';
import { useStudioStore } from '@/store/useStudioStore';

const MAX_RECENT_PROJECTS = 10;
const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'studio-project';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function sourceLabel(source: StudioRecentProjectRef['source']): string {
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
      const [recents, summaries, autosave] = await Promise.all([
        listStudioRecentProjects(),
        listStudioProjectSummaries(),
        getStudioAutosave(),
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

  useStudioProjectPersistence({ rememberRecent });

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
      const autosaveRecord = projectId === STUDIO_IDB_AUTOSAVE_KEY ? await getStudioAutosave() : null;
      const record = autosaveRecord
        ? {
            ...autosaveRecord,
            projectId: autosaveRecord.projectId ?? null,
            projectName: autosaveRecord.projectName?.trim() || '未命名自动存档',
          }
        : await getStudioProjectRecord(projectId);
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
      if (record.projectId) {
        await setActiveStudioProjectRef({
          projectId: record.projectId,
          projectName: record.projectName,
        });
        await rememberRecent(record.projectId, record.projectName, autosaveRecord ? 'autosave' : 'workspace');
      } else {
        await rememberRecent(STUDIO_IDB_AUTOSAVE_KEY, record.projectName, 'autosave');
      }
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
