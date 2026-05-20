import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import { analyzeImageReference } from '@/services/imageReferenceAnalysis';
import { analyzeStoryboardImageToOutput } from '@/services/storyboardImageAnalysis';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';

type ImageRF = Node<StudioNodeData, 'imageNode'>;

export const IMAGE_NODE_OUTPUT_HANDLE_ID = 'out';

type ImageBusyMode = 'visual' | 'table' | null;

function ImageTableNodeInner({ id, data, selected }: NodeProps<ImageRF>) {
  const patchNodeData = useStudioStore((state) => state.patchNodeData);
  const addShotListNode = useStudioStore((state) => state.addShotListNode);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const focusNode = useStudioStore((state) => state.focusNode);
  const nodes = useStudioStore((state) => state.nodes);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busyMode, setBusyMode] = useState<ImageBusyMode>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const busy = busyMode != null;

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
        text: `已载入图片“${file.name}”。可以点击“分析画面”，或连接到文本卡片后点击文本润色。`,
        nodeId: id,
      });
    },
    [data.label, id, patchNodeData, pushMessage],
  );

  const analyzeVisual = useCallback(async () => {
    if (!data.imageDataUrl) {
      pushMessage({ role: 'system', text: '当前还没有图片，请先上传或粘贴图片。', nodeId: id });
      return;
    }
    setBusyMode('visual');
    patchNodeData(id, { generation_error: undefined }, false);
    try {
      const summary = await analyzeImageReference({ imageDataUrl: data.imageDataUrl });
      patchNodeData(
        id,
        {
          imageAnalysisSummary: summary,
          generation_error: undefined,
          review_result: '画面分析已生成，可作为文本润色的视觉参考。',
        },
        true,
      );
      pushMessage({ role: 'system', text: '图片画面分析已完成。', nodeId: id });
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : '图片画面分析失败。';
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
    } finally {
      setBusyMode(null);
    }
  }, [data.imageDataUrl, id, patchNodeData, pushMessage]);

  const parseImage = useCallback(async () => {
    if (!data.imageDataUrl) {
      pushMessage({ role: 'system', text: '当前还没有图片，请先上传或粘贴表格截图。', nodeId: id });
      return;
    }
    const node = nodes.find((item) => item.id === id);
    const basePosition = node?.position ?? { x: 320, y: 240 };
    setBusyMode('table');
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
      setBusyMode(null);
    }
  }, [addShotListNode, data.imageDataUrl, data.imageFileName, focusNode, id, nodes, patchNodeData, pushMessage]);

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
      {selected ? (
        <div className="image-table-node__selected-toolbar nowheel nopan">
          <button
            type="button"
            className="image-table-node__toolbar-btn"
            onClick={() => void analyzeVisual()}
            disabled={busy}
            title={busyMode === 'visual' ? '正在分析画面' : '分析画面'}
          >
            <span className="image-table-node__toolbar-icon image-table-node__toolbar-icon--analyze" aria-hidden />
            <span>{busyMode === 'visual' ? '分析中' : '分析画面'}</span>
          </button>
          <button
            type="button"
            className="image-table-node__toolbar-btn"
            onClick={() => void parseImage()}
            disabled={busy}
            title={busyMode === 'table' ? '正在解析表格' : '解析表格'}
          >
            <span className="image-table-node__toolbar-icon image-table-node__toolbar-icon--grid" aria-hidden />
            <span>{busyMode === 'table' ? '解析中' : '解析表格'}</span>
          </button>
          <span className="image-table-node__toolbar-divider" aria-hidden />
          <button
            type="button"
            className="image-table-node__toolbar-btn image-table-node__toolbar-btn--icon"
            onClick={pickImage}
            disabled={busy}
            aria-label={data.imageDataUrl ? '替换图片' : '上传图片'}
            title={data.imageDataUrl ? '替换图片' : '上传图片'}
          >
            <span className="image-table-node__toolbar-icon image-table-node__toolbar-icon--upload" aria-hidden />
          </button>
        </div>
      ) : null}
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
          <button type="button" className="image-table-node__empty" onClick={pickImage} disabled={busy}>
            <span className="image-table-node__empty-title">添加图片参考</span>
            <span className="image-table-node__empty-copy">上传或粘贴图片后，可连接到文本卡片参与 LLM 润色。</span>
          </button>
        )}
        {busy ? (
          <span className="image-table-node__busy">{busyMode === 'visual' ? '分析画面中' : '解析表格中'}</span>
        ) : null}
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
