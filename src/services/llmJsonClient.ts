import { getResolvedLlmGatewayConfig } from '@/config/llmSettings';
import { requestLLM, requestLLMStream } from '@/services/ModelGateway';
import { safeJsonParse } from '@/services/safeJsonParse';

function buildJsonRepairUserPrompt(originalUserPrompt: string, rawResponse: string): string {
  const snippet = rawResponse.trim().slice(0, 4000);
  return [
    '你上一次返回的内容无法被系统解析成合法 JSON。',
    '不要解释，不要 markdown，不要代码块，只输出一个合法 JSON 对象。',
    '',
    '[原始任务]',
    originalUserPrompt,
    '',
    '[上一次输出]',
    snippet || '(empty)',
    '',
    '[本次要求]',
    '严格返回一个可被 JSON.parse 解析的 JSON 对象，不要附带任何前后缀。',
  ].join('\n');
}

export function parseModelJson(raw: string, fallbackHint?: string): unknown {
  const result = safeJsonParse(raw);
  if (!result.ok) {
    throw new Error(fallbackHint ? `${result.error} ${fallbackHint}` : result.error);
  }
  return result.value;
}

const MISSING_CFG =
  '未配置可用模型网关。请优先在设置里填写“代理 URL”，或改用 Base URL + API Key；也可以在 `.env` 里配置 `VITE_LLM_PROXY_URL` 或 `VITE_LLM_BASE_URL` / `VITE_LLM_API_KEY`。';

function preferSameOriginProxy(config: NonNullable<ReturnType<typeof getResolvedLlmGatewayConfig>>) {
  if (typeof window === 'undefined') return config;
  return {
    ...config,
    proxyUrl: '/api/llm/chat',
    baseUrl: undefined,
    apiKey: undefined,
  };
}

export async function invokeLlmJsonObject(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  feature?: string;
  model?: string;
  preferProxy?: boolean;
  signal?: AbortSignal;
}): Promise<unknown> {
  const resolvedConfig = getResolvedLlmGatewayConfig();
  if (!resolvedConfig) {
    throw new Error(MISSING_CFG);
  }
  const config = params.preferProxy ? preferSameOriginProxy(resolvedConfig) : resolvedConfig;

  const result = await requestLLM(config, {
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    temperature: params.temperature ?? 0.35,
    jsonMode: true,
    feature: params.feature,
    model: params.model,
    signal: params.signal,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  try {
    return parseModelJson(result.content);
  } catch {
    const repairResult = await requestLLM(config, {
      systemPrompt: params.systemPrompt,
      userPrompt: buildJsonRepairUserPrompt(params.userPrompt, result.content),
      temperature: 0.1,
      jsonMode: true,
      feature: params.feature,
      model: params.model,
      signal: params.signal,
    });

    if (!repairResult.ok) {
      throw new Error(repairResult.error.message);
    }

    return parseModelJson(
      repairResult.content,
      '模型已经自动进行了一次 JSON 修复重试，但返回内容仍然无法解析。',
    );
  }
}

export async function invokeLlmJsonObjectStream(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  model?: string;
  onDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (fullText: string) => void;
  signal?: AbortSignal;
}): Promise<unknown> {
  const config = getResolvedLlmGatewayConfig();
  if (!config) {
    throw new Error(MISSING_CFG);
  }

  const streamResult = await requestLLMStream(config, {
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    temperature: params.temperature ?? 0.35,
    jsonMode: true,
    model: params.model,
    signal: params.signal,
    onDelta: (delta, accumulated) => {
      params.onDelta?.(delta, accumulated);
    },
    onComplete: (fullText) => {
      params.onComplete?.(fullText);
    },
  });

  if (streamResult.ok) {
    try {
      return parseModelJson(streamResult.content);
    } catch {
      const repairResult = await requestLLM(config, {
        systemPrompt: params.systemPrompt,
        userPrompt: buildJsonRepairUserPrompt(params.userPrompt, streamResult.content),
        temperature: 0.1,
        jsonMode: true,
        model: params.model,
        signal: params.signal,
      });

      if (!repairResult.ok) {
        throw new Error(repairResult.error.message);
      }

      return parseModelJson(
        repairResult.content,
        '模型已经自动进行了一次 JSON 修复重试，但返回内容仍然无法解析。',
      );
    }
  }

  const shouldFallback =
    streamResult.error.code !== 'USER_ABORT' &&
    (streamResult.error.code === 'HTTP_400' ||
      streamResult.error.code === 'HTTP_404' ||
      streamResult.error.code === 'NO_BODY' ||
      streamResult.error.code === 'EMPTY_STREAM');

  if (!shouldFallback) {
    throw new Error(streamResult.error.message);
  }

  const result = await requestLLM(config, {
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    temperature: params.temperature ?? 0.35,
    jsonMode: true,
    model: params.model,
    signal: params.signal,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  params.onComplete?.(result.content);
  try {
    return parseModelJson(result.content);
  } catch {
    const repairResult = await requestLLM(config, {
      systemPrompt: params.systemPrompt,
      userPrompt: buildJsonRepairUserPrompt(params.userPrompt, result.content),
      temperature: 0.1,
      jsonMode: true,
      model: params.model,
      signal: params.signal,
    });

    if (!repairResult.ok) {
      throw new Error(repairResult.error.message);
    }

    return parseModelJson(
      repairResult.content,
      '模型已经自动进行了一次 JSON 修复重试，但返回内容仍然无法解析。',
    );
  }
}

export type LeaderReviewDecision = { approved: boolean; feedback: string | null };

const LEADER_OUTPUT_INSTRUCTION = `【输出格式】仅输出一个 JSON 对象，不要其他文字：

通过：{"approved": true}

打回：{"approved": false, "feedback": "具体修改建议（中文，指出问题与改进方向）"}`;

export async function invokeLlmLeaderReview(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<LeaderReviewDecision> {
  const config = getResolvedLlmGatewayConfig();
  if (!config) {
    throw new Error(MISSING_CFG);
  }

  const systemPrompt = `${params.systemPrompt.trim()}\n\n${LEADER_OUTPUT_INSTRUCTION}`;

  const result = await requestLLM(config, {
    systemPrompt,
    userPrompt: params.userPrompt,
    temperature: params.temperature ?? 0.2,
    jsonMode: true,
    signal: params.signal,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  const parsed = parseModelJson(result.content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('总监审核返回异常：必须是 JSON 对象。');
  }

  const record = parsed as Record<string, unknown>;
  const approved = record.approved === true;
  const feedback = approved
    ? null
    : typeof record.feedback === 'string' && record.feedback.trim()
      ? record.feedback.trim()
      : '请根据审核维度补充具体修改建议。';

  return { approved, feedback };
}
