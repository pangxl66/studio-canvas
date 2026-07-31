import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  STORYBOARD_GRID_MAX_PANELS,
  addStoryboardPanelCaptions,
  buildStoryboardGridPrompt,
  createStoryboardLayoutReference,
  generateStoryboardGridImage,
  measureStoryboardGridImage,
  paginateStoryboardGridSources,
  prepareStoryboardReferenceImages,
  resolveStoryboardGridSource,
  storyboardGridActionLabel,
  storyboardGridCanvasSize,
  type StoryboardGridImageSize,
} from '@/services/storyboardGridImage';
import {
  STORYBOARD_REFERENCE_MAX_IMAGES,
  buildStoryboardPanelReferenceInstruction,
  buildStoryboardReferenceInstruction,
  resolveStoryboardReferenceContext,
  selectStoryboardReferencesForShots,
} from '@/services/storyboardReferenceImages';
import {
  buildStoryboardGridSourceFromPromptSource,
  matchStoryboardPrompts,
  resolveStoryboardPromptSource,
} from '@/services/storyboardPromptInputs';
import {
  DEFAULT_STORYBOARD_SKILL_ID,
  getSkillById,
  listSkillsInFolder,
  normalizeFilmStoryboardSkillId,
} from '@/services/skillLoader';
import { normalizeStoryboardAspectRatio } from '@/services/aiFilmmakingPrompts';
import {
  STORYBOARD_GRID_IMAGE_MODELS,
  imageGenerationModelOption,
  resolveImageGenerationModel,
  type ImageGenerationModelId,
} from '@/services/imageGenerationModels';
import { IMAGE_NODE_INPUT_HANDLE_ID } from '@/utils/mediaNodeHandles';
import { FILM_INPUT_HANDLE_ID, FILM_OUTPUT_HANDLE_ID } from '@/store/slices/aiFilmmakingStore';
import { useStudioStore } from '@/store/useStudioStore';
import { useStudioGraphContentNodes } from '@/hooks/useStudioGraphContent';
import type {
  NodeKind,
  StoryboardGridImagePage,
  StoryboardReferenceBinding,
  StoryboardReferenceKind,
  StudioNodeData,
} from '@/types/studio';

type FilmNodeType = 'aiFilmCharacter' | 'aiFilmStoryboard' | 'aiFilmVideoPrompt';
type FilmNodeKind = Extract<NodeKind, 'film_character_node' | 'film_storyboard_node' | 'film_video_prompt_node'>;
type FilmRF = Node<StudioNodeData, FilmNodeType>;
type StoryboardGridGeneratedPage = StoryboardGridImagePage & { imageDataUrl: string };

const NODE_META: Record<
  FilmNodeKind,
  {
    eyebrow: string;
    title: string;
    action: string;
    empty: string;
    accent: string;
  }
> = {
  film_character_node: {
    eyebrow: 'CHARACTER',
    title: '角色设定',
    action: '生成角色设定',
    empty: '连接图片节点或文本节点后，生成角色参考表提示词。',
    accent: 'character',
  },
  film_storyboard_node: {
    eyebrow: 'STORYBOARD',
    title: '影视分镜图',
    action: '生成宫格提示词',
    empty: '可只连接提示词节点生成分镜宫格；图片节点可作为角色、场景或道具参考图。',
    accent: 'storyboard',
  },
  film_video_prompt_node: {
    eyebrow: 'SEEDANCE',
    title: '影视分镜提示词',
    action: '生成视频提示词',
    empty: '连接文本、角色设定、影视分镜图或图片参考后，自动识别 A/B/C 模式。',
    accent: 'video',
  },
};

function isFilmKind(kind: StudioNodeData['type']): kind is FilmNodeKind {
  return (
    kind === 'film_character_node' ||
    kind === 'film_storyboard_node' ||
    kind === 'film_video_prompt_node'
  );
}

function textFromData(data: StudioNodeData): string {
  if (data.status === 'IN_PROGRESS' && data.streaming_preview?.trim()) return data.streaming_preview.trim();
  if (data.raw_text?.trim()) return data.raw_text.trim();
  if (data.input?.trim()) return data.input.trim();
  if (data.output && typeof data.output === 'object' && typeof (data.output as { text?: unknown }).text === 'string') {
    return (data.output as { text: string }).text.trim();
  }
  return '';
}

function hashStoryboardFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function videoModeLabel(data: StudioNodeData): string | null {
  if (data.type !== 'film_video_prompt_node') return null;
  const mode = data.output && typeof data.output === 'object' ? (data.output as { videoMode?: unknown }).videoMode : null;
  if (mode === 'A' || mode === 'B' || mode === 'C') return `模式 ${mode}`;
  return '自动识别';
}

