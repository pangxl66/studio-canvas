import type { PromptOutput, PromptShotPack, StoryboardOutput } from '@/types/studio';
import { buildSeedanceCard, buildSeedanceCardsText } from '@/utils/storyboardSeedance';

export function formatPromptShotPack(sp: PromptShotPack): string {
  const dim = sp.dimensions;
  const dimLines = dim
    ? `\n十维：场景 ${dim.场景 ?? '—'} | 角色 ${dim.角色 ?? '—'} | 动作 ${dim.动作 ?? '—'} | 情感 ${dim.情感 ?? '—'} | 镜头 ${dim.镜头 ?? '—'} | 运镜 ${dim.运镜 ?? '—'} | 灯光 ${dim.灯光 ?? '—'} | 风格 ${dim.风格 ?? '—'} | 构图 ${dim.构图 ?? '—'} | 连贯性 ${dim.连贯性 ?? '—'}`
    : '';
  const ca = sp.character_asset_ids?.length ? `角色ID：${sp.character_asset_ids.join(', ')}` : '';
  const sa = sp.scene_asset_ids?.length ? `场景ID：${sp.scene_asset_ids.join(', ')}` : '';
  const assets = [ca, sa].filter(Boolean).join(' ｜ ');
  return `—— ${sp.shot_id} ——\nprompt:\n${sp.prompt}\nnegative_prompt:\n${sp.negative_prompt}${dimLines}${assets ? `\n${assets}` : ''}`;
}

export function formatSeedanceShotPack(sp: PromptShotPack, storyboardShot?: StoryboardOutput['shots'][number]): string {
  if (sp.seedanceCard?.trim()) return sp.seedanceCard.trim();
  if (!storyboardShot) {
    return buildSeedanceCard({
      id: Number(sp.shot_id.replace(/[^\d]/g, '')) || 1,
      type: sp.dimensions?.镜头 || '中景',
      movement: sp.dimensions?.运镜 || '固定',
      description: sp.prompt,
      content: '',
    }, sp);
  }
  return buildSeedanceCard(storyboardShot, sp);
}

export function formatSeedanceCards(
  shotPrompts: PromptShotPack[],
  storyboard: StoryboardOutput | null,
): string {
  return buildSeedanceCardsText(shotPrompts, storyboard);
}

/** system / user / negative / parameters（不含逐镜 shotPrompts） */
export function formatPromptGlobal(o: PromptOutput): string {
  const params = Object.entries(o.parameters)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `【system】\n${o.system}\n\n【user】\n${o.userTemplate}\n\n【negative】\n${o.negative ?? '—'}\n\n【parameters】\n${params}`;
}

export function formatPrompt(o: PromptOutput): string {
  const shots =
    Array.isArray(o.shotPrompts) && o.shotPrompts.length > 0
      ? o.shotPrompts.map((sp) => formatPromptShotPack(sp)).join('\n\n')
      : '';
  return `${formatPromptGlobal(o)}${shots ? `\n\n【shotPrompts】\n${shots}` : ''}`;
}
