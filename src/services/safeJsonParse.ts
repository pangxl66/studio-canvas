/**
 * 安全解析 AI / 网关返回中的 JSON：兼容 markdown 围栏、HTML 报错页包裹、前后缀噪声。
 */

const HTML_SIGNAL = /<!doctype\s+html|<\s*html[\s>]/i;

/** 正则：从第一个 `{` 到最后一个 `}`（贪婪），用于 HTML 或杂质包裹时的兜底提取 */
export function extractJsonSliceFirstBraceToLastBrace(raw: string): string | null {
  const m = raw.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

export function looksLikeHtmlWrappedResponse(text: string): boolean {
  return HTML_SIGNAL.test(text);
}

function stripMarkdownFence(t: string): string {
  let s = t.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```/im;
  const fm = s.match(fence);
  if (fm) s = fm[1].trim();
  return s;
}

function normalizeRaw(raw: string): string {
  let t = raw.replace(/^\uFEFF/, '').trim();
  t = t.replace(/^\)\]\}'\s*\n?/, '').trim();
  return stripMarkdownFence(t);
}

/** 括号平衡截取最外层 JSON 对象（字符串内引号/转义感知） */
function extractBalancedJsonObject(t: string): string | null {
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

function tryJsonParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

function shouldPreferRegexBraceSlice(normalized: string, original: string): boolean {
  if (looksLikeHtmlWrappedResponse(original) || looksLikeHtmlWrappedResponse(normalized)) return true;
  const t = normalized.trimStart();
  if (!t.startsWith('{') && !t.startsWith('[')) return true;
  return false;
}

export type SafeJsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

const PARSE_FAIL_HINT =
  '无法解析为合法 JSON（可能返回了网页、纯文本或截断内容）。请检查 Base URL、模型与 API Key，或稍后重试。';

/**
 * 解析模型或网关返回的 JSON 文本；失败时返回友好说明，不抛异常。
 */
export function safeJsonParse(raw: string): SafeJsonParseResult {
  const normalized = normalizeRaw(raw);
  if (!normalized) {
    return { ok: false, error: '返回内容为空，无法解析 JSON。' };
  }

  const direct = tryJsonParse(normalized);
  if (direct !== undefined) {
    return { ok: true, value: direct };
  }

  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (s: string | null) => {
    if (!s || seen.has(s)) return;
    seen.add(s);
    candidates.push(s);
  };

  const preferRegex = shouldPreferRegexBraceSlice(normalized, raw);
  if (preferRegex) {
    push(extractJsonSliceFirstBraceToLastBrace(normalized));
  }
  push(extractBalancedJsonObject(normalized));
  if (!preferRegex) {
    push(extractJsonSliceFirstBraceToLastBrace(normalized));
  }

  for (const slice of candidates) {
    const v = tryJsonParse(slice);
    if (v !== undefined) return { ok: true, value: v };
  }

  return { ok: false, error: PARSE_FAIL_HINT };
}
