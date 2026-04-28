import { runStoryboardDesignerFromScriptText } from '@/agents/storyboardAgents';
import { STORYBOARD_DEPT_AGENT_SYSTEM } from '@/agents/storyboardDeptSpec';
import { resolveDepartmentExecutionInput } from '@/services/graphInput';
import { appendProjectContextForConsumer } from '@/services/ProjectContext';
import { resolveAndComposeMountedSkills } from '@/services/skillLoader';
import type { StudioRFNode } from '@/types/reactFlow';
import type { StoryboardOutput } from '@/types/studio';
import { BrainExecuteContext, BrainInputError } from '@/services/agents/brainTypes';

/**
 * 分镜任务处理器：**视觉化**镜头语言（构图、运镜、光影、画面可读性）。
 */
export class StoryboardBrain {
  static readonly FOCUS_INSTRUCTION = `【StoryboardBrain · 视觉化重点】
1. 每个镜头必须可被摄影与演员直接执行：写清**构图**（景别、主体位置、前中后景关系）。
2. **运镜**需具体（固定/推/拉/摇/移/跟/升降及节奏），并与画内**动作**区分。
3. **光影**：注明主光方向、反差气质（如侧逆光、体积雾、夜景霓虹等），避免只有剧情复述而无画面光色。
4. narrativeBeats（若写）须与场次逻辑对齐；每镜 content 无对白时输出 ""。`;

  /**
   * @throws BrainInputError 未拿到剧本文本或结构化场次输入时
   */
  static validate(node: StudioRFNode, ctx: BrainExecuteContext): string {
    if (node.type !== 'department' || node.data.type !== 'storyboard') {
      throw new BrainInputError('StoryboardBrain 仅处理「分镜部」部门节点。', 'WRONG_NODE_KIND');
    }
    const text = resolveDepartmentExecutionInput(node.id, ctx.nodes, ctx.edges, node.data.input ?? '');
    if (!text.trim()) {
      throw new BrainInputError(
        '分镜大脑未收到剧本数据：请将 TEXT_NODE 的剧本文本连入 Input，或从编剧部 Output 接入场次/结构化数据后再执行。',
        'MISSING_SCRIPT',
      );
    }
    return text.trim();
  }

  static async execute(node: StudioRFNode, ctx: BrainExecuteContext): Promise<StoryboardOutput> {
    const text = this.validate(node, ctx);
    const mounted = Array.isArray(node.data.mounted_skills) ? node.data.mounted_skills : [];
    const { systemPrompt } = resolveAndComposeMountedSkills('storyboard', STORYBOARD_DEPT_AGENT_SYSTEM, mounted);
    const composed = appendProjectContextForConsumer(systemPrompt, 'storyboard');
    const executionSystemPrompt = `${composed}\n\n${this.FOCUS_INSTRUCTION}`;
    return runStoryboardDesignerFromScriptText(text, executionSystemPrompt);
  }
}
