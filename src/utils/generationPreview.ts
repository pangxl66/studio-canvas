import type { GenerationPhase } from '@/types/studio';

export const MODEL_STREAM_PREVIEW_MAX_CHARS = 8_000;

export function limitModelStreamPreview(
  accumulated: string,
  maxChars = MODEL_STREAM_PREVIEW_MAX_CHARS,
): string {
  const normalizedLimit = Math.max(1, Math.floor(maxChars));
  if (accumulated.length <= normalizedLimit) return accumulated;
  const omitted = accumulated.length - normalizedLimit;
  return `[已省略前 ${omitted.toLocaleString('zh-CN')} 个字符]\n…\n${accumulated.slice(-normalizedLimit)}`;
}

export function storyboardGenerationPhaseCopy(
  phase: GenerationPhase | undefined,
): { title: string; message: string } {
  switch (phase) {
    case 'preparing':
      return {
        title: '分镜生成进度 · 准备输入',
        message: '正在整理剧本文本、项目约束与参考图片。',
      };
    case 'connecting':
      return {
        title: '分镜生成进度 · 连接模型',
        message: '正在连接分镜生成模型，等待首段输出。',
      };
    case 'streaming':
    case 'employee':
      return {
        title: '分镜生成进度 · 生成镜头',
        message: '模型正在返回结构化镜头数据。',
      };
    case 'fallback':
      return {
        title: '分镜生成进度 · 兼容模式',
        message: '当前接口不支持流式返回，已切换兼容模式继续生成。',
      };
    case 'repairing':
      return {
        title: '分镜生成进度 · 修复数据',
        message: '模型结果不符合 JSON 结构，正在自动修复一次。',
      };
    case 'validating':
    case 'leader':
      return {
        title: '分镜生成进度 · 校验结构',
        message: '正在校验镜头字段、时长与下游可用性。',
      };
    case 'finalizing':
      return {
        title: '分镜生成进度 · 创建分镜表',
        message: '校验完成，正在同步并打开分镜表节点。',
      };
    default:
      return {
        title: '分镜生成进度',
        message: '正在启动分镜生成任务。',
      };
  }
}
