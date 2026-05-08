import type { IncomingMessage, ServerResponse } from 'node:http';

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function hasLlmUpstream(): boolean {
  return Boolean(env('LLM_PROXY_URL') || env('LLM_BASE_URL'));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  const checks = {
    llmApiKey: Boolean(env('LLM_API_KEY')),
    llmUpstream: hasLlmUpstream(),
    supabaseAnonKey: Boolean(env('SUPABASE_ANON_KEY')),
    supabaseServiceRoleKey: Boolean(env('SUPABASE_SERVICE_ROLE_KEY')),
    supabaseUrl: Boolean(env('SUPABASE_URL')),
  };
  const ok = Object.values(checks).every(Boolean);

  json(res, ok ? 200 : 503, {
    ok,
    checks,
    runtime: 'vercel-node',
    service: 'studio-canvas-saas',
    timestamp: new Date().toISOString(),
  });
}
