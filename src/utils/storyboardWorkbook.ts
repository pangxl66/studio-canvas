import type { StoryboardOutput, StoryboardShot } from '@/types/studio';
import { createStoryboardShotWireId } from '@/utils/shotListWire';

type WorkbookImportResult = {
  storyboard: StoryboardOutput;
  sheetName: string;
  rowCount: number;
};

type HeaderField =
  | 'sequence'
  | 'shotNo'
  | 'description'
  | 'dialogue'
  | 'sound'
  | 'movement'
  | 'shotType'
  | 'scene'
  | 'role'
  | 'prop'
  | 'note';

type HeaderMap = Record<HeaderField, number>;

const HEADER_ALIASES: Record<HeaderField, string[]> = {
  sequence: ['序号', '编号', '序列', '镜序', '镜次'],
  shotNo: ['镜头号', '镜头编号', '镜号', 'shotno', 'shot', '镜头'],
  description: [
    '制作内容文字描述',
    '制作内容描述',
    '制作内容',
    '画面内容动作视觉环境',
    '画面内容动作视觉',
    '画面内容',
    '镜头内容',
    '内容描述',
    '文字描述',
    '画面描述',
    '分镜描述',
    '分镜内容',
  ],
  dialogue: ['台词', '对白', '人物对白', '台词对白', '台词音效备注'],
  sound: ['音效bgm', '音效', 'bgm', '音乐', '声音'],
  movement: ['镜头运动', '运镜', '摄影机运动', '机位运动'],
  shotType: ['景别', '景型'],
  scene: ['场景', '场次', '场号', '场别'],
  role: ['角色', '人物', '出场人物', '角色人物'],
  prop: ['道具', '关键道具', '道具服化'],
  note: ['备注', '镜头反馈', '反馈', '补充说明', '说明', '制作备注'],
};

const REQUIRED_HEADER_FIELDS: HeaderField[] = ['description'];

function asText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function normalizeHeaderText(value: string): string {
  return asText(value).replace(/\s+/g, '').replace(/[：:]/g, '').toLowerCase();
}

function countNonEmptyCells(row: string[]): number {
  return row.reduce((count, cellValue) => (asText(cellValue) ? count + 1 : count), 0);
}

function findColumnIndex(headerRow: string[], aliases: string[]): number {
  const normalizedAliases = new Set(aliases.map(normalizeHeaderText));
  return headerRow.findIndex((cellValue) => normalizedAliases.has(normalizeHeaderText(cellValue)));
}

function buildHeaderMap(headerRow: string[]): HeaderMap {
  return {
    sequence: findColumnIndex(headerRow, HEADER_ALIASES.sequence),
    shotNo: findColumnIndex(headerRow, HEADER_ALIASES.shotNo),
    description: findColumnIndex(headerRow, HEADER_ALIASES.description),
    dialogue: findColumnIndex(headerRow, HEADER_ALIASES.dialogue),
    sound: findColumnIndex(headerRow, HEADER_ALIASES.sound),
    movement: findColumnIndex(headerRow, HEADER_ALIASES.movement),
    shotType: findColumnIndex(headerRow, HEADER_ALIASES.shotType),
    scene: findColumnIndex(headerRow, HEADER_ALIASES.scene),
    role: findColumnIndex(headerRow, HEADER_ALIASES.role),
    prop: findColumnIndex(headerRow, HEADER_ALIASES.prop),
    note: findColumnIndex(headerRow, HEADER_ALIASES.note),
  };
}

function findHeaderIndex(rows: string[][]): number {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index].map(asText);
    if (countNonEmptyCells(row) < 3) continue;
    const headerMap = buildHeaderMap(row);
    const hitCount = Object.values(headerMap).filter((columnIndex) => columnIndex >= 0).length;
    const requiredSatisfied = REQUIRED_HEADER_FIELDS.every((field) => headerMap[field] >= 0);
    if (requiredSatisfied && hitCount >= 3) return index;
  }
  return -1;
}

function cell(row: string[], index: number): string {
  if (index < 0 || index >= row.length) return '';
  return asText(row[index]);
}

