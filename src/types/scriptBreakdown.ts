export type ScriptBreakdownModule =
  | 'script_scenes'
  | 'script_characters'
  | 'script_props'
  | 'script_package'
  | 'script_review'
  | 'script_timeline'
  | 'script_art'
  | 'script_vfx'
  | 'script_world'
  | 'script_production'
  | 'script_ai_assets';

export type ScriptConfidence = 'high' | 'medium' | 'low';

export interface ScriptEvidenceRef {
  sceneNo?: number;
  excerpt: string;
}

export interface ScriptSceneBreakdown {
  id: string;
  sceneNo: number;
  title: string;
  location: string;
  interiorExterior: '内景' | '外景' | '内外景待确认';
  timeOfDay: string;
  characters: string[];
  props: string[];
  summary: string;
  sourceText: string;
  confidence: ScriptConfidence;
  warnings: string[];
}

export interface ScriptCharacterBreakdown {
  id: string;
  name: string;
  aliases: string[];
  firstSceneNo: number;
  sceneNos: number[];
  actionHints: string[];
  dialogueCount: number;
  evidence: ScriptEvidenceRef[];
  confidence: ScriptConfidence;
  warnings: string[];
}

export interface ScriptPropBreakdown {
  id: string;
  name: string;
  category: string;
  sceneNos: number[];
  notes: string[];
  evidence: ScriptEvidenceRef[];
  confidence: ScriptConfidence;
  warnings: string[];
}

export interface ScriptBreakdownStats {
  sourceLength: number;
  warningCount: number;
}

export type ScriptReviewSeverity = 'blocker' | 'warning' | 'info';

export type ScriptReviewCategory =
  | 'scene_structure'
  | 'character'
  | 'prop'
  | 'continuity'
  | 'production'
  | 'schema';

export interface ScriptReviewIssue {
  id: string;
  severity: ScriptReviewSeverity;
  category: ScriptReviewCategory;
  target: string;
  summary: string;
  recommendation: string;
  evidence?: ScriptEvidenceRef;
}

export type ScriptTimelineMarker = 'present' | 'flashback' | 'future' | 'montage' | 'unknown';

export interface ScriptTimelineEvent {
  id: string;
  sceneNo: number;
  order: number;
  storyDay: string;
  timeOfDay: string;
  marker: ScriptTimelineMarker;
  location: string;
  summary: string;
  evidence: ScriptEvidenceRef;
  confidence: ScriptConfidence;
  warnings: string[];
}

export interface ScriptTimelineConflict {
  id: string;
  severity: 'warning' | 'info';
  sceneNo?: number;
  summary: string;
  recommendation: string;
  evidence?: ScriptEvidenceRef;
}

export type ScriptArtCategory = 'set' | 'environment' | 'lighting' | 'color' | 'costume' | 'texture';

export type ScriptArtComplexity = 'low' | 'medium' | 'high';

export interface ScriptArtRequirement {
  id: string;
  sceneNo: number;
  category: ScriptArtCategory;
  title: string;
  visualStyle: string;
  mood: string;
  palette: string[];
  requirements: string[];
  references: string[];
  complexity: ScriptArtComplexity;
  evidence: ScriptEvidenceRef;
  warnings: string[];
}

export type ScriptVfxCategory = 'digital' | 'practical' | 'makeup' | 'environment' | 'creature' | 'stunt';

export type ScriptVfxComplexity = 'low' | 'medium' | 'high';

export interface ScriptVfxRequirement {
  id: string;
  sceneNo: number;
  category: ScriptVfxCategory;
  title: string;
  effectType: string;
  complexity: ScriptVfxComplexity;
  productionMethod: string;
  plateNeeds: string[];
  assetNeeds: string[];
  riskNotes: string[];
  evidence: ScriptEvidenceRef;
  warnings: string[];
}

export interface ScriptScenesOutput {
  module: 'script_scenes';
  createdAt: number;
  sourceNodeId?: string;
  scenes: ScriptSceneBreakdown[];
  warnings: string[];
  stats: ScriptBreakdownStats & {
    sceneCount: number;
  };
}

export interface ScriptCharactersOutput {
  module: 'script_characters';
  createdAt: number;
  sourceNodeId?: string;
  characters: ScriptCharacterBreakdown[];
  warnings: string[];
  stats: ScriptBreakdownStats & {
    characterCount: number;
  };
}

export interface ScriptPropsOutput {
  module: 'script_props';
  createdAt: number;
  sourceNodeId?: string;
  props: ScriptPropBreakdown[];
  warnings: string[];
  stats: ScriptBreakdownStats & {
    propCount: number;
  };
}

export interface ScriptPackageOutput {
  module: 'script_package';
  createdAt: number;
  scenes: ScriptSceneBreakdown[];
  characters: ScriptCharacterBreakdown[];
  props: ScriptPropBreakdown[];
  warnings: string[];
  stats: ScriptBreakdownStats & {
    sceneCount: number;
    characterCount: number;
    propCount: number;
  };
}

