import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type CoordinateExtent,
  type Edge,
  type NodeTypes,
  type OnConnectEnd,
  type OnConnectStart,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ConnectEndBinder,
  type ConnectionDragStart,
  type NodePickerState,
} from '@/components/ConnectEndBinder';
import { ChatDock } from '@/components/ChatDock';
import {
  DepartmentNode,
  DEPT_INPUT_HANDLE_ID,
  DEPT_INPUT_PULL_HANDLE_ID,
  DEPT_OUTPUT_HANDLE_ID,
} from '@/components/DepartmentNode';
import { ImageTableNode, IMAGE_NODE_OUTPUT_HANDLE_ID } from '@/components/ImageTableNode';
import { PromptReviewNode } from '@/components/PromptReviewNode';
import { StoryboardFileNode } from '@/components/StoryboardFileNode';
import { ShotListNode } from '@/components/ShotListNode';
import { TextNode, TEXT_NODE_OUTPUT_HANDLE_ID } from '@/components/TextNode';
import { DetailPanel } from '@/components/DetailPanel';
import { NodeContextMenu, type ContextMenuState } from '@/components/NodeContextMenu';
import { ScissorCutLayer } from '@/components/ScissorCutLayer';
import { StudioErrorBoundary } from '@/components/StudioErrorBoundary';
import { StudioProjectMenu } from '@/components/StudioProjectMenu';
import { StudioSettings } from '@/components/StudioSettings';
import { StudioWelcomePanel } from '@/components/StudioWelcomePanel';
import {
  createStudioProjectId,
  parseStudioProjectJsonFile,
  pushStudioRecentProject,
  putStudioProjectRecord,
  setActiveStudioProjectRef,
} from '@/services/studioProjectPersistence';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioRFNode } from '@/types/reactFlow';
import { isDeprecatedScriptFlowNode, removeDeprecatedScriptNodes } from '@/utils/deprecatedScriptNodes';
import { parseStoryboardWorkbookFile } from '@/utils/storyboardWorkbook';
import {
  SHOT_LIST_LINK_HANDLE_ID,
  SHOT_LIST_PARENT_HANDLE_ID,
  isShotListItemOutputHandleId,
} from '@/utils/shotListWire';

const nodeTypes: NodeTypes = {
  department: DepartmentNode,
  textNode: TextNode,
  shotList: ShotListNode,
  storyboardFile: StoryboardFileNode,
  imageNode: ImageTableNode,
  promptReview: PromptReviewNode,
};

type CreateNodeKind =
  | 'text_node'
  | 'image_node'
  | 'storyboard_file_node'
  | 'prompt_review_node'
  | 'shot_list_node'
  | 'writing'
  | 'storyboard'
  | 'prompt';

type NodeGalleryItem = {
  id: string;
  kind?: CreateNodeKind;
  title: string;
  subtitle: string;
  badge: string;
  accentClass: string;
  icon: string;
  disabled?: boolean;
};

const HIDE_TEMPORARY_NODE_ENTRIES = true;
const HIDDEN_PANE_GALLERY_KINDS = new Set<CreateNodeKind>(['writing', 'storyboard_file_node']);

const PANE_GALLERY_ITEMS_BASE: NodeGalleryItem[] = [
  {
    id: 'text_node',
    kind: 'text_node',
    title: '文本卡片',
    subtitle: '粘贴原文、台词、批注或任何临时素材。',
    badge: '基础输入',
    accentClass: 'node-picker__card--text',
    icon: 'T',
  },
  {
    id: 'writing',
    kind: 'writing',
    title: '编剧部',
    subtitle: '把文本整理成结构化场次和剧情节拍。',
    badge: '剧情拆解',
    accentClass: 'node-picker__card--writing',
    icon: '剧',
  },
  {
    id: 'storyboard',
    kind: 'storyboard',
    title: '分镜部',
    subtitle: '把剧本拆成镜头，并自动生成镜头表。',
    badge: '镜头设计',
    accentClass: 'node-picker__card--storyboard',
    icon: '镜',
  },
  {
    id: 'prompt',
    kind: 'prompt',
    title: '提示词部',
    subtitle: '把分镜或文本转成视频生成提示词包。',
    badge: '生成提示',
    accentClass: 'node-picker__card--prompt',
    icon: 'P',
  },
  {
    id: 'prompt_review_node',
    kind: 'prompt_review_node',
    title: '提示词审核',
    subtitle: '像文档一样编辑 Prompt，并可调用 LLM 进行修订。',
    badge: '审核编辑',
    accentClass: 'node-picker__card--prompt',
    icon: '审',
  },
  {
    id: 'image_node',
    kind: 'image_node',
    title: '图片节点',
    subtitle: '上传图片作为视觉参考；连接到文本卡片后，润色会结合画面内容。',
    badge: '画面参考',
    accentClass: 'node-picker__card--storyboard',
    icon: '图',
  },
  {
    id: 'storyboard_file_node',
    kind: 'storyboard_file_node',
    title: '分镜表文件',
    subtitle: '导入 Excel 分镜表，直接作为 Prompt 的上游输入。',
    badge: '文件导入',
    accentClass: 'node-picker__card--storyboard',
    icon: 'X',
  },
  {
    id: 'shot_list',
    kind: 'shot_list_node',
    title: '镜头表',
    subtitle: '由分镜执行后自动生成，也可以作为 Prompt 的上游资产。',
    badge: '自动生成',
    accentClass: 'node-picker__card--shot-list',
    icon: '表',
  },
];

