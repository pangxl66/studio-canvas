import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';

type ImageRF = Node<StudioNodeData, 'imageNode'>;

export const IMAGE_NODE_OUTPUT_HANDLE_ID = 'out';

function ImageTableNodeInner({ id, data, selected }: NodeProps<ImageRF>) {
  const patchNodeData = useStudioStore((state) => state.patchNodeData);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

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
          label: data.label?.trim() || file.name.replace(/\.[^.]+$/u, '') || '图片节点',
        },
        true,
      );
      setImageSize(null);
      pushMessage({
        role: 'system',
        text: `已载入图片“${file.name}”。连接到文本卡片后，可作为文本润色的视觉参考。`,
        nodeId: id,
      });
    },
    [data.label, id, patchNodeData, pushMessage],
  );

  const onPreviewLoaded = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setImageSize({ width: naturalWidth, height: naturalHeight });
    }
  }, []);

  const title = data.imageFileName?.trim() || data.label?.trim() || '截图';
  const dimensionLabel = imageSize ? `${imageSize.width} x ${imageSize.height}` : data.imageDataUrl ? 'Image' : '未上传';

  return (
    <div className={`image-table-node ${data.imageDataUrl ? 'image-table-node--loaded' : ''} ${selected ? 'image-table-node--selected' : ''}`}>
      <header className="image-table-node__head">
        <span className="image-table-node__title">
          <span className="image-table-node__title-icon" aria-hidden />
          <span className="image-table-node__title-text">{title}</span>
        </span>
        <span className="image-table-node__dimension">{dimensionLabel}</span>
      </header>
      <div className="image-table-node__media">
        {data.imageDataUrl ? (
          <img
            className="image-table-node__preview"
            src={data.imageDataUrl}
            alt={data.imageFileName || '图片节点'}
            onLoad={onPreviewLoaded}
          />
        ) : (
          <button type="button" className="image-table-node__empty" onClick={pickImage}>
            <span className="image-table-node__empty-title">添加图片参考</span>
            <span className="image-table-node__empty-copy">上传或粘贴图片后，可连接到文本卡片参与 LLM 润色。</span>
          </button>
        )}
      </div>
      <div className="image-table-node__body">
        {data.imageAnalysisSummary?.trim() ? (
          <div className="image-table-node__summary">{data.imageAnalysisSummary.trim()}</div>
        ) : null}
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
      <Handle
        type="source"
        position={Position.Right}
        id={IMAGE_NODE_OUTPUT_HANDLE_ID}
        className="image-table-node__handle"
        title="Output：连接到文本卡片后，润色会结合图片画面。"
      />
    </div>
  );
}

export const ImageTableNode = memo(ImageTableNodeInner);
