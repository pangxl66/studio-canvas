import { WRITING_DEPT_AGENT_SYSTEM } from '@/agents/writingDeptSpec';
import { runWritingEmployee } from '@/agents/writingAgents';
import type { WritingOutput } from '@/types/studio';

/** 编剧员工策略：System Prompt 与生成入口与 `src/agents/writingDeptSpec` 对齐 */
export class WritingAgent {
  static readonly systemPromptTemplate = WRITING_DEPT_AGENT_SYSTEM;

  /**
   * @param executionSystemPrompt 部门基础 + 挂载技能后的完整 system（接入真实 LLM 时使用）
   */
  static async execute(
    novelText: string,
    executionSystemPrompt: string,
    onDelta?: (delta: string, accumulated: string) => void,
    signal?: AbortSignal,
  ): Promise<WritingOutput> {
    return runWritingEmployee(novelText, executionSystemPrompt, onDelta, signal);
  }
}
