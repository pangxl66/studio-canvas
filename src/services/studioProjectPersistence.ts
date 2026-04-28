import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import {
  normalizeRestoredStudioNode,
  toPersistableNodesAndEdges,
} from '@/utils/studioNodePersistence';

export const STUDIO_PROJECT_JSON_VERSION = 1;

export const STUDIO_IDB_NAME = 'studio-ai-drama-idb';
export const STUDIO_IDB_STORE = 'project_snapshots';
export const STUDIO_IDB_AUTOSAVE_KEY = 'canvas_autosave';
export const STUDIO_IDB_ACTIVE_PROJECT_KEY = 'active_project_ref';
export const STUDIO_IDB_RECENT_PROJECTS_KEY = 'recent_project_refs';
const STUDIO_IDB_PROJECT_PREFIX = 'project::';

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
  source: 'workspace' | 'file' | 'autosave';
};

const STUDIO_PROJECT_NODE_TYPES = new Set<StudioRFNode['type']>([
  'department',
  'textNode',
  'shotList',
  'storyboardFile',
  'imageNode',
  'promptReview',
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
  const { nodes: persistableNodes, edges: persistableEdges } = toPersistableNodesAndEdges(nodes, edges);
  const payload: StudioProjectFilePayload = {
    version: STUDIO_PROJECT_JSON_VERSION,
    savedAt: Date.now(),
    nodes: persistableNodes,
    edges: persistableEdges,
    projectId: meta?.projectId,
    projectName: meta?.projectName,
  };
  return JSON.stringify(payload, null, 2);
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
  return {
    version: typeof raw.version === 'number' ? raw.version : STUDIO_PROJECT_JSON_VERSION,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    nodes: normalizedNodes,
    edges: edges as Edge[],
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
    const req = indexedDB.open(STUDIO_IDB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STUDIO_IDB_STORE)) {
        db.createObjectStore(STUDIO_IDB_STORE);
      }
    };
  });
}

export async function putStudioAutosave(payload: StudioProjectFilePayload): Promise<void> {
  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(STUDIO_IDB_STORE).put(payload, STUDIO_IDB_AUTOSAVE_KEY);
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
  return parseStudioProjectPayload(raw);
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
  const db = await openStudioIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STUDIO_IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(STUDIO_IDB_STORE).put(record, projectKey(projectId));
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
  const payload = parseStudioProjectPayload(raw);
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
        (item.source === 'workspace' || item.source === 'file' || item.source === 'autosave')
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