const PANE_GALLERY_ITEMS: NodeGalleryItem[] = PANE_GALLERY_ITEMS_BASE.filter(
  (item) => !(HIDE_TEMPORARY_NODE_ENTRIES && item.kind != null && HIDDEN_PANE_GALLERY_KINDS.has(item.kind)),
);

/** 涓?Miro / Tapnow 涓€鑷达細骞崇Щ涓庢斁缃妭鐐瑰潎鏃犺竟鐣岄檺鍒?*/
const INFINITE_EXTENT: CoordinateExtent = [
  [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
];

export function StudioCanvas() {
  const nodes = useStudioStore((s) => s.nodes);
  const nodeCount = nodes.length;
  const removeNodesByIds = useStudioStore((s) => s.removeNodesByIds);

  // 浠呭湪鏂拌妭鐐硅繘鍏ョ敾甯冩椂琛ョ粦 onExecute/onDelete锛涗笉鍦ㄦ璺?reconcile锛堝叏鍥?resync 浼氱骇鑱?patch锛屾槗瑙﹀彂 Maximum update depth锛?
  useEffect(() => {
    useStudioStore.getState().ensureRuntimeBindingsOnNodes();
  }, [nodeCount]);
  const edges = useStudioStore((s) => s.edges);
  const visibleGraph = useMemo(() => removeDeprecatedScriptNodes(nodes, edges), [edges, nodes]);
  const visibleNodes = visibleGraph.nodes;
  const visibleEdges = visibleGraph.edges;

  useEffect(() => {
    const removedIds = nodes.filter(isDeprecatedScriptFlowNode).map((node) => node.id);
    if (removedIds.length > 0) {
      removeNodesByIds(removedIds);
    }
  }, [nodes, removeNodesByIds]);

  const onNodesChange = useStudioStore((s) => s.onNodesChange);
  const onConnect = useStudioStore((s) => s.onConnect);
  const onEdgesChange = useStudioStore((s) => s.onEdgesChange);
  const completeConnectionMenuPick = useStudioStore((s) => s.completeConnectionMenuPick);
  const removeEdges = useStudioStore((s) => s.removeEdges);
  const setSelected = useStudioStore((s) => s.setSelected);
  const addDepartmentNode = useStudioStore((s) => s.addDepartmentNode);
  const addTextNode = useStudioStore((s) => s.addTextNode);
  const addImageNode = useStudioStore((s) => s.addImageNode);
  const addPromptReviewNode = useStudioStore((s) => s.addPromptReviewNode);
  const addStoryboardFileNode = useStudioStore((s) => s.addStoryboardFileNode);
  const addShotListNode = useStudioStore((s) => s.addShotListNode);
  const startStoryboardPipeline = useStudioStore((s) => s.startStoryboardPipeline);
  const focusNode = useStudioStore((s) => s.focusNode);
  const hydrateProject = useStudioStore((s) => s.hydrateProject);
  const pushMessage = useStudioStore((s) => s.pushMessage);
  const duplicateNodesByIds = useStudioStore((s) => s.duplicateNodesByIds);
  const repositionNodes = useStudioStore((s) => s.repositionNodes);
  const undo = useStudioStore((s) => s.undo);

  const [nodePicker, setNodePicker] = useState<NodePickerState | null>(null);
  const [paneMenuSeed, setPaneMenuSeed] = useState<{ screenX: number; screenY: number } | null>(null);
  const [paneCreateMenu, setPaneCreateMenu] = useState<{
    screenX: number;
    screenY: number;
    flowX: number;
    flowY: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [draggingCanvasFile, setDraggingCanvasFile] = useState(false);
  const connectEndImplRef = useRef<OnConnectEnd>(() => {});
  const connectionDragRef = useRef<ConnectionDragStart | null>(null);
  const altDragStateRef = useRef<{
    dragNodeId: string;
    sourceIds: string[];
    originalPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const lastPaneClickRef = useRef<{ ts: number; x: number; y: number } | null>(null);
  const screenToFlowRef = useRef<((pos: { x: number; y: number }) => { x: number; y: number }) | null>(null);

  const shotListOutputPanePicker =
    Boolean(nodePicker) &&
    nodes.find((n) => n.id === nodePicker!.fromNodeId)?.type === 'shotList' &&
    (nodePicker!.fromHandleId === DEPT_OUTPUT_HANDLE_ID ||
      isShotListItemOutputHandleId(nodePicker!.fromHandleId)) &&
    nodePicker!.fromHandleType === 'source';
  const promptOutputPanePicker =
    Boolean(nodePicker) &&
    nodes.find((n) => n.id === nodePicker!.fromNodeId)?.type === 'department' &&
    nodes.find((n) => n.id === nodePicker!.fromNodeId)?.data.type === 'prompt' &&
    nodePicker!.fromHandleId === DEPT_OUTPUT_HANDLE_ID &&
    nodePicker!.fromHandleType === 'source';
  const onConnectStart = useCallback<OnConnectStart>((_e, p) => {
    connectionDragRef.current = {
      nodeId: p.nodeId,
      handleId: p.handleId,
      handleType: p.handleType,
    };
  }, []);

  const onConnectEndOuter = useCallback<OnConnectEnd>((event, cs) => {
    connectEndImplRef.current(event, cs);
  }, []);

  const onNodeClick = useCallback(
    (_: ReactMouseEvent, n: StudioRFNode) => {
      lastPaneClickRef.current = null;
      setContextMenu(null);
      setPaneCreateMenu(null);
      const openDetail = n.type === 'department' || n.type === 'shotList';
      focusNode(n.id, { openDetail });
    },
    [focusNode],
  );

  const onNodeContextMenu = useCallback((e: ReactMouseEvent, n: StudioRFNode) => {
    lastPaneClickRef.current = null;
    e.preventDefault();
    setPaneCreateMenu(null);
    setContextMenu({ x: e.clientX, y: e.clientY, node: n });
  }, []);

  const onNodeDoubleClick = useCallback(
    (_: ReactMouseEvent, n: StudioRFNode) => {
      if (n.type === 'textNode') {
        useStudioStore.getState().focusNode(n.id, { openDetail: false });
      }
    },
    [],
  );

  const onNodeDragStart = useCallback((event: MouseEvent | ReactMouseEvent, node: StudioRFNode) => {
    if (!('altKey' in event) || !event.altKey) {
      altDragStateRef.current = null;
      return;
    }
    const state = useStudioStore.getState();
    const selectedIds = state.nodes.filter((item) => item.selected).map((item) => item.id);
    const sourceIds = selectedIds.includes(node.id) ? selectedIds : [node.id];
    const originalPositions = Object.fromEntries(
      state.nodes
        .filter((item) => sourceIds.includes(item.id))
        .map((item) => [item.id, { x: item.position.x, y: item.position.y }]),
    );
    altDragStateRef.current = {
      dragNodeId: node.id,
      sourceIds,
      originalPositions,
    };
  }, []);

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | ReactMouseEvent, node: StudioRFNode) => {
      const dragState = altDragStateRef.current;
      altDragStateRef.current = null;
      if (!dragState) return;

      const dragOrigin = dragState.originalPositions[dragState.dragNodeId];
      if (!dragOrigin) return;

      const deltaX = node.position.x - dragOrigin.x;
      const deltaY = node.position.y - dragOrigin.y;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        return;
      }

      const duplicatedIds = duplicateNodesByIds(dragState.sourceIds);
      if (duplicatedIds.length === 0) return;

      const patches: Record<string, { x: number; y: number; selected?: boolean }> = {};
      for (const sourceId of dragState.sourceIds) {
        const original = dragState.originalPositions[sourceId];
        if (!original) continue;
        patches[sourceId] = { x: original.x, y: original.y, selected: false };
      }
      duplicatedIds.forEach((duplicatedId, index) => {
        const sourceId = dragState.sourceIds[index];
        const original = dragState.originalPositions[sourceId];
        if (!original) return;
        patches[duplicatedId] = {
          x: original.x + deltaX,
          y: original.y + deltaY,
          selected: true,
        };
      });
      repositionNodes(patches);
    },
    [duplicateNodesByIds, repositionNodes],
  );

  const onPaneClick = useCallback((e: ReactMouseEvent) => {
    const now = Date.now();
    const prev = lastPaneClickRef.current;
    const distance =
      prev == null ? Number.POSITIVE_INFINITY : Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
    const isSyntheticDoubleClick = prev != null && now - prev.ts <= 280 && distance <= 18;

    setSelected(null);
    setNodePicker(null);
    setContextMenu(null);
    setSelectedEdgeIds([]);
    if (!isSyntheticDoubleClick) {
      lastPaneClickRef.current = { ts: now, x: e.clientX, y: e.clientY };
      setPaneCreateMenu(null);
      return;
    }
    lastPaneClickRef.current = null;
    setPaneMenuSeed({ screenX: e.clientX, screenY: e.clientY });
    setPaneCreateMenu(null);
  }, [setSelected]);

  const onSelectionChange = useCallback(({ edges }: { nodes: StudioRFNode[]; edges: Edge[] }) => {
    setSelectedEdgeIds(edges.map((e) => e.id));
  }, []);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const gone = new Set(deleted.map((e) => e.id));
    setSelectedEdgeIds((prev) => prev.filter((id) => !gone.has(id)));
  }, []);

  useEffect(() => {
    if (!nodePicker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNodePicker(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodePicker]);

  useEffect(() => {
    if (!paneCreateMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPaneCreateMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paneCreateMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const duplicateKey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd';
      if (!duplicateKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const selectedIds = useStudioStore
        .getState()
        .nodes.filter((node) => node.selected)
        .map((node) => node.id);
      if (selectedIds.length === 0) return;
      event.preventDefault();
      duplicateNodesByIds(selectedIds);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [duplicateNodesByIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const undoKey =
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z';
      if (!undoKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      undo();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo]);

  const createNodeFromPaneMenu = useCallback(
    (kind: CreateNodeKind) => {
      if (!paneCreateMenu) return;
      const pos = { x: paneCreateMenu.flowX, y: paneCreateMenu.flowY };
      let id: string;
      if (kind === 'text_node') {
        id = addTextNode('', pos);
        setPaneCreateMenu(null);
        focusNode(id, { openDetail: true });
        return;
      }
      if (kind === 'storyboard_file_node') {
        id = addStoryboardFileNode(pos);
        setPaneCreateMenu(null);
        focusNode(id, { openDetail: false });
        return;
      }
      if (kind === 'image_node') {
        id = addImageNode(pos);
        setPaneCreateMenu(null);
        focusNode(id, { openDetail: false });
        return;
      }
      if (kind === 'prompt_review_node') {
        id = addPromptReviewNode(pos);
        setPaneCreateMenu(null);
        focusNode(id, { openDetail: false });
        return;
      }
      if (kind === 'shot_list_node') {
        id = addShotListNode(pos);
        setPaneCreateMenu(null);
        focusNode(id, { openDetail: true });
        return;
      }
      if (kind === 'storyboard') {
        id = startStoryboardPipeline(pos);
        setPaneCreateMenu(null);
        focusNode(id);
        return;
      }
      id = addDepartmentNode(kind, pos);
      setPaneCreateMenu(null);
      focusNode(id);
    },
    [
      addDepartmentNode,
      addShotListNode,
      addImageNode,
      addPromptReviewNode,
      addStoryboardFileNode,
      addTextNode,
      focusNode,
      paneCreateMenu,
      startStoryboardPipeline,
    ],
  );

  const handleCanvasDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDraggingCanvasFile(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;

      const flowPosition =
        screenToFlowRef.current?.({ x: event.clientX, y: event.clientY }) ?? { x: 360, y: 260 };

      if (/\.json$/i.test(file.name)) {
        const text = await file.text();
        const payload = parseStudioProjectJsonFile(text);
        if (!payload) {
          pushMessage({ role: 'system', text: '拖入失败：项目文件格式无效。' });
          return;
        }
        const { nodes: existingNodes } = useStudioStore.getState();
        if (existingNodes.length > 0) {
          const ok = window.confirm('拖入项目文件将替换当前画布，是否继续？');
          if (!ok) return;
        }
        const nextProjectId = payload.projectId ?? createStudioProjectId();
        const nextProjectName = payload.projectName ?? file.name.replace(/\.json$/i, '');
        hydrateProject(payload.nodes, payload.edges, {
          projectId: nextProjectId,
          projectName: nextProjectName,
          broadcastText: `已从拖入文件打开项目“${nextProjectName}”。`,
        });
        try {
          await putStudioProjectRecord(nextProjectId, nextProjectName, payload.nodes, payload.edges);
          await setActiveStudioProjectRef({
            projectId: nextProjectId,
            projectName: nextProjectName,
          });
          await pushStudioRecentProject({
            projectId: nextProjectId,
            projectName: nextProjectName,
            source: 'file',
          });
        } catch (error) {
          console.warn('Persist dragged studio project failed', error);
          pushMessage({
            role: 'system',
            text: '项目已打开，但未能写入最近工程记录。',
          });
        }
        return;
      }

      if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
            reader.readAsDataURL(file);
          });
          const imageNodeId = addImageNode(flowPosition, {
            imageDataUrl: dataUrl,
            imageMimeType: file.type,
            imageFileName: file.name,
            label: file.name.replace(/\.[^.]+$/u, ''),
          });
          pushMessage({
            role: 'system',
            text: `已拖入图片“${file.name}”，连接到文本卡片后可参与 LLM 润色。`,
            nodeId: imageNodeId,
          });
          focusNode(imageNodeId, { openDetail: false });
        } catch (error) {
          const message =
            error instanceof Error && error.message.trim() ? error.message.trim() : '拖入失败：无法读取图片文件。';
          pushMessage({ role: 'system', text: message });
        }
        return;
      }

      if (!/\.(xlsx|xls)$/i.test(file.name)) return;

      try {
        const parsed = await parseStoryboardWorkbookFile(file);
        const nodeId = addShotListNode(flowPosition, parsed.storyboard, {
          importedFileName: file.name,
          importedSheetName: parsed.sheetName,
          importedRowCount: parsed.rowCount,
          label: `${parsed.sheetName || '镜头表'} · ${file.name.replace(/\.(xlsx|xls)$/i, '')}`,
        });
        focusNode(nodeId, { openDetail: true });
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : '拖入失败：无法解析分镜表文件。';
        pushMessage({ role: 'system', text: message });
      }
    },
    [addImageNode, addShotListNode, focusNode, hydrateProject, pushMessage],
  );

  const handleCanvasDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDraggingCanvasFile(true);
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) {
      setDraggingCanvasFile(false);
    }
  }, []);

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      const items = event.clipboardData?.items;
      if (!items?.length) return;
      const imageItem = Array.from(items).find((item) => item.type.startsWith('image/'));
      const imageFile = imageItem?.getAsFile();
      if (!imageFile) return;
      event.preventDefault();
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
          reader.readAsDataURL(imageFile);
        });
        const viewport = {
          x: window.innerWidth * 0.55,
          y: window.innerHeight * 0.45,
        };
        const flowPosition = screenToFlowRef.current?.(viewport) ?? { x: 360, y: 260 };
        const imageNodeId = addImageNode(flowPosition, {
          imageDataUrl: dataUrl,
          imageMimeType: imageFile.type,
          imageFileName: imageFile.name || '粘贴图片',
          label: '粘贴图片',
        });
        pushMessage({
          role: 'system',
          text: '已从剪贴板粘贴图片，连接到文本卡片后可参与 LLM 润色。',
          nodeId: imageNodeId,
        });
        focusNode(imageNodeId, { openDetail: false });
      } catch (error) {
        const message =
            error instanceof Error && error.message.trim() ? error.message.trim() : '粘贴图片失败。';
        pushMessage({ role: 'system', text: message });
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImageNode, focusNode, pushMessage]);

  return (
    <div
      className={`studio-canvas${draggingCanvasFile ? ' studio-canvas--dragging-file' : ''}`}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      onDrop={(event) => void handleCanvasDrop(event)}
    >
      <StudioErrorBoundary>
      <ReactFlow
        colorMode="dark"
        nodes={visibleNodes}
        edges={visibleEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEndOuter}
        connectionMode={ConnectionMode.Loose}
        connectionDragThreshold={0}
        isValidConnection={(edge) => {
          const src = edge.source;
          const tgt = edge.target;
          if (!src || !tgt || src === tgt) return false;
          const state = useStudioStore.getState();
          const a = state.nodes.find((x) => x.id === src);
          const b = state.nodes.find((x) => x.id === tgt);
          if (!a || !b) return false;

          if (a.type === 'department' && edge.sourceHandle === DEPT_INPUT_PULL_HANDLE_ID) {
            return false;
          }

          if (a.type === 'textNode' && b.type === 'department') {
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            if (edge.sourceHandle != null && edge.sourceHandle !== TEXT_NODE_OUTPUT_HANDLE_ID) return false;
            return true;
          }

          if (a.type === 'textNode' && b.type === 'textNode') {
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            if (edge.sourceHandle != null && edge.sourceHandle !== TEXT_NODE_OUTPUT_HANDLE_ID) return false;
            return true;
          }

          if (a.type === 'department' && b.type === 'textNode') {
            if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            return true;
          }

          if (a.type === 'department' && b.type === 'promptReview') {
            if (a.data.type !== 'prompt') return false;
            if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            return true;
          }

          if (a.type === 'promptReview' && b.type === 'textNode') {
            if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            return true;
          }

          if (a.type === 'promptReview' && b.type === 'promptReview') {
            if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            return true;
          }

          if (a.type === 'imageNode' && b.type === 'textNode') {
            if (edge.sourceHandle != null && edge.sourceHandle !== IMAGE_NODE_OUTPUT_HANDLE_ID) return false;
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            return true;
          }

          if (a.type === 'department' && b.type === 'department') {
            if (edge.sourceHandle != null && edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID) return false;
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            const ak = a.data.type;
            const bk = b.data.type;
            if (ak === 'writing' && bk === 'storyboard') return true;
            if (ak === 'writing' && bk === 'prompt') return true;
            return false;
          }

          if (a.type === 'shotList' && b.type === 'department') {
            if (b.data.type !== 'prompt') return false;
            if (
              edge.sourceHandle != null &&
              edge.sourceHandle !== DEPT_OUTPUT_HANDLE_ID &&
              !isShotListItemOutputHandleId(edge.sourceHandle)
            ) {
              return false;
            }
            if (edge.targetHandle != null && edge.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
            if (a.data.type !== 'shot_list_node') return false;
            return true;
          }

          if (a.type === 'department' && b.type === 'shotList') {
            if (a.data.type !== 'storyboard') return false;
            if (edge.sourceHandle !== SHOT_LIST_LINK_HANDLE_ID) return false;
            if (edge.targetHandle != null && edge.targetHandle !== SHOT_LIST_PARENT_HANDLE_ID) {
              return false;
            }
            return true;
          }

          return false;
        }}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        defaultEdgeOptions={{ selectable: true }}
        fitView
        fitViewOptions={{ maxZoom: 1.24, padding: 0.18 }}
        translateExtent={INFINITE_EXTENT}
        nodeExtent={INFINITE_EXTENT}
        minZoom={0.04}
        maxZoom={4}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag={[1]}
        panActivationKeyCode="Space"
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={['Delete', 'Backspace']}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <ConnectEndBinder
          implRef={connectEndImplRef}
          dragStartRef={connectionDragRef}
          setPicker={setNodePicker}
        />
        <FlowProjectionBridge onReady={(projector) => { screenToFlowRef.current = projector; }} />
        <PaneCreateMenuBinder seed={paneMenuSeed} onResolve={setPaneCreateMenu} onConsume={() => setPaneMenuSeed(null)} />
        <StudioProjectMenu />
        <Panel position="top-center" className="studio-edge-panel">
          {selectedEdgeIds.length > 0 ? (
            <button
              type="button"
              className="studio-edge-panel__disconnect nodrag nopan"
              onClick={() => {
                removeEdges(selectedEdgeIds);
                setSelectedEdgeIds([]);
              }}
            >
              断开连线（{selectedEdgeIds.length}）
            </button>
          ) : null}
        </Panel>
        <Background
          id="dot-grid"
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1.2}
          color="rgba(255,255,255,0.07)"
        />
        <Controls className="studio-controls" showInteractive={false} />
        <MiniMap className="studio-minimap" maskColor="rgba(0,0,0,0.55)" nodeColor={() => '#3d3d46'} />
        <ScissorCutLayer />
        <StudioSettings />
        <ChatDock />
      </ReactFlow>
      <StudioWelcomePanel />
      <NodeContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      {nodePicker ? (
        <div
          className="node-picker"
          style={{ left: nodePicker.screenX, top: nodePicker.screenY }}
          role="dialog"
          aria-label="节点选择"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="node-picker__title">
            {shotListOutputPanePicker
              ? '镜头表 Output · 创建下游 Prompt 并连线'
              : promptOutputPanePicker
                ? 'Prompt Output · 创建下游审核节点'
              : '拉线至空白 · 创建节点并连线'}
          </div>
          {!shotListOutputPanePicker ? (
            <>
              <button
                type="button"
                className="node-picker__btn"
                onClick={() => {
                  const p = nodePicker;
                  const nid = completeConnectionMenuPick({
                    fromNodeId: p.fromNodeId,
                    fromHandleId: p.fromHandleId,
                    fromHandleType: p.fromHandleType,
                    pick: 'text_node',
                    flowPosition: { x: p.flowX, y: p.flowY },
                  });
                  if (nid) {
                    setNodePicker(null);
                    focusNode(nid, { openDetail: true });
                  }
                }}
              >
                创建文本卡片
              </button>
              <button
                type="button"
                className="node-picker__btn"
                onClick={() => {
                  const p = nodePicker;
                  const nid = completeConnectionMenuPick({
                    fromNodeId: p.fromNodeId,
                    fromHandleId: p.fromHandleId,
                    fromHandleType: p.fromHandleType,
                    pick: 'image_node',
                    flowPosition: { x: p.flowX, y: p.flowY },
                  });
                  if (nid) {
                    setNodePicker(null);
                    focusNode(nid, { openDetail: false });
                  }
                }}
              >
                创建图片节点
              </button>
              {!HIDE_TEMPORARY_NODE_ENTRIES ? (
                <button
                  type="button"
                  className="node-picker__btn"
                  onClick={() => {
                    const p = nodePicker;
                    const nid = completeConnectionMenuPick({
                      fromNodeId: p.fromNodeId,
                      fromHandleId: p.fromHandleId,
                      fromHandleType: p.fromHandleType,
                      pick: 'writing',
                      flowPosition: { x: p.flowX, y: p.flowY },
                    });
                    if (nid) {
                      setNodePicker(null);
                      focusNode(nid, { openDetail: true });
                    }
                  }}
                >
                  创建编剧部
                </button>
              ) : null}
              <button
                type="button"
                className="node-picker__btn"
                onClick={() => {
                  const p = nodePicker;
                  const nid = completeConnectionMenuPick({
                    fromNodeId: p.fromNodeId,
                    fromHandleId: p.fromHandleId,
                    fromHandleType: p.fromHandleType,
                    pick: 'storyboard',
                    flowPosition: { x: p.flowX, y: p.flowY },
                  });
                  if (nid) {
                    setNodePicker(null);
                    focusNode(nid, { openDetail: true });
                  }
                }}
              >
                创建分镜部
              </button>
              <button
                type="button"
                className="node-picker__btn"
                onClick={() => {
                  const p = nodePicker;
                  const nid = completeConnectionMenuPick({
                    fromNodeId: p.fromNodeId,
                    fromHandleId: p.fromHandleId,
                    fromHandleType: p.fromHandleType,
                    pick: 'storyboard_file_node',
                    flowPosition: { x: p.flowX, y: p.flowY },
                  });
                  if (nid) {
                    setNodePicker(null);
                    focusNode(nid, { openDetail: false });
                  }
                }}
              >
                创建分镜表文件
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="node-picker__btn"
            onClick={() => {
              const p = nodePicker;
              const nid = completeConnectionMenuPick({
                fromNodeId: p.fromNodeId,
                fromHandleId: p.fromHandleId,
                fromHandleType: p.fromHandleType,
                pick: 'prompt',
                flowPosition: { x: p.flowX, y: p.flowY },
              });
              if (nid) {
                setNodePicker(null);
                focusNode(nid, { openDetail: true });
              }
            }}
          >
            创建 Prompt 部门
          </button>
          {promptOutputPanePicker ? (
            <button
              type="button"
              className="node-picker__btn"
              onClick={() => {
                const p = nodePicker;
                const nid = completeConnectionMenuPick({
                  fromNodeId: p.fromNodeId,
                  fromHandleId: p.fromHandleId,
                  fromHandleType: p.fromHandleType,
                  pick: 'prompt_review_node',
                  flowPosition: { x: p.flowX, y: p.flowY },
                });
                if (nid) {
                  setNodePicker(null);
                  focusNode(nid, { openDetail: false });
                }
              }}
            >
              创建提示词审核
            </button>
          ) : null}
          <button type="button" className="node-picker__dismiss" onClick={() => setNodePicker(null)}>
            取消
          </button>
        </div>
      ) : null}
      {paneCreateMenu ? (
        <NodeGalleryMenu
          x={paneCreateMenu.screenX}
          y={paneCreateMenu.screenY}
          items={PANE_GALLERY_ITEMS}
          onPick={(kind) => createNodeFromPaneMenu(kind)}
        />
      ) : null}
      {false && paneCreateMenu ? (
        <div
          className="node-picker"
          style={{ left: paneCreateMenu?.screenX ?? 0, top: paneCreateMenu?.screenY ?? 0 }}
          role="dialog"
          aria-label="快速创建节点"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="node-picker__title">双击空白处 · 快速创建</div>
          <button type="button" className="node-picker__btn" onClick={() => createNodeFromPaneMenu('text_node')}>
            创建文本卡片
          </button>
          <button type="button" className="node-picker__btn" onClick={() => createNodeFromPaneMenu('storyboard')}>
            创建分镜部          </button>
          <button type="button" className="node-picker__btn" onClick={() => createNodeFromPaneMenu('prompt')}>
            创建 Prompt 部门          </button>
          <button type="button" className="node-picker__dismiss" onClick={() => setPaneCreateMenu(null)}>
            取消
          </button>
        </div>
      ) : null}
      <DetailPanel />
      </StudioErrorBoundary>
    </div>
  );
}

function NodeGalleryMenu({
  x,
  y,
  items,
  onPick,
}: {
  x: number;
  y: number;
  items: NodeGalleryItem[];
  onPick: (kind: CreateNodeKind) => void;
}) {
  const orbitItems = items.filter((item): item is NodeGalleryItem & { kind: CreateNodeKind } => Boolean(item.kind));
  const radius = 84;
  const angleStep = 360 / Math.max(orbitItems.length, 1);

  return (
    <div
      className="node-picker node-picker--radial"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="节点快捷菜单"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="node-picker__radial-core" aria-hidden />
      {orbitItems.map((item, index) => {
        const angleDeg = -90 + index * angleStep;
        const radians = (angleDeg * Math.PI) / 180;
        const tx = Math.cos(radians) * radius;
        const ty = Math.sin(radians) * radius;

        return (
          <button
            key={item.id}
            type="button"
            className={`node-picker__orbit-btn ${item.accentClass}`}
            style={
              {
                '--orbit-x': `${tx.toFixed(1)}px`,
                '--orbit-y': `${ty.toFixed(1)}px`,
                '--orbit-delay': `${index * 45}ms`,
              } as CSSProperties
            }
            title={item.title}
            aria-label={item.title}
            onClick={() => onPick(item.kind)}
          >
            <span className="node-picker__orbit-icon" aria-hidden>
              {item.icon}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PaneCreateMenuBinder({
  seed,
  onResolve,
  onConsume,
}: {
  seed: { screenX: number; screenY: number } | null;
  onResolve: (menu: { screenX: number; screenY: number; flowX: number; flowY: number } | null) => void;
  onConsume: () => void;
}) {
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    if (!seed) return;
    const flow = screenToFlowPosition({ x: seed.screenX, y: seed.screenY });
    onResolve({
      screenX: seed.screenX,
      screenY: seed.screenY,
      flowX: flow.x,
      flowY: flow.y,
    });
    onConsume();
  }, [onConsume, onResolve, screenToFlowPosition, seed]);

  return null;
}

function FlowProjectionBridge({
  onReady,
}: {
  onReady: (projector: (pos: { x: number; y: number }) => { x: number; y: number }) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const projector = useMemo(
    () => (pos: { x: number; y: number }) => screenToFlowPosition({ x: pos.x, y: pos.y }),
    [screenToFlowPosition],
  );

  useEffect(() => {
    onReady(projector);
  }, [onReady, projector]);

  return null;
}
