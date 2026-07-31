import type {
  ActiveStudioProjectRef,
  StudioProjectFilePayload,
  StudioProjectRecord,
  StudioRecentProjectRef,
} from './studioProjectPersistence.ts';

type RestorePayload = StudioProjectFilePayload | StudioProjectRecord;

export type StudioProjectRestoreCandidate = {
  payload: RestorePayload;
  source: StudioRecentProjectRef['source'];
  projectName: string;
  broadcastText: string;
};

export type StudioProjectRestorePolicyInput = {
  activeRef: ActiveStudioProjectRef | null;
  activeRecord: StudioProjectRecord | null;
  autosave: StudioProjectFilePayload | null;
  diskSnapshot?: StudioProjectFilePayload | null;
  recoveryDraft?: StudioProjectFilePayload | null;
  fallbackProjectName: string;
};

function hasCanvasContent(
  payload: Pick<StudioProjectFilePayload, 'nodes' | 'edges'> | null | undefined,
): boolean {
  return Boolean(payload && (payload.nodes.length > 0 || payload.edges.length > 0));
}

export function chooseStudioProjectRestoreCandidate({
  activeRef,
  activeRecord,
  autosave,
  diskSnapshot,
  recoveryDraft,
  fallbackProjectName,
}: StudioProjectRestorePolicyInput): StudioProjectRestoreCandidate | null {
  let restorePayload: RestorePayload | null = null;
  let restoreSource: StudioRecentProjectRef['source'] = 'autosave';

  if (activeRecord && hasCanvasContent(activeRecord)) {
    restorePayload = activeRecord;
    restoreSource = 'workspace';
  }

  if (
    autosave
    && hasCanvasContent(autosave)
    && activeRecord?.projectId
    && autosave.projectId === activeRecord.projectId
    && autosave.savedAt >= activeRecord.updatedAt
  ) {
    restorePayload = autosave;
    restoreSource = 'autosave';
  } else if (!restorePayload && autosave && hasCanvasContent(autosave)) {
    restorePayload = autosave;
    restoreSource = 'autosave';
  }

  const restoreTimestamp =
    restorePayload && 'updatedAt' in restorePayload
      ? restorePayload.updatedAt
      : restorePayload?.savedAt ?? 0;
  if (
    diskSnapshot
    && hasCanvasContent(diskSnapshot)
    && diskSnapshot.savedAt >= restoreTimestamp
  ) {
    restorePayload = diskSnapshot;
    restoreSource = 'disk';
  }

  const currentTimestamp =
    restorePayload && 'updatedAt' in restorePayload
      ? restorePayload.updatedAt
      : restorePayload?.savedAt ?? 0;
  const activeProjectId = activeRecord?.projectId ?? activeRef?.projectId;
  const recoveryMatchesActiveProject =
    !activeProjectId || recoveryDraft?.projectId === activeProjectId;
  if (
    recoveryDraft
    && hasCanvasContent(recoveryDraft)
    && recoveryMatchesActiveProject
    && recoveryDraft.savedAt >= currentTimestamp
  ) {
    restorePayload = recoveryDraft;
    restoreSource = 'recovery';
  }

  if (!restorePayload) return null;

  const projectName = restorePayload.projectName ?? activeRef?.projectName ?? fallbackProjectName;
  const broadcastText =
    restoreSource === 'disk'
      ? `已从磁盘工程库恢复“${projectName}”。`
      : restoreSource === 'recovery'
        ? `已恢复刷新前的临时工作稿“${projectName}”。`
        : restoreSource === 'autosave'
          ? `已恢复上次自动存档“${projectName}”。`
          : `已恢复上次工程“${projectName}”。`;

  return {
    payload: restorePayload,
    source: restoreSource,
    projectName,
    broadcastText,
  };
}
