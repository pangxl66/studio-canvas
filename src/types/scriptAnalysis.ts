export type ScriptAnalysisConfidence = 'high' | 'medium' | 'low';

export type ScriptAnalysisEvidenceType = 'explicit' | 'inferred' | 'tbc';

export type ScriptAnalysisStatus = 'ai_generated' | 'user_confirmed' | 'edited' | 'rejected' | 'tbc';

export type ScriptTextBlock = {
  id: string;
  orderNo: number;
  pageNo: number | null;
  text: string;
  charStart: number;
  charEnd: number;
};

export type ScriptScene = {
  id: string;
  sceneNo: number;
  title: string;
  intExt: string;
  location: string;
  timeLabel: string;
  summary: string;
  characters: string[];
  props: string[];
  sourceText: string;
  sourceBlockIds: string[];
  confidence: ScriptAnalysisConfidence;
  evidenceType: ScriptAnalysisEvidenceType;
  notes: string;
  status: ScriptAnalysisStatus;
};

export type ScriptCharacter = {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  firstSceneId: string | null;
  sceneCount: number;
  sourceText: string;
  sourceBlockIds: string[];
  confidence: ScriptAnalysisConfidence;
  evidenceType: ScriptAnalysisEvidenceType;
  notes: string;
  status: ScriptAnalysisStatus;
};

export type ScriptProp = {
  id: string;
  name: string;
  category: string;
  ownerCharacterId: string | null;
  importance: 'key' | 'normal' | 'background';
  sceneIds: string[];
  sourceText: string;
  sourceBlockIds: string[];
  confidence: ScriptAnalysisConfidence;
  evidenceType: ScriptAnalysisEvidenceType;
  notes: string;
  status: ScriptAnalysisStatus;
};

export type ScriptLocation = {
  id: string;
  name: string;
  type: string;
  sceneIds: string[];
  description: string;
};

export type ScriptAnalysisResult = {
  analysisId: string;
  projectName: string;
  sourceType: 'paste' | 'file' | 'fallback';
  generatedAt: string;
  modelUsed: string | null;
  aiUsed: boolean;
  warnings: string[];
  stats: {
    textChars: number;
    blockCount: number;
    sceneCount: number;
    characterCount: number;
    propCount: number;
  };
  textBlocks: ScriptTextBlock[];
  scenes: ScriptScene[];
  characters: ScriptCharacter[];
  props: ScriptProp[];
  locations: ScriptLocation[];
};

export type ScriptAnalysisRequest = {
  projectName?: string;
  scriptText: string;
  sourceType?: 'paste' | 'file';
};
