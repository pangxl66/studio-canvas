import { getAuthSnapshot } from '@/services/authClient';
import type {
  ScriptAnalysisRequest,
  ScriptAnalysisResult,
  ScriptCharacter,
  ScriptProp,
  ScriptScene,
} from '@/types/scriptAnalysis';

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'script-analysis'
  );
}

function downloadBlob(filename: string, content: BlobPart, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join('、') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\r\n');
}

export async function analyzeScript(request: ScriptAnalysisRequest): Promise<ScriptAnalysisResult> {
  const { session } = await getAuthSnapshot();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch('/api/script/analyze', {
    body: JSON.stringify(request),
    headers,
    method: 'POST',
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | ScriptAnalysisResult
    | null;

  if (!response.ok) {
    const message =
      payload && 'error' in payload && payload.error?.message ? payload.error.message : '剧本分析失败。';
    throw new Error(message);
  }

  return payload as ScriptAnalysisResult;
}

export function downloadScriptAnalysisJson(result: ScriptAnalysisResult): void {
  const name = safeFileName(result.projectName);
  downloadBlob(
    `${name}-剧本拆解.json`,
    JSON.stringify(result, null, 2),
    'application/json;charset=utf-8',
  );
}

export function buildScriptAnalysisMarkdown(result: ScriptAnalysisResult): string {
  const lines = [
    `# ${result.projectName || '剧本分析'}`,
    '',
    `- 分析时间：${new Date(result.generatedAt).toLocaleString('zh-CN', { hour12: false })}`,
    `- 场景：${result.scenes.length}`,
    `- 角色：${result.characters.length}`,
    `- 道具：${result.props.length}`,
    `- 模式：${result.aiUsed ? 'AI 拆解' : '规则兜底'}`,
    '',
  ];

  if (result.warnings.length) {
    lines.push('## 提醒', '', ...result.warnings.map((item) => `- ${item}`), '');
  }

  lines.push('## 场景表', '');
  lines.push('| 场次 | 标题 | 地点 | 时间 | 人物 | 道具 | 摘要 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  result.scenes.forEach((scene) => {
    lines.push(
      `| ${scene.sceneNo} | ${scene.title} | ${scene.location} | ${scene.timeLabel} | ${scene.characters.join('、')} | ${scene.props.join('、')} | ${scene.summary.replace(/\|/g, '/')} |`,
    );
  });

  lines.push('', '## 角色表', '');
  lines.push('| ID | 名称 | 别名 | 出现数 | 描述 |');
  lines.push('| --- | --- | --- | --- | --- |');
  result.characters.forEach((character) => {
    lines.push(
      `| ${character.id} | ${character.name} | ${character.aliases.join('、')} | ${character.sceneCount} | ${character.description.replace(/\|/g, '/')} |`,
    );
  });

  lines.push('', '## 道具表', '');
  lines.push('| ID | 名称 | 类别 | 重要性 | 关联场景 |');
  lines.push('| --- | --- | --- | --- | --- |');
  result.props.forEach((prop) => {
    lines.push(`| ${prop.id} | ${prop.name} | ${prop.category} | ${prop.importance} | ${prop.sceneIds.join('、')} |`);
  });

  return lines.join('\n');
}

export function downloadScriptAnalysisMarkdown(result: ScriptAnalysisResult): void {
  const name = safeFileName(result.projectName);
  downloadBlob(`${name}-剧本拆解.md`, buildScriptAnalysisMarkdown(result), 'text/markdown;charset=utf-8');
}

export function downloadScriptAnalysisCsv(result: ScriptAnalysisResult): void {
  const name = safeFileName(result.projectName);
  const rows = result.scenes.map((scene) => ({
    sceneNo: scene.sceneNo,
    title: scene.title,
    intExt: scene.intExt,
    location: scene.location,
    timeLabel: scene.timeLabel,
    summary: scene.summary,
    characters: scene.characters,
    props: scene.props,
    confidence: scene.confidence,
    evidenceType: scene.evidenceType,
    notes: scene.notes,
  }));
  downloadBlob(
    `${name}-场景表.csv`,
    '\ufeff' +
      toCsv(
        ['sceneNo', 'title', 'intExt', 'location', 'timeLabel', 'summary', 'characters', 'props', 'confidence', 'evidenceType', 'notes'],
        rows,
      ),
    'text/csv;charset=utf-8',
  );
}

export async function downloadScriptAnalysisWorkbook(result: ScriptAnalysisResult): Promise<void> {
  const XLSX = await import('xlsx');
  const { saveAs } = await import('file-saver');
  const workbook = XLSX.utils.book_new();

  const overview = [
    {
      projectName: result.projectName,
      generatedAt: result.generatedAt,
      aiUsed: result.aiUsed,
      scenes: result.scenes.length,
      characters: result.characters.length,
      props: result.props.length,
      warnings: result.warnings.join('；'),
    },
  ];
  const sceneRows = result.scenes.map((scene: ScriptScene) => ({
    sceneNo: scene.sceneNo,
    title: scene.title,
    intExt: scene.intExt,
    location: scene.location,
    timeLabel: scene.timeLabel,
    summary: scene.summary,
    characters: scene.characters.join('、'),
    props: scene.props.join('、'),
    confidence: scene.confidence,
    evidenceType: scene.evidenceType,
    notes: scene.notes,
  }));
  const characterRows = result.characters.map((character: ScriptCharacter) => ({
    id: character.id,
    name: character.name,
    aliases: character.aliases.join('、'),
    firstSceneId: character.firstSceneId,
    sceneCount: character.sceneCount,
    description: character.description,
    status: character.status,
  }));
  const propRows = result.props.map((prop: ScriptProp) => ({
    id: prop.id,
    name: prop.name,
    category: prop.category,
    importance: prop.importance,
    sceneIds: prop.sceneIds.join('、'),
    notes: prop.notes,
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overview), '01_项目总览');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sceneRows), '02_场景表');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(characterRows), '03_角色表');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(propRows), '04_道具表');

  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8',
  });
  saveAs(blob, `${safeFileName(result.projectName)}-剧本拆解.xlsx`);
}
