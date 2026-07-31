import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import {
  normalizeRestoredStudioNode,
  toPersistableNodesAndEdges,
} from '@/utils/studioNodePersistence';
import { removeDeprecatedScriptNodes } from '@/utils/deprecatedScriptNodes';
import {
  getLocalProjectImageAssetDataUrl,
  isLocalProjectDiskConflictError,
  isLocalProjectDiskUnavailableError,
  saveLocalProjectImageAsset,
  saveStudioProjectSnapshotToDisk,
} from './localProjectDiskService';

export const STUDIO_PROJECT_JSON_VERSION = 1;

export const STUDIO_IDB_NAME = 'studio-ai-drama-idb';
export const STUDIO_IDB_STORE = 'project_snapshots';
export const STUDIO_IDB_ASSET_STORE = 'image_assets';
export const STUDIO_IDB_VERSION = 2;
export const STUDIO_IDB_AUTOSAVE_KEY = 'canvas_autosave';
export const STUDIO_IDB_ACTIVE_PROJECT_KEY = 'active_project_ref';
export const STUDIO_IDB_RECENT_PROJECTS_KEY = 'recent_project_refs';
const STUDIO_IDB_PROJECT_PREFIX = 'project::';
const STUDIO_RECOVERY_BUNDLE_FORMAT = 'studio-canvas-recovery';

let studioProjectWriteQueue: Promise<void> = Promise.resolve();

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 与「保存项目」下载文件、IndexedDB 自动存档共用同一结构 */
export type StudioProjectFilePayload = {
  version: number;
  savedAt: number;
  nodes: StudioRFNode[];
  edges: Edge[];
  projectId?: string;
  projectName?: string;
};

export type StudioProjectRecord = StudioProjectFilePayload & {
  projectId: string;
  projectName: string;
  updatedAt: number;
};

export type StudioProjectSummary = {
  projectId: string;
  projectName: string;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
};

export type ActiveStudioProjectRef = {
  projectId: string;
  projectName: string;
};

export type StudioRecentProjectRef = {
  projectId: string;
  projectName: string;
  openedAt: number;
  source: 'workspace' | 'file' | 'autosave' | 'disk' | 'recovery';
};

export type StudioProjectRecoveryBundle = {
  format: typeof STUDIO_RECOVERY_BUNDLE_FORMAT;
  version: 1;
  exportedAt: number;
  sourceOrigin?: string;
  database: {
    name: typeof STUDIO_IDB_NAME;
    store: typeof STUDIO_IDB_STORE;
    version: typeof STUDIO_IDB_VERSION;
  };
  entries: Array<{
    key: string;
    value: unknown;
  }>;
  assets?: StudioImageAssetRecord[];
};

export type StudioProjectRecoveryImportResult = {
  importedCount: number;
  skippedCount: number;
};

export function studioProjectPayloadHasCanvasContent(
  payload: Pick<StudioProjectFilePayload, 'nodes' | 'edges'> | null | undefined,
): boolean {
  return Boolean(payload && (payload.nodes.length > 0 || payload.edges.length > 0));
}

const STUDIO_PROJECT_NODE_TYPES = new Set<StudioRFNode['type']>([
  'department',
  'textNode',
  'shotList',
  'storyboardFile',
  'imageNode',
  'videoNode',
  'promptReview',
  'aiFilmCharacter',
  'aiFilmStoryboard',
  'aiFilmVideoPrompt',
  'scriptInput',
  'scriptAnalyzer',
  'scriptOutput',
]);

function projectKey(projectId: string): string {
  return `${STUDIO_IDB_PROJECT_PREFIX}${projectId}`;
}

export function createStudioProjectId(): string {
  return `project_${Math.random().toString(36).slice(2, 10)}`;
}

export function stringifyStudioProjectPayload(nodes: StudioRFNode[], edges: Edge[]): string {
  return stringifyStudioProjectPayloadWithMeta(nodes, edges);
}

export function stringifyStudioProjectPayloadWithMeta(
  nodes: StudioRFNode[],
  edges: Edge[],
  meta?: { projectId?: string; projectName?: string },
): string {
  return JSON.stringify(createStudioProjectPayload(nodes, edges, meta), null, 2);
}

type StudioImageAssetRecord = {
  id: string;
  dataUrl: string;
  mimeType: string;
  bytes: number;
  createdAt: number;
};

