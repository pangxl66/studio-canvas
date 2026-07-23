import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';
import {
  STORYBOARD_GRID_IMAGE_MODEL,
  STORYBOARD_GRID_MAX_PANELS,
  buildStoryboardGridPrompt,
  generateStoryboardGridImage,
  paginateStoryboardGridSources,
  resolveStoryboardGridSource,
  storyboardGridActionLabel,
} from '@/services/storyboardGridImage';
import { useStudioStore } from '@/store/useStudioStore';
import type { StoryboardGridImagePage, StudioNodeData } from '@/types/studio';
import { imageNodeLayout } from '@/utils/imageNodeLayout';

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
  const generationAbortRef = useRef<AbortController | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const source = useMemo(() => resolveStoryboardGridSource(id, nodes, edges), [edges, id, nodes]);
  const isGenerating = data.imageGenerationStatus === 'generating';
  const generatedPages = useMemo(() => data.storyboardGridImages ?? [], [data.storyboardGridImages]);
  const activePage = generatedPages[previewPageIndex] ?? generatedPages[0];
  const previewUrl = activePage?.imageDataUrl ?? data.imageDataUrl;
  const actionLabel = storyboardGridActionLabel(source.shots.length);

  useEffect(() => () => generationAbortRef.current?.abort(), []);

  useEffect(() => {
    if (previewPageIndex >= generatedPages.length && generatedPages.length) setPreviewPageIndex(0);
    setImageSize(null);
  }, [generatedPages, previewPageIndex]);

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
          imageWidth: undefined,
          imageHeight: undefined,
          generation_error: undefined,
          imageAnalysisSummary: undefined,
          imageColorAnalysisSummary: undefined,
          imageGenerationModel: undefined,
          imageGenerationSourceShotIds: undefined,
          imageGenerationSourceNodeIds: undefined,
          imageGenerationCompletedAt: undefined,
          imageGenerationStatus: 'idle',
          imageGenerationCompletedPages: undefined,
          imageGenerationTotalPages: undefined,
          storyboardGridImages: undefined,
          output: null,
          label: data.label?.trim() || file.name.replace(/\.[^.]+$/u, '') || '图片节点',
        },
        true,
      );
      setImageSize(null);
      pushMessage({
        role: 'system',
        text: `已载入图片“${file.name}”。连接到文本卡片可参与润色，连接到分镜节点可作为场景参考，连接到 Prompt 节点可作为色彩表。`,
        nodeId: id,
      });
    },
    [data.label, id, patchNodeData, pushMessage],
  );

  const generateGrid = useCallback(async () => {
    if (isGenerating) {
      generationAbortRef.current?.abort();
      pushMessage({ role: 'system', text: '正在停止分镜宫格图片生成……', nodeId: id });
      return;
    }
    if (!source.shots.length) {
      const message = '请先把分镜表节点、分镜部门节点，或镜头表中的镜头端口连接到图片节点左侧。';
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
      return;
    }

    const sourcePages = paginateStoryboardGridSources(source.shotSources);
    const abortController = new AbortController();
    generationAbortRef.current = abortController;
    patchNodeData(
      id,
      {
        imageGenerationStatus: 'generating',
        imageGenerationCompletedPages: 0,
        imageGenerationTotalPages: sourcePages.length,
        generation_error: undefined,
        status: 'IN_PROGRESS',
      },
      false,
    );
    pushMessage({
      role: 'system',
      text: `正在使用 ${STORYBOARD_GRID_IMAGE_MODEL} 根据 ${source.shots.length} 个唯一镜头生成 ${sourcePages.length} 张分镜宫格……`,
      nodeId: id,
    });

    try {
      const pages: StoryboardGridImagePage[] = [];
      for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex += 1) {
        const pageSources = sourcePages[pageIndex];
        const prompt = buildStoryboardGridPrompt(
          pageSources.map((item) => item.shot),
          data.imageGenerationPrompt,
        );
        const result = await generateStoryboardGridImage(prompt, currentProjectId, abortController.signal);
        const completedAt = Date.now();
        pages.push({
          id: `storyboard-grid-${completedAt}-${pageIndex + 1}`,
          imageDataUrl: result.imageDataUrl,
          model: result.model,
          size: result.size,
          panelCount: pageSources.length,
          pageIndex: pageIndex + 1,
          totalPages: sourcePages.length,
          completedAt,
          panels: pageSources.map((item, panelIndex) => ({
            panelIndex: panelIndex + 1,
            sourceNodeId: item.sourceNodeId,
            sourceLabel: item.sourceLabel,
            shotId: item.shot.id,
            shotNo: item.shot.shotNo,
          })),
        });
        patchNodeData(
          id,
          { imageGenerationCompletedPages: pageIndex + 1, imageGenerationTotalPages: sourcePages.length },
          false,
        );
      }

      const now = Date.now();
      const firstPage = pages[0];
      const pageMetadata = pages.map(({ imageDataUrl: _imageDataUrl, ...page }) => page);
      patchNodeData(
        id,
        {
          imageDataUrl: firstPage.imageDataUrl,
          imageMimeType: 'image/jpeg',
          imageFileName: `storyboard-grid-${now}.jpg`,
          imageWidth: undefined,
          imageHeight: undefined,
          imageAnalysisSummary: `由 ${source.shots.length} 个唯一镜头生成 ${pages.length} 张分镜宫格 · ${source.sourceLabels.join('、')}`,
          imageGenerationModel: firstPage.model,
          imageGenerationSourceShotIds: source.shots.map((shot) => shot.id),
          imageGenerationSourceNodeIds: source.sourceNodeIds,
          imageGenerationCompletedAt: now,
          imageGenerationStatus: 'idle',
          imageGenerationCompletedPages: undefined,
          imageGenerationTotalPages: undefined,
          storyboardGridImages: pages,
          generation_error: undefined,
          status: 'APPROVED',
          output: {
            kind: 'storyboard_grid_images',
            model: firstPage.model,
            size: firstPage.size,
            pageCount: pages.length,
            sourceShotIds: source.shots.map((shot) => shot.id),
            sourceNodeIds: source.sourceNodeIds,
            pages: pageMetadata,
          },
          label: data.label?.trim() || '分镜宫格',
        },
        true,
      );
      setImageSize(null);
      setPreviewPageIndex(0);
      pushMessage({
        role: 'system',
        text: `已按 ${source.shots.length} 个唯一镜头生成 ${pages.length} 张分镜宫格，每个镜头严格对应一个画面。`,
        nodeId: id,
      });
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      const message = cancelled
        ? '已停止分镜宫格图片生成。'
        : error instanceof Error
          ? error.message
          : '分镜宫格生成失败。';
      patchNodeData(
        id,
        {
          imageGenerationStatus: 'idle',
          imageGenerationCompletedPages: undefined,
          imageGenerationTotalPages: undefined,
          generation_error: cancelled ? undefined : message,
          status: data.imageDataUrl ? 'APPROVED' : cancelled ? 'NOT_STARTED' : 'REJECTED',
        },
        false,
      );
      pushMessage({ role: 'system', text: message, nodeId: id });
    } finally {
      if (generationAbortRef.current === abortController) generationAbortRef.current = null;
    }
  }, [currentProjectId, data.imageDataUrl, data.imageGenerationPrompt, data.label, id, isGenerating, patchNodeData, pushMessage, source]);

  const onPreviewLoaded = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (naturalWidth > 0 && naturalHeight > 0) {
        setImageSize({ width: naturalWidth, height: naturalHeight });
        if (data.imageWidth !== naturalWidth || data.imageHeight !== naturalHeight) {
          patchNodeData(id, { imageWidth: naturalWidth, imageHeight: naturalHeight }, false);
        }
      }
    },
    [data.imageHeight, data.imageWidth, id, patchNodeData],
  );

  const persistedImageSize =
    typeof data.imageWidth === 'number' && data.imageWidth > 0 && typeof data.imageHeight === 'number' && data.imageHeight > 0
      ? { width: data.imageWidth, height: data.imageHeight }
      : null;
  const displayedImageSize = imageSize ?? persistedImageSize;
  const layout = imageNodeLayout(displayedImageSize?.width, displayedImageSize?.height);
  const nodeStyle = { width: `${layout.nodeWidth}px` } satisfies CSSProperties;
  const mediaStyle = previewUrl
    ? ({ height: `${layout.mediaHeight}px`, aspectRatio: 'auto' } satisfies CSSProperties)
    : undefined;

  const title = data.imageFileName?.trim() || data.label?.trim() || '截图';
  const dimensionLabel = activePage
    ? `${activePage.pageIndex}/${activePage.totalPages}`
    : displayedImageSize
      ? `${displayedImageSize.width} x ${displayedImageSize.height}`
      : data.imageDataUrl
        ? 'Image'
        : '未上传';

  return (
    <div
      className={`image-table-node ${data.imageDataUrl ? 'image-table-node--loaded' : ''} ${data.imageGenerationModel ? 'image-table-node--grid' : ''} ${layout.preservesSourceRatio ? '' : 'image-table-node--ratio-limited'} ${selected ? 'image-table-node--selected' : ''}`}
      style={nodeStyle}
    >
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
      <div className="image-table-node__media" style={mediaStyle}>
        {previewUrl ? (
          <img
            className="image-table-node__preview"
            src={previewUrl}
            alt={data.imageFileName || '图片节点'}
            onLoad={onPreviewLoaded}
          />
        ) : (
          <button type="button" className="image-table-node__empty" onClick={pickImage}>
            <span className="image-table-node__empty-title">添加图片参考</span>
            <span className="image-table-node__empty-copy">上传或粘贴图片后，可连接到文本卡片或分镜节点。</span>
          </button>
        )}
        {generatedPages.length > 1 ? (
          <div className="image-table-node__pager nodrag">
            <button type="button" onClick={() => setPreviewPageIndex((index) => Math.max(0, index - 1))} disabled={previewPageIndex <= 0}>‹</button>
            <span>{previewPageIndex + 1}/{generatedPages.length}</span>
            <button type="button" onClick={() => setPreviewPageIndex((index) => Math.min(generatedPages.length - 1, index + 1))} disabled={previewPageIndex >= generatedPages.length - 1}>›</button>
          </div>
        ) : null}
      </div>
      {!previewUrl ? (
        <div className="image-table-node__body">
        <div className="image-table-node__source">
          <span>{source.shots.length ? `${source.sourceNodeIds.length} 个来源 · ${source.shots.length} 个镜头` : '等待分镜连线'}</span>
          {source.shots.length ? <span>{Math.ceil(source.shots.length / STORYBOARD_GRID_MAX_PANELS)} 张图片</span> : null}
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
          <button type="button" onClick={generateGrid} disabled={!isGenerating && !source.shots.length}>
            {isGenerating
              ? `停止绘图 ${data.imageGenerationCompletedPages ?? 0}/${data.imageGenerationTotalPages ?? Math.ceil(source.shots.length / STORYBOARD_GRID_MAX_PANELS)}`
              : data.imageDataUrl
                ? actionLabel.replace(/^生成/u, '重新生成')
                : actionLabel}
          </button>
          <button type="button" className="image-table-node__upload" onClick={pickImage} disabled={isGenerating}>
            本地上传
          </button>
        </div>
        {data.imageAnalysisSummary?.trim() ? (
          <div className="image-table-node__summary">{data.imageAnalysisSummary.trim()}</div>
        ) : null}
        {data.imageColorAnalysisSummary?.trim() ? (
          <div className="image-table-node__summary">
            <strong>色彩表：</strong>
            {data.imageColorAnalysisSummary.trim()}
          </div>
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
      ) : null}
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
