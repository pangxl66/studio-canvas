import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from 'docx';
import { saveAs } from 'file-saver';
import type { StandardScriptDocument, StandardScriptScene } from '@/components/writing/formatToStandardScript';
import {
  applyScriptExportHtmlBlockStyle,
  docxActionParagraphBase,
  docxCharacterParagraphBase,
  docxDialogueParagraphBase,
  docxSceneHeadingParagraphBase,
} from '@/utils/scriptExporter';

export function sanitizeScriptFilename(name: string) {
  const s = name.replace(/[/\\?%*:|"<>]/g, '_').trim().slice(0, 80);
  return s || '剧本';
}

const COURIER = 'Courier New';

function paragraphCenter(text: string) {
  return new Paragraph({
    text,
    alignment: AlignmentType.CENTER,
  });
}

function buildHollywoodSlug(sc: StandardScriptScene): string {
  const io = sc.inOut.includes('外') ? 'EXT.' : 'INT.';
  const time = sc.dayNight.includes('夜') ? 'NIGHT' : 'DAY';
  const loc = sc.sceneTitle.trim().toUpperCase() || `SCENE ${sc.globalIndex}`;
  return `${io} ${loc} - ${time}`;
}

function appendStoryboardDocx(children: Paragraph[], sc: StandardScriptScene) {
  if (!sc.storyboardComment) return;
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `【分镜建议】${sc.storyboardComment}`,
          italics: true,
          size: 20,
          color: '666666',
        }),
      ],
      spacing: { before: 80, after: 100 },
    }),
  );
}

function appendHollywoodSceneDocx(children: Paragraph[], sc: StandardScriptScene) {
  if (sc.isNewEpisode && sc.episodeTitle) {
    children.push(
      new Paragraph({
        text: sc.episodeTitle,
        heading: HeadingLevel.HEADING_2,
      }),
    );
  }
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: buildHollywoodSlug(sc),
          bold: true,
          font: COURIER,
          size: 24,
        }),
      ],
      ...docxSceneHeadingParagraphBase(),
    }),
  );
  if (sc.charactersLine) {
    const raw = sc.charactersLine.replace(/^登场：/, '').trim();
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: raw.toUpperCase(),
            font: COURIER,
            size: 22,
          }),
        ],
        ...docxCharacterParagraphBase(),
      }),
    );
  }
  appendStoryboardDocx(children, sc);
  for (const b of sc.blocks) {
    if (b.kind === 'dialogue') {
      const m = b.text.match(/^([^:：]{1,28})[：:]\s*([\s\S]+)$/);
      if (m) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: m[1].trim().toUpperCase(),
                font: COURIER,
                size: 24,
              }),
            ],
            ...docxCharacterParagraphBase(),
          }),
        );
        children.push(
          new Paragraph({
            children: [new TextRun({ text: m[2].trim(), font: COURIER, size: 24 })],
            ...docxDialogueParagraphBase(),
          }),
        );
      } else {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: b.text, font: COURIER, size: 24 })],
            ...docxDialogueParagraphBase(),
          }),
        );
      }
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: b.text, font: COURIER, size: 24 })],
          ...docxActionParagraphBase(),
        }),
      );
    }
  }
  children.push(new Paragraph({ text: '' }));
}