const IMAGE_ASSET_ID_PATTERN = /^sha256_[a-f0-9]{64}$/;
const IMAGE_ASSET_IO_CONCURRENCY = 2;
const IMAGE_ASSET_MEMORY_CACHE_MAX_BYTES = 160 * 1024 * 1024;
const studioImageAssetMemoryCache = new Map<string, StudioImageAssetRecord>();
let studioImageAssetMemoryCacheBytes = 0;
const pendingImageAssetRestores = new Map<
  string,
  Promise<StudioImageAssetRecord | null>
>();

function rememberStudioImageAsset(record: StudioImageAssetRecord): void {
  const existing = studioImageAssetMemoryCache.get(record.id);
  if (existing) {
    studioImageAssetMemoryCacheBytes -= existing.bytes;
    studioImageAssetMemoryCache.delete(record.id);
  }
  studioImageAssetMemoryCache.set(record.id, record);
  studioImageAssetMemoryCacheBytes += record.bytes;

  while (
    studioImageAssetMemoryCacheBytes > IMAGE_ASSET_MEMORY_CACHE_MAX_BYTES &&
    studioImageAssetMemoryCache.size > 1
  ) {
    const oldestId = studioImageAssetMemoryCache.keys().next().value as string | undefined;
    if (!oldestId) break;
    const oldest = studioImageAssetMemoryCache.get(oldestId);
    studioImageAssetMemoryCache.delete(oldestId);
    studioImageAssetMemoryCacheBytes -= oldest?.bytes ?? 0;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

function collectEmbeddedImageDataUrls(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectEmbeddedImageDataUrls(item, output));
    return;
  }
  if (!isRecord(value)) return;
  const hasPersistedAsset =
    typeof value.imageAssetId === 'string'
    && IMAGE_ASSET_ID_PATTERN.test(value.imageAssetId);
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'imageDataUrl'
      && typeof child === 'string'
      && /^data:image\/[^;,]+(?:;[^,]*)?;base64,/u.test(child)
    ) {
      if (!hasPersistedAsset) output.add(child);
      continue;
    }
    collectEmbeddedImageDataUrls(child, output);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function imageAssetRecord(dataUrl: string): Promise<StudioImageAssetRecord> {
  const blob = await fetch(dataUrl).then((response) => response.blob());
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    id: `sha256_${bytesToHex(new Uint8Array(digest))}`,
    dataUrl,
    mimeType: blob.type || 'image/jpeg',
    bytes: bytes.byteLength,
    createdAt: Date.now(),
  };
}

function replaceEmbeddedImagesWithAssets(
  value: unknown,
  assetsByDataUrl: Map<string, StudioImageAssetRecord>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceEmbeddedImagesWithAssets(item, assetsByDataUrl));
  }
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  const persistedAssetId =
    typeof value.imageAssetId === 'string'
    && IMAGE_ASSET_ID_PATTERN.test(value.imageAssetId)
      ? value.imageAssetId
      : '';
  for (const [key, child] of Object.entries(value)) {
    if (key === 'imageDataUrl' && typeof child === 'string') {
      if (persistedAssetId) continue;
      const asset = assetsByDataUrl.get(child);
      if (asset) {
        output.imageAssetId = asset.id;
        output.imageAssetMimeType = asset.mimeType;
        continue;
      }
    }
    output[key] = replaceEmbeddedImagesWithAssets(child, assetsByDataUrl);
  }
  return output;
}

function collectImageAssetIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageAssetIds(item, output));
    return;
  }
  if (!isRecord(value)) return;
  if (
    typeof value.imageAssetId === 'string'
    && IMAGE_ASSET_ID_PATTERN.test(value.imageAssetId)
    && typeof value.imageDataUrl !== 'string'
  ) {
    output.add(value.imageAssetId);
  }
  Object.values(value).forEach((child) => collectImageAssetIds(child, output));
}

function restoreEmbeddedImagesFromAssets(
  value: unknown,
  assetsById: Map<string, StudioImageAssetRecord>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => restoreEmbeddedImagesFromAssets(item, assetsById));
  }
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = restoreEmbeddedImagesFromAssets(child, assetsById);
  }
  if (
    typeof value.imageAssetId === 'string'
    && typeof value.imageDataUrl !== 'string'
  ) {
    const asset = assetsById.get(value.imageAssetId);
    if (asset?.dataUrl) output.imageDataUrl = asset.dataUrl;
  }
  return output;
}

