import { PROMPT_DEPT_AGENT_SYSTEM } from '@/agents/promptDeptSpec';
import { runPromptEmployee } from '@/agents/promptAgents';
import type { ApprovedAsset, PromptOutput } from '@/types/studio';

/** Prompt 员工策略 */
export class PromptAgent {
  static readonly systemPromptTemplate = PROMPT_DEPT_AGENT_SYSTEM;

  static async execute(
    brief: string,
    approvedAssets: ApprovedAsset[],
    executionSystemPrompt: string,
    onDelta?: (delta: string, accumulated: string) => void,
    signal?: AbortSignal,
  ): Promise<PromptOutput> {
    return runPromptEmployee(brief, approvedAssets, executionSystemPrompt, onDelta, signal);
  }
}
