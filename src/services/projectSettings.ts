import {
  DEFAULT_PROMPT_STYLE_SKILL_ID,
  DEFAULT_STORYBOARD_SKILL_ID,
  normalizeSkillIdForPipelineKind,
} from '@/services/skillLoader';
import type { ProjectAspectRatio, ProjectSettings } from '@/types/studio';

export const DEFAULT_PROJECT_ASPECT_RATIO: ProjectAspectRatio = '16:9';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    schemaVersion: 1,
    revision: 0,
    aspectRatio: DEFAULT_PROJECT_ASPECT_RATIO,
    overallStyle: {
      enabled: true,
      text: '',
    },
    defaultSkills: {
      storyboardSkillId:
        normalizeSkillIdForPipelineKind('storyboard', DEFAULT_STORYBOARD_SKILL_ID)
        ?? DEFAULT_STORYBOARD_SKILL_ID,
      promptSkillId:
        normalizeSkillIdForPipelineKind('prompt', DEFAULT_PROMPT_STYLE_SKILL_ID)
        ?? DEFAULT_PROMPT_STYLE_SKILL_ID,
    },
  };
}

export function normalizeProjectAspectRatio(value: unknown): ProjectAspectRatio {
  return value === '9:16' || value === '21:9' ? value : DEFAULT_PROJECT_ASPECT_RATIO;
}

export function normalizeProjectSettings(value: unknown): ProjectSettings {
  const defaults = createDefaultProjectSettings();
  if (!isRecord(value)) return defaults;

  const style = isRecord(value.overallStyle) ? value.overallStyle : {};
  const skills = isRecord(value.defaultSkills) ? value.defaultSkills : {};
  const storyboardSkillId = normalizeSkillIdForPipelineKind(
    'storyboard',
    typeof skills.storyboardSkillId === 'string' ? skills.storyboardSkillId : undefined,
  );
  const promptSkillId = normalizeSkillIdForPipelineKind(
    'prompt',
    typeof skills.promptSkillId === 'string' ? skills.promptSkillId : undefined,
  );

  return {
    schemaVersion: 1,
    revision:
      typeof value.revision === 'number' && Number.isFinite(value.revision)
        ? Math.max(0, Math.floor(value.revision))
        : 0,
    aspectRatio: normalizeProjectAspectRatio(value.aspectRatio),
    overallStyle: {
      enabled: style.enabled !== false,
      text: typeof style.text === 'string' ? style.text.trim() : '',
    },
    defaultSkills: {
      storyboardSkillId: storyboardSkillId ?? defaults.defaultSkills.storyboardSkillId,
      promptSkillId: promptSkillId ?? defaults.defaultSkills.promptSkillId,
    },
  };
}

export function projectSettingsEqual(a: ProjectSettings, b: ProjectSettings): boolean {
  return (
    a.aspectRatio === b.aspectRatio
    && a.overallStyle.enabled === b.overallStyle.enabled
    && a.overallStyle.text.trim() === b.overallStyle.text.trim()
    && a.defaultSkills.storyboardSkillId === b.defaultSkills.storyboardSkillId
    && a.defaultSkills.promptSkillId === b.defaultSkills.promptSkillId
  );
}

/** 复用既有“项目约束”协议，防止全局风格被模型误当成剧情或台词。 */
export function appendProjectSettingsConstraint(
  input: string,
  settings: ProjectSettings | null | undefined,
): string {
  if (!settings) return input.trim();
  const normalized = normalizeProjectSettings(settings);
  const lines = [
    `目标画幅：${normalized.aspectRatio}。所有相关镜头必须按该画幅直接构图，不得按其他比例设计后简单拉伸。`,
  ];
  if (normalized.overallStyle.enabled && normalized.overallStyle.text.trim()) {
    lines.push(
      `整体风格（用户原文，必须继承，不得改写为剧情或台词）：${normalized.overallStyle.text.trim()}`,
    );
  }
  return `${input.trim()}\n\n【项目约束｜全局设定】\n${lines.join('\n')}`.trim();
}
