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
  STORYBOARD_GRID_MAX_PANELS,
  buildStoryboardGridPrompt,
  generateStoryboardGridImage,
  measureStoryboardGridImage,
  paginateStoryboardGridSources,
  prepareImageEditReference,
  resolveStoryboardGridSource,
  storyboardGridActionLabel,
} from '@/services/storyboardGridImage';
import {
  imageEditOutputSize,
  resolveImageEditSource,
  type ImageEditAspectRatio,
} from '@/services/imageEdit';
import {
  IMAGE_GENERATION_MODELS,
  imageNodeModelOption,
  resolveImageGenerationModel,
  type ImageGenerationModelId,
} from '@/services/imageGenerationModels';
import {
  buildShipLightingPalettePrompt,
  lightingPaletteTitle,
  normalizeShipLightingPaletteImage,
  prepareShipLightingPaletteReferences,
  SHIP_LIGHTING_PALETTE_REQUEST_SIZE,
  SHIP_LIGHTING_PALETTE_SKILL_ID,
} from '@/services/shipLightingPalette';
import { identifyLightingPaletteScene } from '@/services/lightingPaletteScene';
import { useStudioStore } from '@/store/useStudioStore';
import { useStudioGraphContentNodes } from '@/hooks/useStudioGraphContent';
import type { StoryboardGridImagePage, StudioNodeData } from '@/types/studio';
import { imageNodeLayout } from '@/utils/imageNodeLayout';
import {
  IMAGE_NODE_INPUT_HANDLE_ID,
  IMAGE_NODE_OUTPUT_HANDLE_ID,
} from '@/utils/mediaNodeHandles';

type ImageRF = Node<StudioNodeData, 'imageNode'>;

