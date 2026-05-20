import { Fragment, useState } from 'react';
import type {
  ScriptBreakdownOutput,
  ScriptAiAssetsOutput,
  ScriptAiAssetKind,
  ScriptAiAssetPlatform,
  ScriptAiPromptAsset,
  ScriptAiAssetStatus,
  ScriptArtRequirement,
  ScriptCharacterBreakdown,
  ScriptPackageOutput,
  ScriptProductionOutput,
  ScriptProductionRequirement,
  ScriptPropBreakdown,
  ScriptReviewIssue,
  ScriptSceneBreakdown,
  ScriptTimelineConflict,
  ScriptTimelineEvent,
  ScriptVfxRequirement,
  ScriptWorldbuildingOutput,
} from '@/types/scriptBreakdown';
import type { ChatMessage, StudioNodeData } from '@/types/studio';
import {
  applyScriptAiPromptQuality,
  isScriptBreakdownOutput,
  reviewScriptAiPromptAsset,
  rewriteScriptAiPromptAsset,
} from '@/services/scriptBreakdownEngine';

type PushMessage = (m: Omit<ChatMessage, 'id' | 'ts'> & { id?: string }) => string;
type PatchNodeData = (id: string, patch: Partial<StudioNodeData>, bumpVersion?: boolean) => void;
type AiAssetPlatformFilter = 'all' | ScriptAiAssetPlatform;
type AiAssetKindFilter = 'all' | ScriptAiAssetKind;
type AiAssetStatusFilter = 'all' | ScriptAiAssetStatus;

const AI_ASSET_KIND_LABELS: Record<ScriptAiAssetKind, string> = {
  scene_prompt: '场景',
  character_prompt: '角色',
  prop_prompt: '道具',
  cinematic_prompt: '镜头',
  lighting_prompt: '光影',
  style_prompt: '风格',
};

const AI_ASSET_PLATFORM_LABELS: Record<ScriptAiAssetPlatform, string> = {
  midjourney: 'Midjourney',
  gpt_image_2: 'GPT Image 2',
  nanobanana: 'Nano Banana',
};

const AI_ASSET_STATUS_LABELS: Record<ScriptAiAssetStatus, string> = {
  needs_review: '待确认',
  approved: '已确认',
  needs_revision: '需修正',
};

const AI_ASSET_KIND_OPTIONS = Object.keys(AI_ASSET_KIND_LABELS) as ScriptAiAssetKind[];
const AI_ASSET_PLATFORM_OPTIONS = Object.keys(AI_ASSET_PLATFORM_LABELS) as ScriptAiAssetPlatform[];
const AI_ASSET_STATUS_OPTIONS = Object.keys(AI_ASSET_STATUS_LABELS) as ScriptAiAssetStatus[];

function compact(value: string, max = 120): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function listText(values: unknown): string {
  if (Array.isArray(values)) return values.filter(Boolean).join('、') || '—';
  if (typeof values === 'string') return values.trim() || '—';
  if (values == null) return '—';
  return String(values);
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value)
    ? value.filter(Boolean).join('、')
    : value == null
      ? ''
      : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function copyText(text: string, onDone: () => void) {
  void navigator.clipboard.writeText(text).then(onDone, () => window.alert('复制失败：请检查浏览器权限'));
}

function aiAssetStatus(asset: ScriptAiPromptAsset): ScriptAiAssetStatus {
  if (asset.status) return asset.status;
  const quality = aiAssetQuality(asset);
  return asset.warnings.length || quality.issues.length ? 'needs_revision' : 'needs_review';
}

function aiAssetQuality(asset: ScriptAiPromptAsset): { score: number; issues: string[] } {
  if (typeof asset.qualityScore === 'number' && Array.isArray(asset.qualityIssues)) {
    return { score: asset.qualityScore, issues: asset.qualityIssues };
  }
  return reviewScriptAiPromptAsset(asset);
}

function aiAssetTarget(asset: ScriptAiPromptAsset): string {
  if (asset.sceneNo) return `场${asset.sceneNo}`;
  return asset.characterName || '全局';
}

