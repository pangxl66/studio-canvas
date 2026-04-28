import { STORYBOARD_LEADER_SPEC } from '@/agents/storyboardDeptSpec';
import { runStoryboardLeaderReview } from '@/agents/storyboardAgents';
import type { StoryboardOutput } from '@/types/studio';

export type LeaderSelfReviewResult =
  | { approved: true }
  | { approved: false; feedback: string };

/** 分镜总监 */
export class StoryboardLeaderAgent {
  static readonly reviewPromptTemplate = STORYBOARD_LEADER_SPEC;

  static async selfReview(
    output: StoryboardOutput,
    sourceSceneCount: number,
    signal?: AbortSignal,
  ): Promise<LeaderSelfReviewResult> {
    return runStoryboardLeaderReview(output, sourceSceneCount, signal);
  }
}