export function createStudioProjectPayload(
  nodes: StudioRFNode[],
  edges: Edge[],
  meta?: { projectId?: string; projectName?: string },
): StudioProjectFilePayload {
  const cleaned = removeDeprecatedScriptNodes(nodes, edges);
  const { nodes: persistableNodes, edges: persistableEdges } = toPersistableNodesAndEdges(
    cleaned.nodes,
    cleaned.edges,
  );
  const payload: StudioProjectFilePayload = {
    version: STUDIO_PROJECT_JSON_VERSION,
    savedAt: Date.now(),
    nodes: persistableNodes,
    edges: persistableEdges,
    projectId: meta?.projectId,
    projectName: meta?.projectName,
  };
  return payload;
}

/** 解析用户选择的 .json 或 IndexedDB 读出的对象 */
export function parseStudioProjectPayload(raw: unknown): StudioProjectFilePayload | null {
  if (!isRecord(raw)) return null;
  const nodes = raw.nodes;
  const edges = raw.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
  for (const n of nodes) {
    if (!isRecord(n)) return null;
    if (typeof n.id !== 'string') return null;
    if (typeof n.type !== 'string' || !STUDIO_PROJECT_NODE_TYPES.has(n.type as StudioRFNode['type'])) {
      return null;
    }
    if (!isRecord(n.position) || typeof n.position.x !== 'number' || typeof n.position.y !== 'number') {
      return null;
    }
    if (!isRecord(n.data)) return null;
  }
  for (const e of edges) {
    if (!isRecord(e)) return null;
    if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') {
      return null;
    }
  }
  const normalizedNodes = (nodes as StudioRFNode[]).map(normalizeRestoredStudioNode);
  const cleaned = removeDeprecatedScriptNodes(normalizedNodes, edges as Edge[]);
  return {
    version: typeof raw.version === 'number' ? raw.version : STUDIO_PROJECT_JSON_VERSION,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    nodes: cleaned.nodes,
    edges: cleaned.edges,
    projectId: typeof raw.projectId === 'string' ? raw.projectId : undefined,
    projectName: typeof raw.projectName === 'string' ? raw.projectName : undefined,
  };
}

export function parseStudioProjectJsonFile(text: string): StudioProjectFilePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  return parseStudioProjectPayload(parsed);
}

function openStudioIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STUDIO_IDB_NAME, STUDIO_IDB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STUDIO_IDB_STORE)) {
        db.createObjectStore(STUDIO_IDB_STORE);
      }
      if (!db.objectStoreNames.contains(STUDIO_IDB_ASSET_STORE)) {
        db.createObjectStore(STUDIO_IDB_ASSET_STORE, { keyPath: 'id' });
      }
    };
  });
}

async function putStudioImageAssets(records: StudioImageAssetRecord[]): Promise<void> {
  if (!records.length) return;
  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_ASSET_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB image asset write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB image asset write aborted'));
    const store = tx.objectStore(STUDIO_IDB_ASSET_STORE);
    records.forEach((record) => store.put(record));
  });
  db.close();
  records.forEach(rememberStudioImageAsset);
}

async function getStudioImageAssets(assetIds: string[]): Promise<Map<string, StudioImageAssetRecord>> {
  const assets = new Map<string, StudioImageAssetRecord>();
  if (!assetIds.length) return assets;
  const missingAssetIds = assetIds.filter((assetId) => {
    const cached = studioImageAssetMemoryCache.get(assetId);
    if (!cached) return true;
    assets.set(assetId, cached);
    rememberStudioImageAsset(cached);
    return false;
  });
  if (!missingAssetIds.length) return assets;
  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_ASSET_STORE, 'readonly');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB image asset read failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB image asset read aborted'));
    const store = tx.objectStore(STUDIO_IDB_ASSET_STORE);
    missingAssetIds.forEach((assetId) => {
      const request = store.get(assetId);
      request.onsuccess = () => {
        const value = request.result as StudioImageAssetRecord | undefined;
        if (value?.id === assetId && typeof value.dataUrl === 'string') {
          assets.set(assetId, value);
          rememberStudioImageAsset(value);
        }
      };
    });
  });
  db.close();
  return assets;
}

