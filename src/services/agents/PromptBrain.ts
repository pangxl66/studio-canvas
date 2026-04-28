import { runPromptEmployee } from '@/agents/promptAgents';
import { PROMPT_DEPT_AGENT_SYSTEM } from '@/agents/promptDeptSpec';
import { resolveDepartmentExecutionInput } from '@/services/graphInput';
import { appendProjectContextForConsumer } from '@/services/ProjectContext';
import { resolveAndComposeMountedSkills } from '@/services/skillLoader';
import type { StudioRFNode } from '@/types/reactFlow';
import type { ApprovedAsset, PromptOutput } from '@/types/studio';
import { BrainExecuteContext, BrainInputError } from '@/services/agents/brainTypes';
import { safeJsonParse } from '@/services/safeJsonParse';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';

/**
 * Prompt 任务处理器：**工程化**输出，面向 Stable Diffusion / Seeddance 等引擎的标签化、可批量投喂结构。
 */
export class PromptBrain {
  static readonly FOCUS_INSTRUCTION = `【PromptBrain · 工程化重点】
1. 主提示词以**英文或中英混合标签串**为主（材质、光位、镜头焦距、运动、风格锚点），避免空泛形容词堆砌。
2. 每个 shot 的 prompt 须可直接复制进 SD / Seeddance；negative_prompt 与主 prompt 语义一致、排除常见视频瑕疵。
3. dimensions 十维字段填满可检索关键词，便于资产系统与连贯性约束；shot_id 与源镜头严格对应。`;

  /**
   * 要求：非空输入；若以 JSON 传入，须含非空 shots（分镜镜头表）。编剧-only 的 scenes JSON 会明确报错引导接线。
   */
  static validate(node: StudioRFNode, ctx: BrainExecuteContext): string {
    if (node.type !== 'department' || node.data.type !== 'prompt') {
      throw new BrainInputError('PromptBrain 仅处理「Prompt 部」部门节点。', 'WRONG_NODE_KIND');
    }
    const text = resolveDepartmentExecutionInput(node.id, ctx.nodes, ctx.edges, node.data.input ?? '');
    const t = text.trim();
    if (!t) {
      throw new BrainInputError(
        'PromptBrain 未收到输入：请将分镜部 Output 或含镜头表的 TEXT_NODE 连至 Input，或在详情中粘贴镜头 JSON。',
        'MISSING_BRIEF',
      );
    }

    if (t.includes('{') || t.includes('[')) {
      const parsed = safeJsonParse(t);
      if (parsed.ok && parsed.value != null) {
        const board = tryParseStoryboardOutput(parsed.value);
        if (board?.shots?.length) return t;
        if (
          typeof parsed.value === 'object' &&
          parsed.value !== null &&
          !Array.isArray(parsed.value)
        ) {
          const j = parsed.value as Record<string, unknown>;
          if (Array.isArray(j.scenes) && !Array.isArray(j.shots)) {
            throw new BrainInputError(
              '当前输入为编剧场次（scenes）而非镜头表（shots）。请将**分镜部**节点 Output 连入 Input，或粘贴镜头 JSON（shots 数组或根级镜头数组）。',
              'NEED_STORYBOARD_SHOTS',
            );
          }
          if (Array.isArray(j.shots) && j.shots.length === 0) {
            throw new BrainInputError(
              'JSON 中 shots 为空，无法生成逐镜工程化提示词。请检查分镜产出或连线。',
              'EMPTY_SHOTS',
            );
          }
        }
      }
    }

    if (t.length < 16) {
      throw new BrainInputError(
        '镜头简报过短，无法生成可用的标签化提示词。请连接分镜输出或补充描述。',
        'BRIEF_TOO_SHORT',
      );
    }

    return t;
  }

  static async execute(
    node: StudioRFNode,
    ctx: BrainExecuteContext,
    approvedAssets: ApprovedAsset[] = [],
  ): Promise<PromptOutput> {
    const text = this.validate(node, ctx);
    const mounted = Array.isArray(node.data.mounted_skills) ? node.data.mounted_skills : [];
    const { systemPrompt } = resolveAndComposeMountedSkills('prompt', PROMPT_DEPT_AGENT_SYSTEM, mounted);
    const composed = appendProjectContextForConsumer(systemPrompt, 'prompt');
    const executionSystemPrompt = `${composed}\n\n${this.FOCUS_INSTRUCTION}`;
    return runPromptEmployee(text, approvedAssets, executionSystemPrompt);
  }
}
