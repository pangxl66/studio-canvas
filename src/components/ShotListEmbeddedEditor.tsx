import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { reindexStoryboardShotIds, tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import {
  blankShot,
  mergeConsecutiveRange,
  mergeSameSceneGroups,
  selectionCanMergeConsecutive,
} from '@/components/detailPanel/StoryboardShotListTable';
import { ShotListCanvasDecisionStrip } from '@/components/ShotListCanvasDecisionStrip';
import { useStudioStore } from '@/store/useStudioStore';
import type { StoryboardOutput, StoryboardShot, StudioNodeData } from '@/types/studio';
import {
  registerShotListPendingEditFlusher,
  unregisterShotListPendingEditFlusher,
} from '@/utils/shotListPendingEdits';
import { makeShotListItemOutputHandleId, parseShotListItemOutputHandleId } from '@/utils/shotListWire';

type EditableField = 'sceneRef' | 'type' | 'movement' | 'description' | 'content' | 'sound' | 'note';

const TRASH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2zM9 10v9h2v-9H9zm4 0v9h2v-9h-2z"
    />
  </svg>
);

function ShotCanvasRow({
  sh,
  rowIdx,
  selected,
  selectedGroupCount,
  hovered,
  promptLinkCount,
  onHoverPort,
  onSelectGesture,
  onDragRangeEnter,
  onDelete,
  onLiveField,
  onFlushPersist,
  stopCanvas,
}: {
  sh: StoryboardShot;
  rowIdx: number;
  selected: boolean;
  selectedGroupCount: number;
  hovered: boolean;
  promptLinkCount: number;
  onHoverPort: (hovering: boolean) => void;
  onSelectGesture: (
    index: number,
    modifiers: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean },
  ) => void;
  onDragRangeEnter: (index: number) => void;
  onDelete: () => void;
  onLiveField: (field: EditableField, value: string) => void;
  onFlushPersist: () => void;
  stopCanvas: (e: ReactPointerEvent | ReactMouseEvent) => void;
}) {
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [sceneRef, setSceneRef] = useState(sh.sceneRef ?? '');
  const [type, setType] = useState(sh.type);
  const [movement, setMovement] = useState(sh.movement);
  const [description, setDescription] = useState(sh.description);
  const [content, setContent] = useState(sh.content);
  const [sound, setSound] = useState(sh.sound ?? '');
  const [note, setNote] = useState(sh.note ?? '');

  useEffect(() => {
    if (editingField !== 'sceneRef') setSceneRef(sh.sceneRef ?? '');
  }, [sh.sceneRef, editingField]);
  useEffect(() => {
    if (editingField !== 'type') setType(sh.type);
  }, [sh.type, editingField]);
  useEffect(() => {
    if (editingField !== 'movement') setMovement(sh.movement);
  }, [sh.movement, editingField]);
  useEffect(() => {
    if (editingField !== 'description') setDescription(sh.description);
  }, [sh.description, editingField]);
  useEffect(() => {
    if (editingField !== 'content') setContent(sh.content);
  }, [sh.content, editingField]);
  useEffect(() => {
    if (editingField !== 'sound') setSound(sh.sound ?? '');
  }, [sh.sound, editingField]);
  useEffect(() => {
    if (editingField !== 'note') setNote(sh.note ?? '');
  }, [sh.note, editingField]);

  useEffect(() => {
    setSceneRef(sh.sceneRef ?? '');
    setType(sh.type);
    setMovement(sh.movement);
    setDescription(sh.description);
    setContent(sh.content);
    setSound(sh.sound ?? '');
    setNote(sh.note ?? '');
  }, [sh.id]);

  const endEdit = useCallback(() => {
    onFlushPersist();
    setEditingField(null);
  }, [onFlushPersist]);

  const cellDisplay = (text: string, emptyLabel: string) =>
    text.trim() ? text : emptyLabel;
  const shotNoLabel = sh.shotNo?.trim() || `#${sh.id}`;
  const outputLabel = promptLinkCount > 0 ? `已接入 ${promptLinkCount}` : 'Prompt';

  return (
    <tr
      className={`${selected ? 'shot-list-canvas__row--selected ' : ''}${
        hovered ? 'shot-list-canvas__row--port-hovered ' : ''
      }${
        selected && selectedGroupCount >= 2 ? 'shot-list-canvas__row--group-ready ' : ''
      }${
        promptLinkCount > 0 ? 'shot-list-canvas__row--connected' : ''
      }`.trim()}
      onPointerEnter={() => onDragRangeEnter(rowIdx)}
      onMouseEnter={() => onDragRangeEnter(rowIdx)}
    >
      <td
        className="shot-list-canvas__td shot-list-canvas__td--check"
        onPointerDown={(event) => {
          stopCanvas(event);
          onSelectGesture(rowIdx, {
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
          });
        }}
        onMouseDown={stopCanvas}
      >
        <input
          type="checkbox"
          readOnly
          className="nodrag nopan nowheel"
          checked={selected}
          onChange={() => undefined}
          onPointerDown={(event) => {
            stopCanvas(event);
            onSelectGesture(rowIdx, {
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              metaKey: event.metaKey,
            });
          }}
          onMouseDown={stopCanvas}
          onClick={(event) => event.preventDefault()}
          aria-label={`选择镜头 ${shotNoLabel}`}
        />
      </td>
      <td className="shot-list-canvas__td shot-list-canvas__td--id">
        <button
          type="button"
          className={`shot-list-canvas__select-hotspot nodrag nopan nowheel${
            selected ? ' shot-list-canvas__select-hotspot--selected' : ''
          }`}
          onPointerDown={(event) => {
            stopCanvas(event);
            onSelectGesture(rowIdx, {
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              metaKey: event.metaKey,
            });
          }}
          onMouseDown={stopCanvas}
          aria-label={`选择镜头 ${shotNoLabel}`}
        >
          {shotNoLabel}
        </button>
      </td>
      <td className="shot-list-canvas__td shot-list-canvas__td--scene">
        {editingField === 'sceneRef' ? (
          <input
            type="text"
            className="shot-list-canvas__input nodrag nopan nowheel"
            value={sceneRef}
            autoFocus
            onChange={(e) => {
              const v = e.target.value;
              setSceneRef(v);
              onLiveField('sceneRef', v);
            }}
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onBlur={endEdit}
            aria-label="场景"
          />
        ) : (
          <button
            type="button"
            className="shot-list-canvas__cell-display nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={(e) => {
              stopCanvas(e);
              setEditingField('sceneRef');
            }}
          >
            {cellDisplay(sh.sceneRef ?? '', '点击编辑场景')}
          </button>
        )}
      </td>
      <td className="shot-list-canvas__td shot-list-canvas__td--sound">
        {editingField === 'type' ? (
          <input
            type="text"
            className="shot-list-canvas__input nodrag nopan nowheel"
            value={type}
            autoFocus
            onChange={(e) => {
              const v = e.target.value;
              setType(v);
              onLiveField('type', v);
            }}
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onBlur={endEdit}
            aria-label="景别"
          />
        ) : (
          <button
            type="button"
            className="shot-list-canvas__cell-display nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={(e) => {
              stopCanvas(e);
              setEditingField('type');
            }}
          >
            {cellDisplay(sh.type, '点击编辑')}
          </button>
        )}
      </td>
      <td className="shot-list-canvas__td">
        {editingField === 'movement' ? (
          <input
            type="text"
            className="shot-list-canvas__input nodrag nopan nowheel"
            value={movement}
            autoFocus
            onChange={(e) => {
              const v = e.target.value;
              setMovement(v);
              onLiveField('movement', v);
            }}
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onBlur={endEdit}
            aria-label="运镜"
          />
        ) : (
          <button
            type="button"
            className="shot-list-canvas__cell-display nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={(e) => {
              stopCanvas(e);
              setEditingField('movement');
            }}
          >
            {cellDisplay(sh.movement, '点击编辑')}
          </button>
        )}
      </td>
      <td className="shot-list-canvas__td">
        {editingField === 'description' ? (
          <textarea
            className="shot-list-canvas__textarea nodrag nopan nowheel"
            value={description}
            autoFocus
            rows={3}
            onChange={(e) => {
              const v = e.target.value;
              setDescription(v);
              onLiveField('description', v);
            }}
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onBlur={endEdit}
            aria-label="画面描述"
          />
        ) : (
          <button
            type="button"
            className="shot-list-canvas__cell-display shot-list-canvas__cell-display--multiline nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={(e) => {
              stopCanvas(e);
              setEditingField('description');
            }}
          >
            {cellDisplay(sh.description, '点击编辑画面描述')}
          </button>
        )}
      </td>
      <td className="shot-list-canvas__td shot-list-canvas__td--note">
        {editingField === 'content' ? (
          <textarea
            className="shot-list-canvas__textarea nodrag nopan nowheel"
            value={content}
            autoFocus
            rows={3}
            onChange={(e) => {
              const v = e.target.value;
              setContent(v);
              onLiveField('content', v);
            }}
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onBlur={endEdit}
            aria-label="台词"
          />
        ) : (
          <button
            type="button"
            className="shot-list-canvas__cell-display shot-list-canvas__cell-display--multiline nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={(e) => {
              stopCanvas(e);
              setEditingField('content');
            }}
          >
            {cellDisplay(sh.content, '点击编辑台词')}
          </button>
          )}
        </td>
      <td className="shot-list-canvas__td">
        {editingField === 'sound' ? (
          <textarea
            className="shot-list-canvas__textarea nodrag nopan nowheel"
            value={sound}
            autoFocus
            rows={3}
            onChange={(e) => {
              const v = e.target.value;
              setSound(v);
              onLiveField('sound', v);
            }}
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onBlur={endEdit}
            aria-label="音效"
          />
        ) : (
          <button
            type="button"
            className="shot-list-canvas__cell-display shot-list-canvas__cell-display--multiline nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={(e) => {
              stopCanvas(e);
              setEditingField('sound');
            }}
          >
            {cellDisplay(sh.sound ?? '', '点击编辑音效')}
          </button>
        )}
      </td>
      <td className="shot-list-canvas__td">
        {editingField === 'note' ? (
          <textarea
            className="shot-list-canvas__textarea nodrag nopan nowheel"
            value={note}
            autoFocus
            rows={3}
            onChange={(e) => {
              const v = e.target.value;
              setNote(v);
              onLiveField('note', v);
            }}
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onBlur={endEdit}
            aria-label="备注"
          />
        ) : (
          <button
            type="button"
            className="shot-list-canvas__cell-display shot-list-canvas__cell-display--multiline nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={(e) => {
              stopCanvas(e);
              setEditingField('note');
            }}
          >
            {cellDisplay(sh.note ?? '', '点击编辑备注')}
          </button>
        )}
      </td>
      <td className="shot-list-canvas__td shot-list-canvas__td--op">
        <button
          type="button"
          className="shot-list-canvas__icon-trash nodrag nopan nowheel"
          title="删除此镜头"
          aria-label={`删除镜头 ${rowIdx + 1}`}
          onPointerDown={stopCanvas}
          onMouseDown={stopCanvas}
          onClick={() => {
            onFlushPersist();
            onDelete();
          }}
        >
          {TRASH_ICON}
        </button>
      </td>
      <td className="shot-list-canvas__td shot-list-canvas__td--port">
        <div
          className={`shot-list-canvas__port-cell${
            promptLinkCount > 0 ? ' shot-list-canvas__port-cell--connected' : ''
          }`}
          onMouseEnter={() => onHoverPort(true)}
          onMouseLeave={() => onHoverPort(false)}
        >
          <button
            type="button"
            className={`shot-list-canvas__port-select nodrag nopan nowheel${
              selected ? ' shot-list-canvas__port-select--selected' : ''
            }`}
            title="按住拖过多个输出行，可滑动多选后再连接 Prompt"
            aria-label={`选择输出 ${shotNoLabel}`}
            onPointerDown={(event) => {
              stopCanvas(event);
              onSelectGesture(rowIdx, {
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
              });
            }}
            onMouseDown={stopCanvas}
          >
            <span className="shot-list-canvas__port-label">{outputLabel}</span>
          </button>
          <Handle
            type="source"
            position={Position.Right}
            id={makeShotListItemOutputHandleId(sh.wireId ?? String(sh.id))}
            className="shot-list-canvas__row-handle"
            title={`输出当前镜头 ${shotNoLabel} 到 Prompt 节点`}
          />
        </div>
      </td>
    </tr>
  );
}

