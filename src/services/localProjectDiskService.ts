import type {
  StudioProjectFilePayload,
  StudioProjectSummary,
} from './studioProjectPersistence';

type LocalProjectListResponse = {
  projects?: Array<StudioProjectSummary & { isAutosave?: boolean }>;
};

type LocalProjectSnapshotResponse = {
  snapshot?: unknown;
};

type LocalProjectSnapshotSaveResponse = {
  result?: {
    projectId?: string;
    savedAt?: number | null;
    stale?: boolean;
    conflict?: boolean;
    expectedSavedAt?: number | null;
  };
  error?: { message?: string };
};

type LocalProjectVersionsResponse = {
  versions?: DiskProjectVersionSummary[];
};

type LocalProjectAssetSaveResponse = {
  result?: {
    assetId?: string;
    bytes?: number;
    mimeType?: string;
  };
};

export const LOCAL_DISK_AUTOSAVE_PROJECT_ID = '_autosave';
const knownDiskHeadSavedAt = new Map<string, number | null>();

export class LocalProjectDiskUnavailableError extends Error {
  constructor(message = '本地磁盘工程接口当前不可用。') {
    super(message);
    this.name = 'LocalProjectDiskUnavailableError';
  }
}

export class LocalProjectDiskConflictError extends Error {
  constructor(
    message: string,
    readonly projectId: string,
    readonly currentSavedAt: number | null,
  ) {
    super(message);
    this.name = 'LocalProjectDiskConflictError';
  }
}

export function isLocalProjectDiskConflictError(
  error: unknown,
): error is LocalProjectDiskConflictError {
  return error instanceof LocalProjectDiskConflictError;
}

export function isLocalProjectDiskUnavailableError(
  error: unknown,
): error is LocalProjectDiskUnavailableError {
  return error instanceof LocalProjectDiskUnavailableError;
}

export type DiskProjectVersionSummary = {
  id: string;
  savedAt: number;
  projectName?: string;
  nodeCount: number;
  edgeCount: number;
};

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

export function isLocalProjectDiskRepositoryAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    && isLoopbackHostname(window.location.hostname)
  );
}

function rememberKnownDiskHead(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
  const value = snapshot as { projectId?: unknown; savedAt?: unknown };
  if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return;
  const projectId =
    typeof value.projectId === 'string' && value.projectId.trim()
      ? value.projectId.trim()
      : LOCAL_DISK_AUTOSAVE_PROJECT_ID;
  knownDiskHeadSavedAt.set(projectId, value.savedAt);
}

async function readResponseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new LocalProjectDiskUnavailableError(
      `本地磁盘工程接口未启动（HTTP ${response.status}）。`,
    );
  }
  const body = await response.json().catch(() => {
    throw new Error('本地磁盘工程接口返回了无效数据。');
  }) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message || `磁盘工程请求失败（HTTP ${response.status}）。`);
  }
  return body;
}

async function requestLocalProjectJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new LocalProjectDiskUnavailableError();
  }
  return readResponseJson<T>(response);
}

export async function saveStudioProjectSnapshotToDisk(
  snapshot: StudioProjectFilePayload,
): Promise<void> {
  if (!isLocalProjectDiskRepositoryAvailable()) return;
  const projectId = snapshot.projectId || LOCAL_DISK_AUTOSAVE_PROJECT_ID;
  const expectedSavedAt = knownDiskHeadSavedAt.has(projectId)
    ? knownDiskHeadSavedAt.get(projectId) ?? null
    : null;
  let response: Response;
  try {
    response = await fetch('/api/local-projects/snapshot', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ snapshot, expectedSavedAt }),
    });
  } catch {
    throw new LocalProjectDiskUnavailableError();
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new LocalProjectDiskUnavailableError(
      `本地磁盘工程接口未启动（HTTP ${response.status}）。`,
    );
  }
  const body = await response.json().catch(() => {
    throw new Error('本地磁盘工程接口返回了无效数据。');
  }) as LocalProjectSnapshotSaveResponse;
  const result = body.result;
  if (response.status === 409 || result?.conflict) {
    throw new LocalProjectDiskConflictError(
      body.error?.message || '工程已被另一个页面更新，请重新载入后再保存。',
      projectId,
      typeof result?.savedAt === 'number' ? result.savedAt : null,
    );
  }
  if (!response.ok) {
    throw new Error(body.error?.message || `磁盘工程请求失败（HTTP ${response.status}）。`);
  }
  if (typeof result?.savedAt === 'number') {
    knownDiskHeadSavedAt.set(projectId, result.savedAt);
  }
}

