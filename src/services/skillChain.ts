import { getSkillById } from '@/services/skillLoader';

export type PipelineKindForChain = 'writing' | 'storyboard' | 'prompt';

export type SkillChainRule = {
  from: PipelineKindForChain;
  to: PipelineKindForChain;
  /** 上游已挂载的 skill id 任一命中即触发 */
  whenUpstreamHas: string[];
  /** 写入下游的 skill id（按声明顺序，去重） */
  mountOnDownstream: string[];
};

/**
 * Skill Chain：跨部门拉线创建下游节点时，根据上游已挂载技能自动挂载对应下游技能，
 * 使审美/类型在流水线中一致；另继承上游的 `prompt/*` 增强类技能。
 */
export const SKILL_CHAIN_RULES: SkillChainRule[] = [
  {
    from: 'writing',
    to: 'storyboard',
    whenUpstreamHas: ['writing/action_film_v1'],
    mountOnDownstream: ['storyboard/fast_paced_action_v1'],
  },
  {
    from: 'writing',
    to: 'storyboard',
    whenUpstreamHas: ['writing/cyberpunk_ip_v1'],
    mountOnDownstream: ['storyboard/cyberpunk_style'],
  },
  {
    from: 'storyboard',
    to: 'prompt',
    whenUpstreamHas: ['storyboard/fast_paced_action_v1', 'storyboard/action_movie'],
    mountOnDownstream: ['prompt/action_video_pack_v1'],
  },
];

/**
 * 从上游节点推导下游初始 `mounted_skills`：
 * 1. 按 SKILL_CHAIN_RULES 追加匹配的下游技能；
 * 2. 继承上游所有 `prompt/` 技能（增强类沿链传递）。
 * 不自动复制上游的 writing/*、storyboard/* 到下游（避免错部门语义），仅走显式链规则。
 */
export function mergeDownstreamSkillsFromChain(
  upstreamMounted: string[] | undefined,
  upstreamKind: PipelineKindForChain,
  downstreamKind: PipelineKindForChain,
): string[] {
  const upstream = upstreamMounted ?? [];
  const result: string[] = [];
  const seen = new Set<string>();

  const add = (id: string) => {
    if (seen.has(id)) return;
    if (!getSkillById(id)) return;
    seen.add(id);
    result.push(id);
  };

  for (const rule of SKILL_CHAIN_RULES) {
    if (rule.from !== upstreamKind || rule.to !== downstreamKind) continue;
    if (!rule.whenUpstreamHas.some((id) => upstream.includes(id))) continue;
    for (const id of rule.mountOnDownstream) add(id);
  }

  for (const id of upstream) {
    if (id.startsWith('prompt/')) add(id);
  }

  return result;
}
