import { Handle, Position, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import {
  applyScriptAiPromptQuality,
  analyzeScriptArtDirectionOutputs,
  analyzeScriptProductionOutputs,
  analyzeScriptVfxOutputs,
  analyzeScriptWorldbuildingOutputs,
  isScriptBreakdownOutput,
  isScriptScenesOutput,
  analyzeScriptTimelineOutputs,
  reviewScriptBreakdownOutputs,
} from '@/services/scriptBreakdownEngine';
import { generateScriptAiPromptsWithLlm } from '@/services/scriptAiPromptLlm';
import { analyzeScriptPackageWithLlm, splitScriptPackageOutput } from '@/services/scriptBreakdownLlm';
import { useStudioStore } from '@/store/useStudioStore';
import type {
  ScriptAiAssetsOutput,
  ScriptAiAssetPlatform,
  ScriptAiPromptAsset,
  ScriptBreakdownOutput,
  ScriptCharactersOutput,
  ScriptPackageOutput,
  ScriptPropsOutput,
  ScriptScenesOutput,
} from '@/types/scriptBreakdown';
import type { StudioRFNode } from '@/types/reactFlow';
import type { StudioNodeData } from '@/types/studio';

type ScriptInputRF = Node<StudioNodeData, 'scriptInput'>;
type ScriptAnalyzerRF = Node<StudioNodeData, 'scriptAnalyzer'>;
type ScriptOutputRF = Node<StudioNodeData, 'scriptOutput'>;

export const SCRIPT_INPUT_HANDLE_ID = 'in';
export const SCRIPT_OUTPUT_HANDLE_ID = 'out';

type ScriptAnalyzerKind =
  | 'script_scene_node'
  | 'script_character_node'
  | 'script_prop_node'
  | 'script_review_node'
  | 'script_timeline_node'
  | 'script_art_node'
  | 'script_vfx_node'
  | 'script_world_node'
  | 'script_production_node'
  | 'script_ai_assets_node';

type CorePromptKind = 'scene_prompt' | 'character_prompt' | 'prop_prompt';

const ANALYZER_CONFIG: Record<
  ScriptAnalyzerKind,
  {
    eyebrow: string;
    title: string;
    action: string;
    empty: string;
    badge: (output: ScriptBreakdownOutput | null) => string;
  }
> = {
  script_scene_node: {
    eyebrow: 'SCENE',
    title: '场景拆解',
    action: '生成AI提示词',
    empty: '先在剧本输入节点点击“剧本拆解”；生成场景结果后，可在这里生成影视级场景提示词。',
    badge: (output) => (output?.module === 'script_scenes' ? `${output.scenes.length} 场` : '待运行'),
  },
  script_character_node: {
    eyebrow: 'CAST',
    title: '角色分析',
    action: '生成AI提示词',
    empty: '先在剧本输入节点点击“剧本拆解”；生成角色结果后，可在这里生成影视级角色提示词。',
    badge: (output) => (output?.module === 'script_characters' ? `${output.characters.length} 角色` : '待运行'),
  },
  script_prop_node: {
    eyebrow: 'PROP',
    title: '道具分析',
    action: '生成AI提示词',
    empty: '先在剧本输入节点点击“剧本拆解”；生成道具结果后，可在这里生成影视级道具提示词。',
    badge: (output) => (output?.module === 'script_props' ? `${output.props.length} 道具` : '待运行'),
  },
  script_review_node: {
    eyebrow: 'QA',
    title: '质量复核',
    action: '复核结果',
    empty: '连接拆解汇总节点后，检查缺失字段、低置信度和生产风险。',
    badge: (output) => (output?.module === 'script_review' ? `${output.stats.issueCount} 问题` : '待运行'),
  },
  script_timeline_node: {
    eyebrow: 'TIME',
    title: '时间线分析',
    action: '生成时间线',
    empty: '连接拆解汇总节点后，按场次顺序推定故事日、时间点和跨日风险。',
    badge: (output) => (output?.module === 'script_timeline' ? `${output.stats.eventCount} 事件` : '待运行'),
  },
  script_art_node: {
    eyebrow: 'ART',
    title: '美术分析',
    action: '生成美术表',
    empty: '连接拆解汇总节点后，提取置景、环境、灯光、色彩和美术复杂度。',
    badge: (output) => (output?.module === 'script_art' ? `${output.stats.requirementCount} 项` : '待运行'),
  },
  script_vfx_node: {
    eyebrow: 'VFX',
    title: 'VFX分析',
    action: '生成VFX表',
    empty: '连接拆解汇总节点后，提取火焰、爆破、烟雾、血浆、怪物和数字合成需求。',
    badge: (output) => (output?.module === 'script_vfx' ? `${output.stats.requirementCount} 项` : '待运行'),
  },
  script_world_node: {
    eyebrow: 'WORLD',
    title: '世界观分析',
    action: '生成世界观',
    empty: '连接拆解汇总节点后，推断时代、文明、势力、宗教、技术和语言风格。',
    badge: (output) => (output?.module === 'script_world' ? `${output.stats.factionCount} 势力` : '待运行'),
  },
  script_production_node: {
    eyebrow: 'PROD',
    title: '制片统筹',
    action: '生成统筹表',
    empty: '连接拆解汇总节点后，提取场景、演员、道具、夜外景、天气、动作和 VFX 统筹事项。',
    badge: (output) =>
      output?.module === 'script_production' ? `${output.stats.requirementCount} 项` : '待运行',
  },
  script_ai_assets_node: {
    eyebrow: 'ASSET',
    title: 'AI资产生成',
    action: '生成资产',
    empty: '连接拆解汇总节点后，生成 Midjourney / GPT Image 2 / Nano Banana 三平台影视级概念设计 Prompt。',
    badge: (output) => (output?.module === 'script_ai_assets' ? `${output.stats.assetCount} 条` : '待运行'),
  },
};

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : '剧本拆解失败。';
}

function incomingNodes(nodeId: string, nodes: StudioRFNode[], edges: Edge[]): StudioRFNode[] {
  const incoming = edges
    .filter((edge) => edge.target === nodeId && (edge.targetHandle == null || edge.targetHandle === SCRIPT_INPUT_HANDLE_ID))
    .sort((a, b) => a.source.localeCompare(b.source));
  return incoming
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is StudioRFNode => Boolean(node));
}

function dataText(data: StudioNodeData): string | null {
  if (data.type === 'text_node' || data.type === 'script_input_node') {
    const text = (data.raw_text ?? data.input ?? '').trim();
    return text || null;
  }
  if (isScriptScenesOutput(data.output)) {
    const text = data.output.scenes.map((scene) => scene.sourceText).filter(Boolean).join('\n\n');
    return text.trim() || null;
  }
  if (isScriptBreakdownOutput(data.output) && data.output.module === 'script_package') {
    const text = data.output.scenes.map((scene) => scene.sourceText).filter(Boolean).join('\n\n');
    return text.trim() || null;
  }
  const input = (data.input ?? '').trim();
  if (input) return input;
  return null;
}

function resolveScriptText(nodeId: string, nodes: StudioRFNode[], edges: Edge[]): string | null {
  const direct = incomingNodes(nodeId, nodes, edges)
    .map((node) => dataText(node.data))
    .filter((text): text is string => Boolean(text?.trim()));
  if (direct.length > 0) return direct.join('\n\n');

  const node = nodes.find((item) => item.id === nodeId);
  return node ? dataText(node.data) : null;
}

