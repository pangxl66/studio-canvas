import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useMemo, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import {
  STORYBOARD_GRID_IMAGE_MODEL,
  buildStoryboardGridPrompt,
  generateStoryboardGridImage,
  resolveStoryboardGridSource,
} from '@/services/storyboardGridImage';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';

type ImageRF = Node<StudioNodeData, 'imageNode'>;

export const IMAGE_NODE_OUTPUT_HANDLE_ID = 'out';
export const IMAGE_NODE_INPUT_HANDLE_ID = 'in';

function ImageTableNodeInner({ id, data, selected }: NodeProps<ImageRF>) {
  const patchNodeData = useStudioStore((state) => state.patchNodeData);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const nodes = useStudioStore((state) => state.nodes);
  const edges = useStudioStore((state) => state.edges);
  const currentProjectId = useStudioStore((state) => state.currentProjectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const source = useMemo(() => resolveStoryboardGridSource(id, nodes, edges), [edges, id, nodes]);
  const isGenerating = data.imageGenerationStatus === 'generating';

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
          imageGenerationModel: undefined,
          imageGenerationSourceShotIds: undefined,
          imageGenerationSourceNodeIds: undefined,
          imageGenerationCompletedAt: undefined,
          imageGenerationStatus: 'idle',
          output: null,
          label: data.label?.trim() || file.name.replace(/\.[^.]+$/u, '') || '图片节点',
        },
        true,
      );
      setImageSize(null);
      pushMessage({
        role: 'system',
        text: `已载入图片“${file.name}”。连接到文本卡片可参与润色，连接到分镜节点可作为场景设定参考。`,
        nodeId: id,
      });
    },
    [data.label, id, patchNodeData, pushMessage],
  );

  const generateGrid = useCallback(async () => {
    if (!source.shots.length) {
      const message = '请先把分镜表节点、分镜部门节点，或镜头表中的镜头端口连接到图片节点左侧。';
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
      return;
    }

    const prompt = buildStoryboardGridPrompt(source.shots, data.imageGenerationPrompt);
    patchNodeData(
      id,
      {
        imageGenerationStatus: 'generating',
        generation_error: undefined,
        status: 'IN_PROGRESS',
      },
      false,
    );
    pushMessage({
      role: 'system',
      text: `正在使用 ${STORYBOARD_GRID_IMAGE_MODEL} 根据 ${source.shots.length} 个镜头生成九宫格……`,
      nodeId: id,
    });

    try {
      const result = await generateStoryboardGridImage(prompt, currentProjectId);
      const now = Date.now();
      patchNodeData(
        id,
        {
          imageDataUrl: result.imageDataUrl,
          imageMimeType: 'image/jpeg',
          imageFileName: `storyboard-grid-${now}.jpg`,
          imageAnalysisSummary: `由 ${source.shots.length} 个分镜镜头生成 · ${source.sourceLabels.join('、')}`,
          imageGenerationModel: result.model,
          imageGenerationSourceShotIds: source.shots.map((shot) => shot.id),
          imageGenerationSourceNodeIds: source.sourceNodeIds,
          imageGenerationCompletedAt: now,
          imageGenerationStatus: 'idle',
          generation_error: undefined,
          status: 'APPROVED',
          output: {
            kind: 'storyboard_grid_image',
            model: result.model,
            size: result.size,
            sourceShotIds: source.shots.map((shot) => shot.id),
            sourceNodeIds: source.sourceNodeIds,
          },
          label: data.label?.trim() || '分镜九宫格',
        },
        true,
      );
      setImageSize(null);
      pushMessage({
        role: 'system',
        text: `九宫格已生成，读取了 ${source.shots.length} 个镜头的场景、角色、道具和镜头信息。`,
        nodeId: id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '九宫格生成失败。';
      patchNodeData(
        id,
        { imageGenerationStatus: 'idle', generation_error: message, status: 'REJECTED' },
        false,
      );
      pushMessage({ role: 'system', text: message, nodeId: id });
    }
  }, [currentProjectId, data.imageGenerationPrompt, data.label, id, patchNodeData, pushMessage, source]);

  const onPreviewLoaded = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setImageSize({ width: naturalWidth, height: naturalHeight });
    }
  }, []);

  const title = data.imageFileName?.trim() || data.label?.trim() || '截图';
  const dimensionLabel = imageSize ? `${imageSize.width} x ${imageSize.height}` : data.imageDataUrl ? 'Image' : '未上传';

  return (
    <div className={`image-table-node ${data.imageDataUrl ? 'image-table-node--loaded' : ''} ${data.imageGenerationModel ? 'image-table-node--grid' : ''} ${selected ? 'image-table-node--selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={IMAGE_NODE_INPUT_HANDLE_ID}
        className="image-table-node__handle image-table-node__handle--input"
        title="Input：连接分镜表、分镜部门，或镜头表中的单个镜头。"
      />
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
            <span className="image-table-node__empty-copy">上传或粘贴图片后，可连接到文本卡片或分镜节点。</span>
          </button>
        )}
      </div>
      <div className="image-table-node__body">
        <div className="image-table-node__source">
          <span>{source.shots.length ? `已读取 ${source.shots.length} 个镜头` : '等待分镜连线'}</span>
          {source.totalAvailable > source.shots.length ? <span>取前 9 个</span> : null}
        </div>
        <textarea
          className="image-table-node__instruction nodrag nowheel"
          value={data.imageGenerationPrompt ?? ''}
          rows={2}
          maxLength={1000}
          placeholder="可选：补充画风、色调、时代或构图要求"
          onChange={(event) => patchNodeData(id, { imageGenerationPrompt: event.target.value }, false)}
        />
        <div className="image-table-node__actions nodrag">
          <button type="button" onClick={generateGrid} disabled={isGenerating || !source.shots.length}>
            {isGenerating ? '正在生成九宫格…' : data.imageDataUrl ? '重新生成九宫格' : '生成九宫格'}
          </button>
          <button type="button" className="image-table-node__upload" onClick={pickImage} disabled={isGenerating}>
            本地上传
          </button>
        </div>
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
        title="Output：连接到文本卡片或分镜节点。"
      />
    </div>
  );
}

export const ImageTableNode = memo(ImageTableNodeInner);