function aiAssetCopyText(asset: ScriptAiPromptAsset): string {
  return [
    `${AI_ASSET_KIND_LABELS[asset.kind]} / ${AI_ASSET_PLATFORM_LABELS[asset.platform]} / ${asset.title}`,
    `用途：${asset.usage}`,
    `对象：${aiAssetTarget(asset)}`,
    asset.prompt,
    asset.negativePrompt ? `Negative Prompt：${asset.negativePrompt}` : '',
    asset.parameters.length ? `参数：${asset.parameters.join('、')}` : '',
    aiAssetQuality(asset).issues.length ? `质检：${aiAssetQuality(asset).issues.join('；')}` : '质检：通过',
    asset.notes ? `修正备注：${asset.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function aiAssetEvidenceText(asset: ScriptAiPromptAsset): string {
  return asset.evidence.map((item) => `场${item.sceneNo ?? '-'}：${item.excerpt}`).join('\n');
}

function rebuildAiAssetsOutput(output: ScriptAiAssetsOutput, assets: ScriptAiPromptAsset[]): ScriptAiAssetsOutput {
  const qualityIssueCount = assets.reduce((total, asset) => total + aiAssetQuality(asset).issues.length, 0);
  const warnings = Array.from(new Set(assets.flatMap((asset) => [...asset.warnings, ...aiAssetQuality(asset).issues])));
  const approvedCount = assets.filter((asset) => aiAssetStatus(asset) === 'approved').length;
  const revisionCount = assets.filter((asset) => aiAssetStatus(asset) === 'needs_revision').length;
  const reviewCount = assets.filter((asset) => aiAssetStatus(asset) === 'needs_review').length;
  const scenePromptCount = assets.filter((asset) => asset.kind === 'scene_prompt').length;
  const characterPromptCount = assets.filter((asset) => asset.kind === 'character_prompt').length;
  const propPromptCount = assets.filter((asset) => asset.kind === 'prop_prompt').length;
  const cinematicPromptCount = assets.filter((asset) => asset.kind === 'cinematic_prompt').length;
  return {
    ...output,
    assets,
    summary: `已生成 ${assets.length} 条三平台影视级概念设计 Prompt，已确认 ${approvedCount} 条，待确认 ${reviewCount} 条，需修正 ${revisionCount} 条，质检问题 ${qualityIssueCount} 个。`,
    warnings,
    stats: {
      ...output.stats,
      assetCount: assets.length,
      scenePromptCount,
      characterPromptCount,
      propPromptCount,
      cinematicPromptCount,
      platformCount: new Set(assets.map((asset) => asset.platform)).size,
      qualityIssueCount,
      warningCount: warnings.length,
    },
  };
}

function scenesToCsv(scenes: ScriptSceneBreakdown[]): string {
  const rows = [
    ['场次', '标题', '地点', '内外景', '时间', '角色', '道具', '摘要', '置信度', '待确认'],
    ...scenes.map((scene) => [
      scene.sceneNo,
      scene.title,
      scene.location,
      scene.interiorExterior,
      scene.timeOfDay,
      scene.characters,
      scene.props,
      scene.summary,
      scene.confidence,
      scene.warnings,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function charactersToCsv(characters: ScriptCharacterBreakdown[]): string {
  const rows = [
    ['角色', '出现场次', '对白数', '动作线索', '证据', '置信度', '待确认'],
    ...characters.map((character) => [
      character.name,
      character.sceneNos,
      character.dialogueCount,
      character.actionHints,
      character.evidence.map((item) => `场${item.sceneNo ?? '-'} ${item.excerpt}`),
      character.confidence,
      character.warnings,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function propsToCsv(props: ScriptPropBreakdown[]): string {
  const rows = [
    ['道具', '类别', '出现场次', '备注', '证据', '置信度', '待确认'],
    ...props.map((prop) => [
      prop.name,
      prop.category,
      prop.sceneNos,
      prop.notes,
      prop.evidence.map((item) => `场${item.sceneNo ?? '-'} ${item.excerpt}`),
      prop.confidence,
      prop.warnings,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function issuesToCsv(issues: ScriptReviewIssue[]): string {
  const rows = [
    ['级别', '类别', '对象', '问题', '建议', '证据'],
    ...issues.map((item) => [
      item.severity,
      item.category,
      item.target,
      item.summary,
      item.recommendation,
      item.evidence ? `场${item.evidence.sceneNo ?? '-'} ${item.evidence.excerpt}` : '',
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function timelineToCsv(events: ScriptTimelineEvent[], conflicts: ScriptTimelineConflict[]): string {
  const eventRows = [
    ['类型', '场次', '顺序', '故事日', '时间', '标记', '地点', '摘要', '置信度', '待确认'],
    ...events.map((event) => [
      '事件',
      event.sceneNo,
      event.order,
      event.storyDay,
      event.timeOfDay,
      event.marker,
      event.location,
      event.summary,
      event.confidence,
      event.warnings,
    ]),
  ];
  const conflictRows = [
    [],
    ['类型', '场次', '级别', '问题', '建议', '证据'],
    ...conflicts.map((item) => [
      '冲突',
      item.sceneNo ?? '',
      item.severity,
      item.summary,
      item.recommendation,
      item.evidence?.excerpt ?? '',
    ]),
  ];
  return [...eventRows, ...conflictRows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function artToCsv(requirements: ScriptArtRequirement[]): string {
  const rows = [
    ['场次', '类别', '标题', '视觉风格', '氛围', '色彩', '美术需求', '参考', '复杂度', '待确认', '证据'],
    ...requirements.map((item) => [
      item.sceneNo,
      item.category,
      item.title,
      item.visualStyle,
      item.mood,
      item.palette,
      item.requirements,
      item.references,
      item.complexity,
      item.warnings,
      item.evidence.excerpt,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function vfxToCsv(requirements: ScriptVfxRequirement[]): string {
  const rows = [
    ['场次', '类别', '特效类型', '复杂度', '制作方式', '底板需求', '资产需求', '风险提示', '待确认', '证据'],
    ...requirements.map((item) => [
      item.sceneNo,
      item.category,
      item.effectType,
      item.complexity,
      item.productionMethod,
      item.plateNeeds,
      item.assetNeeds,
      item.riskNotes,
      item.warnings,
      item.evidence.excerpt,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function worldToCsv(output: ScriptWorldbuildingOutput): string {
  const rows = [
    ['字段', '内容'],
    ['时代', output.era],
    ['文明结构', output.civilization],
    ['技术水平', output.technologyLevel],
    ['政治体系', output.politicalSystem],
    ['军事体系', output.militarySystem],
    ['宗教体系', output.religion],
    ['经济体系', output.economy],
    ['能量体系', output.energySystem],
    ['社会结构', output.socialStructure],
    ['建筑体系', output.architectureStyle],
    ['服装体系', output.clothingStyle],
    ['语言风格', output.languageStyle],
    ['势力结构', output.factions],
    ['证据', output.evidence.map((item) => `场${item.sceneNo ?? '-'} ${item.excerpt}`)],
    ['待确认', output.warnings],
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function productionToCsv(requirements: ScriptProductionRequirement[]): string {
  const rows = [
    ['场次', '部门', '事项', '复杂度', '资源需求', '通告备注', '风险提示', '待确认', '证据'],
    ...requirements.map((item) => [
      item.sceneNo,
      item.department,
      item.title,
      item.complexity,
      item.resourceNeeds,
      item.callSheetNotes,
      item.riskNotes,
      item.warnings,
      item.evidence.excerpt,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function aiAssetsToCsv(assets: ScriptAiPromptAsset[]): string {
  const rows = [
    [
      '状态',
      '质检分',
      '质检问题',
      '类型',
      '平台',
      '标题',
      '用途',
      '场次',
      '角色',
      'Prompt',
      'Negative Prompt',
      '参数',
      '修正备注',
      '待确认',
      '证据',
    ],
    ...assets.map((item) => [
      AI_ASSET_STATUS_LABELS[aiAssetStatus(item)],
      aiAssetQuality(item).score,
      aiAssetQuality(item).issues,
      item.kind,
      item.platform,
      item.title,
      item.usage,
      item.sceneNo ?? '',
      item.characterName ?? '',
      item.prompt,
      item.negativePrompt ?? '',
      item.parameters,
      item.notes ?? '',
      item.warnings,
      item.evidence.map((evidence) => `场${evidence.sceneNo ?? '-'} ${evidence.excerpt}`),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function outputStats(output: ScriptBreakdownOutput | null) {
  if (!output) return { sceneCount: 0, characterCount: 0, propCount: 0, warningCount: 0 };
  if (output.module === 'script_scenes') {
    return { sceneCount: output.scenes.length, characterCount: 0, propCount: 0, warningCount: output.stats.warningCount };
  }
  if (output.module === 'script_characters') {
    return {
      sceneCount: 0,
      characterCount: output.characters.length,
      propCount: 0,
      warningCount: output.stats.warningCount,
    };
  }
  if (output.module === 'script_props') {
    return { sceneCount: 0, characterCount: 0, propCount: output.props.length, warningCount: output.stats.warningCount };
  }
  if (output.module === 'script_review') {
    return {
      sceneCount: output.stats.issueCount,
      characterCount: output.stats.blockerCount,
      propCount: output.stats.warningIssueCount,
      warningCount: output.stats.warningCount,
    };
  }
  if (output.module === 'script_timeline') {
    return {
      sceneCount: output.stats.eventCount,
      characterCount: output.stats.dayCount,
      propCount: output.stats.conflictCount,
      warningCount: output.stats.unknownTimeCount,
    };
  }
  if (output.module === 'script_art') {
    return {
      sceneCount: output.stats.requirementCount,
      characterCount: output.stats.sceneCount,
      propCount: output.stats.highComplexityCount,
      warningCount: output.stats.warningCount,
    };
  }
  if (output.module === 'script_vfx') {
    return {
      sceneCount: output.stats.requirementCount,
      characterCount: output.stats.sceneCount,
      propCount: output.stats.highComplexityCount,
      warningCount: output.stats.digitalCount,
    };
  }
  if (output.module === 'script_world') {
    return {
      sceneCount: output.stats.factionCount,
      characterCount: output.stats.evidenceCount,
      propCount: output.stats.warningCount,
      warningCount: output.stats.warningCount,
    };
  }
  if (output.module === 'script_production') {
    return {
      sceneCount: output.stats.requirementCount,
      characterCount: output.stats.sceneCount,
      propCount: output.stats.highComplexityCount,
      warningCount: output.stats.nightExteriorCount,
    };
  }
    if (output.module === 'script_ai_assets') {
      return {
        sceneCount: output.stats.assetCount,
        characterCount: output.stats.scenePromptCount,
        propCount: output.stats.propPromptCount,
        warningCount: output.stats.platformCount,
      };
    }
  return output.stats;
}

function scenesFromOutput(output: ScriptBreakdownOutput | null): ScriptSceneBreakdown[] {
  if (!output) return [];
  if (output.module === 'script_scenes' || output.module === 'script_package') return output.scenes;
  return [];
}

function charactersFromOutput(output: ScriptBreakdownOutput | null): ScriptCharacterBreakdown[] {
  if (!output) return [];
  if (output.module === 'script_characters' || output.module === 'script_package') return output.characters;
  return [];
}

function propsFromOutput(output: ScriptBreakdownOutput | null): ScriptPropBreakdown[] {
  if (!output) return [];
  if (output.module === 'script_props' || output.module === 'script_package') return output.props;
  return [];
}

function issuesFromOutput(output: ScriptBreakdownOutput | null): ScriptReviewIssue[] {
  if (!output || output.module !== 'script_review') return [];
  return output.issues;
}

function timelineEventsFromOutput(output: ScriptBreakdownOutput | null): ScriptTimelineEvent[] {
  if (!output || output.module !== 'script_timeline') return [];
  return output.events;
}

function timelineConflictsFromOutput(output: ScriptBreakdownOutput | null): ScriptTimelineConflict[] {
  if (!output || output.module !== 'script_timeline') return [];
  return output.conflicts;
}

function artRequirementsFromOutput(output: ScriptBreakdownOutput | null): ScriptArtRequirement[] {
  if (!output || output.module !== 'script_art') return [];
  return output.requirements;
}

function vfxRequirementsFromOutput(output: ScriptBreakdownOutput | null): ScriptVfxRequirement[] {
  if (!output || output.module !== 'script_vfx') return [];
  return output.requirements;
}

function worldFromOutput(output: ScriptBreakdownOutput | null): ScriptWorldbuildingOutput | null {
  if (!output || output.module !== 'script_world') return null;
  return output;
}

function productionFromOutput(output: ScriptBreakdownOutput | null): ScriptProductionOutput | null {
  if (!output || output.module !== 'script_production') return null;
  return output;
}

function aiAssetsFromOutput(output: ScriptBreakdownOutput | null): ScriptAiAssetsOutput | null {
  if (!output || output.module !== 'script_ai_assets') return null;
  return output;
}

function ActionBar({
  nodeId,
  output,
  pushMessage,
}: {
  nodeId: string;
  output: ScriptBreakdownOutput | null;
  pushMessage: PushMessage;
}) {
  if (!output) return null;
  const copyJson = () => {
    copyText(JSON.stringify(output, null, 2), () => {
      pushMessage({ role: 'system', text: '已复制剧本拆解 JSON。', nodeId });
    });
  };
  const downloadJson = () => {
    downloadText('script-breakdown.json', JSON.stringify(output, null, 2), 'application/json;charset=utf-8');
    pushMessage({ role: 'system', text: '已下载剧本拆解 JSON。', nodeId });
  };
  const downloadCsv = () => {
    const files: Array<[string, string]> = [];
    const scenes = scenesFromOutput(output);
    const characters = charactersFromOutput(output);
    const props = propsFromOutput(output);
    const timelineEvents = timelineEventsFromOutput(output);
    const artRequirements = artRequirementsFromOutput(output);
    const vfxRequirements = vfxRequirementsFromOutput(output);
    if (scenes.length) files.push(['script-scenes.csv', scenesToCsv(scenes)]);
    if (characters.length) files.push(['script-characters.csv', charactersToCsv(characters)]);
    if (props.length) files.push(['script-props.csv', propsToCsv(props)]);
    if (output.module === 'script_review') files.push(['script-review.csv', issuesToCsv(output.issues)]);
    if (output.module === 'script_timeline') {
      files.push(['script-timeline.csv', timelineToCsv(timelineEvents, output.conflicts)]);
    }
    if (output.module === 'script_art') files.push(['script-art-direction.csv', artToCsv(artRequirements)]);
    if (output.module === 'script_vfx') files.push(['script-vfx.csv', vfxToCsv(vfxRequirements)]);
    if (output.module === 'script_world') files.push(['script-worldbuilding.csv', worldToCsv(output)]);
    if (output.module === 'script_production') files.push(['script-production.csv', productionToCsv(output.requirements)]);
    if (output.module === 'script_ai_assets') files.push(['script-ai-assets.csv', aiAssetsToCsv(output.assets)]);
    if (files.length === 0) return;
    for (const [filename, text] of files) {
      downloadText(filename, `\ufeff${text}`, 'text/csv;charset=utf-8');
    }
    pushMessage({ role: 'system', text: `已下载 ${files.length} 个 CSV 文件。`, nodeId });
  };

  return (
    <div className="script-breakdown-detail__actions">
      <button type="button" className="detail-panel__secondary" onClick={copyJson}>
        复制 JSON
      </button>
      <button type="button" className="detail-panel__secondary" onClick={downloadJson}>
        下载 JSON
      </button>
      <button type="button" className="detail-panel__primary" onClick={downloadCsv}>
        下载 CSV
      </button>
    </div>
  );
}

function StatsStrip({ output }: { output: ScriptBreakdownOutput | null }) {
  const stats = outputStats(output);
  if (output?.module === 'script_review') {
    return (
      <div className="script-breakdown-detail__stats">
        <span>
          <strong>{stats.sceneCount}</strong>
          问题
        </span>
        <span>
          <strong>{stats.characterCount}</strong>
          阻塞
        </span>
        <span>
          <strong>{stats.propCount}</strong>
          警告
        </span>
        <span>
          <strong>{stats.warningCount}</strong>
          待确认
        </span>
      </div>
    );
  }
  if (output?.module === 'script_timeline') {
    return (
      <div className="script-breakdown-detail__stats">
        <span>
          <strong>{stats.sceneCount}</strong>
          事件
        </span>
        <span>
          <strong>{stats.characterCount}</strong>
          故事日
        </span>
        <span>
          <strong>{stats.propCount}</strong>
          冲突
        </span>
        <span>
          <strong>{stats.warningCount}</strong>
          缺时间
        </span>
      </div>
    );
  }
  if (output?.module === 'script_art') {
    return (
      <div className="script-breakdown-detail__stats">
        <span>
          <strong>{stats.sceneCount}</strong>
          美术项
        </span>
        <span>
          <strong>{stats.characterCount}</strong>
          场景
        </span>
        <span>
          <strong>{stats.propCount}</strong>
          高复杂
        </span>
        <span>
          <strong>{stats.warningCount}</strong>
          待确认
        </span>
      </div>
    );
  }
  if (output?.module === 'script_vfx') {
    return (
      <div className="script-breakdown-detail__stats">
        <span>
          <strong>{stats.sceneCount}</strong>
          VFX项
        </span>
        <span>
          <strong>{stats.characterCount}</strong>
          场景
        </span>
        <span>
          <strong>{stats.propCount}</strong>
          高复杂
        </span>
        <span>
          <strong>{stats.warningCount}</strong>
          数字项
        </span>
      </div>
    );
  }
  if (output?.module === 'script_world') {
    return (
      <div className="script-breakdown-detail__stats">
        <span>
          <strong>{stats.sceneCount}</strong>
          势力
        </span>
        <span>
          <strong>{stats.characterCount}</strong>
          证据
        </span>
        <span>
          <strong>{stats.propCount}</strong>
          待确认
        </span>
        <span>
          <strong>{stats.warningCount}</strong>
          风险
        </span>
      </div>
    );
  }
  if (output?.module === 'script_production') {
    return (
      <div className="script-breakdown-detail__stats">
        <span>
          <strong>{stats.sceneCount}</strong>
          统筹项
        </span>
        <span>
          <strong>{stats.characterCount}</strong>
          场景
        </span>
        <span>
          <strong>{stats.propCount}</strong>
          高复杂
        </span>
        <span>
          <strong>{stats.warningCount}</strong>
          夜外景
        </span>
      </div>
    );
  }
  if (output?.module === 'script_ai_assets') {
    return (
      <div className="script-breakdown-detail__stats">
        <span>
          <strong>{stats.sceneCount}</strong>
          资产
        </span>
        <span>
          <strong>{stats.characterCount}</strong>
          场景
        </span>
        <span>
          <strong>{stats.propCount}</strong>
          角色
        </span>
        <span>
          <strong>{stats.warningCount}</strong>
          平台
        </span>
      </div>
    );
  }
  return (
    <div className="script-breakdown-detail__stats">
      <span>
        <strong>{stats.sceneCount}</strong>
        场景
      </span>
      <span>
        <strong>{stats.characterCount}</strong>
        角色
      </span>
      <span>
        <strong>{stats.propCount}</strong>
        道具
      </span>
      <span>
        <strong>{stats.warningCount}</strong>
        待确认
      </span>
    </div>
  );
}

function ReviewTable({ issues }: { issues: ScriptReviewIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">质量复核报告</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>级别</th>
              <th>类别</th>
              <th>对象</th>
              <th>问题</th>
              <th>建议</th>
              <th>证据</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((item) => (
              <tr key={item.id}>
                <td>{item.severity}</td>
                <td>{item.category}</td>
                <td>{item.target}</td>
                <td>{item.summary}</td>
                <td>{item.recommendation}</td>
                <td>{item.evidence ? compact(item.evidence.excerpt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TimelineTable({ events }: { events: ScriptTimelineEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">时间线事件表</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>顺序</th>
              <th>场次</th>
              <th>故事日</th>
              <th>时间</th>
              <th>标记</th>
              <th>地点</th>
              <th>摘要</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.order}</td>
                <td>场{event.sceneNo}</td>
                <td>{event.storyDay}</td>
                <td>{event.timeOfDay}</td>
                <td>{event.marker}</td>
                <td>{event.location}</td>
                <td>{compact(event.summary)}</td>
                <td>{event.warnings.length ? event.warnings.join('；') : event.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TimelineConflictTable({ conflicts }: { conflicts: ScriptTimelineConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">时间线待确认</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>级别</th>
              <th>场次</th>
              <th>问题</th>
              <th>建议</th>
              <th>证据</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((item) => (
              <tr key={item.id}>
                <td>{item.severity}</td>
                <td>{item.sceneNo ? `场${item.sceneNo}` : '全局'}</td>
                <td>{item.summary}</td>
                <td>{item.recommendation}</td>
                <td>{item.evidence ? compact(item.evidence.excerpt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArtRequirementTable({ requirements }: { requirements: ScriptArtRequirement[] }) {
  if (requirements.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">美术统筹表</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>场次</th>
              <th>美术项</th>
              <th>风格</th>
              <th>氛围</th>
              <th>色彩</th>
              <th>需求</th>
              <th>复杂度</th>
              <th>待确认</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((item) => (
              <tr key={item.id}>
                <td>场{item.sceneNo}</td>
                <td>{item.title}</td>
                <td>{item.visualStyle}</td>
                <td>{item.mood}</td>
                <td>{listText(item.palette)}</td>
                <td>{compact(item.requirements.join('；'), 180)}</td>
                <td>{item.complexity}</td>
                <td>{item.warnings.length ? item.warnings.join('；') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VfxRequirementTable({ requirements }: { requirements: ScriptVfxRequirement[] }) {
  if (requirements.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">VFX需求表</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>场次</th>
              <th>特效类型</th>
              <th>类别</th>
              <th>复杂度</th>
              <th>制作方式</th>
              <th>底板需求</th>
              <th>资产需求</th>
              <th>风险</th>
              <th>待确认</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((item) => (
              <tr key={item.id}>
                <td>场{item.sceneNo}</td>
                <td>{item.effectType}</td>
                <td>{item.category}</td>
                <td>{item.complexity}</td>
                <td>{item.productionMethod}</td>
                <td>{listText(item.plateNeeds)}</td>
                <td>{listText(item.assetNeeds)}</td>
                <td>{compact(item.riskNotes.join('；'), 160)}</td>
                <td>{item.warnings.length ? item.warnings.join('；') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorldbuildingTable({ output }: { output: ScriptWorldbuildingOutput | null }) {
  if (!output) return null;
  const rows = [
    ['时代', output.era],
    ['文明结构', output.civilization],
    ['技术水平', output.technologyLevel],
    ['政治体系', output.politicalSystem],
    ['军事体系', output.militarySystem],
    ['宗教体系', output.religion],
    ['经济体系', output.economy],
    ['能量体系', output.energySystem],
    ['社会结构', output.socialStructure],
    ['建筑体系', output.architectureStyle],
    ['服装体系', output.clothingStyle],
    ['语言风格', output.languageStyle],
    ['势力结构', output.factions.join('、') || '—'],
  ];
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">世界观分析</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>字段</th>
              <th>推断结果</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {output.evidence.length ? (
        <div className="script-breakdown-detail__warnings">
          {output.evidence.map((item) => (
            <span key={`${item.sceneNo}-${item.excerpt}`}>场{item.sceneNo}：{compact(item.excerpt, 80)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProductionRequirementTable({ output }: { output: ScriptProductionOutput | null }) {
  if (!output || output.requirements.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">制片统筹表</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>场次</th>
              <th>部门</th>
              <th>事项</th>
              <th>复杂度</th>
              <th>资源需求</th>
              <th>通告备注</th>
              <th>风险</th>
              <th>待确认</th>
            </tr>
          </thead>
          <tbody>
            {output.requirements.map((item) => (
              <tr key={item.id}>
                <td>场{item.sceneNo}</td>
                <td>{item.department}</td>
                <td>{item.title}</td>
                <td>{item.complexity}</td>
                <td>{listText(item.resourceNeeds)}</td>
                <td>{compact(item.callSheetNotes.join('；'), 150)}</td>
                <td>{compact(item.riskNotes.join('；'), 150) || '—'}</td>
                <td>{item.warnings.length ? item.warnings.join('；') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiAssetPreview({
  asset,
  updateAsset,
  copyAsset,
  rewriteAsset,
}: {
  asset: ScriptAiPromptAsset;
  updateAsset: (id: string, patch: Partial<ScriptAiPromptAsset>) => void;
  copyAsset: (asset: ScriptAiPromptAsset) => void;
  rewriteAsset: (asset: ScriptAiPromptAsset) => void;
}) {
  const evidence = asset.evidence.slice(0, 6);
  const quality = aiAssetQuality(asset);
  return (
    <div className="script-ai-assets__preview">
      <div className="script-ai-assets__preview-head">
        <div>
          <div className="script-ai-assets__preview-title">{asset.title}</div>
          <div className="script-ai-assets__preview-meta">
            <span>{AI_ASSET_KIND_LABELS[asset.kind]}</span>
            <span>{AI_ASSET_PLATFORM_LABELS[asset.platform]}</span>
            <span>{aiAssetTarget(asset)}</span>
            <span>{AI_ASSET_STATUS_LABELS[aiAssetStatus(asset)]}</span>
          </div>
        </div>
        <div className="script-ai-assets__preview-actions">
          <button type="button" className="script-ai-assets__copy" onClick={() => copyAsset(asset)}>
            复制完整
          </button>
          <button type="button" className="script-ai-assets__copy" onClick={() => rewriteAsset(asset)}>
            按规则重写
          </button>
          <button type="button" className="script-ai-assets__copy" onClick={() => updateAsset(asset.id, { status: 'approved' })}>
            标记已确认
          </button>
          <button type="button" className="script-ai-assets__copy" onClick={() => updateAsset(asset.id, { status: 'needs_revision' })}>
            标记需修正
          </button>
        </div>
      </div>
      <div className="script-ai-assets__preview-grid">
        <section>
          <span>用途</span>
          <p>{asset.usage}</p>
        </section>
        <section>
          <span>平台参数</span>
          <p>{listText(asset.parameters)}</p>
        </section>
        <section>
          <span>待确认</span>
          <p>{asset.warnings.length ? asset.warnings.join('；') : '暂无'}</p>
        </section>
      </div>
      <div className="script-ai-assets__preview-block">
        <span>Prompt 质检 · {quality.score} 分</span>
        <p className={quality.issues.length ? 'script-ai-assets__quality-text' : 'script-ai-assets__quality-text script-ai-assets__quality-text--ok'}>
          {quality.issues.length ? quality.issues.join('；') : '通过：平台参数、描述结构和排除项完整。'}
        </p>
      </div>
      <div className="script-ai-assets__preview-block">
        <span>完整 Prompt</span>
        <pre>{asset.prompt}</pre>
      </div>
      {asset.negativePrompt ? (
        <div className="script-ai-assets__preview-block">
          <span>Negative Prompt</span>
          <pre>{asset.negativePrompt}</pre>
        </div>
      ) : null}
      {evidence.length ? (
        <div className="script-ai-assets__preview-block">
          <span>剧本证据</span>
          <pre>{aiAssetEvidenceText({ ...asset, evidence })}</pre>
        </div>
      ) : null}
      <label className="script-ai-assets__preview-note">
        <span>人工复核备注</span>
        <textarea
          value={asset.notes ?? ''}
          onChange={(event) => updateAsset(asset.id, { notes: event.target.value })}
          placeholder="例如：角色服装需要统一；场景光影需偏冷；生成后检查道具连续性。"
          spellCheck={false}
          rows={3}
        />
      </label>
    </div>
  );
}

function AiAssetQualityBadge({ asset }: { asset: ScriptAiPromptAsset }) {
  const quality = aiAssetQuality(asset);
  const ok = quality.issues.length === 0;
  return (
    <div className={`script-ai-assets__quality ${ok ? 'script-ai-assets__quality--ok' : 'script-ai-assets__quality--warn'}`}>
      <strong>{quality.score}</strong>
      <span>{ok ? '通过' : `${quality.issues.length} 项`}</span>
      {ok ? null : <small>{quality.issues.slice(0, 2).join('；')}</small>}
    </div>
  );
}

function AiAssetsTable({
  output,
  nodeId,
  patchNodeData,
  pushMessage,
}: {
  output: ScriptAiAssetsOutput | null;
  nodeId: string;
  patchNodeData: PatchNodeData;
  pushMessage: PushMessage;
}) {
  const [platformFilter, setPlatformFilter] = useState<AiAssetPlatformFilter>('all');
  const [kindFilter, setKindFilter] = useState<AiAssetKindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<AiAssetStatusFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  if (!output || output.assets.length === 0) return null;
  const query = searchText.trim().toLowerCase();
  const filteredAssets = output.assets.filter((item) => {
    if (platformFilter !== 'all' && item.platform !== platformFilter) return false;
    if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
    if (statusFilter !== 'all' && aiAssetStatus(item) !== statusFilter) return false;
    if (!query) return true;
    const haystack = [
      item.title,
      item.usage,
      item.prompt,
      item.negativePrompt,
      item.characterName,
      item.sceneNo ? `场${item.sceneNo}` : '',
      item.parameters.join(' '),
      aiAssetQuality(item).issues.join(' '),
      item.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
  const statusCounts = output.assets.reduce(
    (counts, item) => {
      counts[aiAssetStatus(item)] += 1;
      return counts;
    },
    { needs_review: 0, approved: 0, needs_revision: 0 } as Record<ScriptAiAssetStatus, number>,
  );
  const qualityIssueCount = output.assets.reduce((total, item) => total + aiAssetQuality(item).issues.length, 0);
  const patchAssets = (assets: ScriptAiPromptAsset[]) => {
    const nextOutput = rebuildAiAssetsOutput(output, assets);
    patchNodeData(nodeId, { output: nextOutput, review_result: nextOutput.summary }, true);
  };
  const updateAsset = (id: string, patch: Partial<ScriptAiPromptAsset>) => {
    const shouldRecheck = 'prompt' in patch || 'negativePrompt' in patch || 'parameters' in patch;
    patchAssets(
      output.assets.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch, updatedAt: Date.now() };
        return shouldRecheck ? applyScriptAiPromptQuality({ ...next, status: undefined }) : next;
      }),
    );
  };
  const recheckFiltered = () => {
    const ids = new Set(filteredAssets.map((item) => item.id));
    patchAssets(output.assets.map((item) => (ids.has(item.id) ? applyScriptAiPromptQuality(item) : item)));
    pushMessage({ role: 'system', text: `已重新质检 ${filteredAssets.length} 条 Prompt。`, nodeId });
  };
  const rewriteAsset = (asset: ScriptAiPromptAsset) => {
    const rewritten = rewriteScriptAiPromptAsset(asset);
    patchAssets(output.assets.map((item) => (item.id === asset.id ? rewritten : item)));
    pushMessage({
      role: 'system',
      text: `已按 ${AI_ASSET_PLATFORM_LABELS[asset.platform]} 规则重写「${asset.title}」。`,
      nodeId,
    });
  };
  const copyAsset = (asset: ScriptAiPromptAsset) => {
    copyText(aiAssetCopyText(asset), () => {
      pushMessage({ role: 'system', text: `已复制「${asset.title}」Prompt。`, nodeId });
    });
  };
  const copyFilteredAssets = () => {
    copyText(filteredAssets.map(aiAssetCopyText).join('\n\n---\n\n'), () => {
      pushMessage({ role: 'system', text: `已复制 ${filteredAssets.length} 条筛选后的 Prompt。`, nodeId });
    });
  };
  const markFiltered = (status: ScriptAiAssetStatus) => {
    const ids = new Set(filteredAssets.map((item) => item.id));
    patchAssets(
      output.assets.map((item) =>
        ids.has(item.id)
          ? {
              ...item,
              status,
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
    pushMessage({ role: 'system', text: `已将 ${filteredAssets.length} 条资产标记为${AI_ASSET_STATUS_LABELS[status]}。`, nodeId });
  };

  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">三平台影视概念设计 Prompt 工作台</div>
      <div className="script-ai-assets__toolbar">
        <label className="script-ai-assets__field">
          <span>平台</span>
          <select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value as AiAssetPlatformFilter)}
          >
            <option value="all">全部平台</option>
            {AI_ASSET_PLATFORM_OPTIONS.map((platform) => (
              <option key={platform} value={platform}>
                {AI_ASSET_PLATFORM_LABELS[platform]}
              </option>
            ))}
          </select>
        </label>
        <label className="script-ai-assets__field">
          <span>类型</span>
          <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as AiAssetKindFilter)}>
            <option value="all">全部类型</option>
            {AI_ASSET_KIND_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {AI_ASSET_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="script-ai-assets__field">
          <span>状态</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AiAssetStatusFilter)}>
            <option value="all">全部状态</option>
            {AI_ASSET_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {AI_ASSET_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="script-ai-assets__field script-ai-assets__field--search">
          <span>搜索</span>
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="标题、场次、角色、Prompt"
          />
        </label>
      </div>
      <div className="script-ai-assets__summary">
        <span>
          当前 {filteredAssets.length}/{output.assets.length} 条
        </span>
        <span>待确认 {statusCounts.needs_review}</span>
        <span>已确认 {statusCounts.approved}</span>
        <span>需修正 {statusCounts.needs_revision}</span>
        <span>质检问题 {qualityIssueCount}</span>
      </div>
      <div className="script-ai-assets__bulk-actions">
        <button type="button" className="detail-panel__secondary" onClick={copyFilteredAssets} disabled={filteredAssets.length === 0}>
          复制筛选结果
        </button>
        <button type="button" className="detail-panel__secondary" onClick={recheckFiltered} disabled={filteredAssets.length === 0}>
          重新质检
        </button>
        <button type="button" className="detail-panel__secondary" onClick={() => markFiltered('approved')} disabled={filteredAssets.length === 0}>
          筛选项标记已确认
        </button>
        <button
          type="button"
          className="detail-panel__secondary"
          onClick={() => markFiltered('needs_revision')}
          disabled={filteredAssets.length === 0}
        >
          筛选项标记需修正
        </button>
      </div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table script-ai-assets__table">
          <thead>
            <tr>
              <th>操作</th>
              <th>状态</th>
              <th>质检</th>
              <th>类型</th>
              <th>平台</th>
              <th>标题</th>
              <th>用途</th>
              <th>场次/角色</th>
              <th>Prompt</th>
              <th>修正备注</th>
              <th>参数</th>
              <th>待确认</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssets.map((item) => (
              <Fragment key={item.id}>
                <tr>
                  <td>
                    <div className="script-ai-assets__row-actions">
                      <button type="button" className="script-ai-assets__copy" onClick={() => copyAsset(item)}>
                        复制
                      </button>
                      <button type="button" className="script-ai-assets__copy" onClick={() => rewriteAsset(item)}>
                        重写
                      </button>
                      <button
                        type="button"
                        className="script-ai-assets__copy script-ai-assets__copy--muted"
                        onClick={() => setExpandedAssetId(expandedAssetId === item.id ? null : item.id)}
                      >
                        {expandedAssetId === item.id ? '收起' : '预览'}
                      </button>
                    </div>
                  </td>
                  <td>
                    <select
                      className="script-ai-assets__select"
                      value={aiAssetStatus(item)}
                      onChange={(event) => updateAsset(item.id, { status: event.target.value as ScriptAiAssetStatus })}
                    >
                      {AI_ASSET_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {AI_ASSET_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <AiAssetQualityBadge asset={item} />
                  </td>
                  <td>{AI_ASSET_KIND_LABELS[item.kind]}</td>
                  <td>{AI_ASSET_PLATFORM_LABELS[item.platform]}</td>
                  <td>{item.title}</td>
                  <td>{item.usage}</td>
                  <td>{aiAssetTarget(item)}</td>
                  <td>
                    <textarea
                      className="script-ai-assets__prompt"
                      value={item.prompt}
                      onChange={(event) => updateAsset(item.id, { prompt: event.target.value })}
                      spellCheck={false}
                      rows={5}
                    />
                  </td>
                  <td>
                    <textarea
                      className="script-ai-assets__note"
                      value={item.notes ?? ''}
                      onChange={(event) => updateAsset(item.id, { notes: event.target.value })}
                      placeholder="记录人工修正点"
                      spellCheck={false}
                      rows={5}
                    />
                  </td>
                  <td>{listText(item.parameters)}</td>
                  <td>{item.warnings.length ? item.warnings.join('；') : '—'}</td>
                </tr>
                {expandedAssetId === item.id ? (
                  <tr className="script-ai-assets__preview-row">
                    <td colSpan={12}>
                      <AiAssetPreview asset={item} updateAsset={updateAsset} copyAsset={copyAsset} rewriteAsset={rewriteAsset} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {filteredAssets.length === 0 ? (
              <tr>
                <td colSpan={12}>没有匹配的 AI 资产。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SceneTable({ scenes }: { scenes: ScriptSceneBreakdown[] }) {
  if (scenes.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">场景拆解表</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>场次</th>
              <th>地点</th>
              <th>内外</th>
              <th>时间</th>
              <th>角色</th>
              <th>道具</th>
              <th>摘要</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene) => (
              <tr key={scene.id}>
                <td>场{scene.sceneNo}</td>
                <td>{scene.location}</td>
                <td>{scene.interiorExterior}</td>
                <td>{scene.timeOfDay}</td>
                <td>{listText(scene.characters)}</td>
                <td>{listText(scene.props)}</td>
                <td>{compact(scene.summary)}</td>
                <td>{scene.warnings.length ? scene.warnings.join('；') : scene.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CharacterTable({ characters }: { characters: ScriptCharacterBreakdown[] }) {
  if (characters.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">角色分析表</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>角色</th>
              <th>场次</th>
              <th>对白</th>
              <th>证据</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {characters.map((character) => (
              <tr key={character.id}>
                <td>{character.name}</td>
                <td>场{character.sceneNos.join('、')}</td>
                <td>{character.dialogueCount}</td>
                <td>{compact(character.evidence[0]?.excerpt ?? character.actionHints[0] ?? '') || '—'}</td>
                <td>{character.warnings.length ? character.warnings.join('；') : character.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PropTable({ props }: { props: ScriptPropBreakdown[] }) {
  if (props.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">道具分析表</div>
      <div className="script-breakdown-detail__scroll">
        <table className="script-breakdown-detail__table">
          <thead>
            <tr>
              <th>道具</th>
              <th>类别</th>
              <th>场次</th>
              <th>证据</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {props.map((prop) => (
              <tr key={prop.id}>
                <td>{prop.name}</td>
                <td>{prop.category}</td>
                <td>场{prop.sceneNos.join('、')}</td>
                <td>{compact(prop.evidence[0]?.excerpt ?? '') || '—'}</td>
                <td>{prop.warnings.length ? prop.warnings.join('；') : prop.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PackageSummary({ output }: { output: ScriptPackageOutput }) {
  const warnings = output.warnings.slice(0, 8);
  if (warnings.length === 0) return null;
  return (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">待人工确认</div>
      <div className="script-breakdown-detail__warnings">
        {warnings.map((warning) => (
          <span key={warning}>{warning}</span>
        ))}
      </div>
    </div>
  );
}

export function ScriptBreakdownDetail(props: {
  node: StudioNodeData;
  patchNodeData: (id: string, patch: Partial<StudioNodeData>, bumpVersion?: boolean) => void;
  pushMessage: PushMessage;
}) {
  const { node, patchNodeData, pushMessage } = props;
  const output = isScriptBreakdownOutput(node.output) ? node.output : null;
  const isInput = node.type === 'script_input_node';
  const scenes = scenesFromOutput(output);
  const characters = charactersFromOutput(output);
  const propsRows = propsFromOutput(output);
  const issues = issuesFromOutput(output);
  const timelineEvents = timelineEventsFromOutput(output);
  const timelineConflicts = timelineConflictsFromOutput(output);
  const artRequirements = artRequirementsFromOutput(output);
  const vfxRequirements = vfxRequirementsFromOutput(output);
  const world = worldFromOutput(output);
  const production = productionFromOutput(output);
  const aiAssets = aiAssetsFromOutput(output);
  const rawText = node.raw_text ?? node.input ?? '';

  if (isInput) {
    return (
      <div className="script-breakdown-detail">
        <div className="detail-panel__section">
          <div className="detail-panel__hint">剧本输入</div>
          <textarea
            className="detail-panel__text-editor script-breakdown-detail__input"
            value={rawText}
            onChange={(event) => patchNodeData(node.id, { raw_text: event.target.value, input: event.target.value }, false)}
            placeholder="粘贴完整剧本或单场片段；在画布输入节点点击“剧本拆解”。"
            spellCheck={false}
            rows={18}
          />
          <p className="detail-panel__tip">
            当前输入 {rawText.trim().length.toLocaleString('zh-CN')} 字。画布上的“剧本拆解”会直接通过 /api/llm/chat 生成场景、角色、道具节点。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="script-breakdown-detail">
      <div className="detail-panel__section script-breakdown-detail__intro">
        <div className="detail-panel__hint">结构化结果</div>
        <StatsStrip output={output} />
        <ActionBar nodeId={node.id} output={output} pushMessage={pushMessage} />
        {!output ? (
          <p className="detail-panel__tip">
            暂无拆解结果：请在画布节点上运行当前节点，或在“拆解汇总”节点点击“AI 运行全链”。
          </p>
        ) : null}
        {output?.module === 'script_review' ? (
          <p className="detail-panel__tip detail-panel__tip--tight">{output.summary}</p>
        ) : null}
        {output?.module === 'script_art' ? (
          <p className="detail-panel__tip detail-panel__tip--tight">
            {output.summary}
            {output.palette.length ? ` 主色参考：${output.palette.join('、')}` : ''}
          </p>
        ) : null}
        {output?.module === 'script_vfx' ? (
          <p className="detail-panel__tip detail-panel__tip--tight">{output.summary}</p>
        ) : null}
        {output?.module === 'script_world' ? (
          <p className="detail-panel__tip detail-panel__tip--tight">{output.summary}</p>
        ) : null}
        {output?.module === 'script_production' ? (
          <p className="detail-panel__tip detail-panel__tip--tight">{output.summary}</p>
        ) : null}
        {output?.module === 'script_ai_assets' ? (
          <p className="detail-panel__tip detail-panel__tip--tight">{output.summary}</p>
        ) : null}
      </div>
      <ReviewTable issues={issues} />
      <TimelineConflictTable conflicts={timelineConflicts} />
      <TimelineTable events={timelineEvents} />
      <ArtRequirementTable requirements={artRequirements} />
      <VfxRequirementTable requirements={vfxRequirements} />
      <WorldbuildingTable output={world} />
      <ProductionRequirementTable output={production} />
      <AiAssetsTable output={aiAssets} nodeId={node.id} patchNodeData={patchNodeData} pushMessage={pushMessage} />
      {output?.module === 'script_package' ? <PackageSummary output={output} /> : null}
      <SceneTable scenes={scenes} />
      <CharacterTable characters={characters} />
      <PropTable props={propsRows} />
    </div>
  );
}
