import { STORYBOARD_DEPT_AGENT_SYSTEM } from '@/agents/storyboardDeptSpec';
import { runStoryboardDesignerFromScriptText } from '@/agents/storyboardAgents';
import type { StoryboardOutput } from '@/types/studio';

/** 分镜员工策略 */
export class StoryboardAgent {
  static readonly systemPromptTemplate = STORYBOARD_DEPT_AGENT_SYSTEM;

  static async execute(
    scriptText: string,
    executionSystemPrompt: string,
    onDelta?: (delta: string, accumulated: string) => void,
    signal?: AbortSignal,
  ): Promise<StoryboardOutput> {
    return runStoryboardDesignerFromScriptText(scriptText, executionSystemPrompt, onDelta, signal);
  }
}