function AiFilmmakingNodeInner({ id, data, selected }: NodeProps<FilmRF>) {
  const runAiFilmmakingNode = useStudioStore((state) => state.runAiFilmmakingNode);
  const stopNodeTask = useStudioStore((state) => state.stopNodeTask);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const patchNodeData = useStudioStore((state) => state.patchNodeData);
  const addImageNode = useStudioStore((state) => state.addImageNode);
  const removeNodesByIds = useStudioStore((state) => state.removeNodesByIds);
  const onConnect = useStudioStore((state) => state.onConnect);
  const reactFlow = useReactFlow();
  const nodes = useStudioGraphContentNodes();
  const edges = useStudioStore((state) => state.edges);
  const currentProjectId = useStudioStore((state) => state.currentProjectId);
  const imageAbortRef = useRef<AbortController | null>(null);
  const storyboardModelMenuRef = useRef<HTMLDivElement>(null);
  const [storyboardModelMenuOpen, setStoryboardModelMenuOpen] = useState(false);
  const [storyboardModelMenuPlacement, setStoryboardModelMenuPlacement] = useState<'up' | 'down'>('down');
  const meta = isFilmKind(data.type) ? NODE_META[data.type] : NODE_META.film_video_prompt_node;
  const busy = data.status === 'IN_PROGRESS';
  const imageBusy = data.imageGenerationStatus === 'generating';
  const anyBusy = busy || imageBusy;
  const text = textFromData(data);
  const hasText = Boolean(text);
  const isStoryboardNode = data.type === 'film_storyboard_node';
  const storyboardOutputImageNodeIds = useMemo(
    () =>
      isStoryboardNode
        ? (data.storyboardOutputImageNodeIds ?? []).filter((nodeId) =>
            nodes.some(
              (node) =>
                node.id === nodeId &&
                node.type === 'imageNode' &&
                node.data.generatedFromStoryboardNodeId === id &&
                Boolean(node.data.imageDataUrl),
            ),
          )
        : [],
    [data.storyboardOutputImageNodeIds, id, isStoryboardNode, nodes],
  );
  const embeddedStoryboardPages = useMemo(
    () =>
      (data.storyboardGridImages ?? []).filter(
        (page): page is StoryboardGridGeneratedPage => Boolean(page.imageDataUrl),
      ),
    [data.storyboardGridImages],
  );
  const hasImage =
    isStoryboardNode &&
    Boolean(storyboardOutputImageNodeIds.length || embeddedStoryboardPages.length || data.imageDataUrl);
  const modeLabel = videoModeLabel(data);
  const connectedStoryboardSource = useMemo(
    () =>
      isStoryboardNode
        ? resolveStoryboardGridSource(id, nodes, edges)
        : {
            shots: [],
            shotSources: [],
            sourceLabels: [],
            sourceNodeIds: [],
            totalAvailable: 0,
            duplicateCount: 0,
          },
    [edges, id, isStoryboardNode, nodes],
  );
  const storyboardReferenceContext = useMemo(
    () =>
      isStoryboardNode
        ? resolveStoryboardReferenceContext(id, nodes, edges, data.storyboardReferenceBindings)
        : { references: [], entities: [], missingImageCount: 0, entitySourceNodeIds: [], entitySource: 'none' as const },
    [data.storyboardReferenceBindings, edges, id, isStoryboardNode, nodes],
  );
  const storyboardPromptSource = useMemo(
    () =>
      isStoryboardNode
        ? resolveStoryboardPromptSource(id, nodes, edges)
        : { sourceNodeIds: [], sourceLabels: [], shotPrompts: [], entries: [], sourceSignature: '' },
    [edges, id, isStoryboardNode, nodes],
  );
  const promptStoryboardSource = useMemo(
    () => buildStoryboardGridSourceFromPromptSource(storyboardPromptSource),
    [storyboardPromptSource],
  );
  const promptOnlyStoryboardMode =
    isStoryboardNode &&
    connectedStoryboardSource.shots.length === 0 &&
    promptStoryboardSource.shots.length > 0;
  const storyboardSource = promptOnlyStoryboardMode
    ? promptStoryboardSource
    : connectedStoryboardSource;
  useEffect(() => {
    if (!isStoryboardNode || !storyboardSource.shots.length) return;
    if (
      data.generation_error ===
      '请先连接分镜表、分镜部，或分镜表中的逐镜头 Output，再生成影视分镜图。'
    ) {
      patchNodeData(id, { generation_error: undefined }, false);
    }
  }, [data.generation_error, id, isStoryboardNode, patchNodeData, storyboardSource.shots.length]);
  const storyboardPromptResolution = useMemo(
    () => matchStoryboardPrompts(storyboardSource.shotSources, storyboardPromptSource),
    [storyboardPromptSource, storyboardSource.shotSources],
  );
  const referenceSignature = useMemo(
    () =>
      hashStoryboardFingerprint(
        storyboardReferenceContext.references
          .map((reference) =>
            [
              reference.imageNodeId,
              reference.name,
              reference.kind,
              reference.entityId ?? '',
              reference.dataUrl ? hashStoryboardFingerprint(reference.dataUrl) : '',
            ].join(':'),
          )
          .join('|'),
      ),
    [storyboardReferenceContext.references],
  );
  const storyboardPageCount = Math.ceil(storyboardSource.shots.length / STORYBOARD_GRID_MAX_PANELS);
  const imageActionLabel = storyboardGridActionLabel(storyboardSource.shots.length);
  const selectedStoryboardAspectRatio = normalizeStoryboardAspectRatio(data.film_storyboard_aspect_ratio);
  const selectedStoryboardModel = resolveImageGenerationModel(data.imageGenerationSelectedModel);
  const selectedStoryboardModelOption = imageGenerationModelOption(selectedStoryboardModel);
  const canSwitchStoryboardModel = STORYBOARD_GRID_IMAGE_MODELS.length > 1;
  const storyboardBusinessReferenceLimit = Math.max(0, STORYBOARD_REFERENCE_MAX_IMAGES - 1);
  const storyboardSkills = useMemo(
    () => (isStoryboardNode ? listSkillsInFolder('storyboard') : []),
    [isStoryboardNode],
  );
  const selectedStoryboardSkillId = isStoryboardNode
    ? normalizeFilmStoryboardSkillId(data.film_storyboard_skill_id)
    : DEFAULT_STORYBOARD_SKILL_ID;
  const effectiveStoryboardSkillId = storyboardSkills.some((skill) => skill.id === selectedStoryboardSkillId)
    ? selectedStoryboardSkillId
    : normalizeFilmStoryboardSkillId(storyboardSkills[0]?.id);
  const storyboardInstructionSignature = useMemo(
    () =>
      hashStoryboardFingerprint(
        [effectiveStoryboardSkillId, data.raw_text?.trim() ?? ''].join('\u001f'),
      ),
    [data.raw_text, effectiveStoryboardSkillId],
  );
  const storyboardImageStale = useMemo(() => {
    if (!data.storyboardGridImages?.length) return false;
    const currentSignature = storyboardSource.shotSources
      .map((item) => `${item.sourceNodeId}:${item.shot.shotNo || item.shot.id}`)
      .join('|');
    const generatedSignature = data.storyboardGridImages
      .flatMap((page) => page.panels)
      .map((panel) => `${panel.sourceNodeId}:${panel.shotNo || panel.shotId}`)
      .join('|');
    return (
      currentSignature !== generatedSignature ||
      (data.imageGenerationReferenceSignature ?? '') !== referenceSignature ||
      (data.imageGenerationPromptSignature ?? '') !== storyboardPromptResolution.signature ||
      (data.imageGenerationInstructionSignature ?? '') !== storyboardInstructionSignature ||
      data.imageGenerationAspectRatio !== selectedStoryboardAspectRatio ||
      (data.imageGenerationModel && data.imageGenerationModel !== selectedStoryboardModel)
    );
  }, [
    data.imageGenerationAspectRatio,
    data.imageGenerationModel,
    data.imageGenerationInstructionSignature,
    data.imageGenerationReferenceSignature,
    data.imageGenerationPromptSignature,
    data.storyboardGridImages,
    referenceSignature,
    selectedStoryboardAspectRatio,
    selectedStoryboardModel,
    storyboardInstructionSignature,
    storyboardPromptResolution.signature,
    storyboardSource.shotSources,
  ]);
  useEffect(() => () => imageAbortRef.current?.abort(), []);
  useEffect(() => {
    if (!storyboardModelMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!storyboardModelMenuRef.current?.contains(event.target as globalThis.Node)) {
        setStoryboardModelMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStoryboardModelMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [storyboardModelMenuOpen]);

  const onRun = useCallback(() => {
    if (busy) {
      stopNodeTask(id);
      return;
    }
    void runAiFilmmakingNode(id);
  }, [busy, id, runAiFilmmakingNode, stopNodeTask]);

  const onCopy = useCallback(async () => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      pushMessage({ role: 'system', text: '已复制节点提示词。', nodeId: id });
    } catch {
      pushMessage({ role: 'system', text: '复制失败：请检查浏览器剪贴板权限。', nodeId: id });
    }
  }, [id, pushMessage, text]);

  const onSkillChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextId = normalizeFilmStoryboardSkillId(event.target.value);
      const skill = getSkillById(nextId);
      patchNodeData(id, { film_storyboard_skill_id: nextId, generation_error: undefined }, false);
      pushMessage({
        role: 'system',
        text: `影视分镜图 Skill 已切换为：${skill?.name ?? nextId}。`,
        nodeId: id,
      });
    },
    [id, patchNodeData, pushMessage],
  );

  const onStoryboardAspectRatioChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextRatio = normalizeStoryboardAspectRatio(event.target.value);
      patchNodeData(id, { film_storyboard_aspect_ratio: nextRatio, generation_error: undefined }, false);
      pushMessage({
        role: 'system',
        text: `分镜宫格画幅已切换为：${nextRatio === '9:16' ? '9:16 竖屏' : '16:9 横屏'}。`,
        nodeId: id,
      });
    },
    [id, patchNodeData, pushMessage],
  );

  const selectStoryboardModel = useCallback(
    (model: ImageGenerationModelId) => {
      const nextModel = resolveImageGenerationModel(model);
      const option = imageGenerationModelOption(nextModel);
      patchNodeData(
        id,
        { imageGenerationSelectedModel: nextModel, generation_error: undefined },
        false,
      );
      pushMessage({
        role: 'system',
        text: `影视分镜图片模型已切换为：${option.label}。`,
        nodeId: id,
      });
      setStoryboardModelMenuOpen(false);
    },
    [id, patchNodeData, pushMessage],
  );

  const toggleStoryboardModelMenu = useCallback(() => {
    setStoryboardModelMenuOpen((open) => {
      if (!open) {
        const triggerRect = storyboardModelMenuRef.current?.getBoundingClientRect();
        const availableBelow = triggerRect ? window.innerHeight - triggerRect.bottom : window.innerHeight;
        setStoryboardModelMenuPlacement(availableBelow < 340 ? 'up' : 'down');
      }
      return !open;
    });
  }, []);

  const saveReferenceBindings = useCallback(
    (imageNodeId: string, changes: Partial<StoryboardReferenceBinding>) => {
      const nextBindings = storyboardReferenceContext.references.map((reference): StoryboardReferenceBinding => {
        const base: StoryboardReferenceBinding = {
          imageNodeId: reference.imageNodeId,
          name: reference.name,
          kind: reference.kind,
          entityId: reference.entityId,
          entityName: reference.entityName,
        };
        return reference.imageNodeId === imageNodeId ? { ...base, ...changes } : base;
      });
      patchNodeData(id, { storyboardReferenceBindings: nextBindings, generation_error: undefined }, false);
    },
    [id, patchNodeData, storyboardReferenceContext.references],
  );

  const onReferenceKindChange = useCallback(
    (imageNodeId: string, kind: StoryboardReferenceKind) => {
      saveReferenceBindings(imageNodeId, { kind, entityId: undefined, entityName: undefined });
    },
    [saveReferenceBindings],
  );

  const onReferenceEntityChange = useCallback(
    (imageNodeId: string, kind: StoryboardReferenceKind, entityId: string) => {
      const entity = storyboardReferenceContext.entities.find(
        (item) => item.kind === kind && item.id === entityId,
      );
      saveReferenceBindings(imageNodeId, {
        entityId: entity?.id,
        entityName: entity?.name,
        ...(entity ? { name: entity.name } : {}),
      });
    },
    [saveReferenceBindings, storyboardReferenceContext.entities],
  );

  const onGenerateStoryboardImage = useCallback(async () => {
    if (imageBusy) {
      imageAbortRef.current?.abort();
      pushMessage({ role: 'system', text: '正在停止分镜宫格图片生成……', nodeId: id });
      return;
    }
    if (!storyboardSource.shots.length) {
      const message = storyboardPromptSource.sourceNodeIds.length
        ? '已连接提示词节点，但还没有可用的逐镜头提示词。请先运行提示词节点，再生成分镜宫格图片。'
        : '请先连接提示词节点，或连接分镜表、分镜部、分镜表中的逐镜头 Output，再生成影视分镜图。';
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
      return;
    }
    if (
      storyboardPromptSource.sourceNodeIds.length &&
      storyboardPromptResolution.matchedCount !== storyboardSource.shots.length
    ) {
      const details = [
        storyboardPromptResolution.missingShotIds.length
          ? `未匹配镜头：${storyboardPromptResolution.missingShotIds.join('、')}`
          : '',
        storyboardPromptResolution.duplicatePromptIds.length
          ? `重复提示词编号：${storyboardPromptResolution.duplicatePromptIds.join('、')}`
          : '',
        storyboardPromptResolution.unmatchedPromptIds.length
          ? `多余提示词：${storyboardPromptResolution.unmatchedPromptIds.join('、')}`
          : '',
      ].filter(Boolean).join('；');
      const message = `已连接提示词节点，但仅匹配 ${storyboardPromptResolution.matchedCount}/${storyboardSource.shots.length} 个镜头。请先重新生成或校正提示词节点${details ? `；${details}` : ''}。`;
      patchNodeData(id, { generation_error: message }, false);
      pushMessage({ role: 'system', text: message, nodeId: id });
      return;
    }

    const skill = getSkillById(effectiveStoryboardSkillId);
    const extraInstruction = [
      data.raw_text?.trim()
        ? `用户已生成或编辑的宫格导演提示词（优先执行，但不得覆盖镜头数量、顺序、画幅和参考图硬约束）：\n${data.raw_text.trim().slice(0, 8000)}`
        : '',
      skill?.system_instruction ? `分镜风格：${skill.system_instruction.slice(0, 6000)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const isPortrait = selectedStoryboardAspectRatio === '9:16';
    const fallbackSize: StoryboardGridImageSize = isPortrait ? '1024x1536' : '1536x1024';
    const sourcePages = paginateStoryboardGridSources(storyboardSource.shotSources);
    const abortController = new AbortController();
    imageAbortRef.current = abortController;
    patchNodeData(
      id,
      {
        imageGenerationStatus: 'generating',
        imageGenerationCompletedPages: 0,
        imageGenerationTotalPages: sourcePages.length,
        generation_error: undefined,
      },
      false,
    );
    pushMessage({
      role: 'system',
      text: `正在把 ${storyboardSource.shots.length} 个镜头${promptOnlyStoryboardMode ? '（来自提示词节点）' : storyboardPromptSource.sourceNodeIds.length ? `及 ${storyboardPromptResolution.matchedCount} 条已匹配 Prompt` : ''}合并为 ${sourcePages.length} 张 ${selectedStoryboardAspectRatio} 分镜宫格；每页只调用一次 ${selectedStoryboardModelOption.label}，不做后期切割……`,
      nodeId: id,
    });

    try {
      const generatedPages: StoryboardGridGeneratedPage[] = [];
      let nativeSizeFallbackCount = 0;
      for (let pageIndex = 0; pageIndex < sourcePages.length; pageIndex += 1) {
        const pageSources = sourcePages[pageIndex];
        const pageReferences = selectStoryboardReferencesForShots(
          storyboardReferenceContext.references,
          pageSources.map((source) => source.shot),
          storyboardBusinessReferenceLimit,
        );
        const preparedReferences = await prepareStoryboardReferenceImages(
          pageReferences,
          storyboardBusinessReferenceLimit,
        );
        const referenceInstruction = buildStoryboardReferenceInstruction(pageReferences, 2);
        const panelReferenceInstructions = pageSources.map((source) =>
          buildStoryboardPanelReferenceInstruction(source.shot, pageReferences, 2),
        );
        const pagePromptMatches = storyboardPromptResolution.matches.slice(
          pageIndex * STORYBOARD_GRID_MAX_PANELS,
          pageIndex * STORYBOARD_GRID_MAX_PANELS + pageSources.length,
        );
        const preferredSize: StoryboardGridImageSize = storyboardGridCanvasSize(
          pageSources.length,
          selectedStoryboardAspectRatio,
        );
        const prompt = buildStoryboardGridPrompt(
          pageSources.map((source) => source.shot),
          extraInstruction,
          {
            canvas: isPortrait ? 'portrait' : 'landscape',
            panelAspectRatio: selectedStoryboardAspectRatio,
            referenceInstruction,
            hasLayoutReference: true,
            layoutReferenceIndex: 1,
            panelPrompts: pagePromptMatches.map((match) => match.visualPrompt || undefined),
            panelReferenceInstructions,
          },
        );
        const layoutReference = createStoryboardLayoutReference(
          pageSources.length,
          selectedStoryboardAspectRatio,
        );
        const requestReferences = [layoutReference, ...preparedReferences];
        let rawResult;
        let usedFallbackSize = false;
        try {
          rawResult = await generateStoryboardGridImage(
            prompt,
            currentProjectId,
            abortController.signal,
            preferredSize,
            requestReferences,
            selectedStoryboardModel,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (!/(?:HTTP\s*(?:400|422)|尺寸|size|unsupported|不支持)/iu.test(message)) throw error;
          if (pageSources.length === 6) {
            throw new Error(`当前 ${selectedStoryboardModelOption.label} 渠道不支持六宫格专属尺寸 ${preferredSize}，已停止生成，不会改用错误比例的默认画布。`);
          }
          rawResult = await generateStoryboardGridImage(
            prompt,
            currentProjectId,
            abortController.signal,
            fallbackSize,
            requestReferences,
            selectedStoryboardModel,
          );
          usedFallbackSize = true;
          nativeSizeFallbackCount += 1;
        }
        const measuredResult = await measureStoryboardGridImage(rawResult);
        if (pageSources.length === 6 && measuredResult.width && measuredResult.height) {
          const expectedCanvasRatio = isPortrait ? 3 / 8 : 8 / 3;
          const actualCanvasRatio = measuredResult.width / measuredResult.height;
          const ratioError = Math.abs(actualCanvasRatio / expectedCanvasRatio - 1);
          if (ratioError > 0.03) {
            throw new Error(
              `${selectedStoryboardModelOption.label} 未按六宫格专属尺寸返回图片（实际 ${measuredResult.width}×${measuredResult.height}），已拒绝显示错误比例结果。`,
            );
          }
        }
        const result = await addStoryboardPanelCaptions(
          measuredResult,
          pageSources.map((source) => source.shot),
          selectedStoryboardAspectRatio,
        );
        const completedAt = Date.now();
        generatedPages.push({
          id: `film-storyboard-grid-${completedAt}-${pageIndex + 1}`,
          imageDataUrl: result.imageDataUrl,
          model: result.model,
          size: result.size,
          width: result.width,
          height: result.height,
          referenceImageCount: preparedReferences.length,
          referenceLabels: pageReferences.map((reference) =>
            `${reference.kind === 'character' ? '角色' : reference.kind === 'scene' ? '场景' : '道具'}:${reference.entityName || reference.name}`,
          ),
          frameGenerationMode: 'merged',
          nativeFrameFallbackCount: usedFallbackSize ? 1 : 0,
          panelCount: pageSources.length,
          pageIndex: pageIndex + 1,
          totalPages: sourcePages.length,
          completedAt,
          panels: pageSources.map((item, panelIndex) => {
            const promptMatch = pagePromptMatches[panelIndex];
            return {
              panelIndex: panelIndex + 1,
              sourceNodeId: item.sourceNodeId,
              sourceLabel: item.sourceLabel,
              shotId: item.shot.id,
              shotNo: item.shot.shotNo,
              promptSourceNodeId: promptMatch?.promptSourceNodeId,
              promptShotId: promptMatch?.promptPack?.shot_id,
              promptMatchMode:
                promptMatch?.mode === 'id' || promptMatch?.mode === 'order'
                  ? promptMatch.mode
                  : undefined,
            };
          }),
        });
        patchNodeData(
          id,
          { imageGenerationCompletedPages: pageIndex + 1, imageGenerationTotalPages: sourcePages.length },
          false,
        );
      }

      const now = Date.now();
      const firstPage = generatedPages[0];
      const previousOutput: Record<string, unknown> =
        data.output && typeof data.output === 'object' ? { ...(data.output as Record<string, unknown>) } : {};
      const pageMetadata = generatedPages.map(({ imageDataUrl: _imageDataUrl, ...page }) => page);
      const sourceNode = useStudioStore.getState().nodes.find((node) => node.id === id);
      const sourcePosition = sourceNode?.position ?? { x: 0, y: 0 };
      const outputImageNodeIds = generatedPages.map((page, pageOffset) => {
        const liveState = useStudioStore.getState();
        const existing = liveState.nodes.find(
          (node) =>
            node.type === 'imageNode' &&
            node.data.generatedFromStoryboardNodeId === id &&
            node.data.generatedStoryboardPageIndex === page.pageIndex,
        );
        const label = `分镜宫格 ${page.pageIndex}/${page.totalPages} · ${page.panelCount} 镜头`;
        const imageFileName = `storyboard-grid-${page.pageIndex}-${now}.jpg`;
        const imageNodeId = existing?.id ?? addImageNode(
          {
            x: sourcePosition.x + 820,
            y: sourcePosition.y + pageOffset * 540,
          },
          {
            imageDataUrl: page.imageDataUrl,
            imageMimeType: 'image/jpeg',
            imageFileName,
            label,
            silent: true,
          },
        );
        patchNodeData(
          imageNodeId,
          {
            label,
            imageDataUrl: page.imageDataUrl,
            imageMimeType: 'image/jpeg',
            imageFileName,
            imageWidth: page.width,
            imageHeight: page.height,
            imageDisplayMode: 'storyboard-output',
            generatedFromStoryboardNodeId: id,
            generatedStoryboardPageIndex: page.pageIndex,
            imageAnalysisSummary: `${page.panelCount} 个镜头 · 目标 ${selectedStoryboardAspectRatio} · 实际 ${page.size.replace('x', '×')} · ${selectedStoryboardModelOption.label} 合并提示词单次生成`,
            imageGenerationModel: page.model,
            imageGenerationSourceShotIds: page.panels.map((panel) => panel.shotId),
            imageGenerationSourceNodeIds: storyboardSource.sourceNodeIds,
            imageGenerationReferenceSignature: referenceSignature,
            imageGenerationReferenceCount: page.referenceImageCount,
            imageGenerationReferenceLabels: page.referenceLabels,
            imageGenerationPromptSignature: storyboardPromptResolution.signature,
            imageGenerationInstructionSignature: storyboardInstructionSignature,
            imageGenerationPromptSourceNodeIds: storyboardPromptSource.sourceNodeIds,
            imageGenerationPromptMatchedCount: storyboardPromptResolution.matchedCount,
            imageGenerationAspectRatio: selectedStoryboardAspectRatio,
            imageGenerationCompletedAt: page.completedAt,
            film_storyboard_aspect_ratio: selectedStoryboardAspectRatio,
            status: 'APPROVED',
            output: {
              storyboardImagePage: {
                sourceStoryboardNodeId: id,
                pageIndex: page.pageIndex,
                totalPages: page.totalPages,
                panelCount: page.panelCount,
                panels: page.panels,
                model: page.model,
                size: page.size,
                completedAt: page.completedAt,
              },
            },
          },
          true,
        );
        const hasOutputEdge = useStudioStore.getState().edges.some(
          (edge) => edge.source === id && edge.target === imageNodeId,
        );
        if (!hasOutputEdge) {
          onConnect({
            source: id,
            target: imageNodeId,
            sourceHandle: FILM_OUTPUT_HANDLE_ID,
            targetHandle: IMAGE_NODE_INPUT_HANDLE_ID,
          });
        }
        return imageNodeId;
      });
      const obsoleteOutputNodeIds = useStudioStore
        .getState()
        .nodes.filter(
          (node) =>
            node.type === 'imageNode' &&
            node.data.generatedFromStoryboardNodeId === id &&
            !outputImageNodeIds.includes(node.id),
        )
        .map((node) => node.id);
      if (obsoleteOutputNodeIds.length) removeNodesByIds(obsoleteOutputNodeIds);
      const persistedPageMetadata: StoryboardGridImagePage[] = generatedPages.map((page) => ({
        ...page,
        imageDataUrl: undefined,
      }));
      patchNodeData(
        id,
        {
          imageDataUrl: undefined,
          imageMimeType: 'image/jpeg',
          imageFileName: `film-storyboard-grid-${now}.jpg`,
          imageWidth: firstPage.width,
          imageHeight: firstPage.height,
          imageAnalysisSummary: `由 ${storyboardSource.shots.length} 个唯一镜头生成 ${generatedPages.length} 张分镜宫格 · ${storyboardSource.sourceLabels.join('、')}`,
          imageGenerationModel: firstPage.model,
          imageGenerationSourceShotIds: storyboardSource.shots.map((shot) => shot.id),
          imageGenerationSourceNodeIds: storyboardSource.sourceNodeIds,
          imageGenerationReferenceSignature: referenceSignature,
          imageGenerationReferenceCount: firstPage.referenceImageCount,
          imageGenerationReferenceLabels: firstPage.referenceLabels,
          imageGenerationPromptSignature: storyboardPromptResolution.signature,
          imageGenerationInstructionSignature: storyboardInstructionSignature,
          imageGenerationPromptSourceNodeIds: storyboardPromptSource.sourceNodeIds,
          imageGenerationPromptMatchedCount: storyboardPromptResolution.matchedCount,
          imageGenerationAspectRatio: selectedStoryboardAspectRatio,
          imageGenerationCompletedAt: now,
          imageGenerationStatus: 'idle',
          imageGenerationCompletedPages: undefined,
          imageGenerationTotalPages: undefined,
          storyboardGridImages: persistedPageMetadata,
          storyboardOutputImageNodeIds: outputImageNodeIds,
          generation_error: undefined,
          status: 'APPROVED',
          output: {
            ...previousOutput,
            storyboardImage: {
              kind: 'storyboard_grid_image',
              model: firstPage.model,
              size: firstPage.size,
              aspectRatio: selectedStoryboardAspectRatio,
              sourceShotIds: storyboardSource.shots.map((shot) => shot.id),
              sourceNodeIds: storyboardSource.sourceNodeIds,
              referenceBindings: storyboardReferenceContext.references.map((reference) => ({
                imageNodeId: reference.imageNodeId,
                name: reference.name,
                kind: reference.kind,
                entityId: reference.entityId,
                entityName: reference.entityName,
              })),
              promptSourceNodeIds: storyboardPromptSource.sourceNodeIds,
              promptMatchedCount: storyboardPromptResolution.matchedCount,
              promptSignature: storyboardPromptResolution.signature,
              completedAt: now,
            },
            storyboardImages: pageMetadata,
          },
        },
        true,
      );
      pushMessage({
        role: 'system',
        text: `已将 ${storyboardSource.shots.length} 个镜头${storyboardPromptSource.sourceNodeIds.length ? `与 ${storyboardPromptResolution.matchedCount} 条 Prompt` : ''}合并生成 ${generatedPages.length} 张分镜宫格，并输出到右侧 ${outputImageNodeIds.length} 个独立图片节点；每页仅调用一次 ${selectedStoryboardModelOption.label}，未做后期切割${nativeSizeFallbackCount ? `；${nativeSizeFallbackCount} 页因渠道尺寸限制保留原生画幅` : ''}${firstPage.referenceImageCount ? `；${selectedStoryboardModelOption.label} 已接收 ${firstPage.referenceImageCount} 张命名参考图` : ''}。`,
        nodeId: id,
      });
      window.requestAnimationFrame(() => {
        void reactFlow.fitView({
          nodes: outputImageNodeIds.map((nodeId) => ({ id: nodeId })),
          padding: 0.18,
          duration: 600,
        });
      });
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      const message = cancelled
        ? '已停止分镜宫格图片生成。'
        : error instanceof Error
          ? error.message
          : '分镜宫格图片生成失败。';
      patchNodeData(
        id,
        {
          imageGenerationStatus: 'idle',
          imageGenerationCompletedPages: undefined,
          imageGenerationTotalPages: undefined,
          generation_error: cancelled ? undefined : message,
        },
        false,
      );
      pushMessage({ role: 'system', text: message, nodeId: id });
    } finally {
      if (imageAbortRef.current === abortController) imageAbortRef.current = null;
    }
  }, [
    addImageNode,
    currentProjectId,
    data.output,
    data.raw_text,
    effectiveStoryboardSkillId,
    id,
    imageBusy,
    onConnect,
    patchNodeData,
    promptOnlyStoryboardMode,
    pushMessage,
    reactFlow,
    referenceSignature,
    removeNodesByIds,
    selectedStoryboardAspectRatio,
    selectedStoryboardModel,
    selectedStoryboardModelOption.label,
    storyboardInstructionSignature,
    storyboardBusinessReferenceLimit,
    storyboardPromptResolution,
    storyboardPromptSource,
    storyboardSource,
    storyboardReferenceContext.references,
  ]);

  return (
    <div
      className={`ai-film-node ai-film-node--${meta.accent} ${selected ? 'ai-film-node--selected' : ''} ${
        anyBusy ? 'ai-film-node--busy' : ''
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={FILM_INPUT_HANDLE_ID}
        className="ai-film-node__handle ai-film-node__handle--in"
        title={isStoryboardNode
          ? 'Input：可只接提示词节点，并接图片作为参考图；也兼容分镜部或分镜表来源。'
          : 'Input：接入文本、图片、角色设定或分镜提示词。'}
      />
      <header className="ai-film-node__head">
        <div>
          <div className="ai-film-node__eyebrow">{meta.eyebrow}</div>
          <div className="ai-film-node__title">{data.label?.trim() || meta.title}</div>
        </div>
        <span className={`ai-film-node__status ${anyBusy ? 'ai-film-node__status--busy' : ''}`}>
          {imageBusy
            ? `绘图 ${data.imageGenerationCompletedPages ?? 0}/${data.imageGenerationTotalPages ?? storyboardPageCount}`
            : busy
              ? '生成中'
              : storyboardImageStale
                ? '需重生成'
                : hasImage
                ? '已出图'
                : modeLabel ?? '待生成'}
        </span>
      </header>
      <section className={`ai-film-node__body ${hasText || hasImage ? 'ai-film-node__body--filled' : ''}`}>
        {isStoryboardNode && storyboardOutputImageNodeIds.length ? (
          <div className="ai-film-node__output-card">
            <span className="ai-film-node__output-icon" aria-hidden>↗</span>
            <div>
              <strong>分镜图片已输出</strong>
              <span>右侧 {storyboardOutputImageNodeIds.length} 个独立图片节点</span>
            </div>
          </div>
        ) : isStoryboardNode && embeddedStoryboardPages.length ? (
          <div className="ai-film-node__grid-gallery">
            {embeddedStoryboardPages.map((page) => (
              <figure key={page.id} className="ai-film-node__grid-preview">
                <img src={page.imageDataUrl} alt={`影视分镜图第 ${page.pageIndex} 页`} />
                <figcaption>
                  第 {page.pageIndex}/{page.totalPages} 张 · {page.panelCount} 个镜头 · 目标 {selectedStoryboardAspectRatio} · 实际 {page.size.replace('x', '×')} · 合并提示词单次生成
                </figcaption>
              </figure>
            ))}
          </div>
        ) : isStoryboardNode && data.imageDataUrl ? (
          <figure className="ai-film-node__grid-preview">
            <img src={data.imageDataUrl} alt={data.imageFileName || '影视分镜图'} />
            <figcaption>{data.imageGenerationSourceShotIds?.length ?? 0} 个镜头 · 旧版单图结果</figcaption>
          </figure>
        ) : null}
        {hasText ? <pre className="ai-film-node__prompt">{text}</pre> : null}
        {!hasText && !hasImage ? (
          <div className="ai-film-node__empty">
            <span />
            <p>{meta.empty}</p>
          </div>
        ) : null}
      </section>
      {data.generation_error?.trim() ? (
        <div className="ai-film-node__error">{data.generation_error.trim()}</div>
      ) : null}
      <footer className={`ai-film-node__footer nodrag nopan ${isStoryboardNode ? 'ai-film-node__footer--stacked' : ''}`}>
        {isStoryboardNode ? (
          <>
            <label className="ai-film-node__skill">
              <span>画幅</span>
              <select
                className="ai-film-node__skill-select"
                value={selectedStoryboardAspectRatio}
                onChange={onStoryboardAspectRatioChange}
                disabled={anyBusy}
              >
                <option value="16:9">16:9 横屏</option>
                <option value="9:16">9:16 竖屏</option>
              </select>
            </label>
            <div className="ai-film-node__skill ai-film-node__model-picker">
              <span>图片模型</span>
              <div
                ref={storyboardModelMenuRef}
                className={`image-table-node__model-switcher nodrag nowheel ${storyboardModelMenuOpen ? 'image-table-node__model-switcher--open' : ''} image-table-node__model-switcher--${storyboardModelMenuPlacement}`}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="image-table-node__model-trigger"
                  aria-label="影视分镜图片模型"
                  aria-haspopup={canSwitchStoryboardModel ? 'listbox' : undefined}
                  aria-expanded={canSwitchStoryboardModel ? storyboardModelMenuOpen : undefined}
                  title={`切换图片模型：${selectedStoryboardModelOption.label}`}
                  onClick={canSwitchStoryboardModel ? toggleStoryboardModelMenu : undefined}
                  disabled={anyBusy}
                >
                  <span className="image-table-node__model-trigger-copy">
                    <strong>{selectedStoryboardModelOption.label}</strong>
                    <small>{selectedStoryboardModelOption.badge}</small>
                  </span>
                  <span className="image-table-node__model-chevron" aria-hidden>
                    {canSwitchStoryboardModel ? (storyboardModelMenuOpen ? '收起' : '切换') : '固定'}
                  </span>
                </button>
                {canSwitchStoryboardModel && storyboardModelMenuOpen ? (
                  <div className="image-table-node__model-menu" role="listbox" aria-label="选择影视分镜图片模型">
                    <div className="image-table-node__model-menu-head">
                      <strong>图片模型</strong>
                      <span>影视分镜图</span>
                    </div>
                    {STORYBOARD_GRID_IMAGE_MODELS.map((model) => {
                      const active = model.id === selectedStoryboardModel;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={`image-table-node__model-option ${active ? 'image-table-node__model-option--active' : ''}`}
                          onClick={() => selectStoryboardModel(model.id)}
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
            </div>
            <label className="ai-film-node__skill">
              <span>分镜 Skill</span>
              <select
                className="ai-film-node__skill-select"
                value={effectiveStoryboardSkillId}
                onChange={onSkillChange}
                disabled={anyBusy}
              >
                {storyboardSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}
                  </option>
                ))}
              </select>
            </label>
            {storyboardReferenceContext.references.length ? (
              <details className="ai-film-node__references" open>
                <summary>
                  <span>参考图绑定</span>
                  <b>
                    {Math.min(
                      storyboardReferenceContext.references.filter((reference) => reference.dataUrl).length,
                      storyboardBusinessReferenceLimit,
                    )}
                    /{storyboardReferenceContext.references.length}
                  </b>
                </summary>
                <div className="ai-film-node__reference-list">
                  {storyboardReferenceContext.references.map((reference) => {
                    const entities = storyboardReferenceContext.entities.filter(
                      (entity) => entity.kind === reference.kind,
                    );
                    return (
                      <div key={reference.imageNodeId} className="ai-film-node__reference-row">
                        {reference.dataUrl ? (
                          <img src={reference.dataUrl} alt={reference.name} />
                        ) : (
                          <div className="ai-film-node__reference-missing">无图</div>
                        )}
                        <div className="ai-film-node__reference-fields">
                          <input
                            value={reference.name}
                            onChange={(event) => saveReferenceBindings(reference.imageNodeId, { name: event.target.value })}
                            placeholder="给参考图命名"
                            aria-label="参考图名称"
                            disabled={anyBusy}
                          />
                          <div>
                            <select
                              value={reference.kind}
                              onChange={(event) =>
                                onReferenceKindChange(reference.imageNodeId, event.target.value as StoryboardReferenceKind)
                              }
                              aria-label="参考图类型"
                              disabled={anyBusy}
                            >
                              <option value="character">角色</option>
                              <option value="scene">场景</option>
                              <option value="prop">道具</option>
                            </select>
                            <select
                              value={reference.entityId ?? ''}
                              onChange={(event) =>
                                onReferenceEntityChange(reference.imageNodeId, reference.kind, event.target.value)
                              }
                              aria-label="对应分镜表对象"
                              disabled={anyBusy || !entities.length}
                            >
                              <option value="">{entities.length ? '选择角色/场景/道具' : '未识别到表格数据'}</option>
                              {entities.map((entity) => (
                                <option key={`${entity.kind}:${entity.id}`} value={entity.id}>
                                  {entity.name}{entity.detail ? ` · ${entity.detail}` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p>
                  {storyboardReferenceContext.entities.length
                    ? `已从${storyboardReferenceContext.entitySource === 'connected' ? '连入的分镜部/分镜表' : '当前项目分镜表'}识别 ${storyboardReferenceContext.entities.length} 个角色、场景或道具；生成时会把原图传给 ${selectedStoryboardModelOption.label}。`
                    : '尚未识别到角色、场景或道具。请确认分镜表包含场景、角色、道具列，或先运行剧本拆解。'}
                  {storyboardReferenceContext.references.length > storyboardBusinessReferenceLimit
                    ? ` 单次最多读取 ${storyboardBusinessReferenceLimit} 张业务参考图，并固定保留 1 张宫格布局参考图。`
                    : ''}
                  {storyboardReferenceContext.missingImageCount
                    ? ` 有 ${storyboardReferenceContext.missingImageCount} 个图片节点尚未上传图片。`
                    : ''}
                  {typeof data.imageGenerationReferenceCount === 'number'
                    ? ` 上次出图已确认传入 ${data.imageGenerationModel ? imageGenerationModelOption(resolveImageGenerationModel(data.imageGenerationModel)).label : selectedStoryboardModelOption.label}：${data.imageGenerationReferenceCount} 张。`
                    : ''}
                  {data.imageGenerationReferenceLabels?.length
                    ? ` 实际顺序：${data.imageGenerationReferenceLabels
                        .map((label, index) => `参考图${index + 1}=${label}`)
                        .join('；')}。`
                    : ''}
                </p>
              </details>
            ) : (
              <div className="ai-film-node__reference-empty">
                可把图片节点连到这里作为角色、场景或道具参考图。
              </div>
            )}
          </>
        ) : null}
        {isStoryboardNode ? (
          <div className="ai-film-node__source-meta">
            <span>
              {storyboardSource.shots.length
                ? `${promptOnlyStoryboardMode ? '提示词直连' : `已连接 ${storyboardSource.sourceNodeIds.length} 个来源`} · 读取 ${storyboardSource.shots.length} 个镜头`
                : '等待 Prompt 或分镜来源'}
            </span>
            {storyboardSource.shots.length ? (
              <span className={
                storyboardPromptSource.sourceNodeIds.length &&
                storyboardPromptResolution.matchedCount !== storyboardSource.shots.length
                  ? 'ai-film-node__source-stale'
                  : undefined
              }>
                {storyboardPromptSource.sourceNodeIds.length
                  ? `Prompt ${storyboardPromptResolution.matchedCount}/${storyboardSource.shots.length}${promptOnlyStoryboardMode ? ' · 直连模式' : ''}`
                  : '未连接 Prompt · 分镜表模式'}
              </span>
            ) : null}
            {storyboardSource.shots.length ? <span>将生成 {storyboardPageCount} 张图片</span> : null}
            {storyboardSource.duplicateCount ? <span>已去重 {storyboardSource.duplicateCount} 个重复镜头</span> : null}
            {storyboardPromptResolution.orderFallbackCount ? (
              <span>按顺序兜底匹配 {storyboardPromptResolution.orderFallbackCount} 条</span>
            ) : null}
            {storyboardImageStale ? <span className="ai-film-node__source-stale">镜头、Prompt 或参考图已变化</span> : null}
          </div>
        ) : null}
        <div className={`ai-film-node__actions ${isStoryboardNode ? 'ai-film-node__actions--storyboard' : ''}`}>
          <button
            type="button"
            className={`ai-film-node__primary ${busy ? 'ai-film-node__primary--stop' : ''}`}
            onClick={onRun}
            disabled={imageBusy}
          >
            {busy ? '停止' : meta.action}
          </button>
          {isStoryboardNode ? (
            <button
              type="button"
              className={`ai-film-node__image-action ${imageBusy ? 'ai-film-node__primary--stop' : ''}`}
              onClick={onGenerateStoryboardImage}
              disabled={busy}
            >
              {imageBusy ? '停止绘图' : hasImage ? imageActionLabel.replace(/^生成/u, '重新生成') : imageActionLabel}
            </button>
          ) : null}
          <button type="button" className="ai-film-node__secondary" onClick={onCopy} disabled={!hasText || anyBusy}>
            复制
          </button>
        </div>
      </footer>
      <Handle
        type="source"
        position={Position.Right}
        id={FILM_OUTPUT_HANDLE_ID}
        className="ai-film-node__handle ai-film-node__handle--out"
        title="Output：把生成的提示词连接到下游 AI Filmmaking 节点。"
      />
    </div>
  );
}

export const AiFilmCharacterNode = memo(AiFilmmakingNodeInner);
export const AiFilmStoryboardNode = memo(AiFilmmakingNodeInner);
export const AiFilmVideoPromptNode = memo(AiFilmmakingNodeInner);
