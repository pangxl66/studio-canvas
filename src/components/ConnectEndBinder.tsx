import { useReactFlow, type OnConnectEnd } from '@xyflow/react';
import { useLayoutEffect, type MutableRefObject } from 'react';
import { DEPT_INPUT_PULL_HANDLE_ID } from '@/components/DepartmentNode';
import { isShotListItemOutputHandleId } from '@/utils/shotListWire';

export type NodePickerState = {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  fromNodeId: string;
  fromHandleId: string | null;
  fromHandleType: 'source' | 'target' | null;
};

export type ConnectionDragStart = {
  nodeId: string | null;
  handleId: string | null;
  handleType: string | null;
};

function isPaneDropMenuHandle(
  nodeType: string,
  handleId: string | null,
  handleType: 'source' | 'target' | null,
): boolean {
  if (!handleId || !handleType) return false;
  if (
    handleType === 'source' &&
    ((nodeType !== 'shotList' && handleId === 'out') ||
      (nodeType === 'shotList' && isShotListItemOutputHandleId(handleId)))
  ) {
    return (
      nodeType === 'textNode' ||
      nodeType === 'department' ||
      nodeType === 'shotList' ||
      nodeType === 'storyboardFile' ||
      nodeType === 'promptReview' ||
      nodeType === 'imageNode' ||
      nodeType === 'videoNode' ||
      nodeType === 'aiFilmCharacter' ||
      nodeType === 'aiFilmStoryboard' ||
      nodeType === 'aiFilmVideoPrompt'
    );
  }
  if (handleType === 'source' && handleId === DEPT_INPUT_PULL_HANDLE_ID) {
    return nodeType === 'department';
  }
  if (handleType === 'target' && handleId === 'in') {
    return (
      nodeType === 'textNode' ||
      nodeType === 'department' ||
      nodeType === 'aiFilmCharacter' ||
      nodeType === 'aiFilmStoryboard' ||
      nodeType === 'aiFilmVideoPrompt'
    );
  }
  return false;
}

/**
 * React Flow 在内部嵌套 Provider；必须在画布子树内使用 useReactFlow，
 * 才能把正确的 screenToFlowPosition 注入到父组件传入的 onConnectEnd ref。
 */
export function ConnectEndBinder({
  implRef,
  dragStartRef,
  setPicker,
}: {
  implRef: MutableRefObject<OnConnectEnd>;
  dragStartRef: MutableRefObject<ConnectionDragStart | null>;
  setPicker: (p: NodePickerState | null) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();

  useLayoutEffect(() => {
    implRef.current = (event, cs) => {
      const started = dragStartRef.current;
      dragStartRef.current = null;

      if (cs.isValid === true) return;
      if (cs.toNode != null) return;

      const fromNode = cs.fromNode;
      if (!fromNode?.id) return;

      const hid = started?.handleId ?? cs.fromHandle?.id ?? null;
      const ht = (started?.handleType ?? cs.fromHandle?.type ?? null) as 'source' | 'target' | null;

      if (!isPaneDropMenuHandle(fromNode.type ?? '', hid, ht)) return;

      const cx =
        'clientX' in event ? event.clientX : (event.changedTouches?.[0]?.clientX ?? 0);
      const cy =
        'clientY' in event ? event.clientY : (event.changedTouches?.[0]?.clientY ?? 0);
      const flow = screenToFlowPosition({ x: cx, y: cy });
      const payload: NodePickerState = {
        fromNodeId: fromNode.id,
        fromHandleId: hid,
        fromHandleType: ht,
        screenX: cx,
        screenY: cy,
        flowX: flow.x,
        flowY: flow.y,
      };
      /** 推迟到 macrotask，避免同一次 mouseup 上 onPaneClick 先执行把菜单清掉 */
      window.setTimeout(() => setPicker(payload), 0);
    };

    return () => {
      implRef.current = () => {};
    };
  }, [implRef, dragStartRef, screenToFlowPosition, setPicker]);

  return null;
}