function resolveScriptTextDeep(nodeId: string, nodes: StudioRFNode[], edges: Edge[]): string | null {
  const visited = new Set<string>();
  const collect = (id: string): string[] => {
    if (visited.has(id)) return [];
    visited.add(id);
    const upstream = incomingNodes(id, nodes, edges);
    const upstreamTexts = upstream.flatMap((node) => collect(node.id)).filter((text) => text.trim());
    if (upstreamTexts.length > 0) return upstreamTexts;
    const node = nodes.find((item) => item.id === id);
    const ownText = node ? dataText(node.data) : null;
    return ownText?.trim() ? [ownText] : [];
  };
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const text of collect(nodeId)) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(text.trim());
  }
  return deduped.length ? deduped.join('\n\n') : resolveScriptText(nodeId, nodes, edges);
}

function collectScriptOutputs(nodeId: string, nodes: StudioRFNode[], edges: Edge[]): ScriptBreakdownOutput[] {
  return incomingNodes(nodeId, nodes, edges)
    .map((node) => node.data.output)
    .filter(isScriptBreakdownOutput);
}

function collectScriptOutputsDeep(nodeId: string, nodes: StudioRFNode[], edges: Edge[]): ScriptBreakdownOutput[] {
  const visited = new Set<string>();
  const outputs: ScriptBreakdownOutput[] = [];
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const node of incomingNodes(id, nodes, edges)) {
      if (isScriptBreakdownOutput(node.data.output)) outputs.push(node.data.output);
      walk(node.id);
    }
  };
  walk(nodeId);
  return outputs;
}

function upstreamNodesDeep(nodeId: string, nodes: StudioRFNode[], edges: Edge[]): StudioRFNode[] {
  const visited = new Set<string>();
  const result: StudioRFNode[] = [];
  const walk = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const node of incomingNodes(id, nodes, edges)) {
      result.push(node);
      walk(node.id);
    }
  };
  walk(nodeId);
  return result;
}

function inProgressUpstream(nodeId: string, nodes: StudioRFNode[], edges: Edge[]): StudioRFNode | null {
  return upstreamNodesDeep(nodeId, nodes, edges).find((node) => node.data.status === 'IN_PROGRESS') ?? null;
}

function describeScriptNode(node: StudioRFNode): string {
  const type = node.data.type;
  if (type === 'script_input_node') return '剧本输入';
  if (type === 'script_scene_node') return '场景拆解';
  if (type === 'script_character_node') return '角色分析';
  if (type === 'script_prop_node') return '道具分析';
  if (type === 'script_output_node') return '拆解汇总';
  return typeof node.data.title === 'string' && node.data.title.trim() ? node.data.title.trim() : '上游节点';
}

function compactEvidence(value: string, max = 120): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function charactersFromScenesOutput(
  sceneOutput: ScriptScenesOutput,
  sourceNodeId?: string,
): ScriptCharactersOutput | null {
  const byName = new Map<string, ScriptCharactersOutput['characters'][number]>();
  for (const scene of sceneOutput.scenes) {
    for (const name of scene.characters) {
      const cleanName = name.trim();
      if (!cleanName) continue;
      const current =
        byName.get(cleanName) ??
        ({
          id: `character_from_scene_${byName.size + 1}`,
          name: cleanName,
          aliases: [],
          firstSceneNo: scene.sceneNo,
          sceneNos: [],
          actionHints: [],
          dialogueCount: 0,
          evidence: [],
          confidence: 'medium',
          warnings: ['由上游场景 API 结果同步，建议核对角色身份和出场证据。'],
        } satisfies ScriptCharactersOutput['characters'][number]);
      if (!current.sceneNos.includes(scene.sceneNo)) current.sceneNos.push(scene.sceneNo);
      if (current.evidence.length < 4) {
        current.evidence.push({ sceneNo: scene.sceneNo, excerpt: compactEvidence(scene.sourceText || scene.summary) });
      }
      if (current.actionHints.length < 4 && scene.summary) current.actionHints.push(compactEvidence(scene.summary));
      byName.set(cleanName, current);
    }
  }
  const characters = [...byName.values()].map((character) => ({
    ...character,
    sceneNos: [...character.sceneNos].sort((a, b) => a - b),
  }));
  if (!characters.length) return null;
  const warnings = [...new Set(characters.flatMap((character) => character.warnings))];
  return {
    module: 'script_characters',
    createdAt: Date.now(),
    sourceNodeId,
    characters,
    warnings,
    stats: {
      sourceLength: sceneOutput.stats.sourceLength,
      characterCount: characters.length,
      warningCount: warnings.length,
    },
  };
}

function propsFromScenesOutput(sceneOutput: ScriptScenesOutput, sourceNodeId?: string): ScriptPropsOutput | null {
  const byName = new Map<string, ScriptPropsOutput['props'][number]>();
  for (const scene of sceneOutput.scenes) {
    for (const name of scene.props) {
      const cleanName = name.trim();
      if (!cleanName) continue;
      const current =
        byName.get(cleanName) ??
        ({
          id: `prop_from_scene_${byName.size + 1}`,
          name: cleanName,
          category: '其他',
          sceneNos: [],
          notes: ['由上游场景 API 结果同步。'],
          evidence: [],
          confidence: 'medium',
          warnings: ['由上游场景 API 结果同步，建议核对道具类别和连续性。'],
        } satisfies ScriptPropsOutput['props'][number]);
      if (!current.sceneNos.includes(scene.sceneNo)) current.sceneNos.push(scene.sceneNo);
      if (current.evidence.length < 4) {
        current.evidence.push({ sceneNo: scene.sceneNo, excerpt: compactEvidence(scene.sourceText || scene.summary) });
      }
      byName.set(cleanName, current);
    }
  }
  const props = [...byName.values()].map((prop) => ({
    ...prop,
    sceneNos: [...prop.sceneNos].sort((a, b) => a - b),
  }));
  if (!props.length) return null;
  const warnings = [...new Set(props.flatMap((prop) => prop.warnings))];
  return {
    module: 'script_props',
    createdAt: Date.now(),
    sourceNodeId,
    props,
    warnings,
    stats: {
      sourceLength: sceneOutput.stats.sourceLength,
      propCount: props.length,
      warningCount: warnings.length,
    },
  };
}

function reusableCoreOutputFromUpstream(
  kind: 'script_scene_node' | 'script_character_node' | 'script_prop_node',
  outputs: ScriptBreakdownOutput[],
  sourceNodeId?: string,
): ScriptScenesOutput | ScriptCharactersOutput | ScriptPropsOutput | null {
  const packageOutput = outputs.find((output): output is ScriptPackageOutput => output.module === 'script_package');
  if (packageOutput) return outputFromPackageForKind(packageOutput, kind, sourceNodeId);

  if (kind === 'script_scene_node') {
    return outputs.find((output): output is ScriptScenesOutput => output.module === 'script_scenes') ?? null;
  }
  if (kind === 'script_character_node') {
    const direct = outputs.find((output): output is ScriptCharactersOutput => output.module === 'script_characters');
    if (direct) return direct;
    const sceneOutput = outputs.find((output): output is ScriptScenesOutput => output.module === 'script_scenes');
    return sceneOutput ? charactersFromScenesOutput(sceneOutput, sourceNodeId) : null;
  }
  const direct = outputs.find((output): output is ScriptPropsOutput => output.module === 'script_props');
  if (direct) return direct;
  const sceneOutput = outputs.find((output): output is ScriptScenesOutput => output.module === 'script_scenes');
  return sceneOutput ? propsFromScenesOutput(sceneOutput, sourceNodeId) : null;
}

