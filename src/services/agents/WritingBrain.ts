import { runWritingEmployee } from '@/agents/writingAgents';
import { WRITING_DEPT_AGENT_SYSTEM } from '@/agents/writingDeptSpec';
import { resolveDepartmentExecutionInput } from '@/services/graphInput';
import { resolveAndComposeMountedSkills } from '@/services/skillLoader';
import type { StudioRFNode } from '@/types/reactFlow';
import type { WritingOutput } from '@/types/studio';
import { BrainExecuteContext, BrainInputError } from '@/services/agents/brainTypes';

/**
 * 编剧任务处理器：把长文本**结构化**为分集 + 场次 JSON 语义（与 WritingOutput 对齐）。
 */
export class WritingBrain {
  /**
   * 追加在部门 system 之后：强调集数、场次表字段与 JSON -only。
   */
  static readonly FOCUS_INSTRUCTION = `【WritingBrain · 结构化重点】
1. 将非结构化长文本拆解为可生产的「集—场」资产：plannedEpisodeCount、episodes[]、scenes[] 必须自洽。
2. 每场必须有明确场次标题、核心冲突（或 beat）、登场角色列表；集与场之间的 episodeId / episodeNo 必须可溯源。
3. 输出仅允许一个 JSON 对象，键名与业务 schema 一致，禁止散文式说明。`;

  /**
   * @returns 校验通过后的合并输入文本（与 executeTask 同源逻辑）
   * @throws BrainInputError 无素材时
   */
  static validate(node: StudioRFNode, ctx: BrainExecuteContext): string {
    if (node.type !== 'department' || node.data.type !== 'writing') {
      throw new BrainInputError('WritingBrain 仅处理「编剧部」部门节点。', 'WRONG_NODE_KIND');
    }
    const text = resolveDepartmentExecutionInput(node.id, ctx.nodes, ctx.edges, node.data.input ?? '');
    if (!text.trim()) {
      throw new BrainInputError(
        '缺少可用于结构化的素材：请从左侧 Input 连接 TEXT_NODE 并粘贴小说/IP 长文本，或在节点详情中填写正文后再执行。',
        'MISSING_SOURCE_TEXT',
      );
    }
    return text.trim();
  }

  /**
   * 先校验输入，再调用编剧员工逻辑（含挂载技能的 system 拼接）。
   */
  static async execute(node: StudioRFNode, ctx: BrainExecuteContext): Promise<WritingOutput> {
    const text = this.validate(node, ctx);
    const mounted = Array.isArray(node.data.mounted_skills) ? node.data.mounted_skills : [];
    const { systemPrompt } = resolveAndComposeMountedSkills('writing', WRITING_DEPT_AGENT_SYSTEM, mounted);
    const executionSystemPrompt = `${systemPrompt}\n\n${this.FOCUS_INSTRUCTION}`;
    return runWritingEmployee(text, executionSystemPrompt);
  }
}