export function ShotListEmbeddedEditor({
  id,
  data,
  viewportHeight,
}: {
  id: string;
  data: StudioNodeData;
  viewportHeight?: number;
}) {
  const patchShotListNodeOutput = useStudioStore((s) => s.patchShotListNodeOutput);
  const setShotListSelectedWires = useStudioStore((s) => s.setShotListSelectedWires);
  const parentId = data.sourceStoryboardNodeId ?? null;
  const edges = useStudioStore((s) => s.edges);
  const updateNodeInternals = useUpdateNodeInternals();

  const parentReviewData = useStudioStore((s) => {
    if (!parentId) return null;
    const n = s.nodes.find((x) => x.id === parentId);
    if (n?.type !== 'department' || n.data.type !== 'storyboard') return null;
    return n.data;
  });

  const output = useMemo((): StoryboardOutput | null => {
    if (data.type !== 'shot_list_node' || data.output == null) return null;
    return tryParseStoryboardOutput(data.output);
  }, [data.output, data.type]);

  const shots = output?.shots ?? [];

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
  const [batchSceneRef, setBatchSceneRef] = useState('');
  const [batchSound, setBatchSound] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const refreshFrameRef = useRef<number | null>(null);
  const selectionAnchorRef = useRef<number | null>(null);
  const dragSelectRef = useRef<{
    anchor: number;
    mode: 'replace' | 'add' | 'remove';
    base: Set<number>;
  } | null>(null);

  const promptLinkCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      if (edge.source !== id) continue;
      const wireId = parseShotListItemOutputHandleId(edge.sourceHandle);
      if (!wireId) continue;
      counts.set(wireId, (counts.get(wireId) ?? 0) + 1);
    }
    return counts;
  }, [edges, id]);

  const mergeInfo = useMemo(() => selectionCanMergeConsecutive(selected), [selected]);
  const selectedWireIds = useMemo(
    () =>
      Array.from(selected)
        .sort((a, b) => a - b)
        .map((index) => shots[index]?.wireId ?? String(shots[index]?.id ?? ''))
        .filter((wireId) => wireId.trim() !== ''),
    [selected, shots],
  );

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ rowIdx: number; field: EditableField; value: string } | null>(null);

  const scheduleHandleRefresh = useCallback(() => {
    if (refreshFrameRef.current != null) return;
    refreshFrameRef.current = window.requestAnimationFrame(() => {
      refreshFrameRef.current = null;
      updateNodeInternals(id);
    });
  }, [id, updateNodeInternals]);

  const applyPendingToStore = useCallback(() => {
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p) return;
    const row = useStudioStore.getState().nodes.find((n) => n.id === id)?.data;
    if (row?.type !== 'shot_list_node' || row.output == null) return;
    const out = tryParseStoryboardOutput(row.output);
    if (!out || p.rowIdx < 0 || p.rowIdx >= out.shots.length) return;
    const next = out.shots.map((s, i) => {
      if (i !== p.rowIdx) return s;
      if (p.field === 'sceneRef') return { ...s, sceneRef: p.value.trim() || undefined };
      if (p.field === 'type') return { ...s, type: p.value };
      if (p.field === 'movement') return { ...s, movement: p.value };
      if (p.field === 'description') return { ...s, description: p.value };
      if (p.field === 'content') return { ...s, content: p.value };
      if (p.field === 'sound') return { ...s, sound: p.value.trim() || undefined };
      return { ...s, note: p.value.trim() || undefined };
    });
    patchShotListNodeOutput(id, { ...out, shots: reindexStoryboardShotIds(next) }, true);
  }, [id, patchShotListNodeOutput]);

  const flushPersist = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    applyPendingToStore();
  }, [applyPendingToStore]);

  useEffect(() => {
    registerShotListPendingEditFlusher(id, flushPersist);
    return () => unregisterShotListPendingEditFlusher(id, flushPersist);
  }, [flushPersist, id]);

  const onLiveField = useCallback(
    (rowIdx: number, field: EditableField, value: string) => {
      pendingRef.current = { rowIdx, field, value };
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        applyPendingToStore();
      }, 100);
    },
    [applyPendingToStore],
  );

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < shots.length) next.add(i);
      }
      return next;
    });
  }, [shots.length]);

  useEffect(() => {
    setShotListSelectedWires(id, selectedWireIds);
  }, [id, selectedWireIds, setShotListSelectedWires]);

  useEffect(() => {
    scheduleHandleRefresh();
  }, [scheduleHandleRefresh, selectedWireIds, shots.length, viewportHeight]);

  useEffect(() => {
    const onResize = () => scheduleHandleRefresh();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [scheduleHandleRefresh]);

  useEffect(
    () => () => {
      setShotListSelectedWires(id, []);
      if (refreshFrameRef.current != null) {
        window.cancelAnimationFrame(refreshFrameRef.current);
      }
    },
    [id, setShotListSelectedWires],
  );

  const startSelectionGesture = useCallback(
    (
      index: number,
      modifiers: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean },
    ) => {
      const toggleMode = modifiers.ctrlKey || modifiers.metaKey;
      const rangeMode = modifiers.shiftKey && selectionAnchorRef.current != null;

      if (rangeMode) {
        const anchor = selectionAnchorRef.current!;
        const lo = Math.min(anchor, index);
        const hi = Math.max(anchor, index);
        setSelected((prev) => {
          const next = toggleMode ? new Set(prev) : new Set<number>();
          for (let rowIndex = lo; rowIndex <= hi; rowIndex += 1) {
            next.add(rowIndex);
          }
          return next;
        });
        dragSelectRef.current = null;
        return;
      }

      setSelected((prev) => {
        const mode: 'replace' | 'add' | 'remove' = prev.has(index) ? 'remove' : 'add';
        dragSelectRef.current = {
          anchor: index,
          mode,
          base: new Set(prev),
        };
        selectionAnchorRef.current = index;
        const next = new Set(prev);
        if (mode === 'add') next.add(index);
        else next.delete(index);
        return next;
      });
    },
    [],
  );

  const extendRangeSelect = useCallback((index: number) => {
    const activeDrag = dragSelectRef.current;
    if (!activeDrag) return;
    const lo = Math.min(activeDrag.anchor, index);
    const hi = Math.max(activeDrag.anchor, index);
    setSelected(() => {
      const next = activeDrag.mode === 'replace' ? new Set<number>() : new Set(activeDrag.base);
      for (let rowIndex = lo; rowIndex <= hi; rowIndex += 1) {
        if (activeDrag.mode === 'remove') next.delete(rowIndex);
        else next.add(rowIndex);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const stopDragging = () => {
      dragSelectRef.current = null;
    };
    window.addEventListener('pointerup', stopDragging);
    return () => window.removeEventListener('pointerup', stopDragging);
  }, []);

  const onMerge = useCallback(() => {
    flushPersist();
    if (!mergeInfo.ok || mergeInfo.lo == null || mergeInfo.hi == null) return;
    const row = useStudioStore.getState().nodes.find((n) => n.id === id)?.data;
    if (row?.type !== 'shot_list_node' || row.output == null) return;
    const out = tryParseStoryboardOutput(row.output);
    if (!out) return;
    const next = mergeConsecutiveRange(out.shots, mergeInfo.lo, mergeInfo.hi);
    setSelected(new Set());
    patchShotListNodeOutput(id, { ...out, shots: reindexStoryboardShotIds(next) }, true);
  }, [mergeInfo, id, patchShotListNodeOutput, flushPersist]);

  const onMergeSameScene = useCallback(() => {
    flushPersist();
    const row = useStudioStore.getState().nodes.find((n) => n.id === id)?.data;
    if (row?.type !== 'shot_list_node' || row.output == null) return;
    const out = tryParseStoryboardOutput(row.output);
    if (!out) return;
    setSelected(new Set());
    patchShotListNodeOutput(id, { ...out, shots: mergeSameSceneGroups(out.shots) }, true);
  }, [id, patchShotListNodeOutput, flushPersist]);

  const onDelete = useCallback(
    (index: number) => {
      flushPersist();
      const row = useStudioStore.getState().nodes.find((n) => n.id === id)?.data;
      if (row?.type !== 'shot_list_node' || row.output == null) return;
      const out = tryParseStoryboardOutput(row.output);
      if (!out || index < 0 || index >= out.shots.length) return;
      const next = out.shots.filter((_, i) => i !== index);
      setSelected((prev) => {
        const n = new Set<number>();
        for (const i of prev) {
          if (i === index) continue;
          if (i > index) n.add(i - 1);
          else n.add(i);
        }
        return n;
      });
      patchShotListNodeOutput(id, { ...out, shots: reindexStoryboardShotIds(next) }, true);
    },
    [id, patchShotListNodeOutput, flushPersist],
  );

  const onDeleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    flushPersist();
    const row = useStudioStore.getState().nodes.find((n) => n.id === id)?.data;
    if (row?.type !== 'shot_list_node' || row.output == null) return;
    const out = tryParseStoryboardOutput(row.output);
    if (!out) return;
    const selectedIndexes = new Set(selected);
    const nextShots = out.shots.filter((_, index) => !selectedIndexes.has(index));
    setSelected(new Set());
    patchShotListNodeOutput(id, { ...out, shots: reindexStoryboardShotIds(nextShots) }, true);
  }, [flushPersist, id, patchShotListNodeOutput, selected]);

  const applySelectedField = useCallback(
    (field: 'sceneRef' | 'sound', value: string) => {
      if (selected.size === 0) return;
      flushPersist();
      const row = useStudioStore.getState().nodes.find((n) => n.id === id)?.data;
      if (row?.type !== 'shot_list_node' || row.output == null) return;
      const out = tryParseStoryboardOutput(row.output);
      if (!out) return;
      const normalized = value.trim() || undefined;
      const selectedIndexes = new Set(selected);
      const nextShots = out.shots.map((shot, index) => {
        if (!selectedIndexes.has(index)) return shot;
        if (field === 'sceneRef') return { ...shot, sceneRef: normalized };
        return { ...shot, sound: normalized };
      });
      patchShotListNodeOutput(id, { ...out, shots: reindexStoryboardShotIds(nextShots) }, true);
    },
    [flushPersist, id, patchShotListNodeOutput, selected],
  );

  const onAppendRow = useCallback(() => {
    flushPersist();
    const row = useStudioStore.getState().nodes.find((n) => n.id === id)?.data;
    const out =
      row?.type === 'shot_list_node' && row.output != null
        ? tryParseStoryboardOutput(row.output)
        : null;
    const base = out ?? { shots: [] as StoryboardShot[], narrativeBeats: [] as string[] };
    const last = base.shots[base.shots.length - 1];
    const sceneRef = last?.sceneRef;
    const nextShots = [...base.shots, blankShot(sceneRef)];
    const beats =
      base.narrativeBeats?.length > 0
        ? base.narrativeBeats
        : nextShots.length > 0
          ? ['鎵嬪姩缁存姢鐨勯暅澶磋〃']
          : [];
    patchShotListNodeOutput(id, { ...base, narrativeBeats: beats, shots: reindexStoryboardShotIds(nextShots) }, true);
  }, [id, patchShotListNodeOutput, flushPersist]);

  const stopCanvas = useCallback((e: ReactPointerEvent | ReactMouseEvent) => {
    e.stopPropagation();
  }, []);

  const hasSelection = selected.size >= 1;
  const scrollViewportHeight = Math.max(220, (viewportHeight ?? 560) - 210);

  const decisionStrip =
    parentId != null && parentReviewData != null ? (
      <ShotListCanvasDecisionStrip parentId={parentId} parentData={parentReviewData} />
    ) : null;

  if (!output || shots.length === 0) {
    return (
      <div
        className="shot-list-canvas__stack nodrag nopan nowheel"
        onPointerDown={stopCanvas}
        onMouseDown={stopCanvas}
      >
        {decisionStrip}
        <div className="shot-list-canvas__empty shot-list-canvas__empty--padded">
          <p className="shot-list-canvas__empty-text">暂无镜头数据</p>
          <p className="shot-list-canvas__empty-hint">可从父分镜同步生成，或点击下方手动新增第一行</p>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--add nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={onAppendRow}
          >
            + 新增镜头
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="shot-list-canvas__root nodrag nopan nowheel"
      onPointerDown={stopCanvas}
      onMouseDown={stopCanvas}
    >
      {decisionStrip}
      {hasSelection ? (
        <div className="shot-list-canvas__toolbar">
          <span className="shot-list-canvas__toolbar-hint">已选 {selected.size} 行</span>
          <label className="shot-list-canvas__batch-field">
            <span className="shot-list-canvas__batch-label">场景</span>
            <input
              type="text"
              className="shot-list-canvas__input nodrag nopan nowheel"
              value={batchSceneRef}
              onChange={(e) => setBatchSceneRef(e.target.value)}
              onPointerDown={stopCanvas}
              onMouseDown={stopCanvas}
              placeholder="批量填写场景"
            />
          </label>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--merge nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={() => applySelectedField('sceneRef', batchSceneRef)}
          >
            应用场景
          </button>
          <label className="shot-list-canvas__batch-field">
            <span className="shot-list-canvas__batch-label">音效</span>
            <input
              type="text"
              className="shot-list-canvas__input nodrag nopan nowheel"
              value={batchSound}
              onChange={(e) => setBatchSound(e.target.value)}
              onPointerDown={stopCanvas}
              onMouseDown={stopCanvas}
              placeholder="批量填写音效"
            />
          </label>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--merge nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={() => applySelectedField('sound', batchSound)}
          >
            应用音效
          </button>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--danger nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={onDeleteSelected}
          >
            删除选中
          </button>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--merge nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={() => setSelected(new Set())}
          >
            清空选择
          </button>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--merge nodrag nopan nowheel"
            title="将同一场次下的连续镜头按 15 秒上限自动合并"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={onMergeSameScene}
          >
            同场合并
          </button>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--merge nodrag nopan nowheel"
            disabled={!mergeInfo.ok}
            title={
              mergeInfo.ok
                ? '将连续选中的多行合并为一行'
                : '请选择行号连续的多行（中间不能空行）'
            }
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={onMerge}
          >
            合并选中项
          </button>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--add shot-list-canvas__btn--toolbar-end nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={onAppendRow}
          >
            + 新增镜头
          </button>
        </div>
      ) : (
        <div className="shot-list-canvas__toolbar shot-list-canvas__toolbar--subtle">
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--merge nodrag nopan nowheel"
            title="将同一场次下的连续镜头按 15 秒上限自动合并"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={onMergeSameScene}
          >
            同场合并
          </button>
          <span className="shot-list-canvas__toolbar-hint">勾选至少 2 行（须连续）后可手动合并</span>
          <button
            type="button"
            className="shot-list-canvas__btn shot-list-canvas__btn--add shot-list-canvas__btn--toolbar-end nodrag nopan nowheel"
            onPointerDown={stopCanvas}
            onMouseDown={stopCanvas}
            onClick={onAppendRow}
          >
            + 新增镜头
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="shot-list-canvas__scroll"
        style={{ maxHeight: scrollViewportHeight, height: scrollViewportHeight }}
        onScroll={scheduleHandleRefresh}
      >
        <table className="shot-list-canvas__table">
          <thead>
            <tr>
              <th className="shot-list-canvas__th shot-list-canvas__th--check" scope="col">
                选
              </th>
              <th className="shot-list-canvas__th" scope="col">
                镜头号
              </th>
              <th className="shot-list-canvas__th shot-list-canvas__th--scene" scope="col">
                场景
              </th>
              <th className="shot-list-canvas__th" scope="col">
                景别
              </th>
              <th className="shot-list-canvas__th" scope="col">
                运镜
              </th>
              <th className="shot-list-canvas__th shot-list-canvas__th--wide" scope="col">
                画面描述
              </th>
              <th className="shot-list-canvas__th shot-list-canvas__th--wide" scope="col">
                台词
              </th>
              <th className="shot-list-canvas__th shot-list-canvas__th--sound" scope="col">
                音效
              </th>
              <th className="shot-list-canvas__th shot-list-canvas__th--note" scope="col">
                备注
              </th>
              <th className="shot-list-canvas__th shot-list-canvas__th--op" scope="col">
                操作
              </th>
              <th className="shot-list-canvas__th shot-list-canvas__th--port" scope="col">
                输出
              </th>
            </tr>
          </thead>
          <tbody>
            {shots.map((sh, rowIdx) => (
              <ShotCanvasRow
                key={sh.id}
                sh={sh}
                rowIdx={rowIdx}
                selected={selected.has(rowIdx)}
                selectedGroupCount={selectedWireIds.length}
                hovered={hoveredWireId === (sh.wireId ?? String(sh.id))}
                promptLinkCount={promptLinkCounts.get(sh.wireId ?? String(sh.id)) ?? 0}
                onHoverPort={(hovering) => setHoveredWireId(hovering ? (sh.wireId ?? String(sh.id)) : null)}
                onSelectGesture={startSelectionGesture}
                onDragRangeEnter={extendRangeSelect}
                onDelete={() => onDelete(rowIdx)}
                onLiveField={(field, value) => onLiveField(rowIdx, field, value)}
                onFlushPersist={flushPersist}
                stopCanvas={stopCanvas}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