function restoreStudioImageAssetFromDisk(
  assetId: string,
): Promise<StudioImageAssetRecord | null> {
  const pending = pendingImageAssetRestores.get(assetId);
  if (pending) return pending;

  const task = (async () => {
    try {
      const dataUrl = await getLocalProjectImageAssetDataUrl(assetId);
      if (!dataUrl) return null;
      const record = await imageAssetRecord(dataUrl);
      return record.id === assetId ? record : null;
    } catch (error) {
      if (!isLocalProjectDiskUnavailableError(error)) {
        console.warn('Local image asset restore failed', error);
      }
      return null;
    } finally {
      pendingImageAssetRestores.delete(assetId);
    }
  })();
  pendingImageAssetRestores.set(assetId, task);
  return task;
}

async function externalizeStudioProjectImages(
  payload: StudioProjectFilePayload,
): Promise<StudioProjectFilePayload> {
  const dataUrls = new Set<string>();
  collectEmbeddedImageDataUrls(payload, dataUrls);
  if (!dataUrls.size) {
    return replaceEmbeddedImagesWithAssets(
      payload,
      new Map(),
    ) as StudioProjectFilePayload;
  }

  const uniqueDataUrls = [...dataUrls];
  const records = await mapWithConcurrency(
    uniqueDataUrls,
    IMAGE_ASSET_IO_CONCURRENCY,
    (dataUrl) => imageAssetRecord(dataUrl),
  );
  const assetsByDataUrl = new Map<string, StudioImageAssetRecord>();
  records.forEach((record, index) => {
    const dataUrl = uniqueDataUrls[index];
    assetsByDataUrl.set(dataUrl, record);
  });
  await putStudioImageAssets(records);
  await mapWithConcurrency(
    records,
    IMAGE_ASSET_IO_CONCURRENCY,
    (record) => saveLocalProjectImageAsset(record.id, record.dataUrl),
  );
  return replaceEmbeddedImagesWithAssets(
    payload,
    assetsByDataUrl,
  ) as StudioProjectFilePayload;
}

export async function hydrateStudioProjectPayloadImages(
  payload: StudioProjectFilePayload | null,
): Promise<StudioProjectFilePayload | null> {
  if (!payload) return null;
  const assetIds = new Set<string>();
  collectImageAssetIds(payload, assetIds);
  if (!assetIds.size) return payload;

  const assetsById = await getStudioImageAssets([...assetIds]);
  const missingAssetIds = [...assetIds].filter((assetId) => !assetsById.has(assetId));
  const recoveredAssets = (
    await mapWithConcurrency(
      missingAssetIds,
      IMAGE_ASSET_IO_CONCURRENCY,
      restoreStudioImageAssetFromDisk,
    )
  ).filter((record): record is StudioImageAssetRecord => record != null);
  recoveredAssets.forEach((record) => {
    if (!assetsById.has(record.id)) {
      assetsById.set(record.id, record);
    }
  });
  await putStudioImageAssets(recoveredAssets);
  return restoreEmbeddedImagesFromAssets(
    payload,
    assetsById,
  ) as StudioProjectFilePayload;
}

async function putStudioProjectSnapshotNow(payload: StudioProjectFilePayload): Promise<void> {
  const compactPayload = await externalizeStudioProjectImages(payload);
  let diskWriteError: unknown = null;
  let diskUnavailableError: unknown = null;
  try {
    await saveStudioProjectSnapshotToDisk(compactPayload);
  } catch (error) {
    if (isLocalProjectDiskConflictError(error)) {
      throw error;
    }
    if (isLocalProjectDiskUnavailableError(error)) {
      diskUnavailableError = error;
    } else {
      diskWriteError = error;
    }
  }

  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB snapshot write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB snapshot write aborted'));
    const store = tx.objectStore(STUDIO_IDB_STORE);
    store.put(compactPayload, STUDIO_IDB_AUTOSAVE_KEY);
    if (compactPayload.projectId) {
      const projectName = compactPayload.projectName?.trim() || '未命名项目';
      const record: StudioProjectRecord = {
        ...compactPayload,
        projectId: compactPayload.projectId,
        projectName,
        updatedAt: compactPayload.savedAt,
      };
      store.put(record, projectKey(compactPayload.projectId));
      store.put(
        {
          projectId: compactPayload.projectId,
          projectName,
        } satisfies ActiveStudioProjectRef,
        STUDIO_IDB_ACTIVE_PROJECT_KEY,
      );
    }
  });
  db.close();
  if (diskUnavailableError) {
    console.warn(
      'Local disk project mirror is unavailable; the IndexedDB project snapshot was saved.',
      diskUnavailableError,
    );
  }
  if (diskWriteError) throw diskWriteError;
}

