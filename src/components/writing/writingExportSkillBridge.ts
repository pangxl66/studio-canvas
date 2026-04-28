import { getSkillById } from '@/services/skillLoader';

export type WritingExportTemplateKind = 'standard' | 'vertical_short' | 'hollywood';

const VERTICAL_IDS = new Set(['writing/vertical_short_drama_v1']);
const HOLLYWOOD_IDS = new Set(['writing/film_feature_v1', 'writing/action_film_v1']);

/** 与 mounted_skills 顺序一致：先匹配的 Skill 决定导出模版 */
export function resolveWritingExportTemplate(mountedSkillIds: string[]): WritingExportTemplateKind {
  for (const id of mountedSkillIds) {
    if (VERTICAL_IDS.has(id)) return 'vertical_short';
  }
  for (const id of mountedSkillIds) {
    if (HOLLYWOOD_IDS.has(id)) return 'hollywood';
  }
  for (const id of mountedSkillIds) {
    const s = getSkillById(id);
    if (!s || s.folder !== 'writing') continue;
    if (/竖屏短剧|竖屏.*短剧|^短剧$/i.test(s.name)) return 'vertical_short';
    if (/电影长片|好莱坞.*剧本|长片电影/i.test(s.name)) return 'hollywood';
  }
  return 'standard';
}

export function writingExportTemplateLabel(kind: WritingExportTemplateKind): string {
  if (kind === 'vertical_short') return '竖屏短剧专用（约 1–2 分钟/页 节拍）';
  if (kind === 'hollywood') return '好莱坞标准剧本格式';
  return '标准文学剧本';
}
