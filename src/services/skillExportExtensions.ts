import { getSkillById } from '@/services/skillLoader';
import type { SkillExportExtension, SkillExportExtensionCapability } from '@/types/skill';

const BY_NODE: Record<'writing' | 'storyboard' | 'prompt', ReadonlySet<SkillExportExtensionCapability>> = {
  writing: new Set(['writing_download']),
  storyboard: new Set(['storyboard_shotlist']),
  prompt: new Set(['prompt_copy_all', 'prompt_sync_video']),
};

export type MountedSkillExportItem = {
  skillId: string;
  skillName: string;
  ext: SkillExportExtension;
};

/** 按挂载顺序收集当前节点类型可用的「导出扩展」按钮配置 */
export function collectMountedSkillExportExtensions(
  mountedSkillIds: string[],
  nodeKind: 'writing' | 'storyboard' | 'prompt',
): MountedSkillExportItem[] {
  const allowed = BY_NODE[nodeKind];
  const out: MountedSkillExportItem[] = [];
  for (const skillId of mountedSkillIds) {
    const skill = getSkillById(skillId);
    if (!skill?.export_extensions?.length) continue;
    for (const ext of skill.export_extensions) {
      if (!allowed.has(ext.capability)) continue;
      out.push({ skillId, skillName: skill.name, ext });
    }
  }
  return out;
}