/**
 * Serializes every project snapshot write. This prevents an older, slower write
 * from completing after a newer snapshot and becoming the visible project head.
 */
export function queueStudioProjectSnapshot(payload: StudioProjectFilePayload): Promise<void> {
  const nextWrite = studioProjectWriteQueue
    .catch(() => undefined)
    .then(() => putStudioProjectSnapshotNow(payload));
  studioProjectWriteQueue = nextWrite;
  return nextWrite;
}

export async function flushStudioProjectWriteQueue(): Promise<void> {
  await studioProjectWriteQueue;
}

export async function createStudioProjectRecoveryBundle(): Promise<StudioProjectRecoveryBundle> {
  await flushStudioProjectWriteQueue();
  const db = await openStudioIdb();
  const entries = await new Promise<StudioProjectRecoveryBundle['entries']>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readonly');
    const store = tx.objectStore(STUDIO_IDB_STORE);
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    tx.oncomplete = () => {
      const keys = Array.isArray(keysRequest.result) ? keysRequest.result : [];
      const values = Array.isArray(valuesRequest.result) ? valuesRequest.result : [];
      resolve(
        keys.map((key, index) => ({
          key: String(key),
          value: values[index],
        })),
      );
    };
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB recovery export failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB recovery export aborted'));
  });
  const assets = await new Promise<StudioImageAssetRecord[]>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_ASSET_STORE, 'readonly');
    const request = tx.objectStore(STUDIO_IDB_ASSET_STORE).getAll();
    request.onsuccess = () => {
      resolve(
        (Array.isArray(request.result) ? request.result : []).filter(
          (value): value is StudioImageAssetRecord =>
            isRecord(value)
            && typeof value.id === 'string'
            && IMAGE_ASSET_ID_PATTERN.test(value.id)
            && typeof value.dataUrl === 'string',
        ),
      );
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB asset export failed'));
  });
  db.close();
  return {
    format: STUDIO_RECOVERY_BUNDLE_FORMAT,
    version: 1,
    exportedAt: Date.now(),
    sourceOrigin: typeof window === 'undefined' ? undefined : window.location.origin,
    database: {
      name: STUDIO_IDB_NAME,
      store: STUDIO_IDB_STORE,
      version: STUDIO_IDB_VERSION,
    },
    entries,
    assets,
  };
}

export function parseStudioProjectRecoveryBundle(
  raw: unknown,
): StudioProjectRecoveryBundle | null {
  if (!isRecord(raw)) return null;
  if (raw.format !== STUDIO_RECOVERY_BUNDLE_FORMAT || raw.version !== 1) return null;
  if (!Array.isArray(raw.entries)) return null;
  const entries: StudioProjectRecoveryBundle['entries'] = [];
  for (const entry of raw.entries) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !('value' in entry)) return null;
    const allowedKey =
      entry.key === STUDIO_IDB_AUTOSAVE_KEY
      || entry.key === STUDIO_IDB_ACTIVE_PROJECT_KEY
      || entry.key === STUDIO_IDB_RECENT_PROJECTS_KEY
      || entry.key.startsWith(STUDIO_IDB_PROJECT_PREFIX);
    if (!allowedKey) return null;
    entries.push({
      key: entry.key,
      value: entry.value,
    });
  }
  const assets = Array.isArray(raw.assets)
    ? raw.assets.filter(
        (value): value is StudioImageAssetRecord =>
          isRecord(value)
          && typeof value.id === 'string'
          && IMAGE_ASSET_ID_PATTERN.test(value.id)
          && typeof value.dataUrl === 'string',
      )
    : [];
  if (Array.isArray(raw.assets) && assets.length !== raw.assets.length) return null;
  return {
    format: STUDIO_RECOVERY_BUNDLE_FORMAT,
    version: 1,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : Date.now(),
    sourceOrigin: typeof raw.sourceOrigin === 'string' ? raw.sourceOrigin : undefined,
    database: {
      name: STUDIO_IDB_NAME,
      store: STUDIO_IDB_STORE,
      version: STUDIO_IDB_VERSION,
    },
    entries,
    assets,
  };
}

