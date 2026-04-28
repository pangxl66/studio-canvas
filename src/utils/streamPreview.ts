import type { PromptOutput, StoryboardOutput, WritingOutput } from '@/types/studio';

export type PipelineKindForPreview = 'writing' | 'storyboard' | 'prompt';

/** 将员工产出格式化为详情区流式展示的文本（通常为 JSON） */
export function formatPipelineOutputPreview(
  _kind: PipelineKindForPreview,
  output: WritingOutput | StoryboardOutput | PromptOutput,
): string {
  return JSON.stringify(output, null, 2);
}

/**
 * 逐段将全文推入回调，模拟 Stream 打字机效果（员工阶段无真实 SSE 时仍可在 UI 上渐进展示）。
 */
export async function typewriterStream(
  fullText: string,
  onPartial: (accumulated: string) => void,
  options?: { chunkChars?: number; delayMs?: number; signal?: AbortSignal },
): Promise<void> {
  const chunkChars = Math.max(1, options?.chunkChars ?? 48);
  const delayMs = Math.max(0, options?.delayMs ?? 18);
  const t = fullText.length === 0 ? '' : fullText;
  for (let end = 0; end < t.length; end += chunkChars) {
    if (options?.signal?.aborted) {
      throw new Error('已手动停止当前任务。');
    }
    const acc = t.slice(0, Math.min(t.length, end + chunkChars));
    onPartial(acc);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (options?.signal?.aborted) {
    throw new Error('已手动停止当前任务。');
  }
  onPartial(t);
}
