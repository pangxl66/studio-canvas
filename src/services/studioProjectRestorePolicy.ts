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
  fallbackProjectName: string;
};

function hasCanvasContent(payload: Pick<StudioProjectFilePayload, 'nodes' | 'edges'> | null | undefined): boolean {
  return Boolean(payload && (payload.nodes.length > 0 || payload.edges.length > 0));
}

export function chooseStudioProjectRestoreCandidate({
  activeRef,
  activeRecord,
  autosave,
  fallbackProjectName,
}: StudioProjectRestorePolicyInput): StudioProjectRestoreCandidate | null {
  let restorePayload: RestorePayload | null = null;
  let restoreSource: StudioRecentProjectRef['source'] = 'autosave';

  if (activeRecord && hasCanvasContent(activeRecord)) {
    restorePayload = activeRecord;
    restoreSource = 'workspace';
  }

  if (
    autosave &&
    hasCanvasContent(autosave) &&
    activeRecord?.projectId &&
    autosave.projectId === activeRecord.projectId &&
    autosave.savedAt >= activeRecord.updatedAt
  ) {
    restorePayload = autosave;
    restoreSource = 'autosave';
  } else if (!restorePayload && autosave && hasCanvasContent(autosave)) {
    restorePayload = autosave;
    restoreSource = 'autosave';
  }

  if (!restorePayload) return null;

  const projectName = restorePayload.projectName ?? activeRef?.projectName ?? fallbackProjectName;
  const broadcastText =
    restoreSource === 'autosave'
      ? `已恢复上次自动存档「${projectName}」。`
      : `已恢复上次工程「${projectName}」。`;

  return {
    payload: restorePayload,
    source: restoreSource,
    projectName,
    broadcastText,
  };
}
