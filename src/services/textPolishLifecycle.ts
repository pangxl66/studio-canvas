import type { StudioNodeData } from '@/types/studio';

export const TEXT_POLISH_TIMEOUT_MS = 120_000;

export const TEXT_POLISH_TIMEOUT_MESSAGE =
  '文本润色等待超过 120 秒，任务已自动停止；原文已保留，请稍后重试。';

export const TEXT_POLISH_INTERRUPTED_MESSAGE =
  '检测到上一次文本润色已因刷新或异常中断；原文已保留，请重新生成。';

export function recoverInterruptedTextPolish(
  data: Pick<StudioNodeData, 'input' | 'raw_text'>,
  message = TEXT_POLISH_INTERRUPTED_MESSAGE,
): Pick<
  StudioNodeData,
  'status' | 'generation_error' | 'streaming_preview' | 'text_polish_started_at'
> {
  const hasText = Boolean((data.raw_text ?? data.input ?? '').trim());
  return {
    status: hasText ? 'APPROVED' : 'NOT_STARTED',
    generation_error: message,
    streaming_preview: undefined,
    text_polish_started_at: undefined,
  };
}