function outputWarningCount(output: ScriptBreakdownOutput | null): number {
  return output?.warnings?.length ?? 0;
}

function previewLines(output: ScriptBreakdownOutput | null): string[] {
  if (!output) return [];
  if (output.module === 'script_scenes') {
    return output.scenes.slice(0, 3).map((scene) => `场${scene.sceneNo} ${scene.location} · ${scene.timeOfDay}`);
  }
  if (output.module === 'script_characters') {
    return output.characters.slice(0, 4).map((character) => `${character.name} · 场${character.sceneNos.join('/')}`);
  }
  if (output.module === 'script_props') {
    return output.props.slice(0, 4).map((prop) => `${prop.name} · ${prop.category} · 场${prop.sceneNos.join('/')}`);
  }
  if (output.module === 'script_review') {
    return output.issues.slice(0, 4).map((item) => `${item.target} · ${item.summary}`);
  }
  if (output.module === 'script_timeline') {
    return output.events
      .slice(0, 4)
      .map((event) => `场${event.sceneNo} · ${event.storyDay} · ${event.timeOfDay} · ${event.location}`);
  }
  if (output.module === 'script_art') {
    return output.requirements
      .slice(0, 4)
      .map((item) => `场${item.sceneNo} · ${item.mood} · ${item.complexity}`);
  }
  if (output.module === 'script_vfx') {
    return output.requirements
      .slice(0, 4)
      .map((item) => `场${item.sceneNo} · ${item.effectType} · ${item.complexity}`);
  }
  if (output.module === 'script_world') {
    return [
      `${output.era} · ${output.technologyLevel}`,
      `${output.civilization}`,
      `势力：${output.factions.slice(0, 4).join('、') || '待确认'}`,
    ];
  }
  if (output.module === 'script_production') {
    return output.requirements
      .slice(0, 4)
      .map((item) => `场${item.sceneNo} · ${item.title} · ${item.complexity}`);
  }
  if (output.module === 'script_ai_assets') {
    return output.assets
      .slice(0, 4)
      .map((item) => `${item.title} · ${item.platform} · ${item.kind}`);
  }
  return [
    `场景 ${output.stats.sceneCount}`,
    `角色 ${output.stats.characterCount}`,
    `道具 ${output.stats.propCount}`,
  ];
}

function packageToText(output: ScriptPackageOutput): string {
  const lines: string[] = [
    `场景：${output.scenes.length}`,
    `角色：${output.characters.length}`,
    `道具：${output.props.length}`,
    '',
    '【场景】',
    ...output.scenes.map(
      (scene) =>
        `场${scene.sceneNo} ${scene.location} ${scene.interiorExterior} ${scene.timeOfDay}｜角色：${scene.characters.join('、') || '待确认'}｜道具：${scene.props.join('、') || '无'}`,
    ),
    '',
    '【角色】',
    ...output.characters.map((character) => `${character.name}｜场${character.sceneNos.join('、')}｜对白 ${character.dialogueCount}`),
    '',
    '【道具】',
    ...output.props.map((prop) => `${prop.name}｜${prop.category}｜场${prop.sceneNos.join('、')}`),
  ];
  return lines.join('\n');
}

function isCoreScriptAnalyzerKind(
  kind: ScriptAnalyzerKind,
): kind is 'script_scene_node' | 'script_character_node' | 'script_prop_node' {
  return kind === 'script_scene_node' || kind === 'script_character_node' || kind === 'script_prop_node';
}

function outputFromPackageForKind(
  output: ScriptPackageOutput,
  kind: 'script_scene_node' | 'script_character_node' | 'script_prop_node',
  sourceNodeId?: string,
): ScriptScenesOutput | ScriptCharactersOutput | ScriptPropsOutput {
  const split = splitScriptPackageOutput(output, sourceNodeId);
  if (kind === 'script_scene_node') return split.scenesOutput;
  if (kind === 'script_character_node') return split.charactersOutput;
  return split.propsOutput;
}

function promptKindForCoreAnalyzer(kind: ScriptAnalyzerKind): CorePromptKind | null {
  if (kind === 'script_scene_node') return 'scene_prompt';
  if (kind === 'script_character_node') return 'character_prompt';
  if (kind === 'script_prop_node') return 'prop_prompt';
  return null;
}

function promptTargetLabel(kind: ScriptAnalyzerKind): string {
  if (kind === 'script_scene_node') return '场景';
  if (kind === 'script_character_node') return '角色';
  if (kind === 'script_prop_node') return '道具';
  return 'AI';
}

function filterAiAssetsOutputForCore(
  output: ScriptAiAssetsOutput,
  kind: 'script_scene_node' | 'script_character_node' | 'script_prop_node',
): ScriptAiAssetsOutput {
  const promptKind = promptKindForCoreAnalyzer(kind);
  const assets = promptKind ? output.assets.filter((asset) => asset.kind === promptKind) : output.assets;
  const warnings = [...new Set(assets.flatMap((asset) => [...asset.warnings, ...(asset.qualityIssues ?? [])]))];
  const qualityIssueCount = assets.reduce((total, asset) => total + (asset.qualityIssues?.length ?? 0), 0);
  const scenePromptCount = assets.filter((asset) => asset.kind === 'scene_prompt').length;
  const characterPromptCount = assets.filter((asset) => asset.kind === 'character_prompt').length;
  const propPromptCount = assets.filter((asset) => asset.kind === 'prop_prompt').length;
  const cinematicPromptCount = assets.filter((asset) => asset.kind === 'cinematic_prompt').length;
  const platformCount = new Set(assets.map((asset) => asset.platform)).size;
  const label = promptTargetLabel(kind);
  return {
    ...output,
    assets,
    summary: assets.length
      ? `已生成 ${assets.length} 条${label} AI 提示词，覆盖 ${platformCount} 个平台（Midjourney / GPT Image 2 / Nano Banana），质检${qualityIssueCount ? `发现 ${qualityIssueCount} 个问题` : '通过'}。`
      : `暂无可生成的${label} AI 提示词。`,
    warnings,
    stats: {
      ...output.stats,
      assetCount: assets.length,
      scenePromptCount,
      characterPromptCount,
      propPromptCount,
      cinematicPromptCount,
      platformCount,
      qualityIssueCount,
      warningCount: warnings.length,
    },
  };
}

const SCRIPT_AI_PLATFORM_OPTIONS: Array<{ value: ScriptAiAssetPlatform; label: string }> = [
  { value: 'midjourney', label: 'MJ' },
  { value: 'nanobanana', label: 'Nano' },
  { value: 'gpt_image_2', label: 'Image2' },
];

function normalizeScriptAiAssetPlatform(value: unknown): ScriptAiAssetPlatform {
  if (value === 'midjourney' || value === 'nanobanana' || value === 'gpt_image_2') return value;
  return 'midjourney';
}

