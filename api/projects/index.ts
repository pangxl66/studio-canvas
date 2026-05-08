import { createClient } from '@supabase/supabase-js';
import type { IncomingMessage, ServerResponse } from 'node:http';

type AnySupabaseClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
  };
  from: (table: string) => any;
};

type ProjectSnapshot = {
  version?: number;
  savedAt?: number;
  nodes?: unknown[];
  edges?: unknown[];
  projectId?: string;
  projectName?: string;
};

type ProjectRow = {
  id: string;
  name: string;
  snapshot: ProjectSnapshot;
  updated_at: string;
};

const MAX_PROJECT_SNAPSHOT_CHARS = 5_000_000;
const PROJECT_LIST_LIMIT = 40;

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function sanitizeError(raw: unknown): string {
  return String(raw ?? '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function getBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  const value = Array.isArray(header) ? header[0] : header;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function getAuthClients(token: string): { authClient: AnySupabaseClient; serviceClient: AnySupabaseClient } {
  const supabaseUrl = env('SUPABASE_URL');
  const supabaseAnonKey = env('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error('Server Supabase env is missing.');
  }

  return {
    authClient: createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }) as AnySupabaseClient,
    serviceClient: createClient(supabaseUrl, supabaseServiceRoleKey) as AnySupabaseClient,
  };
}

async function getAuthedUserId(req: IncomingMessage): Promise<{
  error?: { status: number; message: string };
  serviceClient?: AnySupabaseClient;
  userId?: string;
}> {
  const token = getBearerToken(req);
  if (!token) {
    return { error: { status: 401, message: '请先登录。' } };
  }

  try {
    const { authClient, serviceClient } = getAuthClients(token);
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) {
      return { error: { status: 401, message: '登录状态已失效，请重新登录。' } };
    }
    return { serviceClient, userId: data.user.id };
  } catch (error) {
    return { error: { status: 500, message: sanitizeError(error) || '服务器鉴权配置缺失。' } };
  }
}

function isSnapshot(value: unknown): value is ProjectSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as ProjectSnapshot;
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return false;
  return JSON.stringify(snapshot).length <= MAX_PROJECT_SNAPSHOT_CHARS;
}

function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.slice(0, 120) || '未命名工程';
}

function normalizeProjectRow(row: ProjectRow) {
  const nodes = Array.isArray(row.snapshot?.nodes) ? row.snapshot.nodes : [];
  const edges = Array.isArray(row.snapshot?.edges) ? row.snapshot.edges : [];
  return {
    id: row.id,
    name: row.name,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    snapshot: {
      ...row.snapshot,
      projectId: row.id,
      projectName: row.name,
    },
    updatedAt: Date.parse(row.updated_at) || Date.now(),
  };
}

async function listProjects(serviceClient: AnySupabaseClient, userId: string, res: ServerResponse): Promise<void> {
  const { data, error } = await serviceClient
    .from('projects')
    .select('id,name,snapshot,updated_at')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(PROJECT_LIST_LIMIT);

  if (error) {
    json(res, 500, { error: { message: error.message || '读取云端工程失败。' } });
    return;
  }

  const projects = ((data ?? []) as ProjectRow[]).map(normalizeProjectRow).map((item) => ({
    id: item.id,
    name: item.name,
    nodeCount: item.nodeCount,
    edgeCount: item.edgeCount,
    updatedAt: item.updatedAt,
  }));
  json(res, 200, { projects });
}

async function createProject(
  serviceClient: AnySupabaseClient,
  userId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    json(res, 400, { error: { message: '请求体不是合法 JSON。' } });
    return;
  }

  const snapshot = body.snapshot;
  if (!isSnapshot(snapshot)) {
    json(res, 400, { error: { message: '工程 snapshot 无效或超过大小限制。' } });
    return;
  }

  const name = normalizeName(body.name);
  const { data, error } = await serviceClient
    .from('projects')
    .insert({
      name,
      snapshot: {
        ...snapshot,
        projectName: name,
      },
      updated_at: new Date().toISOString(),
      user_id: userId,
    })
    .select('id,name,snapshot,updated_at')
    .single();

  if (error) {
    json(res, 500, { error: { message: error.message || '创建云端工程失败。' } });
    return;
  }

  const project = normalizeProjectRow(data as ProjectRow);
  json(res, 201, { project });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = await getAuthedUserId(req);
  if (auth.error || !auth.serviceClient || !auth.userId) {
    json(res, auth.error?.status ?? 500, { error: { message: auth.error?.message ?? '鉴权失败。' } });
    return;
  }

  if (req.method === 'GET') {
    await listProjects(auth.serviceClient, auth.userId, res);
    return;
  }

  if (req.method === 'POST') {
    await createProject(auth.serviceClient, auth.userId, req, res);
    return;
  }

  json(res, 405, { error: { message: 'Method not allowed.' } });
}