export function parseStudioProjectRecoveryBundleJson(
  text: string,
): StudioProjectRecoveryBundle | null {
  try {
    return parseStudioProjectRecoveryBundle(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function storedTimestamp(value: unknown): number {
  if (!isRecord(value)) return 0;
  if (typeof value.updatedAt === 'number') return value.updatedAt;
  if (typeof value.savedAt === 'number') return value.savedAt;
  return 0;
}

function mergeRecentProjectRefs(current: unknown, incoming: unknown): StudioRecentProjectRef[] {
  const merged = new Map<string, StudioRecentProjectRef>();
  const candidates = [
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    if (
      typeof candidate.projectId !== 'string'
      || typeof candidate.projectName !== 'string'
      || typeof candidate.openedAt !== 'number'
      || (
        candidate.source !== 'workspace'
        && candidate.source !== 'file'
        && candidate.source !== 'autosave'
        && candidate.source !== 'disk'
      )
    ) {
      continue;
    }
    const next = candidate as StudioRecentProjectRef;
    const previous = merged.get(next.projectId);
    if (!previous || next.openedAt > previous.openedAt) {
      merged.set(next.projectId, next);
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * Imports a recovery bundle without replacing newer local records. The current
 * active-project pointer is intentionally preserved so importing cannot switch
 * or clear the canvas behind the user's back.
 */
export async function importStudioProjectRecoveryBundle(
  bundle: StudioProjectRecoveryBundle,
): Promise<StudioProjectRecoveryImportResult> {
  await flushStudioProjectWriteQueue();
  const verifiedAssets: StudioImageAssetRecord[] = [];
  for (const asset of bundle.assets ?? []) {
    const verified = await imageAssetRecord(asset.dataUrl);
    if (verified.id !== asset.id) {
      throw new Error('恢复包中的图片资产校验失败。');
    }
    verifiedAssets.push({
      ...verified,
      createdAt: asset.createdAt || verified.createdAt,
    });
  }
  await putStudioImageAssets(verifiedAssets);
  const db = await openStudioIdb();
  let importedCount = 0;
  let skippedCount = 0;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readwrite');
    const store = tx.objectStore(STUDIO_IDB_STORE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB recovery import failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB recovery import aborted'));
    for (const entry of bundle.entries) {
      if (entry.key === STUDIO_IDB_ACTIVE_PROJECT_KEY) {
        skippedCount += 1;
        continue;
      }
      const request = store.get(entry.key);
      request.onerror = () => {
        tx.abort();
      };
      request.onsuccess = () => {
        const current = request.result as unknown;
        if (entry.key === STUDIO_IDB_RECENT_PROJECTS_KEY) {
          store.put(
            mergeRecentProjectRefs(current, entry.value),
            STUDIO_IDB_RECENT_PROJECTS_KEY,
          );
          importedCount += 1;
          return;
        }
        if (current !== undefined && storedTimestamp(current) > storedTimestamp(entry.value)) {
          skippedCount += 1;
          return;
        }
        store.put(entry.value, entry.key);
        importedCount += 1;
      };
    }
  });
  db.close();
  return {
    importedCount,
    skippedCount,
  };
}

export async function putStudioAutosave(payload: StudioProjectFilePayload): Promise<void> {
  const compactPayload = await externalizeStudioProjectImages(payload);
  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(STUDIO_IDB_STORE).put(compactPayload, STUDIO_IDB_AUTOSAVE_KEY);
  });
  db.close();
}

export async function getStudioAutosave(): Promise<StudioProjectFilePayload | null> {
  const db = await openStudioIdb();
  const raw = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readonly');
    const q = tx.objectStore(STUDIO_IDB_STORE).get(STUDIO_IDB_AUTOSAVE_KEY);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error ?? new Error('IndexedDB read failed'));
  });
  db.close();
  return hydrateStudioProjectPayloadImages(parseStudioProjectPayload(raw));
}

export async function putStudioProjectRecord(
  projectId: string,
  projectName: string,
  nodes: StudioRFNode[],
  edges: Edge[],
): Promise<StudioProjectRecord> {
  const { nodes: persistableNodes, edges: persistableEdges } = toPersistableNodesAndEdges(nodes, edges);
  const record: StudioProjectRecord = {
    version: STUDIO_PROJECT_JSON_VERSION,
    savedAt: Date.now(),
    updatedAt: Date.now(),
    nodes: persistableNodes,
    edges: persistableEdges,
    projectId,
    projectName,
  };
  const compactRecord = await externalizeStudioProjectImages(record) as StudioProjectRecord;
  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(STUDIO_IDB_STORE).put(compactRecord, projectKey(projectId));
  });
  db.close();
  return record;
}