function scriptAiPlatformName(platform: ScriptAiAssetPlatform): string {
  if (platform === 'midjourney') return 'Midjourney';
  if (platform === 'nanobanana') return 'Nano Banana';
  return 'GPT Image 2';
}

function scriptAiAssetKindLabel(kind: ScriptAiPromptAsset['kind']): string {
  if (kind === 'scene_prompt') return 'Scene';
  if (kind === 'character_prompt') return 'Character';
  if (kind === 'prop_prompt') return 'Prop';
  if (kind === 'cinematic_prompt') return 'Cinematic';
  if (kind === 'lighting_prompt') return 'Lighting';
  return 'Style';
}

function scriptAiAssetTarget(asset: ScriptAiPromptAsset): string {
  if (asset.sceneNo != null) return `Scene ${asset.sceneNo}`;
  if (asset.characterName?.trim()) return asset.characterName.trim();
  return scriptAiAssetKindLabel(asset.kind);
}

function rebuildScriptAiAssetsOutput(output: ScriptAiAssetsOutput, assets: ScriptAiPromptAsset[]): ScriptAiAssetsOutput {
  const warnings = [...new Set(assets.flatMap((asset) => [...asset.warnings, ...(asset.qualityIssues ?? [])]))];
  const qualityIssueCount = assets.reduce((total, asset) => total + (asset.qualityIssues?.length ?? 0), 0);
  return {
    ...output,
    assets,
    warnings,
    stats: {
      ...output.stats,
      assetCount: assets.length,
      scenePromptCount: assets.filter((asset) => asset.kind === 'scene_prompt').length,
      characterPromptCount: assets.filter((asset) => asset.kind === 'character_prompt').length,
      propPromptCount: assets.filter((asset) => asset.kind === 'prop_prompt').length,
      cinematicPromptCount: assets.filter((asset) => asset.kind === 'cinematic_prompt').length,
      platformCount: new Set(assets.map((asset) => asset.platform)).size,
      qualityIssueCount,
      warningCount: warnings.length,
    },
  };
}

function updateScriptAiAssetPrompt(
  output: ScriptAiAssetsOutput,
  assetId: string,
  prompt: string,
): ScriptAiAssetsOutput {
  const assets = output.assets.map((asset) =>
    asset.id === assetId
      ? applyScriptAiPromptQuality({
          ...asset,
          prompt,
          updatedAt: Date.now(),
        })
      : asset,
  );
  return rebuildScriptAiAssetsOutput(output, assets);
}

async function runScriptPromptAssetsForNode(nodeId: string): Promise<boolean> {
  const state = useStudioStore.getState();
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'scriptAnalyzer') return false;
  const kind = node.data.type as ScriptAnalyzerKind;
  if (!isCoreScriptAnalyzerKind(kind)) return false;
  const sourceOutput = isScriptBreakdownOutput(node.data.output) ? node.data.output : null;
  const label = promptTargetLabel(kind);
  if (!sourceOutput) {
    const message = `请先在「剧本输入」节点点击“剧本拆解”，生成${label}分析结果后再生成 AI 提示词。`;
    state.patchNodeData(nodeId, { generation_error: message, streaming_preview: '' }, false);
    state.pushMessage({ role: 'system', text: message, nodeId });
    return false;
  }

  state.patchNodeData(
    nodeId,
    {
      status: 'IN_PROGRESS',
      generation_error: '',
      streaming_preview: `正在通过 /api/llm/chat 调用 LLM 生成${label} AI 提示词...`,
    },
    false,
  );

  try {
    const startedAt = Date.now();
    const output = filterAiAssetsOutputForCore(
      await generateScriptAiPromptsWithLlm({ outputs: [sourceOutput], promptKind: promptKindForCoreAnalyzer(kind) ?? undefined }),
      kind,
    );
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (output.assets.length === 0) {
      throw new Error(`当前${label}结果里没有可生成提示词的条目。`);
    }

    const assetNodeId = useStudioStore.getState().addScriptAiAssetsNodeFromSource(nodeId);
    if (!assetNodeId) throw new Error('创建 AI 资产节点失败，请重新选择节点后再试。');

    const latest = useStudioStore.getState();
    latest.patchNodeData(
      assetNodeId,
      {
        output,
        input: output.assets.map((item) => `${item.platform} ${item.kind} ${item.title}`).join('\n'),
        inputSource: 'graph',
        status: 'APPROVED',
        generation_error: '',
        streaming_preview: '',
        review_result: `${output.summary} LLM 耗时 ${elapsedSeconds} 秒。`,
      },
      true,
    );
    latest.patchNodeData(
      nodeId,
      {
        status: 'APPROVED',
        generation_error: '',
        streaming_preview: '',
        review_result: `${label} AI 提示词已通过 LLM 生成到右侧「AI资产生成」节点（耗时 ${elapsedSeconds} 秒）。`,
      },
      false,
    );
    latest.pushMessage({
      role: 'system',
      text: `${label} AI 提示词生成完成：LLM 已通过 /api/llm/chat 返回 ${output.stats.assetCount} 条，耗时 ${elapsedSeconds} 秒。`,
      nodeId: assetNodeId,
    });
    latest.focusNode(assetNodeId, { openDetail: true });
    return true;
  } catch (error) {
    const message = readableError(error);
    useStudioStore.getState().patchNodeData(
      nodeId,
      {
        status: 'APPROVED',
        generation_error: `AI 提示词生成失败：${message}`,
        streaming_preview: '',
        review_result: null,
      },
      false,
    );
    useStudioStore.getState().pushMessage({ role: 'system', text: `AI 提示词生成失败：${message}`, nodeId });
    return false;
  }
}

function patchUpstreamAnalyzerOutputs(nodeId: string, output: ScriptPackageOutput, sourceNodeId?: string): void {
  const state = useStudioStore.getState();
  const split = splitScriptPackageOutput(output, sourceNodeId);
  const related = [
    ...incomingNodes(nodeId, state.nodes, state.edges),
    ...state.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => state.nodes.find((node) => node.id === edge.target))
      .filter((node): node is StudioRFNode => Boolean(node)),
  ].filter((node) => node.type === 'scriptAnalyzer');
  const seen = new Set<string>();
  for (const node of related) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const type = node.data.type;
    let nextOutput: ScriptScenesOutput | ScriptCharactersOutput | ScriptPropsOutput | null = null;
    if (type === 'script_scene_node') nextOutput = split.scenesOutput;
    if (type === 'script_character_node') nextOutput = split.charactersOutput;
    if (type === 'script_prop_node') nextOutput = split.propsOutput;
    if (!nextOutput) continue;
    state.patchNodeData(
      node.id,
      {
        output: nextOutput,
        inputSource: 'graph',
        status: 'APPROVED',
        generation_error: '',
        streaming_preview: '',
        review_result: 'API 分析结果已同步。',
      },
      true,
    );
  }
}

