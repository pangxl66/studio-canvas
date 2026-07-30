import {
  fetchAdminUsageEvents,
  fetchAdminUsers,
  type AdminUsageEvent,
  type AdminUserRecord,
} from '@/services/adminCreditService';
import {
  getActiveDiskProjectSnapshot,
  listDiskProjectSummaries,
  type DiskProjectVersionSummary,
  listDiskProjectVersions,
} from '@/services/localProjectDiskService';
import type { StudioProjectSummary } from '@/services/studioProjectPersistence';

export type AdminTaskState = 'attention' | 'failed' | 'queued' | 'running' | 'success';

export type AdminWorkspaceTask = {
  error: string;
  id: string;
  label: string;
  model: string;
  nodeType: string;
  projectId: string;
  projectName: string;
  rawStatus: string;
  state: AdminTaskState;
  updatedAt: number | null;
};

export type AdminHealthProvider = {
  apiKey: boolean;
  failureState?: {
    coolingDown?: boolean;
    cooldownRemainingSec?: number;
    recentFailures?: number;
  };
  fallbackModels?: string[];
  primaryModel: string;
  provider: string;
  upstream: boolean;
};

export type AdminHealthSnapshot = {
  authMode: string;
  checks: Record<string, boolean>;
  ok: boolean;
  providers: AdminHealthProvider[];
  serverUptimeSec: number;
  timestamp: string;
};

export type AdminProjectRecord = StudioProjectSummary & {
  isAutosave?: boolean;
};

export type AdminWorkspaceData = {
  activeProjectId: string;
  activeProjectName: string;
  errors: string[];
  health: AdminHealthSnapshot;
  projects: AdminProjectRecord[];
  tasks: AdminWorkspaceTask[];
  usageEvents: AdminUsageEvent[];
  users: AdminUserRecord[];
};

type HealthResponse = {
  checks?: Record<string, boolean>;
  diagnostics?: {
    auth?: { mode?: string };
    llm?: { providers?: AdminHealthProvider[] };
    server?: { uptimeSec?: number };
  };
  ok?: boolean;
  timestamp?: string;
};

type SnapshotNode = {
  data?: Record<string, unknown>;
  id?: string;
  type?: string;
};

type ProjectSnapshot = {
  nodes?: SnapshotNode[];
  projectId?: string;
  projectName?: string;
  savedAt?: number;
};

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function taskState(data: Record<string, unknown>): AdminTaskState {
  const status = stringValue(data.status).toUpperCase();
  if (stringValue(data.generation_error)) return 'failed';
  if (stringValue(data.generation_phase) || status === 'IN_PROGRESS' || status === 'RUNNING') return 'running';
  if (status === 'WAITING_REVIEW' || status === 'NEEDS_REVIEW') return 'attention';
  if (status === 'APPROVED' || status === 'COMPLETED' || status === 'SUCCESS') return 'success';
  return 'queued';
}

function nodeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    aiFilmStoryboard: '九宫格分镜',
    department: '部门节点',
    imageNode: '图片生成',
    promptReview: '提示词',
    shotList: '分镜表',
    textNode: '文本节点',
    videoNode: '视频节点',
  };
  return labels[type] || type || '工作节点';
}

function deriveTasks(snapshot: unknown): {
  activeProjectId: string;
  activeProjectName: string;
  tasks: AdminWorkspaceTask[];
} {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { activeProjectId: '', activeProjectName: '', tasks: [] };
  }
  const project = snapshot as ProjectSnapshot;
  const projectId = stringValue(project.projectId);
  const projectName = stringValue(project.projectName) || '当前工程';
  const updatedAt = typeof project.savedAt === 'number' ? project.savedAt : null;
  const tasks = (Array.isArray(project.nodes) ? project.nodes : []).map((node, index) => {
    const data = node.data && typeof node.data === 'object' ? node.data : {};
    const type = stringValue(node.type);
    const rawStatus = stringValue(data.status) || stringValue(data.generation_phase) || 'NOT_STARTED';
    const model =
      stringValue(data.imageGenerationSelectedModel)
      || stringValue(data.image_model)
      || stringValue(data.model);
    return {
      error: stringValue(data.generation_error),
      id: stringValue(node.id) || `node-${index}`,
      label:
        stringValue(data.label)
        || stringValue(data.title)
        || stringValue(data.name)
        || `${nodeTypeLabel(type)} ${index + 1}`,
      model,
      nodeType: type,
      projectId,
      projectName,
      rawStatus,
      state: taskState(data),
      updatedAt,
    } satisfies AdminWorkspaceTask;
  });
  return { activeProjectId: projectId, activeProjectName: projectName, tasks };
}

async function fetchHealth(): Promise<AdminHealthSnapshot> {
  const response = await fetch('/api/health', { cache: 'no-store' });
  const payload = await response.json() as HealthResponse;
  if (!response.ok) throw new Error('系统健康检查失败。');
  return {
    authMode: stringValue(payload.diagnostics?.auth?.mode) || 'unknown',
    checks: payload.checks || {},
    ok: Boolean(payload.ok),
    providers: Array.isArray(payload.diagnostics?.llm?.providers)
      ? payload.diagnostics?.llm?.providers
      : [],
    serverUptimeSec: Number(payload.diagnostics?.server?.uptimeSec || 0),
    timestamp: stringValue(payload.timestamp) || new Date().toISOString(),
  };
}

export async function loadAdminWorkspaceData(): Promise<AdminWorkspaceData> {
  const errors: string[] = [];
  const [healthResult, projectsResult, snapshotResult, usersResult, usageResult] =
    await Promise.allSettled([
      fetchHealth(),
      listDiskProjectSummaries(),
      getActiveDiskProjectSnapshot(),
      fetchAdminUsers('', 200, 1),
      fetchAdminUsageEvents('', 200),
    ]);

  const health =
    healthResult.status === 'fulfilled'
      ? healthResult.value
      : {
          authMode: 'unknown',
          checks: {},
          ok: false,
          providers: [],
          serverUptimeSec: 0,
          timestamp: new Date().toISOString(),
        };
  if (healthResult.status === 'rejected') errors.push('系统健康状态暂时无法读取。');
  if (projectsResult.status === 'rejected') errors.push('工程磁盘列表暂时无法读取。');
  if (snapshotResult.status === 'rejected') errors.push('当前工程状态暂时无法读取。');
  if (usersResult.status === 'rejected') {
    errors.push(usersResult.reason instanceof Error ? usersResult.reason.message : '用户数据暂时无法读取。');
  }
  if (usageResult.status === 'rejected') {
    errors.push(usageResult.reason instanceof Error ? usageResult.reason.message : '使用记录暂时无法读取。');
  }

  const derived = deriveTasks(snapshotResult.status === 'fulfilled' ? snapshotResult.value : null);
  return {
    ...derived,
    errors,
    health,
    projects: projectsResult.status === 'fulfilled' ? projectsResult.value : [],
    tasks: derived.tasks,
    usageEvents: usageResult.status === 'fulfilled' ? usageResult.value.events : [],
    users: usersResult.status === 'fulfilled' ? usersResult.value.users : [],
  };
}

export async function loadAdminProjectVersions(projectId: string): Promise<DiskProjectVersionSummary[]> {
  return listDiskProjectVersions(projectId);
}
