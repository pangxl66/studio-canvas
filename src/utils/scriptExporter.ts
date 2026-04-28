import { AlignmentType } from 'docx';
import type { IParagraphOptions } from 'docx';

/**
 * 剧本 / 分镜表导出共用排版配置（与 Word docx 一致：spacing、indent 单位为 TWIP，1 TWIP = 1/20 pt）
 */
export const SCRIPT_EXPORT_STYLES = {
  character: {
    alignment: AlignmentType.CENTER,
    spacing: { before: 240 },
  },
  dialogue: {
    alignment: AlignmentType.CENTER,
    indent: { left: 1440, right: 1440 },
  },
  action: {
    alignment: AlignmentType.LEFT,
    spacing: { before: 120, after: 120 },
  },
  sceneHeading: {
    shading: { fill: 'F0F0F0' } as const,
    bold: true,
  },
} as const;

/** 分镜表 PDF / 打印样式（与场次标题底纹一致） */
export const STORYBOARD_TABLE_EXPORT_STYLES = {
  headerBackground: '#F0F0F0',
  headerFontWeight: '700',
  borderColor: '#cccccc',
  cellBorderColor: '#dddddd',
  titleFontPt: 14,
  bodyFontPt: 8.5,
  cellPaddingPt: 5,
  pageFontStack: '"Noto Serif SC","Source Han Serif SC","Songti SC",SimSun,system-ui,sans-serif',
} as const;

export function scriptTwipToPt(tw: number): number {
  return tw / 20;
}

/** 将 docx TWIP 间距转为 CSS margin（仅上下） */
export function scriptHtmlVerticalMarginFromSpacing(beforeTw?: number, afterTw?: number): string {
  const t = scriptTwipToPt(beforeTw ?? 0);
  const b = scriptTwipToPt(afterTw ?? 0);
  return `${t}pt 0 ${b}pt 0`;
}

export type ScriptExportHtmlBlock = 'sceneHeading' | 'character' | 'dialogue' | 'action';

/**
 * 剧本 PDF（html2pdf）段落样式，与 SCRIPT_EXPORT_STYLES 对齐
 */
export function applyScriptExportHtmlBlockStyle(
  el: HTMLElement,
  kind: ScriptExportHtmlBlock,
  opts?: { mono?: boolean; compact?: boolean; fontSizePt?: number },
) {
  const mono = opts?.mono ?? false;
  const fs = opts?.fontSizePt ?? (mono ? 11 : 12);
  const font = mono ? 'Courier New,Consolas,monospace' : 'inherit';
  el.style.fontFamily = font;
  el.style.fontSize = `${fs}pt`;
  el.style.whiteSpace = 'pre-wrap';
  el.style.lineHeight = '1.5';

  switch (kind) {
    case 'sceneHeading': {
      el.style.fontWeight = '700';
      el.style.background = SCRIPT_EXPORT_STYLES.sceneHeading.shading.fill;
      el.style.padding = opts?.compact ? '5pt 8pt' : '6pt 10pt';
      el.style.margin = scriptHtmlVerticalMarginFromSpacing(0, 120);
      el.style.textAlign = 'left';
      break;
    }
    case 'character': {
      el.style.textAlign = 'center';
      el.style.fontWeight = '600';
      el.style.margin = scriptHtmlVerticalMarginFromSpacing(
        SCRIPT_EXPORT_STYLES.character.spacing.before,
        0,
      );
      break;
    }
    case 'dialogue': {
      el.style.textAlign = 'center';
      el.style.margin = '0';
      el.style.paddingTop = '0';
      el.style.paddingBottom = '0';
      el.style.paddingLeft = `${scriptTwipToPt(SCRIPT_EXPORT_STYLES.dialogue.indent.left)}pt`;
      el.style.paddingRight = `${scriptTwipToPt(SCRIPT_EXPORT_STYLES.dialogue.indent.right)}pt`;
      break;
    }
    case 'action': {
      el.style.textAlign = 'left';
      el.style.margin = scriptHtmlVerticalMarginFromSpacing(
        SCRIPT_EXPORT_STYLES.action.spacing.before,
        SCRIPT_EXPORT_STYLES.action.spacing.after,
      );
      break;
    }
  }
}

/** docx：场次标题段落（底纹 + 正文加粗由 TextRun 控制） */
export function docxSceneHeadingParagraphBase(): Pick<
  IParagraphOptions,
  'shading' | 'spacing'
> {
  return {
    shading: { fill: SCRIPT_EXPORT_STYLES.sceneHeading.shading.fill },
    spacing: { after: 160 },
  };
}

/** docx：角色名行 */
export function docxCharacterParagraphBase(): Pick<IParagraphOptions, 'alignment' | 'spacing'> {
  return {
    alignment: SCRIPT_EXPORT_STYLES.character.alignment,
    spacing: { before: SCRIPT_EXPORT_STYLES.character.spacing.before },
  };
}

/** docx：对白行 */
export function docxDialogueParagraphBase(): Pick<
  IParagraphOptions,
  'alignment' | 'indent'
> {
  return {
    alignment: SCRIPT_EXPORT_STYLES.dialogue.alignment,
    indent: { ...SCRIPT_EXPORT_STYLES.dialogue.indent },
  };
}

/** docx：动作 / 叙事段落 */
export function docxActionParagraphBase(): Pick<
  IParagraphOptions,
  'alignment' | 'spacing'
> {
  return {
    alignment: SCRIPT_EXPORT_STYLES.action.alignment,
    spacing: { ...SCRIPT_EXPORT_STYLES.action.spacing },
  };
}