async function runScriptAnalyzerNode(nodeId: string): Promise<boolean> {
  const state = useStudioStore.getState();
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'scriptAnalyzer') return false;
  const kind = node.data.type as ScriptAnalyzerKind;
  const config = ANALYZER_CONFIG[kind];
  if (!config) return false;

  const initialState = useStudioStore.getState();
  const busyUpstream = inProgressUpstream(nodeId, initialState.nodes, initialState.edges);
  if (busyUpstream) {
    const message = `${describeScriptNode(busyUpstream)}正在运行，请等待上游完成后再运行「${config.title}」。本节点不会重复请求模型。`;
    initialState.patchNodeData(
      nodeId,
      {
        status: 'NOT_STARTED',
        generation_error: '',
        streaming_preview: '',
        review_result: message,
      },
      false,
    );
    initialState.pushMessage({ role: 'system', text: message, nodeId });
    return false;
  }

  state.patchNodeData(
    nodeId,
    {
      status: 'IN_PROGRESS',
      generation_error: '',
      streaming_preview: isCoreScriptAnalyzerKind(kind)
        ? '正在通过 /api/llm/chat 调用 API 分析剧本...'
        : `${config.title}运行中...`,
    },
    false,
  );
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  try {
    const latest = useStudioStore.getState();
    const upstreamOutputs = collectScriptOutputs(nodeId, latest.nodes, latest.edges);
    const deepUpstreamOutputs = collectScriptOutputsDeep(nodeId, latest.nodes, latest.edges);
    if (isCoreScriptAnalyzerKind(kind)) {
      const reusableOutput = reusableCoreOutputFromUpstream(kind, deepUpstreamOutputs, nodeId);
      if (reusableOutput) {
        useStudioStore.getState().patchNodeData(
          nodeId,
          {
            output: reusableOutput,
            input: previewLines(reusableOutput).join('\n') || reusableOutput.warnings.join('\n'),
            inputSource: 'graph',
            status: 'APPROVED',
            generation_error: '',
            streaming_preview: '',
            review_result: '已复用上游 API 拆解结果，没有重复请求模型。',
          },
          true,
        );
        useStudioStore.getState().pushMessage({
          role: 'system',
          text: `${config.title}完成：已复用上游 API 结果，未重复调用 /api/llm/chat。`,
          nodeId,
        });
        return true;
      }
    }
    if (kind === 'script_review_node') {
      if (upstreamOutputs.length === 0) {
        throw new Error('没有读取到上游拆解汇总，请先运行“AI 运行全链”。');
      }
      const output = reviewScriptBreakdownOutputs(upstreamOutputs);
      useStudioStore.getState().patchNodeData(
        nodeId,
        {
          output,
          input: output.summary,
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: output.summary,
        },
        true,
      );
      useStudioStore.getState().pushMessage({
        role: 'system',
        text: `质量复核完成：${config.badge(output)}。`,
        nodeId,
      });
      return true;
    }
    if (kind === 'script_timeline_node') {
      if (upstreamOutputs.length === 0) {
        throw new Error('没有读取到上游拆解汇总，请先运行“AI 运行全链”。');
      }
      const output = analyzeScriptTimelineOutputs(upstreamOutputs);
      useStudioStore.getState().patchNodeData(
        nodeId,
        {
          output,
          input: output.events
            .map((event) => `场${event.sceneNo} ${event.storyDay} ${event.timeOfDay} ${event.location}`)
            .join('\n'),
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: output.warnings.length
            ? `时间线生成完成，仍有 ${output.warnings.length} 条待确认。`
            : '时间线生成完成。',
        },
        true,
      );
      useStudioStore.getState().pushMessage({
        role: 'system',
        text: `时间线分析完成：${config.badge(output)}。`,
        nodeId,
      });
      return true;
    }
    if (kind === 'script_art_node') {
      if (upstreamOutputs.length === 0) {
        throw new Error('没有读取到上游拆解汇总，请先运行“AI 运行全链”。');
      }
      const output = analyzeScriptArtDirectionOutputs(upstreamOutputs);
      useStudioStore.getState().patchNodeData(
        nodeId,
        {
          output,
          input: output.requirements
            .map((item) => `场${item.sceneNo} ${item.title} ${item.visualStyle}`)
            .join('\n'),
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: output.summary,
        },
        true,
      );
      useStudioStore.getState().pushMessage({
        role: 'system',
        text: `美术分析完成：${config.badge(output)}。`,
        nodeId,
      });
      return true;
    }
    if (kind === 'script_vfx_node') {
      if (upstreamOutputs.length === 0) {
        throw new Error('没有读取到上游拆解汇总，请先运行“AI 运行全链”。');
      }
      const output = analyzeScriptVfxOutputs(upstreamOutputs);
      useStudioStore.getState().patchNodeData(
        nodeId,
        {
          output,
          input: output.requirements
            .map((item) => `场${item.sceneNo} ${item.effectType} ${item.productionMethod}`)
            .join('\n'),
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: output.summary,
        },
        true,
      );
      useStudioStore.getState().pushMessage({
        role: 'system',
        text: `VFX分析完成：${config.badge(output)}。`,
        nodeId,
      });
      return true;
    }
    if (kind === 'script_world_node') {
      if (upstreamOutputs.length === 0) {
        throw new Error('没有读取到上游拆解汇总，请先运行“AI 运行全链”。');
      }
      const output = analyzeScriptWorldbuildingOutputs(upstreamOutputs);
      useStudioStore.getState().patchNodeData(
        nodeId,
        {
          output,
          input: [
            output.summary,
            `时代：${output.era}`,
            `文明：${output.civilization}`,
            `势力：${output.factions.join('、') || '待确认'}`,
          ].join('\n'),
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: output.summary,
        },
        true,
      );
      useStudioStore.getState().pushMessage({
        role: 'system',
        text: `世界观分析完成：${config.badge(output)}。`,
        nodeId,
      });
      return true;
    }
    if (kind === 'script_production_node') {
      if (upstreamOutputs.length === 0) {
        throw new Error('没有读取到上游拆解汇总，请先运行“AI 运行全链”。');
      }
      const output = analyzeScriptProductionOutputs(upstreamOutputs);
      useStudioStore.getState().patchNodeData(
        nodeId,
        {
          output,
          input: output.requirements
            .map((item) => `场${item.sceneNo} ${item.department} ${item.title} ${item.complexity}`)
            .join('\n'),
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: output.summary,
        },
        true,
      );
      useStudioStore.getState().pushMessage({
        role: 'system',
        text: `制片统筹完成：${config.badge(output)}。`,
        nodeId,
      });
      return true;
    }
    if (kind === 'script_ai_assets_node') {
      if (upstreamOutputs.length === 0) {
        throw new Error('没有读取到上游拆解汇总，请先运行“AI 运行全链”。');
      }
      useStudioStore.getState().patchNodeData(
        nodeId,
        {
          streaming_preview: '正在通过 /api/llm/chat 调用 LLM 生成 Midjourney / GPT Image 2 / Nano Banana 提示词...',
        },
        false,
      );
      const output = await generateScriptAiPromptsWithLlm({ outputs: upstreamOutputs });
      useStudioStore.getState().patchNodeData(
        nodeId,
        {
          output,
          input: output.assets
            .map((item) => `${item.platform} ${item.kind} ${item.title}`)
            .join('\n'),
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: output.summary,
        },
        true,
      );
      useStudioStore.getState().pushMessage({
        role: 'system',
        text: `AI资产生成完成：${config.badge(output)}。`,
        nodeId,
      });
      return true;
    }

    const text = resolveScriptTextDeep(nodeId, latest.nodes, latest.edges);
    if (!text?.trim()) throw new Error('没有读取到上游剧本文本，请先连接「剧本输入」或文本卡片。');

    if (!isCoreScriptAnalyzerKind(kind)) {
      throw new Error('当前节点类型暂不支持直接运行。');
    }

    const llmStartedAt = Date.now();
    const packageOutput = await analyzeScriptPackageWithLlm({ scriptText: text });
    const llmElapsedSeconds = ((Date.now() - llmStartedAt) / 1000).toFixed(1);
    patchUpstreamAnalyzerOutputs(nodeId, packageOutput, nodeId);
    const output = outputFromPackageForKind(packageOutput, kind, nodeId);

    useStudioStore.getState().patchNodeData(
      nodeId,
      {
        output,
        input: text,
        inputSource: 'graph',
        status: 'APPROVED',
        generation_error: '',
        streaming_preview: '',
        review_result: `API 分析完成（耗时 ${llmElapsedSeconds} 秒）。`,
      },
      true,
    );
    useStudioStore.getState().pushMessage({
      role: 'system',
      text: `${config.title}完成：API 已通过 /api/llm/chat 返回 ${config.badge(output)}，耗时 ${llmElapsedSeconds} 秒。`,
      nodeId,
    });
    return true;
  } catch (error) {
    const message = readableError(error);
    const currentOutput = isScriptBreakdownOutput(
      useStudioStore.getState().nodes.find((item) => item.id === nodeId)?.data.output,
    )
      ? useStudioStore.getState().nodes.find((item) => item.id === nodeId)?.data.output
      : null;
    useStudioStore.getState().patchNodeData(
      nodeId,
      {
        status: currentOutput ? 'APPROVED' : 'NOT_STARTED',
        generation_error: message,
        streaming_preview: '',
        review_result: currentOutput ? '保留上一次成功的拆解结果。' : null,
      },
      Boolean(currentOutput),
    );
    useStudioStore.getState().pushMessage({ role: 'system', text: message, nodeId });
    return false;
  }
}