function appendChineseSceneDocx(
  children: Paragraph[],
  sc: StandardScriptScene,
  compactVertical: boolean,
) {
  if (sc.isNewEpisode && sc.episodeTitle) {
    children.push(
      new Paragraph({
        text: sc.episodeTitle,
        heading: HeadingLevel.HEADING_2,
      }),
    );
  }
  const titleSize = compactVertical ? 26 : 28;
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: sc.headingLine,
          bold: true,
          size: titleSize,
        }),
      ],
      ...docxSceneHeadingParagraphBase(),
    }),
  );
  if (sc.charactersLine) {
    children.push(
      new Paragraph({
        text: sc.charactersLine,
        ...docxCharacterParagraphBase(),
      }),
    );
  }
  appendStoryboardDocx(children, sc);
  for (const b of sc.blocks) {
    if (b.kind === 'dialogue') {
      const m = b.text.match(/^([^:：]{1,32})[：:]\s*([\s\S]+)$/);
      if (m) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: m[1].trim(), bold: true })],
            ...docxCharacterParagraphBase(),
          }),
        );
        children.push(
          new Paragraph({
            children: [new TextRun({ text: m[2].trim() })],
            ...docxDialogueParagraphBase(),
          }),
        );
      } else {
        children.push(
          new Paragraph({
            text: b.text,
            ...docxDialogueParagraphBase(),
          }),
        );
      }
    } else {
      children.push(
        new Paragraph({
          text: b.text,
          ...docxActionParagraphBase(),
        }),
      );
    }
  }
  children.push(new Paragraph({ text: '' }));
}

