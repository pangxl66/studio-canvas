import { useProjectContextStore } from '@/store/useProjectContextStore';
import type { WritingOutput } from '@/types/studio';

export type { ProjectCharacterEntry, ProjectContextState } from '@/store/useProjectContextStore';

/**
 * 编剧节点产出结构化剧本后写入全局 Context（角色 + 风格锚点）。
 */
export function ingestWritingOutputToProjectContext(writingNodeId: string, output: WritingOutput): void {
  useProjectContextStore.getState().ingestFromWritingOutput(writingNodeId, output);
}

/** 拼接到 LLM system 末尾；供分镜 / Prompt 等下游部门使用 */
export function getProjectContextSystemAppend(): string {
  return useProjectContextStore.getState().getSystemAppend();
}

export function resetProjectContext(): void {
  useProjectContextStore.getState().reset();
}

/**
 * 编剧部不注入（避免自引用）；分镜 / Prompt 自动带上 ProjectContext。
 */
export function appendProjectContextForConsumer(
  systemPrompt: string,
  consumer: 'writing' | 'storyboard' | 'prompt',
): string {
  if (consumer === 'writing') return systemPrompt;
  return systemPrompt + getProjectContextSystemAppend();
}
