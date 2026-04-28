import type { StoryboardOutput, StoryboardShot } from '@/types/studio';
import { saveAs } from 'file-saver';
import { STORYBOARD_TABLE_EXPORT_STYLES } from '@/utils/scriptExporter';

function sanitizeFilename(name: string) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim().slice(0, 72) || '分镜';
}

function csvCell(s: string): string {
  const t = String(s ?? '');
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

/** 英文表头：便于脚本 / 工具链解析（与协议字段一致） */
export function buildStoryboardShotlistCsvIntl(output: StoryboardOutput): string {
  const headers = ['id', 'type', 'movement', 'action', 'description', 'content', 'sceneRef'];
  const lines = [headers.join(',')];
  for (const s of output.shots) {
    const sh = s as StoryboardShot;
    const row = [
      sh.id,
      sh.type,
      sh.movement,
      typeof sh.action === 'string' ? sh.action : '',
      sh.description,
      typeof sh.content === 'string' ? sh.content : '',
      sh.sceneRef ?? '',
    ].map((x) => csvCell(String(x ?? '')));
    lines.push(row.join(','));
  }
  return lines.join('\r\n');
}

/**
 * 中文表头分镜清单：场次、镜头号、景别、运镜、画面、动作、台词，UTF-8 BOM 便于 Excel 直接打开。
 */
export function buildStoryboardShotlistCsvZh(output: StoryboardOutput): string {
  const headers = ['场次', '镜头号', '景别', '运镜', '画面描述', '动作', '台词'];
  const lines = [headers.join(',')];
  for (const s of output.shots) {
    const sh = s as StoryboardShot;
    const row = [
      sh.sceneRef?.trim() ? sh.sceneRef : '—',
      sh.id,
      sh.type,
      sh.movement,
      sh.description,
      typeof sh.action === 'string' ? sh.action : '',
      typeof sh.content === 'string' ? sh.content : '',
    ].map((x) => csvCell(String(x ?? '')));
    lines.push(row.join(','));
  }
  return lines.join('\r\n');
}

/** @deprecated 使用 buildStoryboardShotlistCsvIntl */
export function buildStoryboardShotlistCsv(output: StoryboardOutput): string {
  return buildStoryboardShotlistCsvIntl(output);
}

export function downloadStoryboardShotlistCsv(output: StoryboardOutput, baseLabel: string) {
  downloadStoryboardShotlistExcelCsv(output, baseLabel);
}

/** 中文表头 CSV，Excel 可直接打开（UTF-8 BOM）；文件名含「拍摄清单」便于线下传阅 */
export function downloadStoryboardShotlistExcelCsv(output: StoryboardOutput, baseLabel: string) {
  const bom = '\ufeff';
  const blob = new Blob([bom + buildStoryboardShotlistCsvZh(output)], {
    type: 'text/csv;charset=utf-8',
  });
  saveAs(blob, `${sanitizeFilename(baseLabel)}_拍摄清单.csv`);
}

/**
 * 纯文本拍摄清单（与表格列一致，便于打印预览或粘贴到文档）；
 * 数据须为当前节点 `output` 解析结果（含用户手改后的镜头）。
 */
export function buildStoryboardShootingListPlainText(output: StoryboardOutput): string {
  const beatBlock =
    output.narrativeBeats.length > 0
      ? `【场次节拍】\n${output.narrativeBeats.map((b) => `· ${b}`).join('\n')}\n\n`
      : '';
  const rows = output.shots.map((s) => {
    const lines: string[] = [];
    if (s.sceneRef?.trim()) lines.push(`场次：${s.sceneRef.trim()}`);
    lines.push(`镜头号：${s.id}`, `景别：${s.type}`, `运镜：${s.movement}`, `画面：${s.description}`);
    if (typeof s.action === 'string' && s.action.trim()) lines.push(`动作：${s.action.trim()}`);
    lines.push(
      `台词：${typeof s.content === 'string' && s.content !== '' ? s.content : '（无）'}`,
    );
    return lines.join('\n');
  });
  return `${beatBlock}【拍摄清单 · 共 ${output.shots.length} 镜】\n\n${rows.join('\n\n────────\n\n')}`;
}

export function downloadStoryboardShotlistCsvIntl(output: StoryboardOutput, baseLabel: string) {
  const bom = '\ufeff';
  const blob = new Blob([bom + buildStoryboardShotlistCsvIntl(output)], {
    type: 'text/csv;charset=utf-8',
  });
  saveAs(blob, `${sanitizeFilename(baseLabel)}_分镜表_en.csv`);
}

function buildShotlistPdfRoot(output: StoryboardOutput, title: string): HTMLDivElement {
  const S = STORYBOARD_TABLE_EXPORT_STYLES;
  const root = document.createElement('div');
  root.style.cssText = [
    'box-sizing:border-box',
    'width:190mm',
    'padding:10mm',
    `font-family:${S.pageFontStack}`,
    `font-size:${S.bodyFontPt}pt`,
    'color:#111',
    'background:#fff',
  ].join(';');
  const h = document.createElement('h1');
  h.textContent = `${title} · 拍摄清单`;
  h.style.cssText = `font-size:${S.titleFontPt}pt;margin:0 0 ${S.cellPaddingPt + 3}pt;font-weight:700;`;
  root.appendChild(h);
  const table = document.createElement('table');
  table.style.cssText = `width:100%;border-collapse:collapse;font-size:${S.bodyFontPt}pt;`;
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const col of ['#', '景别', '运镜', '动作', '画面', '台词', '场次']) {
    const th = document.createElement('th');
    th.textContent = col;
    th.style.cssText = [
      `border:1px solid ${S.borderColor}`,
      `padding:${S.cellPaddingPt}px`,
      'text-align:left',
      `background:${S.headerBackground}`,
      `font-weight:${S.headerFontWeight}`,
    ].join(';');
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = document.createElement('tbody');
  for (const s of output.shots) {
    const sh = s as StoryboardShot;
    const tr = document.createElement('tr');
    const cells = [
      String(sh.id),
      sh.type,
      sh.movement,
      typeof sh.action === 'string' ? sh.action : '',
      sh.description,
      typeof sh.content === 'string' ? sh.content : '',
      sh.sceneRef ?? '',
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      td.style.cssText = [
        `border:1px solid ${S.cellBorderColor}`,
        `padding:${S.cellPaddingPt}px`,
        'vertical-align:top',
        'word-break:break-word',
        'line-height:1.45',
      ].join(';');
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  root.appendChild(table);
  return root;
}

export async function downloadStoryboardShotlistPdf(output: StoryboardOutput, baseLabel: string) {
  const html2pdf = (await import('html2pdf.js')).default;
  const el = buildShotlistPdfRoot(output, baseLabel);
  el.style.position = 'fixed';
  el.style.left = '-12000px';
  el.style.top = '0';
  document.body.appendChild(el);
  try {
    await html2pdf()
      .set({
        margin: [8, 8, 8, 8] as [number, number, number, number],
        filename: `${sanitizeFilename(baseLabel)}_拍摄清单.pdf`,
        image: { type: 'jpeg' as const, quality: 0.92 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'landscape' as const },
      })
      .from(el)
      .save();
  } finally {
    el.remove();
  }
}
