import { type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useRef, useState, type ChangeEvent } from 'react';
import { analyzeStoryboardImageToOutput } from '@/services/storyboardImageAnalysis';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';

type ImageRF = Node<StudioNodeData, 'imageNode'>;

function ImageTableNodeInner({ id, data, selected }: NodeProps<ImageRF>) {
  const patchNodeData = useStudioStore((state) => state.patchNodeData);
  const addShotListNode = useStudioStore((state) => state.addShotListNode);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const focusNode = useStudioStore((state) => state.focusNode);
  const nodes = useStudioStore((state) => state.nodes);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pickImage = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onImagePicked = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        pushMessage({ role: 'system', text: '请选择图片文件。', nodeId: id });
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      patchNodeData(
        id,
        {
          imageDataUrl: dataUrl,
          imageMimeType: file.type,
          imageFileName: file.name,
          generation_error: undefined,
          imageAnalysisSummary: undefined,
          output: null,
        },
        true,
      );
      pushMessage({
        role: 'system',
        text: `已载入图片“${file.name}”，可以点击“解析表格”生成镜头表节点。`,
        nodeId: id,
      });
    },
    [id, patchNodeData, pushMessage],
  );

  const parseImage = useCallback(async () => {
    if (!data.imageDataUrl) {
      pushMessage({ role: 'system', text: '当前还没有图片，请先上传或粘贴表格截图。', nodeId: id });
      return;
    }
    const node = nodes.find((item) => item.id === id);
    const basePosition = node?.position ?? { x: 320, y: 240 };
    setBusy(true);
    patchNodeData(id, { generation_error: undefined }, false);
    try {
      const parsed = await analyzeStoryboardImageToOutput({ imageDataUrl: data.imageDataUrl });
      patchNodeData(
        id,
        {
          output: parsed.storyboard,
          imageAnalysisSummary: parsed.summary,
          generation_error: undefined,
        },
        true,
      );
      const shotListId = addShotListNode(
        { x: basePosition.x + 420, y: basePosition.y + 16 },
        parsed.storyboard,
        {
          importedFileName: data.imageFileName || '图片表格',
          importedSheetName: parsed.sheetTitle,
          importedRowCount: parsed.storyboard.shots.length,
          label: `${parsed.sheetTitle || '图片表格'} · ${data.imageFileName?.replace(/\.[^.]+$/u, '') || '解析结果'}`,
        },
      );
      pushMessage({
        role: 'system',
        text: `已从图片中解析出 ${parsed.storyboard.shots.length} 条镜头，并生成独立镜头表节点。`,
        nodeId: id,
      });
      focusNode(shotListId, { openDetail: true });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : '图片解析失败，请检查截图清晰度或模型网关设置。';
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
    } finally {
      setBusy(false);
    }
  }, [addShotListNode, data.imageDataUrl, data.imageFileName, focusNode, id, nodes, patchNodeData, pushMessage]);

  return (
    <div className={`image-table-node ${selected ? 'image-table-node--selected' : ''}`}>
      <header className="image-table-node__head">
        <span className="image-table-node__title">{data.label || '图片表格'}</span>
        <span className="image-table-node__badge">Image → 镜头表</span>
      </header>
      <div className="image-table-node__body">
        {data.imageDataUrl ? (
          <img className="image-table-node__preview" src={data.imageDataUrl} alt={data.imageFileName || '图片表格'} />
        ) : (
          <div className="image-table-node__empty">上传或粘贴表格截图后，可以一键解析为镜头表节点。</div>
        )}
        <div className="image-table-node__meta">{data.imageFileName?.trim() || '尚未载入图片'}</div>
        {data.imageAnalysisSummary?.trim() ? (
          <div className="image-table-node__summary">{data.imageAnalysisSummary.trim()}</div>
        ) : null}
        <div className="image-table-node__actions">
          <button type="button" className="image-table-node__btn image-table-node__btn--ghost" onClick={pickImage}>
            {data.imageDataUrl ? '更换图片' : '上传图片'}
          </button>
          <button type="button" className="image-table-node__btn" onClick={() => void parseImage()} disabled={busy}>
            {busy ? '解析中…' : '解析表格'}
          </button>
        </div>
        <input
          ref={inputRef}
          className="image-table-node__input"
          type="file"
          accept="image/*"
          onChange={onImagePicked}
        />
        {data.generation_error?.trim() ? (
          <div className="image-table-node__error">{data.generation_error.trim()}</div>
        ) : null}
      </div>
    </div>
  );
}

export const ImageTableNode = memo(ImageTableNodeInner);