export async function saveLocalProjectImageAsset(
  assetId: string,
  dataUrl: string,
): Promise<void> {
  if (!isLocalProjectDiskRepositoryAvailable()) return;
  await requestLocalProjectJson<LocalProjectAssetSaveResponse>('/api/local-project-assets', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ assetId, dataUrl }),
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('本地图片资产读取失败。'));
    reader.readAsDataURL(blob);
  });
}

export async function getLocalProjectImageAssetDataUrl(
  assetId: string,
): Promise<string | null> {
  if (!isLocalProjectDiskRepositoryAvailable()) return null;
  let response: Response;
  try {
    response = await fetch(`/api/local-project-assets/${encodeURIComponent(assetId)}`, {
      cache: 'force-cache',
    });
  } catch {
    throw new LocalProjectDiskUnavailableError();
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`本地图片资产读取失败（HTTP ${response.status}）。`);
  }
  return blobToDataUrl(await response.blob());
}

export async function optimizeDiskProjectAssets(
  projectId: string,
): Promise<{
  beforeBytes: number;
  afterBytes: number;
  reclaimedBytes: number;
  optimizedFiles: number;
  assetCount: number;
} | null> {
  if (!isLocalProjectDiskRepositoryAvailable()) return null;
  const body = await requestLocalProjectJson<{
    result?: {
      beforeBytes?: number;
      afterBytes?: number;
      reclaimedBytes?: number;
      optimizedFiles?: number;
      assetCount?: number;
    };
  }>(`/api/local-projects/${encodeURIComponent(projectId)}/optimize`, {
    method: 'POST',
    cache: 'no-store',
  });
  if (!body.result) return null;
  return {
    beforeBytes: Number(body.result.beforeBytes || 0),
    afterBytes: Number(body.result.afterBytes || 0),
    reclaimedBytes: Number(body.result.reclaimedBytes || 0),
    optimizedFiles: Number(body.result.optimizedFiles || 0),
    assetCount: Number(body.result.assetCount || 0),
  };
}

export async function getActiveDiskProjectSnapshot(): Promise<unknown | null> {
  if (!isLocalProjectDiskRepositoryAvailable()) return null;
  try {
    const body = await requestLocalProjectJson<LocalProjectSnapshotResponse>(
      '/api/local-projects/active',
      { cache: 'no-store' },
    );
    const snapshot = body.snapshot ?? null;
    rememberKnownDiskHead(snapshot);
    return snapshot;
  } catch (error) {
    if (isLocalProjectDiskUnavailableError(error)) return null;
    throw error;
  }
}

export async function getDiskProjectSnapshot(projectId: string): Promise<unknown | null> {
  if (!isLocalProjectDiskRepositoryAvailable()) return null;
  try {
    const body = await requestLocalProjectJson<LocalProjectSnapshotResponse>(
      `/api/local-projects/${encodeURIComponent(projectId)}`,
      { cache: 'no-store' },
    );
    const snapshot = body.snapshot ?? null;
    rememberKnownDiskHead(snapshot);
    return snapshot;
  } catch (error) {
    if (isLocalProjectDiskUnavailableError(error)) return null;
    throw error;
  }
}

export async function getDiskProjectVersionSnapshot(
  projectId: string,
  versionId: string,
): Promise<unknown | null> {
  if (!isLocalProjectDiskRepositoryAvailable()) return null;
  try {
    const body = await requestLocalProjectJson<LocalProjectSnapshotResponse>(
      `/api/local-projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
      { cache: 'no-store' },
    );
    return body.snapshot ?? null;
  } catch (error) {
    if (isLocalProjectDiskUnavailableError(error)) return null;
    throw error;
  }
}

export async function listDiskProjectVersions(
  projectId: string,
): Promise<DiskProjectVersionSummary[]> {
  if (!isLocalProjectDiskRepositoryAvailable()) return [];
  try {
    const body = await requestLocalProjectJson<LocalProjectVersionsResponse>(
      `/api/local-projects/${encodeURIComponent(projectId)}/versions`,
      { cache: 'no-store' },
    );
    return Array.isArray(body.versions) ? body.versions : [];
  } catch (error) {
    if (isLocalProjectDiskUnavailableError(error)) return [];
    throw error;
  }
}

export async function listDiskProjectSummaries(): Promise<
  Array<StudioProjectSummary & { isAutosave?: boolean }>
> {
  if (!isLocalProjectDiskRepositoryAvailable()) return [];
  try {
    const body = await requestLocalProjectJson<LocalProjectListResponse>(
      '/api/local-projects',
      { cache: 'no-store' },
    );
    return Array.isArray(body.projects) ? body.projects : [];
  } catch (error) {
    if (isLocalProjectDiskUnavailableError(error)) return [];
    throw error;
  }
}
