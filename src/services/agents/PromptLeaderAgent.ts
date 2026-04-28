import { PROMPT_LEADER_SPEC } from '@/agents/promptDeptSpec';
import { runPromptLeaderReview } from '@/agents/promptAgents';
import type { PromptOutput } from '@/types/studio';

export type LeaderSelfReviewResult =
  | { approved: true }
  | { approved: false; feedback: string };

/** Prompt 总监 */
export class PromptLeaderAgent {
  static readonly reviewPromptTemplate = PROMPT_LEADER_SPEC;

  static async selfReview(
    output: PromptOutput,
    mountedSkills: string[] = [],
    signal?: AbortSignal,
  ): Promise<LeaderSelfReviewResult> {
    return runPromptLeaderReview(output, mountedSkills, signal);
  }
}