async function runScriptOutputNode(nodeId: string): Promise<boolean> {
  const state = useStudioStore.getState();
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'scriptOutput') return false;
  const scriptText = resolveScriptTextDeep(nodeId, state.nodes, state.edges);
  if (!scriptText?.trim()) {
    const message = '没有读取到上游剧本文本，请先连接「剧本输入」或文本卡片。';
    state.patchNodeData(nodeId, { generation_error: message, status: 'NOT_STARTED' }, false);
    state.pushMessage({ role: 'system', text: message, nodeId });
    return false;
  }
  const busyUpstream = inProgressUpstream(nodeId, state.nodes, state.edges);
  if (busyUpstream) {
    const message = `${describeScriptNode(busyUpstream)}正在运行，请等待上游完成后再运行「拆解汇总」。汇总节点不会重复请求模型。`;
    state.patchNodeData(
      nodeId,
      {
        status: 'NOT_STARTED',
        generation_error: '',
        streaming_preview: '',
        review_result: message,
      },
      false,
    );
    state.pushMessage({ role: 'system', text: message, nodeId });
    return false;
  }
  state.patchNodeData(
    nodeId,
    {
      input: scriptText,
      status: 'IN_PROGRESS',
      generation_error: '',
      streaming_preview: '正在通过 /api/llm/chat 调用 API 分析剧本结构...',
    },
    false,
  );

  try {
    const llmStartedAt = Date.now();
    const refinedOutput = await analyzeScriptPackageWithLlm({ scriptText });
    const llmElapsedSeconds = ((Date.now() - llmStartedAt) / 1000).toFixed(1);
    patchUpstreamAnalyzerOutputs(nodeId, refinedOutput, nodeId);
    useStudioStore.getState().patchNodeData(
      nodeId,
      {
        output: refinedOutput,
        input: packageToText(refinedOutput),
        status: 'APPROVED',
        generation_error: '',
        streaming_preview: '',
        review_result: `API 分析完成（耗时 ${llmElapsedSeconds} 秒）：${refinedOutput.stats.sceneCount} 场，${refinedOutput.stats.characterCount} 角色，${refinedOutput.stats.propCount} 道具。`,
      },
      true,
    );
    useStudioStore.getState().pushMessage({
      role: 'system',
      text: `剧本拆解汇总完成：API 已通过 /api/llm/chat 返回结果，耗时 ${llmElapsedSeconds} 秒。`,
      nodeId,
    });
    return true;
  } catch (error) {
    const message = readableError(error);
    const currentOutput = isScriptBreakdownOutput(useStudioStore.getState().nodes.find((item) => item.id === nodeId)?.data.output)
      ? useStudioStore.getState().nodes.find((item) => item.id === nodeId)?.data.output
      : null;
    useStudioStore.getState().patchNodeData(
      nodeId,
      {
        status: currentOutput ? 'APPROVED' : 'NOT_STARTED',
        generation_error: `API 分析失败：${message}`,
        streaming_preview: '',
        review_result: currentOutput ? '保留上一次成功的 API 分析结果。' : null,
      },
      true,
    );
    useStudioStore.getState().pushMessage({
      role: 'system',
      text: `API 分析失败：${message}`,
      nodeId,
    });
    return false;
  }
}

