import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useRef, type ChangeEvent } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { StoryboardOutput, StudioNodeData } from '@/types/studio';
import { DEPT_OUTPUT_HANDLE_ID } from '@/utils/departmentInputWire';
import { SHOT_LIST_LINK_HANDLE_ID } from '@/utils/shotListWire';
import { parseStoryboardWorkbookFile } from '@/utils/storyboardWorkbook';

type StoryboardFileRF = Node<StudioNodeData, 'storyboardFile'>;

function firstShotPreview(output: StudioNodeData['output']): string {
  if (!output || typeof output !== 'object') return '';
  const storyboard = output as StoryboardOutput;
  if (!Array.isArray(storyboard.shots) || storyboard.shots.length === 0) return '';
  return storyboard.shots[0]?.description ?? '';
}

function shotCountFromOutput(data: StudioNodeData): number {
  if (typeof data.importedRowCount === 'number') return data.importedRowCount;
  if (!data.output || typeof data.output !== 'object') return 0;
  const storyboard = data.output as StoryboardOutput;
  return Array.isArray(storyboard.shots) ? storyboard.shots.length : 0;
}

function StoryboardFileNodeInner({ id, data, selected }: NodeProps<StoryboardFileRF>) {
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const pushMessage = useStudioStore((s) => s.pushMessage);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onFilePicked = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      try {
        const parsed = await parseStoryboardWorkbookFile(file);
        patchNodeData(
          id,
          {
            input: JSON.stringify(parsed.storyboard, null, 2),
            output: parsed.storyboard,
            importedFileName: file.name,
            importedSheetName: parsed.sheetName,
            importedRowCount: parsed.rowCount,
            generation_error: undefined,
            review_result: null,
          },
          true,
        );

        pushMessage({
          role: 'system',
          text: `已导入分镜表文件《${file.name}》，共解析 ${parsed.rowCount} 条镜头。`,
          nodeId: id,
        });
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : '分镜表文件解析失败，请检查 Excel 表头或文件内容。';
        patchNodeData(id, { generation_error: message }, false);
        pushMessage({ role: 'system', text: message, nodeId: id });
      }
    },
    [id, patchNodeData, pushMessage],
  );

  const shotCount = shotCountFromOutput(data);
  const previewText = firstShotPreview(data.output);

  return (
    <div className={`storyboard-file-node ${selected ? 'storyboard-file-node--selected' : ''}`}>
      <Handle
        type="source"
        position={Position.Bottom}
        id={SHOT_LIST_LINK_HANDLE_ID}
        className="storyboard-file-node__handle storyboard-file-node__handle--child"
        title="导入成功后会在下方自动生成并连接分镜表节点"
      />
      <header className="storyboard-file-node__head">
        <span className="storyboard-file-node__title">{data.label}</span>
        <span className="storyboard-file-node__badge">{'File -> Prompt'}</span>
      </header>
      <div className="storyboard-file-node__body">
        <div className="storyboard-file-node__meta">
          {data.importedFileName ? data.importedFileName : '未导入分镜表文件'}
        </div>
        <div className="storyboard-file-node__submeta">
          {data.importedSheetName ? `${data.importedSheetName} · ` : ''}
          {shotCount > 0 ? `${shotCount} 条镜头` : '支持 .xlsx / .xls'}
        </div>
        <p className="storyboard-file-node__preview">
          {previewText || '读取现有分镜表文件，解析后自动生成分镜表节点，也可直接连接 Prompt 节点。'}
        </p>
        <button type="button" className="storyboard-file-node__upload" onClick={pickFile}>
          {data.importedFileName ? '重新导入分镜表' : '导入分镜表'}
        </button>
        <input
          ref={inputRef}
          className="storyboard-file-node__input"
          type="file"
          accept=".xlsx,.xls"
          onChange={onFilePicked}
        />
        {data.generation_error?.trim() ? (
          <div className="storyboard-file-node__error">{data.generation_error.trim()}</div>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id={DEPT_OUTPUT_HANDLE_ID}
        className="storyboard-file-node__handle"
        title="输出已解析的分镜数据，可直接连接 Prompt 节点"
      />
    </div>
  );
}

export const StoryboardFileNode = memo(StoryboardFileNodeInner);