/** 导出 Microsoft Word .docx（封面、集数大纲、分场；模版由 doc.exportTemplate 决定） */
export async function exportStandardScriptDocx(doc: StandardScriptDocument, baseName: string) {
  const children: Paragraph[] = [];
  const tpl = doc.exportTemplate;

  children.push(
    new Paragraph({
      text: doc.cover.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
  );
  children.push(new Paragraph({ text: '' }));
  children.push(paragraphCenter(doc.cover.subtitle));
  for (const line of doc.cover.lines) {
    children.push(paragraphCenter(line));
  }
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(
    new Paragraph({
      text: '集数大纲',
      heading: HeadingLevel.HEADING_1,
    }),
  );
  for (const ep of doc.outline) {
    const label = ep.episodeNo != null ? `第${ep.episodeNo}集　${ep.title}` : ep.title;
    children.push(
      new Paragraph({
        text: label,
        heading: HeadingLevel.HEADING_2,
      }),
    );
    children.push(new Paragraph({ text: ep.summary || '（无梗概）' }));
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  const bodyHeading =
    tpl === 'vertical_short'
      ? '分场正文（竖屏 · 约 1–2 分钟/页）'
      : tpl === 'hollywood'
        ? '正文（好莱坞格式）'
        : '分场剧本正文';
  children.push(
    new Paragraph({
      text: bodyHeading,
      heading: HeadingLevel.HEADING_1,
    }),
  );

  if (tpl === 'vertical_short') {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '（短剧模版：每两场合分页，对应约 1–2 分钟竖屏进度，可按拍期合并或再拆。）',
            size: 18,
            color: '888888',
          }),
        ],
      }),
    );
  }

  doc.scenes.forEach((sc, i) => {
    if (tpl === 'vertical_short' && i > 0 && i % 2 === 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    if (tpl === 'hollywood') {
      appendHollywoodSceneDocx(children, sc);
    } else {
      appendChineseSceneDocx(children, sc, tpl === 'vertical_short');
    }
  });

  const document = new Document({
    creator: 'Studio Canvas',
    title: doc.cover.title,
    description: doc.cover.subtitle,
    sections: [
      {
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  saveAs(blob, `${sanitizeScriptFilename(baseName)}.docx`);
}

function appendStoryboardHtml(container: HTMLElement, sc: StandardScriptScene) {
  if (!sc.storyboardComment) return;
  const note = document.createElement('p');
  note.textContent = `【分镜建议】${sc.storyboardComment}`;
  note.style.cssText =
    'margin:8pt 0;font-size:10.5pt;font-style:italic;color:#555;white-space:pre-wrap;border-left:3px solid #ccc;padding-left:8pt;';
  container.appendChild(note);
}

function appendHollywoodSceneHtml(root: HTMLElement, sc: StandardScriptScene) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:18pt;font-family:Courier New,Consolas,monospace;font-size:11pt;';
  if (sc.isNewEpisode && sc.episodeTitle) {
    const eh = document.createElement('h3');
    eh.textContent = sc.episodeTitle;
    eh.style.cssText = 'font-size:12pt;margin:16pt 0 8pt;font-family:inherit;';
    wrap.appendChild(eh);
  }
  const slug = document.createElement('p');
  slug.textContent = buildHollywoodSlug(sc);
  applyScriptExportHtmlBlockStyle(slug, 'sceneHeading', { mono: true });
  wrap.appendChild(slug);
  if (sc.charactersLine) {
    const ch = document.createElement('p');
    ch.textContent = sc.charactersLine.replace(/^登场：/, '').trim().toUpperCase();
    applyScriptExportHtmlBlockStyle(ch, 'character', { mono: true });
    wrap.appendChild(ch);
  }
  appendStoryboardHtml(wrap, sc);
  for (const b of sc.blocks) {
    if (b.kind === 'dialogue') {
      const m = b.text.match(/^([^:：]{1,28})[：:]\s*([\s\S]+)$/);
      if (m) {
        const name = document.createElement('p');
        name.textContent = m[1].trim().toUpperCase();
        applyScriptExportHtmlBlockStyle(name, 'character', { mono: true });
        wrap.appendChild(name);
        const line = document.createElement('p');
        line.textContent = m[2].trim();
        applyScriptExportHtmlBlockStyle(line, 'dialogue', { mono: true });
        wrap.appendChild(line);
      } else {
        const p = document.createElement('p');
        p.textContent = b.text;
        applyScriptExportHtmlBlockStyle(p, 'dialogue', { mono: true });
        wrap.appendChild(p);
      }
    } else {
      const p = document.createElement('p');
      p.textContent = b.text;
      applyScriptExportHtmlBlockStyle(p, 'action', { mono: true });
      wrap.appendChild(p);
    }
  }
  root.appendChild(wrap);
}

function appendChineseSceneHtml(
  root: HTMLElement,
  sc: StandardScriptScene,
  compactVertical: boolean,
) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `margin-bottom:${compactVertical ? '14pt' : '20pt'};`;
  if (sc.isNewEpisode && sc.episodeTitle) {
    const eh = document.createElement('h3');
    eh.textContent = sc.episodeTitle;
    eh.style.cssText = 'font-size:13pt;margin:16pt 0 8pt;';
    wrap.appendChild(eh);
  }
  const sh = document.createElement('p');
  sh.textContent = sc.headingLine;
  applyScriptExportHtmlBlockStyle(sh, 'sceneHeading', {
    mono: false,
    compact: compactVertical,
    fontSizePt: compactVertical ? 11.5 : 12.5,
  });
  wrap.appendChild(sh);
  if (sc.charactersLine) {
    const ch = document.createElement('p');
    ch.textContent = sc.charactersLine;
    applyScriptExportHtmlBlockStyle(ch, 'character', { mono: false, fontSizePt: 11 });
    wrap.appendChild(ch);
  }
  appendStoryboardHtml(wrap, sc);
  for (const b of sc.blocks) {
    const el = document.createElement('p');
    el.textContent = b.text;
    if (b.kind === 'dialogue') {
      applyScriptExportHtmlBlockStyle(el, 'dialogue', { mono: false });
    } else {
      applyScriptExportHtmlBlockStyle(el, 'action', { mono: false });
    }
    wrap.appendChild(el);
  }
  root.appendChild(wrap);
}

function buildExportPdfRoot(doc: StandardScriptDocument): HTMLDivElement {
  const root = document.createElement('div');
  root.setAttribute('data-writing-export', 'pdf');
  const tpl = doc.exportTemplate;
  const mono = tpl === 'hollywood';
  root.style.cssText = [
    'box-sizing:border-box',
    'width:190mm',
    'padding:12mm 14mm',
    'background:#fff',
    'color:#1a1a1a',
    mono
      ? 'font-family:Courier New,Consolas,monospace'
      : 'font-family:"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,Georgia,serif',
    'font-size:12pt',
    'line-height:1.65',
  ].join(';');

  const cover = document.createElement('div');
  cover.style.textAlign = 'center';
  cover.style.marginBottom = '36pt';

  const h1 = document.createElement('h1');
  h1.textContent = doc.cover.title;
  h1.style.cssText = 'font-size:22pt;font-weight:700;margin:0 0 16pt;';
  cover.appendChild(h1);

  const sub = document.createElement('p');
  sub.textContent = doc.cover.subtitle;
  sub.style.cssText = 'font-size:14pt;margin:8pt 0;';
  cover.appendChild(sub);

  for (const line of doc.cover.lines) {
    const p = document.createElement('p');
    p.textContent = line;
    p.style.cssText = 'font-size:11pt;margin:6pt 0;color:#333;';
    cover.appendChild(p);
  }
  root.appendChild(cover);

  const outlineH = document.createElement('h2');
  outlineH.textContent = '集数大纲';
  outlineH.style.cssText = 'font-size:16pt;font-weight:700;border-bottom:1px solid #333;padding-bottom:6pt;margin:24pt 0 12pt;';
  root.appendChild(outlineH);

  for (const ep of doc.outline) {
    const h3 = document.createElement('h3');
    const n = ep.episodeNo != null ? `第${ep.episodeNo}集 ` : '';
    h3.textContent = `${n}${ep.title}`;
    h3.style.cssText = 'font-size:13pt;font-weight:600;margin:16pt 0 6pt;';
    root.appendChild(h3);
    const p = document.createElement('p');
    p.textContent = ep.summary || '（无梗概）';
    p.style.cssText = 'margin:0 0 12pt;white-space:pre-wrap;text-align:justify;';
    root.appendChild(p);
  }

  const bodyH = document.createElement('h2');
  bodyH.textContent =
    tpl === 'vertical_short'
      ? '分场正文（竖屏 · 约 1–2 分钟/页）'
      : tpl === 'hollywood'
        ? '正文（好莱坞格式）'
        : '分场剧本正文';
  bodyH.style.cssText = 'font-size:16pt;font-weight:700;border-bottom:1px solid #333;padding-bottom:6pt;margin:28pt 0 12pt;';
  root.appendChild(bodyH);

  if (tpl === 'vertical_short') {
    const hint = document.createElement('p');
    hint.textContent = '（短剧模版：每两场合分页，对应约 1–2 分钟竖屏进度。）';
    hint.style.cssText = 'font-size:10pt;color:#666;margin:0 0 16pt;';
    root.appendChild(hint);
  }

  const bodyWrap = document.createElement('div');
  doc.scenes.forEach((sc, i) => {
    if (tpl === 'vertical_short' && i > 0 && i % 2 === 0) {
      const br = document.createElement('div');
      br.style.cssText = 'page-break-before:always;height:1px;margin:0;padding:0;';
      bodyWrap.appendChild(br);
    }
    if (tpl === 'hollywood') {
      appendHollywoodSceneHtml(bodyWrap, sc);
    } else {
      appendChineseSceneHtml(bodyWrap, sc, tpl === 'vertical_short');
    }
  });
  root.appendChild(bodyWrap);

  return root;
}

/** 使用 html2canvas + jsPDF 导出 PDF */
export async function exportStandardScriptPdf(doc: StandardScriptDocument, baseName: string) {
  const { default: html2pdf } = await import('html2pdf.js');
  const el = buildExportPdfRoot(doc);
  el.style.position = 'fixed';
  el.style.left = '-12000px';
  el.style.top = '0';
  document.body.appendChild(el);

  const opt = {
    margin: [10, 10, 10, 10] as [number, number, number, number],
    filename: `${sanitizeScriptFilename(baseName)}.pdf`,
    image: { type: 'jpeg' as const, quality: 0.96 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
  };

  try {
    await html2pdf().set(opt).from(el).save();
  } finally {
    el.remove();
  }
}