async function runScriptChainToOutput(outputNodeId: string): Promise<void> {
  const ok = await runScriptOutputNode(outputNodeId);
  if (!ok) return;
  const latest = useStudioStore.getState();
  const postNodes = latest.edges
    .filter((edge) => edge.source === outputNodeId)
    .map((edge) => latest.nodes.find((node) => node.id === edge.target))
    .filter(
      (node): node is StudioRFNode =>
        node != null &&
        node.type === 'scriptAnalyzer' &&
        (node.data.type === 'script_review_node' ||
          node.data.type === 'script_timeline_node' ||
          node.data.type === 'script_art_node' ||
          node.data.type === 'script_vfx_node' ||
          node.data.type === 'script_world_node' ||
          node.data.type === 'script_production_node' ||
          node.data.type === 'script_ai_assets_node'),
    );
  for (const postNode of postNodes) {
    await runScriptAnalyzerNode(postNode.id);
  }
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type ScriptAiAssetsNodeBodyProps = {
  nodeId: string;
  output: ScriptAiAssetsOutput;
  selectedPlatform: ScriptAiAssetPlatform;
  onSelectPlatform: (platform: ScriptAiAssetPlatform) => void;
  onChangePrompt: (assetId: string, prompt: string) => void;
};

function ScriptAiAssetsNodeBody({
  nodeId,
  output,
  selectedPlatform,
  onSelectPlatform,
  onChangePrompt,
}: ScriptAiAssetsNodeBodyProps) {
  const assets = useMemo(
    () => output.assets.filter((asset) => asset.platform === selectedPlatform),
    [output.assets, selectedPlatform],
  );
  const warningCount = assets.reduce((total, asset) => total + asset.warnings.length + (asset.qualityIssues?.length ?? 0), 0);

  const copyPlatformPrompts = useCallback(() => {
    if (!assets.length) return;
    const text = assets
      .map((asset, index) => {
        const negative = asset.negativePrompt?.trim() ? `\nNegative: ${asset.negativePrompt.trim()}` : '';
        const params = asset.parameters.length ? `\nParams: ${asset.parameters.join(' ')}` : '';
        return `${index + 1}. ${asset.title}\n${asset.prompt}${negative}${params}`;
      })
      .join('\n\n---\n\n');
    void navigator.clipboard?.writeText(text);
    useStudioStore.getState().pushMessage({
      role: 'system',
      text: `Copied ${assets.length} ${scriptAiPlatformName(selectedPlatform)} prompts.`,
      nodeId,
    });
  }, [assets, nodeId, selectedPlatform]);

  return (
    <div className="script-ai-assets-node__body">
      <div className="script-ai-assets-node__platforms nodrag nopan">
        {SCRIPT_AI_PLATFORM_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={selectedPlatform === option.value ? 'is-active' : undefined}
            onClick={() => onSelectPlatform(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="script-ai-assets-node__platform-actions nodrag nopan">
        <span>
          {scriptAiPlatformName(selectedPlatform)} · {assets.length} prompts
        </span>
        <button type="button" disabled={!assets.length} onClick={copyPlatformPrompts}>
          Copy
        </button>
      </div>
      <div className="script-ai-assets-node__prompt-list nodrag nopan nowheel">
        {assets.length ? (
          assets.map((asset) => (
            <section className="script-ai-assets-node__prompt-card" key={asset.id}>
              <header className="script-ai-assets-node__prompt-head">
                <strong>{asset.title}</strong>
                <span>
                  {scriptAiAssetTarget(asset)} · {scriptAiAssetKindLabel(asset.kind)}
                </span>
              </header>
              <textarea
                className="script-ai-assets-node__prompt-textarea nodrag nopan nowheel"
                value={asset.prompt}
                onChange={(event) => onChangePrompt(asset.id, event.target.value)}
              />
              {asset.negativePrompt?.trim() ? (
                <div className="script-ai-assets-node__negative">Negative: {asset.negativePrompt.trim()}</div>
              ) : null}
              {asset.parameters.length ? (
                <div className="script-ai-assets-node__params">{asset.parameters.join(' ')}</div>
              ) : null}
            </section>
          ))
        ) : (
          <p className="script-node__empty">No prompts for this platform yet.</p>
        )}
      </div>
      {warningCount > 0 ? <div className="script-ai-assets-node__quality">{warningCount} review items</div> : null}
    </div>
  );
}

function ScriptInputNodeInner({ id, data, selected }: NodeProps<ScriptInputRF>) {
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const pushMessage = useStudioStore((s) => s.pushMessage);
  const addScriptCoreAnalyzerNodes = useStudioStore((s) => s.addScriptCoreAnalyzerNodes);
  const fileRef = useRef<HTMLInputElement>(null);
  const raw = data.raw_text ?? data.input ?? '';
  const busy = data.status === 'IN_PROGRESS';
  const hasText = raw.trim().length > 0;

  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      patchNodeData(id, { raw_text: value, input: value, generation_error: '', streaming_preview: '' }, false);
    },
    [id, patchNodeData],
  );

  const onFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        patchNodeData(id, { raw_text: text, input: text, generation_error: '', streaming_preview: '' }, false);
        pushMessage({ role: 'system', text: `已导入 ${file.name}（${text.length} 字）。`, nodeId: id });
      };
      reader.onerror = () => {
        pushMessage({ role: 'system', text: '读取剧本文件失败。', nodeId: id });
      };
      reader.readAsText(file, 'UTF-8');
    },
    [id, patchNodeData, pushMessage],
  );

  const runInputBreakdown = useCallback(async () => {
    const text = raw.trim();
    if (!text) {
      const message = '请先粘贴剧本文本，或导入 TXT / MD 文件。';
      patchNodeData(id, { generation_error: message, streaming_preview: '' }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
      return;
    }

    patchNodeData(
      id,
      {
        raw_text: text,
        input: text,
        status: 'IN_PROGRESS',
        generation_error: '',
        streaming_preview: '正在通过 /api/llm/chat 调用 API 拆解剧本；完成后会生成场景、角色、道具节点...',
      },
      false,
    );

    try {
      const startedAt = Date.now();
      const packageOutput = await analyzeScriptPackageWithLlm({ scriptText: text });
      const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      const ids = addScriptCoreAnalyzerNodes(id);
      const split = splitScriptPackageOutput(packageOutput, id);
      const state = useStudioStore.getState();
      const reviewResult = `由剧本输入拆解生成：API 耗时 ${elapsedSeconds} 秒。`;

      state.patchNodeData(
        ids.sceneId,
        {
          output: split.scenesOutput,
          input: text,
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: reviewResult,
        },
        true,
      );
      state.patchNodeData(
        ids.characterId,
        {
          output: split.charactersOutput,
          input: text,
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: reviewResult,
        },
        true,
      );
      state.patchNodeData(
        ids.propId,
        {
          output: split.propsOutput,
          input: text,
          inputSource: 'graph',
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: reviewResult,
        },
        true,
      );
      state.patchNodeData(
        id,
        {
          output: packageOutput,
          raw_text: text,
          input: text,
          status: 'APPROVED',
          generation_error: '',
          streaming_preview: '',
          review_result: `剧本拆解完成（耗时 ${elapsedSeconds} 秒）：已生成场景、角色、道具节点。`,
        },
        true,
      );
      state.pushMessage({
        role: 'system',
        text: `剧本拆解完成：API 返回 ${packageOutput.stats.sceneCount} 场、${packageOutput.stats.characterCount} 角色、${packageOutput.stats.propCount} 道具，耗时 ${elapsedSeconds} 秒。`,
        nodeId: id,
      });
      state.focusNode(ids.sceneId, { openDetail: false });
    } catch (error) {
      const message = readableError(error);
      const currentOutput = isScriptBreakdownOutput(useStudioStore.getState().nodes.find((item) => item.id === id)?.data.output)
        ? useStudioStore.getState().nodes.find((item) => item.id === id)?.data.output
        : null;
      useStudioStore.getState().patchNodeData(
        id,
        {
          status: 'APPROVED',
          generation_error: `API 分析失败：${message}`,
          streaming_preview: '',
          review_result: currentOutput ? '保留上一次成功的 API 拆解结果。' : null,
        },
        Boolean(currentOutput),
      );
      useStudioStore.getState().pushMessage({ role: 'system', text: `API 分析失败：${message}`, nodeId: id });
    }
  }, [addScriptCoreAnalyzerNodes, id, patchNodeData, pushMessage, raw]);

  return (
    <div className={`script-node script-input-node ${selected ? 'script-node--selected' : ''}`}>
      <header className="script-node__head">
        <div>
          <span className="script-node__eyebrow">SCRIPT</span>
          <strong className="script-node__title">剧本输入</strong>
        </div>
        <span className={`script-node__badge ${busy ? 'script-node__badge--busy' : ''}`}>
          {busy ? '运行中' : `${raw.trim().length} 字`}
        </span>
      </header>
      <textarea
        className="script-input-node__area nodrag nopan nowheel"
        value={raw}
        onChange={onChange}
        placeholder="粘贴剧本文本，或导入 TXT / MD 文件。"
        spellCheck={false}
      />
      <div className="script-node__actions nodrag nopan">
        <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} hidden />
        <button className="script-node__primary-action" type="button" disabled={busy || !hasText} onClick={() => void runInputBreakdown()}>
          剧本拆解
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          导入 TXT/MD
        </button>
        <button type="button" disabled={busy} onClick={() => patchNodeData(id, { raw_text: '', input: '', output: null, generation_error: '', streaming_preview: '' }, false)}>
          清空
        </button>
      </div>
      {data.streaming_preview?.trim() ? <div className="script-node__llm">{data.streaming_preview.trim()}</div> : null}
      {!data.streaming_preview?.trim() && data.review_result?.trim() ? (
        <div className="script-node__llm">{data.review_result.trim()}</div>
      ) : null}
      {data.generation_error?.trim() ? <div className="script-node__error">{data.generation_error.trim()}</div> : null}
      <Handle type="source" position={Position.Right} id={SCRIPT_OUTPUT_HANDLE_ID} className="script-node__handle script-node__handle--out" />
    </div>
  );
}

