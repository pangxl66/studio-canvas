import { runPromptEmployee } from '@/agents/promptAgents';
import { PROMPT_DEPT_AGENT_SYSTEM } from '@/agents/promptDeptSpec';
import { resolveDepartmentExecutionInput } from '@/services/graphInput';
import { appendProjectContextForConsumer } from '@/services/ProjectContext';
import {
  resolveAndComposeMountedSkills,
  STUDIO_CANVAS_PROMPT_V23_SKILL_ID,
  STUDIO_CANVAS_PROMPT_V231_SEGMENTS_SKILL_ID,
  STUDIO_CANVAS_PROMPT_V25_SKILL_ID,
  STUDIO_CANVAS_PROMPT_V26_SKILL_ID,
  STUDIO_CANVAS_PROMPT_V27_SKILL_ID,
} from '@/services/skillLoader';
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

  static readonly V23_FOCUS_INSTRUCTION = `【PromptBrain · Studio Canvas 2.3 工程化重点】
1. seedanceCard 是完整 Studio Card；“提示词”字段是去重、消解冲突后的 Engine Prompt。
2. 严格保留 Studio Canvas 2.3 的18个全角冒号字段，四类钉子不得合并为旧版“钉子4行”。
3. dimensions 十维字段填满可检索关键词；shot_id、资产引用与源镜头严格对应。`;

  static readonly V231_SEGMENTS_FOCUS_INSTRUCTION = `【PromptBrain · Studio Canvas 2.3.1 组合镜头重点】
1. 完整保留 Studio Canvas 2.3 的 seedanceCard 与 Engine Prompt 双层结构。
2. mergedMembers 仍只生成一条连续 shotPrompt，但必须同步生成逐一对应源分镜的 shotSegments。
3. 每个 segment 的 image_prompt 只描述一个静态决定性关键帧，供影视分镜宫格直接读取；禁止时间线、运镜过程和音频描述。`;

  static readonly V25_FOCUS_INSTRUCTION = `【PromptBrain · Studio Canvas 2.5 生产校验重点】
1. seedanceCard 保持18字段 Studio Card；“提示词”是去重后的 Engine Prompt，不重复 Project Bible。
2. 挂载只允许真实独立资产，标记之间使用一个空格；禁止把场景内部结构、材质、灯具或参考图虚构成资产。
3. 内部按 HARD / SOFT / AUTO 消解冲突，检查伪精确数字、景别可见性、动作预算、连续时间轴、节拍映射和引擎适配。`;

  static readonly V26_FOCUS_INSTRUCTION = `【PromptBrain · Studio Canvas 2.6 详细挂载重点】
1. seedanceCard 保持18字段 Studio Card；“提示词”是去重后的 Engine Prompt。
2. 挂载使用无空格连续格式 |@=实体名||@=实体名|，按角色、交互道具、主场景、关键结构、设备、固定光源、环境介质、动作相关声音排列。
3. 普通镜头建议5至12项，复杂镜头最多15项；只挂载来自输入、Project Bible 或当前分镜且直接影响执行的具体实体，禁止装饰性膨胀。`;

  static readonly V27_FOCUS_INSTRUCTION = `【PromptBrain · Studio Canvas 2.7 摄影机参数匹配重点】
1. 完整继承2.6的18字段 Studio Card、无空格详细挂载和连续时间轴。
2. 每个镜头先判断主体任务、景别、空间任务、摄影机运动、光线环境和焦点职责，再匹配摄影机、主镜头体系、焦段、光圈与景深。
3. “镜头参数”必须使用【摄影机·镜头】机型+镜头体系或光学类型+焦段+光圈+景深（实焦主体、失焦层级与焦点变化）的完整句式；同一连续场景不得无理由切换摄影机和镜头品牌。
4. 若上游 StoryboardOutput 含 projectConstraints，必须继续继承到画幅、场景、灯光、镜头参数与 Engine Prompt，不得把它误写成剧情或台词。
5. V2.7 单镜挂载硬上限放宽为30项；15项以上仍须逐项来自输入或项目设定并具有执行价值，不得虚构或堆叠装饰项。`;

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
    const { systemPrompt, resolvedIds } = resolveAndComposeMountedSkills(
      'prompt',
      PROMPT_DEPT_AGENT_SYSTEM,
      mounted,
    );
    const composed = appendProjectContextForConsumer(systemPrompt, 'prompt');
    const focusInstruction = resolvedIds.includes(STUDIO_CANVAS_PROMPT_V231_SEGMENTS_SKILL_ID)
      ? this.V231_SEGMENTS_FOCUS_INSTRUCTION
      : resolvedIds.includes(STUDIO_CANVAS_PROMPT_V27_SKILL_ID)
        ? this.V27_FOCUS_INSTRUCTION
      : resolvedIds.includes(STUDIO_CANVAS_PROMPT_V26_SKILL_ID)
        ? this.V26_FOCUS_INSTRUCTION
      : resolvedIds.includes(STUDIO_CANVAS_PROMPT_V25_SKILL_ID)
        ? this.V25_FOCUS_INSTRUCTION
      : resolvedIds.includes(STUDIO_CANVAS_PROMPT_V23_SKILL_ID)
        ? this.V23_FOCUS_INSTRUCTION
        : this.FOCUS_INSTRUCTION;
    const executionSystemPrompt = `${composed}\n\n${focusInstruction}`;
    return runPromptEmployee(text, approvedAssets, executionSystemPrompt);
  }
}
