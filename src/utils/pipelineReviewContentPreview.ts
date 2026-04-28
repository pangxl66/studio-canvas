import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import { formatWritingDataDump } from '@/components/writing/writingScriptPreview';
import type { PromptOutput, StoryboardOutput, StudioNodeData, WritingOutput } from '@/types/studio';
import { formatPrompt } from '@/utils/promptFormat';

function isWritingOutput(o: unknown): o is WritingOutput {
  if (!o || typeof o !== 'object') return false;
  const x = o as WritingOutput;
  return Array.isArray(x.episodes) && Array.isArray(x.scenes);
}

function isPromptOutput(o: unknown): o is PromptOutput {
  if (!o || typeof o !== 'object') return false;
  const x = o as PromptOutput;
  return (
    typeof x.system === 'string' &&
    typeof x.userTemplate === 'string' &&
    x.parameters != null &&
    typeof x.parameters === 'object'
  );
}

function formatStoryboardCompare(o: StoryboardOutput): string {
  const lines = o.shots.map((s) => {
    const act = typeof s.action === 'string' && s.action.trim() !== '' ? s.action : '';
    const dlg = typeof s.content === 'string' ? s.content : '';
    const dlgLine = dlg !== '' ? `\n台词：${dlg}` : '';
    return `#${s.id} [${s.type}] 运镜：${s.movement}\n动作：${act || '—'}\n${s.description}${dlgLine}${s.sceneRef ? `  (${s.sceneRef})` : ''}`;
  });
  return [...o.narrativeBeats.map((b) => `· ${b}`), '', ...lines].join('\n');
}

const DEFAULT_MAX = 14000;

/** 调用大模型「执行优化」时的当前版本全文上限（字符） */
export const REVIEW_OPTIMIZATION_CONTENT_MAX_CHARS = 600_000;

/** 构造优化迭代用户 Prompt 中的「当前版本内容」段落（尽量完整、少截断） */
export function formatReviewOptimizationPayload(node: StudioNodeData): string {
  return formatReviewedNodeCurrentContent(node, REVIEW_OPTIMIZATION_CONTENT_MAX_CHARS);
}

/** 已阅态对比视图：左侧「当前产出」纯文本摘要 */
export function formatReviewedNodeCurrentContent(node: StudioNodeData, maxChars = DEFAULT_MAX): string {
  if (node.type === 'writing' && node.output && isWritingOutput(node.output)) {
    try {
      const t = formatWritingDataDump(node.output);
      return t.length > maxChars ? `${t.slice(0, maxChars)}\n\n…（已截断，完整内容见下方工作区）` : t;
    } catch {
      return '（剧本数据格式异常）';
    }
  }
  if (node.type === 'storyboard' && node.output) {
    const sb = tryParseStoryboardOutput(node.output);
    if (sb) {
      try {
        const t = formatStoryboardCompare(sb);
        return t.length > maxChars ? `${t.slice(0, maxChars)}\n\n…（已截断）` : t;
      } catch {
        return '（分镜数据格式异常）';
      }
    }
    return '（分镜产出无法解析）';
  }
  if (node.type === 'prompt' && node.output && isPromptOutput(node.output)) {
    try {
      const t = formatPrompt(node.output);
      return t.length > maxChars ? `${t.slice(0, maxChars)}\n\n…（已截断）` : t;
    } catch {
      return '（Prompt 数据格式异常）';
    }
  }
  return '（暂无结构化产出可展示）';
}

/**
 * 将总监反馈拆成「修改建议点」列表：优先识别项目符号 / 编号行，否则按段或整段展示。
 */
export function suggestionPointsFromFeedback(text: string): string[] {
  const raw = text.trim();
  if (!raw) return ['（无具体建议文案）'];
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const bulletLike = lines.filter(
    (l) =>
      /^[-•*·‧]\s*\S/.test(l) ||
      /^\d+[.)]\s+\S/.test(l) ||
      /^[（(]?\d+[）)]\s*\S/.test(l),
  );
  if (bulletLike.length >= 2) {
    return bulletLike.map((l) =>
      l
        .replace(/^[-•*·‧]\s*/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^[（(]?\d+[）)]\s*/, ''),
    );
  }
  if (lines.length >= 2) return lines;
  return [raw];
}
