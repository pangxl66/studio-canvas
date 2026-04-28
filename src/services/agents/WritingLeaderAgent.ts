import { WRITING_LEADER_SPEC } from '@/agents/writingDeptSpec';
import { runWritingLeaderReview } from '@/agents/writingAgents';
import type { WritingOutput } from '@/types/studio';

export type LeaderSelfReviewResult =
  | { approved: true }
  | { approved: false; feedback: string };

/** 编剧总监：初审（与人工「提交总监审核」共用同一套规则时可复用 runWritingLeaderReview） */
export class WritingLeaderAgent {
  static readonly reviewPromptTemplate = WRITING_LEADER_SPEC;

  static async selfReview(
    output: WritingOutput,
    signal?: AbortSignal,
  ): Promise<LeaderSelfReviewResult> {
    return runWritingLeaderReview(output, signal);
  }
}
