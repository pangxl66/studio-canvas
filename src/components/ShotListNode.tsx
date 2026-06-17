import {
  Handle,
  NodeResizeControl,
  Position,
  useUpdateNodeInternals,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import { downloadStoryboardShotlistExcelCsv } from '@/components/detailPanel/storyboardShotlistExport';
import { ShotListEmbeddedEditor } from '@/components/ShotListEmbeddedEditor';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';
import { SHOT_LIST_PARENT_HANDLE_ID } from '@/utils/shotListWire';

type ShotListRF = Node<StudioNodeData, 'shotList'>;

const SHOT_LIST_MIN_WIDTH = 640;
const SHOT_LIST_MIN_HEIGHT = 360;
const SHOT_LIST_DEFAULT_WIDTH = 800;
const SHOT_LIST_DEFAULT_HEIGHT = 560;

function ShotListNodeInner({ id, data, selected }: NodeProps<ShotListRF>) {
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const updateNodeInternals = useUpdateNodeInternals();
  const parsed = data.output ? tryParseStoryboardOutput(data.output) : null;
  const shotCount = parsed?.shots?.length ?? 0;
  const persistedWidth = Math.max(
    SHOT_LIST_MIN_WIDTH,
    Math.round(data.canvasWidth ?? SHOT_LIST_DEFAULT_WIDTH),
  );
  const persistedHeight = Math.max(
    SHOT_LIST_MIN_HEIGHT,
    Math.round(data.canvasHeight ?? SHOT_LIST_DEFAULT_HEIGHT),
  );
  const [liveSize, setLiveSize] = useState({ width: persistedWidth, height: persistedHeight });
  const resizeFrameRef = useRef<number | null>(null);
  const resizingRef = useRef(false);
  const width = liveSize.width;
  const height = liveSize.height;
  const parentHint = data.sourceStoryboardNodeId
    ? `父分镜 · ${data.sourceStoryboardNodeId.slice(-6)}`
    : data.sourceStoryboardFileNodeId
      ? `分镜文件 · ${data.sourceStoryboardFileNodeId.slice(-6)}`
      : '未绑定父分镜';

  const parentStoryboardGenerating = useStudioStore((s) => {
    const parentId = data.sourceStoryboardNodeId;
    if (!parentId) return false;
    const parent = s.nodes.find((node) => node.id === parentId);
    return (
      parent?.type === 'department' &&
      parent.data.type === 'storyboard' &&
      parent.data.status === 'IN_PROGRESS'
    );
  });

  const onExportCsv = useCallback(() => {
    const latest = data.output ? tryParseStoryboardOutput(data.output) : null;
    downloadStoryboardShotlistExcelCsv(
      {
        shots: latest?.shots ?? [],
        narrativeBeats: latest?.narrativeBeats ?? [],
      },
      data.label,
    );
  }, [data.label, data.output]);

  const scheduleInternalsRefresh = useCallback(() => {
    if (resizeFrameRef.current != null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      updateNodeInternals(id);
    });
  }, [id, updateNodeInternals]);

  useEffect(() => {
    if (resizingRef.current) return;
    setLiveSize({ width: persistedWidth, height: persistedHeight });
  }, [persistedHeight, persistedWidth]);

  useEffect(
    () => () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  return (
    <div
      className={`shot-list-node ${selected ? 'shot-list-node--selected' : ''}`}
      style={{ width, minWidth: width, maxWidth: width, height, minHeight: height }}
    >
      <NodeResizeControl
        className="shot-list-node__resize-handle"
        minWidth={SHOT_LIST_MIN_WIDTH}
        minHeight={SHOT_LIST_MIN_HEIGHT}
        position="bottom-right"
        onResizeStart={() => {
          resizingRef.current = true;
        }}
        onResize={(_event, params) => {
          setLiveSize({
            width: Math.max(SHOT_LIST_MIN_WIDTH, Math.round(params.width)),
            height: Math.max(SHOT_LIST_MIN_HEIGHT, Math.round(params.height)),
          });
          scheduleInternalsRefresh();
        }}
        onResizeEnd={(_event, params) => {
          resizingRef.current = false;
          const nextWidth = Math.max(SHOT_LIST_MIN_WIDTH, Math.round(params.width));
          const nextHeight = Math.max(SHOT_LIST_MIN_HEIGHT, Math.round(params.height));
          setLiveSize({ width: nextWidth, height: nextHeight });
          patchNodeData(
            id,
            {
              canvasWidth: nextWidth,
              canvasHeight: nextHeight,
            },
            false,
          );
          scheduleInternalsRefresh();
        }}
      >
        <div className="shot-list-node__resize-grip" aria-hidden />
      </NodeResizeControl>

      <Handle
        type="target"
        position={Position.Top}
        id={SHOT_LIST_PARENT_HANDLE_ID}
        className="shot-list-node__handle shot-list-node__handle--in"
        title="父子连线：由分镜节点底部自动连接，也可手动从分镜底部拖入"
      />

      <header className="shot-list-node__head">
        <div className="shot-list-node__head-top">
          <div className="shot-list-node__head-row">
            <span className="shot-list-node__title">镜头表</span>
            <span className="shot-list-node__badge">
              {shotCount > 0 ? `${shotCount} 镜` : '待同步'}
            </span>
          </div>
          <button
            type="button"
            className="shot-list-node__download nodrag nopan nowheel"
            title="导出当前镜头表为 CSV（Excel 可直接打开）"
            aria-label="导出 CSV"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onExportCsv();
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 3v12m0 0l4-4m-4 4L8 11M5 21h14"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="shot-list-node__label" title={data.label}>
          {data.label}
        </div>
      </header>

      <p
        className="shot-list-node__meta nodrag nopan nowheel"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {parentHint} · 逐镜头 Output -&gt; Prompt
      </p>

      <ShotListEmbeddedEditor id={id} data={data} viewportHeight={height} />

      {parentStoryboardGenerating ? (
        <div
          className="shot-list-node__loading-overlay nodrag nopan nowheel"
          role="status"
          aria-live="polite"
          aria-label="父分镜生成中"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="shot-list-node__loading-card">
            <div className="shot-list-node__loading-spinner" aria-hidden />
            <p className="shot-list-node__loading-title">AI 正在重算分镜表</p>
            <p className="shot-list-node__loading-sub">完成后表格将自动刷新</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const ShotListNode = memo(ShotListNodeInner);