function ImageTableNodeInner({ id, data, selected }: NodeProps<ImageRF>) {
  const patchNodeData = useStudioStore((state) => state.patchNodeData);
  const addImageNode = useStudioStore((state) => state.addImageNode);
  const focusNode = useStudioStore((state) => state.focusNode);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const nodes = useStudioGraphContentNodes();
  const edges = useStudioStore((state) => state.edges);
  const currentProjectId = useStudioStore((state) => state.currentProjectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationInFlightRef = useRef(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuPlacement, setModelMenuPlacement] = useState<'up' | 'down'>('down');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const source = useMemo(() => resolveStoryboardGridSource(id, nodes, edges), [edges, id, nodes]);
  const editSourceContext = useMemo(() => resolveImageEditSource(id, nodes), [id, nodes]);
  const editSource = editSourceContext.source;
  const isEditMode = Boolean(editSource?.dataUrl);
  const isGenerating = data.imageGenerationStatus === 'generating';
  const isEditGenerating = isGenerating && data.imageGenerationTask === 'edit';
  const isPaletteGenerating = isGenerating && data.imageGenerationTask === 'palette';
  const hasRestorableSource = Boolean(
    data.imageNodeMode === 'palette'
      ? data.imagePaletteSourceDataUrl?.trim()
      : data.imageEditBaseDataUrl?.trim(),
  );
  const generatedPages = useMemo(() => data.storyboardGridImages ?? [], [data.storyboardGridImages]);
  const activePage = generatedPages[previewPageIndex] ?? generatedPages[0];
  const ownPreviewUrl = activePage?.imageDataUrl ?? data.imageDataUrl;
  const previewUrl = ownPreviewUrl;
  const actionLabel = storyboardGridActionLabel(source.shots.length);
  const selectedModel = resolveImageGenerationModel(data.imageGenerationSelectedModel);
  const selectedModelOption = imageNodeModelOption(selectedModel);
  const canSwitchImageModel = IMAGE_GENERATION_MODELS.length > 1;

  useEffect(() => () => generationAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as globalThis.Node)) setModelMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModelMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (previewPageIndex >= generatedPages.length && generatedPages.length) setPreviewPageIndex(0);
    setImageSize(null);
  }, [generatedPages, previewPageIndex]);

  useEffect(() => {
    if (selected) return;
    setModelMenuOpen(false);
    setComposerExpanded(false);
  }, [selected]);

  const pickImage = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const selectImageModel = useCallback(
    (model: ImageGenerationModelId) => {
      patchNodeData(id, { imageGenerationSelectedModel: model }, true);
      setModelMenuOpen(false);
    },
    [id, patchNodeData],
  );

  const toggleModelMenu = useCallback(() => {
    setModelMenuOpen((open) => {
      if (!open) {
        const triggerRect = modelMenuRef.current?.getBoundingClientRect();
        const availableBelow = triggerRect ? window.innerHeight - triggerRect.bottom : window.innerHeight;
        setModelMenuPlacement(availableBelow < 340 ? 'up' : 'down');
      }
      return !open;
    });
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
          imageGenerationTask: undefined,
          imageGenerationCompletedPages: undefined,
          imageGenerationTotalPages: undefined,
          storyboardGridImages: undefined,
          imageNodeMode: 'asset',
          imageEditBaseDataUrl: undefined,
          imageEditBaseMimeType: undefined,
          imageEditBaseFileName: undefined,
          imageEditBaseWidth: undefined,
          imageEditBaseHeight: undefined,
          imageEditSourceNodeId: undefined,
          imageEditSourceSignature: undefined,
          imageEditCompletedAt: undefined,
          imagePaletteSourceDataUrl: undefined,
          imagePaletteSourceMimeType: undefined,
          imagePaletteSourceFileName: undefined,
          imagePaletteSourceWidth: undefined,
          imagePaletteSourceHeight: undefined,
          imagePaletteSourceSignature: undefined,
          imagePaletteCompletedAt: undefined,
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
    if (generationInFlightRef.current && !isGenerating) return;
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
    generationInFlightRef.current = true;
    generationAbortRef.current = abortController;
    patchNodeData(
      id,
      {
        imageGenerationStatus: 'generating',
        imageGenerationCompletedPages: 0,
        imageGenerationTotalPages: sourcePages.length,
        imageGenerationTask: 'grid',
        generation_error: undefined,
        status: 'IN_PROGRESS',
      },
      false,
    );
    pushMessage({
      role: 'system',
      text: `正在使用 ${selectedModelOption.label} 根据 ${source.shots.length} 个唯一镜头生成 ${sourcePages.length} 张分镜宫格……`,
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
        const result = await generateStoryboardGridImage(
          prompt,
          currentProjectId,
          abortController.signal,
          undefined,
          undefined,
          selectedModel,
        );
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
          imageGenerationTask: undefined,
          storyboardGridImages: pages,
          imageNodeMode: 'storyboard-grid',
          imageEditBaseDataUrl: undefined,
          imageEditBaseMimeType: undefined,
          imageEditBaseFileName: undefined,
          imageEditBaseWidth: undefined,
          imageEditBaseHeight: undefined,
          imagePaletteSourceDataUrl: undefined,
          imagePaletteSourceMimeType: undefined,
          imagePaletteSourceFileName: undefined,
          imagePaletteSourceWidth: undefined,
          imagePaletteSourceHeight: undefined,
          imagePaletteSourceSignature: undefined,
          imagePaletteCompletedAt: undefined,
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
          imageGenerationTask: undefined,
          generation_error: cancelled ? undefined : message,
          status: data.imageDataUrl ? 'APPROVED' : cancelled ? 'NOT_STARTED' : 'REJECTED',
        },
        false,
      );
      pushMessage({ role: 'system', text: message, nodeId: id });
    } finally {
      generationInFlightRef.current = false;
      if (generationAbortRef.current === abortController) generationAbortRef.current = null;
    }
  }, [currentProjectId, data.imageDataUrl, data.imageGenerationPrompt, data.label, id, isGenerating, patchNodeData, pushMessage, selectedModel, selectedModelOption.label, source]);

  const generateEdit = useCallback(async () => {
    if (generationInFlightRef.current && !isGenerating) return;
    if (isGenerating) {
      generationAbortRef.current?.abort();
      pushMessage({ role: 'system', text: '正在停止图片编辑……', nodeId: id });
      return;
    }
    if (!editSource?.dataUrl) {
      const message = '当前图片节点还没有可编辑的图片。';
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
      return;
    }
    const prompt = data.imageEditPrompt?.trim() ?? '';
    if (!prompt) {
      const message = '请先填写希望如何修改当前图片。';
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
      return;
    }

    const abortController = new AbortController();
    generationInFlightRef.current = true;
    generationAbortRef.current = abortController;
    patchNodeData(
      id,
      {
        imageNodeMode: 'edit',
        imageGenerationStatus: 'generating',
        imageGenerationTask: 'edit',
        generation_error: undefined,
        status: 'IN_PROGRESS',
      },
      false,
    );
    pushMessage({
      role: 'system',
      text: `正在使用 ${selectedModelOption.label} 原地编辑“${editSource.label}”……`,
      nodeId: id,
    });

    try {
      const reference = await prepareImageEditReference(editSource.dataUrl, editSource.label);
      const aspectRatio = (data.imageEditAspectRatio ?? 'source') as ImageEditAspectRatio;
      const sourceWidth = editSource.width ?? imageSize?.width;
      const sourceHeight = editSource.height ?? imageSize?.height;
      const requestedSize = imageEditOutputSize(aspectRatio, sourceWidth, sourceHeight);
      const rawResult = await generateStoryboardGridImage(
        prompt,
        currentProjectId,
        abortController.signal,
        requestedSize,
        [reference],
        selectedModel,
      );
      const result = await measureStoryboardGridImage(rawResult);
      const completedAt = Date.now();
      patchNodeData(
        id,
        {
          imageDataUrl: result.imageDataUrl,
          imageMimeType: 'image/jpeg',
          imageFileName: `image-edit-${completedAt}.jpg`,
          imageWidth: result.width,
          imageHeight: result.height,
          imageAnalysisSummary: undefined,
          imageColorAnalysisSummary: undefined,
          imageNodeMode: 'edit',
          imageEditBaseDataUrl: data.imageEditBaseDataUrl ?? editSource.dataUrl,
          imageEditBaseMimeType: data.imageEditBaseMimeType ?? editSource.mimeType,
          imageEditBaseFileName: data.imageEditBaseFileName ?? editSource.label,
          imageEditBaseWidth: data.imageEditBaseWidth ?? editSource.width,
          imageEditBaseHeight: data.imageEditBaseHeight ?? editSource.height,
          imageGenerationModel: result.model,
          imageGenerationSourceShotIds: undefined,
          imageGenerationSourceNodeIds: [editSource.nodeId],
          imageGenerationReferenceCount: result.referenceImageCount ?? 1,
          imageGenerationReferenceLabels: [`原图:${editSource.label}`],
          imageGenerationCompletedAt: completedAt,
          imageGenerationStatus: 'idle',
          imageGenerationTask: undefined,
          storyboardGridImages: undefined,
          imageEditSourceNodeId: editSource.nodeId,
          imageEditSourceSignature: editSource.signature,
          imageEditCompletedAt: completedAt,
          generation_error: undefined,
          status: 'APPROVED',
          output: {
            kind: 'image_edit',
            model: result.model,
            size: result.size,
            sourceImageNodeId: editSource.nodeId,
            sourceImageLabel: editSource.label,
            referenceImageCount: result.referenceImageCount ?? 1,
            prompt,
            completedAt,
          },
        },
        true,
      );
      setImageSize(result.width && result.height ? { width: result.width, height: result.height } : null);
      setPreviewPageIndex(0);
      pushMessage({
        role: 'system',
        text: `已完成“${editSource.label}”的原地编辑；首次编辑前的原图基线已保留。`,
        nodeId: id,
      });
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      const message = cancelled
        ? '已停止图片编辑。'
        : error instanceof Error
          ? error.message
          : '图片编辑失败。';
      patchNodeData(
        id,
        {
          imageGenerationStatus: 'idle',
          imageGenerationTask: undefined,
          generation_error: cancelled ? undefined : message,
          status: data.imageDataUrl ? 'APPROVED' : cancelled ? 'NOT_STARTED' : 'REJECTED',
        },
        false,
      );
      pushMessage({ role: 'system', text: message, nodeId: id });
    } finally {
      generationInFlightRef.current = false;
      if (generationAbortRef.current === abortController) generationAbortRef.current = null;
    }
  }, [
    currentProjectId,
    data.imageDataUrl,
    data.imageEditBaseDataUrl,
    data.imageEditBaseFileName,
    data.imageEditBaseHeight,
    data.imageEditBaseMimeType,
    data.imageEditBaseWidth,
    data.imageEditAspectRatio,
    data.imageEditPrompt,
    editSource,
    id,
    imageSize,
    isGenerating,
    patchNodeData,
    pushMessage,
    selectedModel,
    selectedModelOption.label,
  ]);

  const generatePalette = useCallback(async () => {
    if (generationInFlightRef.current && !isGenerating) return;
    if (isGenerating) {
      if (data.imageGenerationTask === 'palette') {
        generationAbortRef.current?.abort();
        pushMessage({ role: 'system', text: '正在停止灯光色表生成……', nodeId: id });
      }
      return;
    }
    if (!editSource?.dataUrl) {
      const message = '请先读取或上传一张图片，再生成灯光色表。';
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
      return;
    }

    const hasStoredPaletteSource =
      data.imageNodeMode === 'palette' && Boolean(data.imagePaletteSourceDataUrl?.trim());
    const sourceDataUrl = hasStoredPaletteSource
      ? (data.imagePaletteSourceDataUrl as string)
      : editSource.dataUrl;
    const sourceLabel = hasStoredPaletteSource
      ? data.imagePaletteSourceFileName?.trim() || '色表来源图'
      : editSource.label;
    const sourceStatusBeforeGeneration = data.status;

    const abortController = new AbortController();
    generationInFlightRef.current = true;
    generationAbortRef.current = abortController;
    patchNodeData(
      id,
      {
        imageGenerationStatus: 'generating',
        imageGenerationTask: 'palette',
        generation_error: undefined,
        status: 'IN_PROGRESS',
      },
      false,
    );
    pushMessage({
      role: 'system',
      text: `正在读取“${sourceLabel}”，将先识别场景，再使用 ${selectedModelOption.label} 生成对应场景色表……`,
      nodeId: id,
    });

    try {
      pushMessage({
        role: 'system',
        text: `正在识别“${sourceLabel}”对应的场景……`,
        nodeId: id,
      });
      const sceneName = await identifyLightingPaletteScene({
        imageDataUrl: sourceDataUrl,
        signal: abortController.signal,
      });
      const paletteTitle = lightingPaletteTitle(sceneName);
      pushMessage({
        role: 'system',
        text: `已识别场景为“${sceneName}”，正在生成“${paletteTitle}”……`,
        nodeId: id,
      });
      const references = await prepareShipLightingPaletteReferences(sourceDataUrl, sourceLabel);
      const prompt = buildShipLightingPalettePrompt(sourceLabel, sceneName);
      const rawResult = await generateStoryboardGridImage(
        prompt,
        currentProjectId,
        abortController.signal,
        SHIP_LIGHTING_PALETTE_REQUEST_SIZE,
        references,
        selectedModel,
      );
      const result = await normalizeShipLightingPaletteImage(rawResult);
      const completedAt = Date.now();
      const sourceNode = nodes.find((node) => node.id === id);
      const paletteNodeId = addImageNode(
        {
          x: (sourceNode?.position.x ?? 320) + 700,
          y: sourceNode?.position.y ?? 240,
        },
        {
          imageDataUrl: result.imageDataUrl,
          imageMimeType: 'image/png',
          imageFileName: `${paletteTitle}-${completedAt}.png`,
          label: paletteTitle,
          silent: true,
        },
      );
      patchNodeData(
        paletteNodeId,
        {
          imageDataUrl: result.imageDataUrl,
          imageMimeType: 'image/png',
          imageFileName: `${paletteTitle}-${completedAt}.png`,
          imageWidth: result.width,
          imageHeight: result.height,
          imageAnalysisSummary: `${sceneName}场景 · 按原图主导色与真实高光区域生成的 20+4 色灯光分析板。`,
          imageColorAnalysisSummary: undefined,
          imageNodeMode: 'palette',
          imageGenerationModel: result.model,
          imageGenerationSourceShotIds: undefined,
          imageGenerationSourceNodeIds: [id],
          imageGenerationReferenceCount: result.referenceImageCount ?? references.length,
          imageGenerationReferenceLabels: [
            `颜色来源:${sourceLabel}`,
            `版式:${SHIP_LIGHTING_PALETTE_SKILL_ID}`,
          ],
          imageGenerationCompletedAt: completedAt,
          imageGenerationStatus: 'idle',
          imageGenerationTask: undefined,
          storyboardGridImages: undefined,
          imagePaletteCompletedAt: completedAt,
          generation_error: undefined,
          status: 'APPROVED',
          output: {
            kind: 'image_color_palette',
            skill: SHIP_LIGHTING_PALETTE_SKILL_ID,
            model: result.model,
            size: result.size,
            sourceImageNodeId: id,
            sourceImageLabel: sourceLabel,
            sceneName,
            paletteTitle,
            referenceImageCount: result.referenceImageCount ?? references.length,
            completedAt,
          },
        },
        true,
      );
      patchNodeData(
        id,
        {
          imageGenerationStatus: 'idle',
          imageGenerationTask: undefined,
          generation_error: undefined,
          status: sourceStatusBeforeGeneration,
        },
        false,
      );
      focusNode(paletteNodeId, { openDetail: false });
      pushMessage({
        role: 'system',
        text: `已识别“${sceneName}”并新建“${paletteTitle}”图片节点，输出为 1920×1080（16:9）PNG；来源图片未被覆盖。`,
        nodeId: paletteNodeId,
      });
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      const message = cancelled
        ? '已停止灯光色表生成。'
        : error instanceof Error
          ? error.message
          : '灯光色表生成失败。';
      patchNodeData(
        id,
        {
          imageGenerationStatus: 'idle',
          imageGenerationTask: undefined,
          generation_error: cancelled ? undefined : message,
          status: sourceStatusBeforeGeneration,
        },
        false,
      );
      pushMessage({ role: 'system', text: message, nodeId: id });
    } finally {
      generationInFlightRef.current = false;
      if (generationAbortRef.current === abortController) generationAbortRef.current = null;
    }
  }, [
    addImageNode,
    currentProjectId,
    data.imageDataUrl,
    data.imageGenerationTask,
    data.imageNodeMode,
    data.imagePaletteSourceDataUrl,
    data.imagePaletteSourceFileName,
    data.status,
    editSource,
    focusNode,
    id,
    isGenerating,
    nodes,
    patchNodeData,
    pushMessage,
    selectedModel,
    selectedModelOption.label,
  ]);

  const restoreOriginalImage = useCallback(() => {
    const restoringPalette =
      data.imageNodeMode === 'palette' && Boolean(data.imagePaletteSourceDataUrl?.trim());
    const originalDataUrl = restoringPalette
      ? data.imagePaletteSourceDataUrl?.trim()
      : data.imageEditBaseDataUrl?.trim();
    if (!originalDataUrl || isGenerating) return;
    const originalMimeType = restoringPalette
      ? data.imagePaletteSourceMimeType
      : data.imageEditBaseMimeType;
    const originalFileName = restoringPalette
      ? data.imagePaletteSourceFileName
      : data.imageEditBaseFileName;
    const originalWidth = restoringPalette
      ? data.imagePaletteSourceWidth
      : data.imageEditBaseWidth;
    const originalHeight = restoringPalette
      ? data.imagePaletteSourceHeight
      : data.imageEditBaseHeight;
    patchNodeData(
      id,
      {
        imageDataUrl: originalDataUrl,
        imageMimeType: originalMimeType,
        imageFileName: originalFileName,
        imageWidth: originalWidth,
        imageHeight: originalHeight,
        imageNodeMode: restoringPalette && data.imageEditBaseDataUrl ? 'edit' : 'asset',
        imageGenerationModel: undefined,
        imageGenerationCompletedAt: undefined,
        imageGenerationTask: undefined,
        imageGenerationSourceNodeIds: undefined,
        imageGenerationReferenceCount: undefined,
        imageGenerationReferenceLabels: undefined,
        imageEditBaseDataUrl: restoringPalette ? data.imageEditBaseDataUrl : undefined,
        imageEditBaseMimeType: restoringPalette ? data.imageEditBaseMimeType : undefined,
        imageEditBaseFileName: restoringPalette ? data.imageEditBaseFileName : undefined,
        imageEditBaseWidth: restoringPalette ? data.imageEditBaseWidth : undefined,
        imageEditBaseHeight: restoringPalette ? data.imageEditBaseHeight : undefined,
        imageEditSourceNodeId: restoringPalette ? data.imageEditSourceNodeId : undefined,
        imageEditSourceSignature: restoringPalette ? data.imageEditSourceSignature : undefined,
        imageEditCompletedAt: restoringPalette ? data.imageEditCompletedAt : undefined,
        imagePaletteSourceDataUrl: undefined,
        imagePaletteSourceMimeType: undefined,
        imagePaletteSourceFileName: undefined,
        imagePaletteSourceWidth: undefined,
        imagePaletteSourceHeight: undefined,
        imagePaletteSourceSignature: undefined,
        imagePaletteCompletedAt: undefined,
        storyboardGridImages: undefined,
        generation_error: undefined,
        status: 'APPROVED',
        output: null,
      },
      true,
    );
    setImageSize(
      originalWidth && originalHeight
        ? { width: originalWidth, height: originalHeight }
        : null,
    );
    setPreviewPageIndex(0);
    pushMessage({
      role: 'system',
      text: restoringPalette ? '已恢复生成色表前的来源图。' : '已恢复第一次原地编辑前的原图。',
      nodeId: id,
    });
  }, [
    data.imageEditBaseDataUrl,
    data.imageEditBaseFileName,
    data.imageEditBaseHeight,
    data.imageEditBaseMimeType,
    data.imageEditBaseWidth,
    data.imageEditCompletedAt,
    data.imageEditSourceNodeId,
    data.imageEditSourceSignature,
    data.imageNodeMode,
    data.imagePaletteSourceDataUrl,
    data.imagePaletteSourceFileName,
    data.imagePaletteSourceHeight,
    data.imagePaletteSourceMimeType,
    data.imagePaletteSourceWidth,
    id,
    isGenerating,
    patchNodeData,
    pushMessage,
  ]);

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
  const modelSwitcher = (
    <div
      ref={modelMenuRef}
      className={`image-table-node__model-switcher nodrag nowheel ${modelMenuOpen ? 'image-table-node__model-switcher--open' : ''} image-table-node__model-switcher--${modelMenuPlacement}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="image-table-node__model-trigger"
        aria-haspopup={canSwitchImageModel ? 'listbox' : undefined}
        aria-expanded={canSwitchImageModel ? modelMenuOpen : undefined}
        title={`图片模型：${selectedModelOption.label}`}
        onClick={canSwitchImageModel ? toggleModelMenu : undefined}
      >
        <span className="image-table-node__model-trigger-copy">
          <strong>{selectedModelOption.label}</strong>
          <small>{selectedModelOption.badge}</small>
        </span>
        <span className="image-table-node__model-chevron" aria-hidden>
          {canSwitchImageModel ? (modelMenuOpen ? '收起' : '切换') : '固定'}
        </span>
      </button>
      {canSwitchImageModel && modelMenuOpen ? (
        <div className="image-table-node__model-menu" role="listbox" aria-label="选择图片生成模型">
          <div className="image-table-node__model-menu-head">
            <strong>图片模型</strong>
            <span>生成和编辑共用</span>
          </div>
          {IMAGE_GENERATION_MODELS.map((model) => {
            const active = model.id === selectedModel;
            return (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`image-table-node__model-option ${active ? 'image-table-node__model-option--active' : ''}`}
                onClick={() => selectImageModel(model.id)}
              >
                <span className="image-table-node__model-option-copy">
                  <span className="image-table-node__model-option-title">
                    <strong>{model.label}</strong>
                    <em>{model.badge}</em>
                  </span>
                  <small>{model.description}</small>
                </span>
                <span className="image-table-node__model-latency">{model.latencyLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={`image-table-node ${data.imageDataUrl ? 'image-table-node--loaded' : ''} ${data.imageGenerationModel && !isEditMode ? 'image-table-node--grid' : ''} ${isEditMode ? 'image-table-node--edit' : ''} ${layout.preservesSourceRatio ? '' : 'image-table-node--ratio-limited'} ${selected ? 'image-table-node--selected' : ''}`}
      style={nodeStyle}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={IMAGE_NODE_INPUT_HANDLE_ID}
        className="image-table-node__handle image-table-node__handle--input"
        title="Input：连接分镜表、分镜部门或单个镜头，可生成分镜宫格。"
      />
      <header className="image-table-node__head">
        <span className="image-table-node__title">
          <span className="image-table-node__title-icon" aria-hidden />
          <span className="image-table-node__title-text">{title}</span>
          {isEditMode && selected ? (
            <span className="image-table-node__mode">
              {data.imageNodeMode === 'palette' ? '色表' : '编辑'}
            </span>
          ) : null}
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
        {!isEditMode && generatedPages.length > 1 ? (
          <div className="image-table-node__pager nodrag">
            <button type="button" onClick={() => setPreviewPageIndex((index) => Math.max(0, index - 1))} disabled={previewPageIndex <= 0}>‹</button>
            <span>{previewPageIndex + 1}/{generatedPages.length}</span>
            <button type="button" onClick={() => setPreviewPageIndex((index) => Math.min(generatedPages.length - 1, index + 1))} disabled={previewPageIndex >= generatedPages.length - 1}>›</button>
          </div>
        ) : null}
      </div>
      {editSource?.dataUrl && selected ? (
        <div
          className={`image-table-node__body image-table-node__body--edit image-table-node__composer nodrag nopan nowheel ${composerExpanded ? 'image-table-node__composer--expanded' : ''}`}
          role="dialog"
          aria-label="图片编辑器"
        >
          <div className="image-table-node__composer-head">
            <div className="image-table-node__composer-chips" aria-label="图片编辑辅助项">
              <span className="image-table-node__composer-chip image-table-node__composer-chip--active">
                参考 {editSource.dataUrl ? '1' : '0'}
              </span>
              {data.imageNodeMode !== 'palette' ? (
                <button
                  type="button"
                  className="image-table-node__composer-chip image-table-node__composer-chip--button"
                  onClick={generatePalette}
                  disabled={isGenerating && !isPaletteGenerating}
                  title="先识别场景，再新建 1920×1080（16:9）场景色表图片节点"
                >
                  {isPaletteGenerating ? '停止色表' : '生成色表'}
                </button>
              ) : null}
              <span className="image-table-node__composer-chip">标记</span>
              <span className="image-table-node__composer-chip">风格</span>
            </div>
            <div className="image-table-node__composer-head-actions">
              {hasRestorableSource ? (
                <button
                  type="button"
                  className="image-table-node__composer-reset"
                  disabled={isGenerating}
                  onClick={restoreOriginalImage}
                >
                  {data.imageNodeMode === 'palette' ? '恢复来源图' : '恢复原图'}
                </button>
              ) : null}
              <button
                type="button"
                className="image-table-node__composer-expand"
                aria-expanded={composerExpanded}
                onClick={() => setComposerExpanded((expanded) => !expanded)}
              >
                {composerExpanded ? '收起编辑器' : '展开编辑器'}
              </button>
            </div>
          </div>
          <div
            className="image-table-node__composer-reference"
            title={
              editSource.width && editSource.height
                ? `${editSource.label} · ${editSource.width} × ${editSource.height}`
                : editSource.label
            }
          >
            <span className="image-table-node__composer-reference-index">1</span>
            {editSource.dataUrl ? <img src={editSource.dataUrl} alt={editSource.label} /> : <span>无图</span>}
          </div>
          <textarea
            className="image-table-node__instruction image-table-node__composer-instruction nodrag nowheel"
            value={data.imageEditPrompt ?? ''}
            rows={composerExpanded ? 7 : 4}
            maxLength={2000}
            placeholder="描述希望如何修改，例如：场景中主体缩小，保留舷窗、雾气与整体光线。"
            onChange={(event) => patchNodeData(id, { imageEditPrompt: event.target.value }, false)}
          />
          <div className="image-table-node__composer-footer">
            {modelSwitcher}
            <span className="image-table-node__composer-separator" aria-hidden />
            <label className="image-table-node__composer-format">
              <span>画幅</span>
              <select
                aria-label="输出画幅"
                value={data.imageEditAspectRatio ?? 'source'}
                onChange={(event) =>
                  patchNodeData(
                    id,
                    { imageEditAspectRatio: event.target.value as ImageEditAspectRatio },
                    false,
                  )
                }
              >
                <option value="source">沿用当前图</option>
                <option value="16:9">16:9 横屏</option>
                <option value="9:16">9:16 竖屏</option>
                <option value="1:1">1:1 方形</option>
              </select>
            </label>
            <span className="image-table-node__composer-output-note">标准画质 · 1张</span>
            <span className="image-table-node__composer-credit">3 次额度</span>
            <button
              type="button"
              className="image-table-node__composer-submit"
              onClick={generateEdit}
              disabled={
                (isGenerating && !isEditGenerating)
                || (!isGenerating && (!editSource.dataUrl || !data.imageEditPrompt?.trim()))
              }
            >
              {isEditGenerating ? '停止' : data.imageEditCompletedAt ? '重新生成' : '生成'}
            </button>
          </div>
          {data.generation_error?.trim() ? (
            <div className="image-table-node__error">{data.generation_error.trim()}</div>
          ) : null}
        </div>
      ) : !previewUrl ? (
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
      {!isEditMode ? modelSwitcher : null}
      <Handle
        type="source"
        position={Position.Right}
        id={IMAGE_NODE_OUTPUT_HANDLE_ID}
        className="image-table-node__handle"
        title="Output：连接到文本卡片、分镜节点或其他下游节点。"
      />
    </div>
  );
}

export const ImageTableNode = memo(ImageTableNodeInner);