function ScriptAnalyzerNodeInner({ id, data, selected }: NodeProps<ScriptAnalyzerRF>) {
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const kind = data.type as ScriptAnalyzerKind;
  const config = ANALYZER_CONFIG[kind] ?? ANALYZER_CONFIG.script_scene_node;
  const output = isScriptBreakdownOutput(data.output) ? data.output : null;
  const busy = data.status === 'IN_PROGRESS';
  const coreAnalyzer = isCoreScriptAnalyzerKind(kind);
  const lines = previewLines(output);
  const warningCount = outputWarningCount(output);
  const aiAssetsOutput = output?.module === 'script_ai_assets' ? output : null;
  const selectedAiPlatform = normalizeScriptAiAssetPlatform(data.script_ai_asset_platform);

  const selectAiPlatform = useCallback(
    (platform: ScriptAiAssetPlatform) => {
      patchNodeData(id, { script_ai_asset_platform: platform }, false);
    },
    [id, patchNodeData],
  );

  const changeAiPrompt = useCallback(
    (assetId: string, prompt: string) => {
      if (!aiAssetsOutput) return;
      patchNodeData(id, { output: updateScriptAiAssetPrompt(aiAssetsOutput, assetId, prompt) }, true);
    },
    [aiAssetsOutput, id, patchNodeData],
  );

  return (
    <div className={`script-node script-analyzer-node ${kind === 'script_ai_assets_node' ? 'script-ai-assets-node' : ''} ${selected ? 'script-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} id={SCRIPT_INPUT_HANDLE_ID} className="script-node__handle script-node__handle--in" />
      <header className="script-node__head">
        <div>
          <span className="script-node__eyebrow">{config.eyebrow}</span>
          <strong className="script-node__title">{config.title}</strong>
        </div>
        <span className={`script-node__badge ${busy ? 'script-node__badge--busy' : ''}`}>{busy ? '运行中' : config.badge(output)}</span>
      </header>
      <div className="script-node__body">
        {busy ? (
          <p className="script-node__empty">{data.streaming_preview || '正在拆解...'}</p>
        ) : aiAssetsOutput ? (
          <ScriptAiAssetsNodeBody
            nodeId={id}
            output={aiAssetsOutput}
            selectedPlatform={selectedAiPlatform}
            onSelectPlatform={selectAiPlatform}
            onChangePrompt={changeAiPrompt}
          />
        ) : lines.length > 0 ? (
          <ul className="script-node__preview">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="script-node__empty">{config.empty}</p>
        )}
      </div>
      {warningCount > 0 ? <div className="script-node__warn">{warningCount} 条待确认</div> : null}
      {!busy && data.review_result?.trim() ? <div className="script-node__llm">{data.review_result.trim()}</div> : null}
      {data.generation_error?.trim() ? <div className="script-node__error">{data.generation_error.trim()}</div> : null}
      <div className="script-node__actions nodrag nopan">
        <button
          className={coreAnalyzer ? 'script-node__primary-action' : undefined}
          type="button"
          disabled={busy}
          onClick={() => void (coreAnalyzer ? runScriptPromptAssetsForNode(id) : runScriptAnalyzerNode(id))}
        >
          {config.action}
        </button>
      </div>
      <Handle type="source" position={Position.Right} id={SCRIPT_OUTPUT_HANDLE_ID} className="script-node__handle script-node__handle--out" />
    </div>
  );
}

function ScriptOutputNodeInner({ id, data, selected }: NodeProps<ScriptOutputRF>) {
  const output = isScriptBreakdownOutput(data.output) && data.output.module === 'script_package' ? data.output : null;
  const busy = data.status === 'IN_PROGRESS';
  const summary = useMemo(() => {
    if (!output) return { sceneCount: 0, characterCount: 0, propCount: 0, warningCount: 0 };
    return output.stats;
  }, [output]);

  const copyJson = useCallback(() => {
    if (!output) return;
    void navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    useStudioStore.getState().pushMessage({ role: 'system', text: '已复制剧本拆解 JSON。', nodeId: id });
  }, [id, output]);

  return (
    <div className={`script-node script-output-node ${selected ? 'script-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} id={SCRIPT_INPUT_HANDLE_ID} className="script-node__handle script-node__handle--in" />
      <header className="script-node__head">
        <div>
          <span className="script-node__eyebrow">OUTPUT</span>
          <strong className="script-node__title">拆解汇总</strong>
        </div>
        <span className={`script-node__badge ${busy ? 'script-node__badge--busy' : ''}`}>
          {busy ? '运行中' : output ? '已汇总' : '待汇总'}
        </span>
      </header>
      <div className="script-output-node__stats">
        <span>
          <strong>{summary.sceneCount}</strong>
          场景
        </span>
        <span>
          <strong>{summary.characterCount}</strong>
          角色
        </span>
        <span>
          <strong>{summary.propCount}</strong>
          道具
        </span>
      </div>
      {output ? (
        <ul className="script-node__preview">
          {previewLines(output).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="script-node__empty">AI 运行全链会直接通过 /api/llm/chat 分析剧本，不走本地预处理。</p>
      )}
      {data.streaming_preview?.trim() ? <div className="script-node__llm">{data.streaming_preview.trim()}</div> : null}
      {!data.streaming_preview?.trim() && data.review_result?.trim() ? (
        <div className="script-node__llm">{data.review_result.trim()}</div>
      ) : null}
      {summary.warningCount > 0 ? <div className="script-node__warn">{summary.warningCount} 条待确认</div> : null}
      {data.generation_error?.trim() ? <div className="script-node__error">{data.generation_error.trim()}</div> : null}
      <div className="script-node__actions script-node__actions--wrap nodrag nopan">
        <button type="button" disabled={busy} onClick={() => void runScriptChainToOutput(id)}>
          AI 运行全链
        </button>
        <button type="button" disabled={busy} onClick={() => void runScriptOutputNode(id)}>
          AI 刷新汇总
        </button>
        <button type="button" disabled={!output} onClick={copyJson}>
          复制 JSON
        </button>
        <button type="button" disabled={!output} onClick={() => output && downloadJson('script-breakdown.json', output)}>
          下载 JSON
        </button>
      </div>
      <Handle type="source" position={Position.Right} id={SCRIPT_OUTPUT_HANDLE_ID} className="script-node__handle script-node__handle--out" />
    </div>
  );
}

export const ScriptInputNode = memo(ScriptInputNodeInner);
export const ScriptAnalyzerNode = memo(ScriptAnalyzerNodeInner);
export const ScriptOutputNode = memo(ScriptOutputNodeInner);