export async function getStudioProjectRecord(projectId: string): Promise<StudioProjectRecord | null> {
  const db = await openStudioIdb();
  const raw = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readonly');
    const q = tx.objectStore(STUDIO_IDB_STORE).get(projectKey(projectId));
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error ?? new Error('IndexedDB read failed'));
  });
  db.close();
  const payload = await hydrateStudioProjectPayloadImages(parseStudioProjectPayload(raw));
  if (!payload || !payload.projectId || !payload.projectName) return null;
  return {
    ...payload,
    projectId: payload.projectId,
    projectName: payload.projectName,
    updatedAt:
      typeof (raw as Record<string, unknown> | null)?.updatedAt === 'number'
        ? Number((raw as Record<string, unknown>).updatedAt)
        : payload.savedAt,
  };
}

export async function listStudioProjectSummaries(): Promise<StudioProjectSummary[]> {
  const db = await openStudioIdb();
  const records = await new Promise<StudioProjectSummary[]>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readonly');
    const req = tx.objectStore(STUDIO_IDB_STORE).getAll();
    req.onsuccess = () => {
      const all = Array.isArray(req.result) ? req.result : [];
      const summaries = all
        .map((raw) => {
          const parsed = parseStudioProjectPayload(raw);
          if (!parsed?.projectId || !parsed.projectName) return null;
          return {
            projectId: parsed.projectId,
            projectName: parsed.projectName,
            updatedAt:
              typeof (raw as Record<string, unknown>).updatedAt === 'number'
                ? Number((raw as Record<string, unknown>).updatedAt)
                : parsed.savedAt,
            nodeCount: parsed.nodes.length,
            edgeCount: parsed.edges.length,
          } satisfies StudioProjectSummary;
        })
        .filter((item): item is StudioProjectSummary => item != null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(summaries);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB list failed'));
  });
  db.close();
  return records;
}

export async function setActiveStudioProjectRef(ref: ActiveStudioProjectRef | null): Promise<void> {
  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    const store = tx.objectStore(STUDIO_IDB_STORE);
    if (ref) {
      store.put(ref, STUDIO_IDB_ACTIVE_PROJECT_KEY);
    } else {
      store.delete(STUDIO_IDB_ACTIVE_PROJECT_KEY);
    }
  });
  db.close();
}

export async function getActiveStudioProjectRef(): Promise<ActiveStudioProjectRef | null> {
  const db = await openStudioIdb();
  const raw = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readonly');
    const q = tx.objectStore(STUDIO_IDB_STORE).get(STUDIO_IDB_ACTIVE_PROJECT_KEY);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error ?? new Error('IndexedDB read failed'));
  });
  db.close();
  if (!isRecord(raw)) return null;
  if (typeof raw.projectId !== 'string' || typeof raw.projectName !== 'string') return null;
  return {
    projectId: raw.projectId,
    projectName: raw.projectName,
  };
}

export async function listStudioRecentProjects(): Promise<StudioRecentProjectRef[]> {
  const db = await openStudioIdb();
  const raw = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readonly');
    const q = tx.objectStore(STUDIO_IDB_STORE).get(STUDIO_IDB_RECENT_PROJECTS_KEY);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error ?? new Error('IndexedDB read failed'));
  });
  db.close();
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is StudioRecentProjectRef => {
      if (!isRecord(item)) return false;
      return (
        typeof item.projectId === 'string' &&
        typeof item.projectName === 'string' &&
        typeof item.openedAt === 'number' &&
        (
          item.source === 'workspace'
          || item.source === 'file'
          || item.source === 'autosave'
          || item.source === 'disk'
          || item.source === 'recovery'
        )
      );
    })
    .sort((a, b) => b.openedAt - a.openedAt);
}

export async function pushStudioRecentProject(ref: Omit<StudioRecentProjectRef, 'openedAt'>): Promise<void> {
  const current = await listStudioRecentProjects();
  const next: StudioRecentProjectRef[] = [
    {
      ...ref,
      openedAt: Date.now(),
    },
    ...current.filter((item) => item.projectId !== ref.projectId),
  ].slice(0, 12);
  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(STUDIO_IDB_STORE).put(next, STUDIO_IDB_RECENT_PROJECTS_KEY);
  });
  db.close();
}
