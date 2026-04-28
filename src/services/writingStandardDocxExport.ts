import type { WritingExportTemplateKind } from '@/components/writing/writingExportSkillBridge';
import { formatToStandardScript } from '@/components/writing/formatToStandardScript';
import { exportStandardScriptDocx } from '@/components/writing/writingScriptExport';
import type { WritingOutput } from '@/types/studio';

export type ExportWritingStandardDocxParams = {
  /** 节点标题 / 文件名基底 */
  workTitle: string;
  /** 与挂载 Skill 一致的导出模版 */
  template?: WritingExportTemplateKind;
  /** 是否在 docx 中附带分镜建议批注 */
  includeStoryboardNotes?: boolean;
};

/**
 * 将编剧部节点 `WritingOutput` JSON 导出为标准剧本 .docx。
 * 使用 `docx` 生成文档、`file-saver` 触发下载；排版与侧栏「Word 导出」一致：
 * 场次标题加粗 + 底纹、登场/角色名居中、对白段落两侧缩进；若对白为「角色：台词」则拆成角色行 + 对白行。
 */
export async function exportWritingJsonToStandardDocx(
  output: WritingOutput,
  params: ExportWritingStandardDocxParams,
): Promise<void> {
  const doc = formatToStandardScript(
    output,
    { workTitle: params.workTitle },
    {
      template: params.template ?? 'standard',
      includeStoryboardNotes: params.includeStoryboardNotes ?? false,
    },
  );
  await exportStandardScriptDocx(doc, params.workTitle);
}