function normalizeShotId(sequenceText: string, shotNo: string, fallbackId: number): number {
  const fromSequence = Number.parseInt(sequenceText, 10);
  if (Number.isFinite(fromSequence) && fromSequence > 0) return fromSequence;

  const fromShotNo = shotNo.match(/(\d+)(?!.*\d)/)?.[1];
  if (fromShotNo) {
    const parsed = Number.parseInt(fromShotNo, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return fallbackId;
}

function isSceneMarkerRow(row: string[]): boolean {
  const joined = row.map(asText).filter(Boolean).join(' ');
  return /第[一二三四五六七八九十\d]+场/.test(joined) || /场次[:：]/.test(joined);
}

function buildNarrativeBeats(shots: StoryboardShot[], sheetName: string): string[] {
  const scenes = Array.from(new Set(shots.map((shot) => shot.sceneRef?.trim()).filter(Boolean)));
  if (scenes.length > 0) {
    return scenes.map((scene, index) => `场次 ${index + 1}：${scene}`);
  }
  return [`已从表格 ${sheetName} 解析 ${shots.length} 条镜头。`];
}

function normalizeShot(
  row: string[],
  headerMap: HeaderMap,
  fallbackId: number,
  currentSceneRef: string | null,
): StoryboardShot | null {
  const sequenceText = cell(row, headerMap.sequence);
  const shotNo = cell(row, headerMap.shotNo);
  const description = cell(row, headerMap.description);
  const dialogue = cell(row, headerMap.dialogue);
  const sound = cell(row, headerMap.sound);
  const movement = cell(row, headerMap.movement);
  const shotType = cell(row, headerMap.shotType);
  const scene = cell(row, headerMap.scene) || currentSceneRef || '';
  const role = cell(row, headerMap.role);
  const prop = cell(row, headerMap.prop);
  const noteText = cell(row, headerMap.note);

  if (!sequenceText && !shotNo && !description && !dialogue && !sound) {
    return null;
  }

  const id = normalizeShotId(sequenceText, shotNo, fallbackId);
  const content = dialogue;
  const noteParts = [
    role ? `角色:${role}` : '',
    prop ? `道具:${prop}` : '',
    noteText ? `备注:${noteText}` : '',
  ].filter(Boolean);

  return {
    id,
    shotNo: shotNo || undefined,
    wireId: createStoryboardShotWireId(id),
    type: shotType || '中景',
    movement: movement || '固定',
    description: description || shotNo || `镜头 ${id}`,
    content,
    sceneRef: scene || undefined,
    action: description || undefined,
    sound: sound || undefined,
    note: noteParts.length > 0 ? noteParts.join('\n') : undefined,
  };
}

function rowsToStoryboard(rows: string[][], sheetName: string): WorkbookImportResult {
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) {
    throw new Error('未识别到可用分镜表头，请确认文件中至少包含镜头号、制作内容描述等关键列。');
  }

  const headerRow = rows[headerIndex].map(asText);
  const headerMap = buildHeaderMap(headerRow);
  if (headerMap.description < 0 || (headerMap.shotNo < 0 && headerMap.sequence < 0)) {
    throw new Error('分镜表缺少关键列，至少需要镜头号/序号和制作内容描述列。');
  }

  let currentSceneRef: string | null = null;
  const shots: StoryboardShot[] = [];

  for (const rawRow of rows.slice(headerIndex + 1)) {
    const row = rawRow.map(asText);
    if (countNonEmptyCells(row) === 0) continue;

    if (isSceneMarkerRow(row)) {
      currentSceneRef = row.find((cellText) => cellText.trim()) ?? currentSceneRef;
      continue;
    }

    const shot = normalizeShot(row, headerMap, shots.length + 1, currentSceneRef);
    if (shot) shots.push(shot);
  }

  if (shots.length === 0) {
    throw new Error('分镜表中没有解析到有效镜头行。');
  }

  return {
    storyboard: {
      shots,
      narrativeBeats: buildNarrativeBeats(shots, sheetName),
    },
    sheetName,
    rowCount: shots.length,
  };
}

export async function parseStoryboardWorkbookFile(file: File): Promise<WorkbookImportResult> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetNames = workbook.SheetNames.filter(Boolean);
  if (sheetNames.length === 0) {
    throw new Error('Excel 文件里没有可读取的工作表。');
  }

  let lastError: Error | null = null;
  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, defval: '' });
    try {
      return rowsToStoryboard(rows.map((row) => row.map(asText)), sheetName);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('分镜表文件解析失败，请检查工作表内容。');
}
