import { formatToStandardScript } from '@/components/writing/formatToStandardScript';
import type { WritingExportTemplateKind } from '@/components/writing/writingExportSkillBridge';
import type { WritingOutput } from '@/types/studio';

export async function runWritingScriptExport(opts: {
  output: WritingOutput;
  workTitle: string;
  template: WritingExportTemplateKind;
  format: 'docx' | 'pdf';
  includeStoryboardNotes?: boolean;
}): Promise<void> {
  const doc = formatToStandardScript(
    opts.output,
    { workTitle: opts.workTitle },
    {
      template: opts.template,
      includeStoryboardNotes: opts.includeStoryboardNotes ?? false,
    },
  );
  if (opts.format === 'docx') {
    const { exportStandardScriptDocx } = await import('@/components/writing/writingScriptExport');
    await exportStandardScriptDocx(doc, opts.workTitle);
    return;
  }
  const { exportStandardScriptPdf } = await import('@/components/writing/writingScriptExport');
  await exportStandardScriptPdf(doc, opts.workTitle);
}