export interface ScriptReviewOutput {
  module: 'script_review';
  createdAt: number;
  issues: ScriptReviewIssue[];
  pass: boolean;
  summary: string;
  warnings: string[];
  stats: ScriptBreakdownStats & {
    issueCount: number;
    blockerCount: number;
    warningIssueCount: number;
  };
}

export interface ScriptTimelineOutput {
  module: 'script_timeline';
  createdAt: number;
  events: ScriptTimelineEvent[];
  conflicts: ScriptTimelineConflict[];
  warnings: string[];
  stats: ScriptBreakdownStats & {
    eventCount: number;
    dayCount: number;
    conflictCount: number;
    unknownTimeCount: number;
  };
}

export interface ScriptArtDirectionOutput {
  module: 'script_art';
  createdAt: number;
  requirements: ScriptArtRequirement[];
  palette: string[];
  summary: string;
  warnings: string[];
  stats: ScriptBreakdownStats & {
    requirementCount: number;
    sceneCount: number;
    highComplexityCount: number;
  };
}

export interface ScriptVfxOutput {
  module: 'script_vfx';
  createdAt: number;
  requirements: ScriptVfxRequirement[];
  summary: string;
  warnings: string[];
  stats: ScriptBreakdownStats & {
    requirementCount: number;
    sceneCount: number;
    highComplexityCount: number;
    digitalCount: number;
  };
}

export interface ScriptWorldbuildingOutput {
  module: 'script_world';
  createdAt: number;
  era: string;
  civilization: string;
  technologyLevel: string;
  politicalSystem: string;
  militarySystem: string;
  religion: string;
  economy: string;
  energySystem: string;
  socialStructure: string;
  architectureStyle: string;
  clothingStyle: string;
  languageStyle: string;
  factions: string[];
  evidence: ScriptEvidenceRef[];
  summary: string;
  warnings: string[];
  stats: ScriptBreakdownStats & {
    factionCount: number;
    evidenceCount: number;
  };
}

export type ScriptProductionDepartment =
  | 'location'
  | 'cast'
  | 'art'
  | 'props'
  | 'vfx'
  | 'stunt'
  | 'makeup'
  | 'weather'
  | 'night'
  | 'animal_vehicle';

export type ScriptProductionComplexity = 'low' | 'medium' | 'high';

export interface ScriptProductionRequirement {
  id: string;
  sceneNo: number;
  department: ScriptProductionDepartment;
  title: string;
  complexity: ScriptProductionComplexity;
  resourceNeeds: string[];
  callSheetNotes: string[];
  riskNotes: string[];
  evidence: ScriptEvidenceRef;
  warnings: string[];
}

export interface ScriptProductionOutput {
  module: 'script_production';
  createdAt: number;
  requirements: ScriptProductionRequirement[];
  summary: string;
  warnings: string[];
  stats: ScriptBreakdownStats & {
    requirementCount: number;
    sceneCount: number;
    highComplexityCount: number;
    nightExteriorCount: number;
    locationCount: number;
  };
}

export type ScriptAiAssetPlatform = 'midjourney' | 'gpt_image_2' | 'nanobanana';

export type ScriptAiAssetKind =
  | 'scene_prompt'
  | 'character_prompt'
  | 'prop_prompt'
  | 'cinematic_prompt'
  | 'lighting_prompt'
  | 'style_prompt';

export type ScriptAiAssetStatus = 'needs_review' | 'approved' | 'needs_revision';

export interface ScriptAiPromptAsset {
  id: string;
  kind: ScriptAiAssetKind;
  platform: ScriptAiAssetPlatform;
  title: string;
  prompt: string;
  negativePrompt?: string;
  usage: string;
  sceneNo?: number;
  characterName?: string;
  parameters: string[];
  evidence: ScriptEvidenceRef[];
  warnings: string[];
  qualityIssues?: string[];
  qualityScore?: number;
  lastQualityCheckAt?: number;
  status?: ScriptAiAssetStatus;
  notes?: string;
  updatedAt?: number;
}

export interface ScriptAiAssetsOutput {
  module: 'script_ai_assets';
  createdAt: number;
  assets: ScriptAiPromptAsset[];
  summary: string;
  warnings: string[];
  stats: ScriptBreakdownStats & {
    assetCount: number;
    scenePromptCount: number;
    characterPromptCount: number;
    propPromptCount: number;
    cinematicPromptCount: number;
    platformCount: number;
    qualityIssueCount: number;
  };
}

export type ScriptBreakdownOutput =
  | ScriptScenesOutput
  | ScriptCharactersOutput
  | ScriptPropsOutput
  | ScriptPackageOutput
  | ScriptReviewOutput
  | ScriptTimelineOutput
  | ScriptArtDirectionOutput
  | ScriptVfxOutput
  | ScriptWorldbuildingOutput
  | ScriptProductionOutput
  | ScriptAiAssetsOutput;
