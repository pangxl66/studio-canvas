import type { Edge } from '@xyflow/react';
import {
  parseStudioProjectPayload,
  STUDIO_PROJECT_JSON_VERSION,
  type StudioProjectFilePayload,
} from '@/services/studioProjectPersistence';
import { getSupabaseClient, isSaasAuthEnabled, isSaasMockEnabled } from '@/services/authClient';
import type { StudioRFNode } from '@/types/reactFlow';
import { toPersistableNodesAndEdges } from '@/utils/studioNodePersistence';

export type CloudProjectSummary = {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
};

export type CloudProjectRecord = {
  id: string;
  name: string;
  snapshot: StudioProjectFilePayload;
  updatedAt: number;
};

type CloudProjectApiRecord = {
  id: string;
  name: string;
  snapshot: unknown;
  updatedAt: number;
  nodeCount?: number;
  edgeCount?: number;
};

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
};

type MockProjectRecord = {
  id: string;
  name: string;
  snapshot: StudioProjectFilePayload;
  updatedAt: number;
  archivedAt?: number;
};

const MOCK_PROJECTS_KEY = 'studio_canvas_saas_mock_projects_v1';

function toTimestamp(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value) return Date.now();
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : Date.now();
}

function buildSnapshot(
  nodes: StudioRFNode[],
  edges: Edge[],
  meta: { projectId?: string | null; projectName: string },
): StudioProjectFilePayload {
  const { nodes: persistableNodes, edges: persistableEdges } = toPersistableNodesAndEdges(nodes, edges);
  return {
    version: STUDIO_PROJECT_JSON_VERSION,
    savedAt: Date.now(),
    nodes: persistableNodes,
    edges: persistableEdges,
    projectId: meta.projectId ?? undefined,
    projectName: meta.projectName,
  };
}

function parseApiProject(project: CloudProjectApiRecord): CloudProjectRecord | null {
  const snapshot = parseStudioProjectPayload(project.snapshot);
  if (!snapshot) return null;

  return {
    id: project.id,
    name: project.name,
    snapshot: {
      ...snapshot,
      projectId: project.id,
      projectName: project.name,
    },
    updatedAt: toTimestamp(project.updatedAt),
  };
}

function createMockProjectId(): string {
  return `mock_${Math.random().toString(36).slice(2, 10)}`;
}

function readMockProjects(): MockProjectRecord[] {
  try {
    const raw = localStorage.getItem(MOCK_PROJECTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as MockProjectRecord[]) : [];
  } catch {
    return [];
  }
}

function writeMockProjects(projects: MockProjectRecord[]): void {
  localStorage.setItem(MOCK_PROJECTS_KEY, JSON.stringify(projects));
}

function parseMockProject(project: MockProjectRecord): CloudProjectRecord | null {
  const snapshot = parseStudioProjectPayload(project.snapshot);
  if (!snapshot) return null;
  return {
    id: project.id,
    name: project.name,
    snapshot: {
      ...snapshot,
      projectId: project.id,
      projectName: project.name,
    },
    updatedAt: project.updatedAt,
  };
}

function listMockCloudProjects(): CloudProjectSummary[] {
  return readMockProjects()
    .filter((project) => !project.archivedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      nodeCount: project.snapshot.nodes.length,
      edgeCount: project.snapshot.edges.length,
    }));
}

function getMockCloudProject(projectId: string): CloudProjectRecord | null {
  const project = readMockProjects().find((item) => item.id === projectId && !item.archivedAt);
  return project ? parseMockProject(project) : null;
}

function saveMockCloudProject(params: {
  projectId?: string | null;
  projectName: string;
  nodes: StudioRFNode[];
  edges: Edge[];
}): CloudProjectRecord {
  const projects = readMockProjects();
  const now = Date.now();
  const id = params.projectId || createMockProjectId();
  const snapshot = buildSnapshot(params.nodes, params.edges, {
    projectId: id,
    projectName: params.projectName,
  });
  const existingIndex = projects.findIndex((project) => project.id === id);
  const nextProject: MockProjectRecord = {
    id,
    name: params.projectName,
    snapshot,
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    projects[existingIndex] = nextProject;
  } else {
    projects.push(nextProject);
  }
  writeMockProjects(projects);
  const parsed = parseMockProject(nextProject);
  if (!parsed) throw new Error('Mock project saved but could not be parsed.');
  return parsed;
}

function archiveMockCloudProject(projectId: string): void {
  const projects = readMockProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index >= 0) {
    projects[index] = {
      ...projects[index],
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeMockProjects(projects);
  }
}

async function getAccessToken(): Promise<string> {
  const client = getSupabaseClient();
  if (!client || !isSaasAuthEnabled()) {
    throw new Error('云端工程服务尚未启用。');
  }

  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw error ?? new Error('请先登录。');
  }

  return data.session.access_token;
}

async function readApiPayload<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as (T & ApiErrorPayload) | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message || '云端工程请求失败。');
  }
  if (!payload) {
    throw new Error('云端工程返回内容为空。');
  }
  return payload as T;
}

async function cloudFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });
  return readApiPayload<T>(response);
}

export async function listCloudProjects(): Promise<CloudProjectSummary[]> {
  if (isSaasMockEnabled()) {
    return listMockCloudProjects();
  }

  const payload = await cloudFetch<{ projects: CloudProjectApiRecord[] }>('/api/projects');
  return payload.projects.map((item) => ({
    id: item.id,
    name: item.name,
    updatedAt: toTimestamp(item.updatedAt),
    nodeCount: item.nodeCount ?? 0,
    edgeCount: item.edgeCount ?? 0,
  }));
}

export async function getCloudProject(projectId: string): Promise<CloudProjectRecord | null> {
  if (isSaasMockEnabled()) {
    return getMockCloudProject(projectId);
  }

  const payload = await cloudFetch<{ project: CloudProjectApiRecord }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
  );
  return parseApiProject(payload.project);
}

export async function saveCloudProject(params: {
  projectId?: string | null;
  projectName: string;
  nodes: StudioRFNode[];
  edges: Edge[];
}): Promise<CloudProjectRecord> {
  if (isSaasMockEnabled()) {
    return saveMockCloudProject(params);
  }

  const snapshot = buildSnapshot(params.nodes, params.edges, {
    projectId: params.projectId,
    projectName: params.projectName,
  });
  const payload = await cloudFetch<{ project: CloudProjectApiRecord }>(
    params.projectId ? `/api/projects/${encodeURIComponent(params.projectId)}` : '/api/projects',
    {
      method: params.projectId ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: params.projectName,
        snapshot,
      }),
    },
  );

  const record = parseApiProject(payload.project);
  if (!record) {
    throw new Error('云端工程保存成功，但返回内容无法解析。');
  }
  return record;
}

export async function archiveCloudProject(projectId: string): Promise<void> {
  if (isSaasMockEnabled()) {
    archiveMockCloudProject(projectId);
    return;
  }

  await cloudFetch<{ ok: true }>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
}
