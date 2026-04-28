import { useCallback, useEffect, useRef } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioRFNode } from '@/types/reactFlow';

export type ContextMenuState = {
  x: number;
  y: number;
  node: StudioRFNode;
} | null;

type Props = {
  menu: ContextMenuState;
  onClose: () => void;
};

export function NodeContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const executeNodeTask = useStudioStore((s) => s.executeNodeTask);
  const refreshPromptInputsFromShotList = useStudioStore((s) => s.refreshPromptInputsFromShotList);
  const removeNodesByIds = useStudioStore((s) => s.removeNodesByIds);
  const duplicateNodesByIds = useStudioStore((s) => s.duplicateNodesByIds);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, onClose]);

  const copyJson = useCallback(async () => {
    if (!menu) return;
    const { node } = menu;
    const payload = {
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      useStudioStore.getState().pushMessage({ role: 'system', text: '已复制节点 JSON 到剪贴板。' });
    } catch {
      useStudioStore.getState().pushMessage({ role: 'system', text: '复制失败：请检查浏览器剪贴板权限。' });
    }
    onClose();
  }, [menu, onClose]);

  const runExecute = useCallback(() => {
    if (!menu) return;
    const n = menu.node;
    if (
      n.type === 'department' &&
      (n.data.type === 'writing' || n.data.type === 'storyboard' || n.data.type === 'prompt')
    ) {
      if (n.data.onExecute) void n.data.onExecute();
      else void executeNodeTask(n.id);
    }
    onClose();
  }, [menu, executeNodeTask, onClose]);

  const runDelete = useCallback(() => {
    if (!menu) return;
    if (menu.node.data.onDelete) menu.node.data.onDelete();
    else removeNodesByIds([menu.node.id]);
    onClose();
  }, [menu, removeNodesByIds, onClose]);

  const runDuplicate = useCallback(() => {
    if (!menu) return;
    duplicateNodesByIds([menu.node.id]);
    onClose();
  }, [duplicateNodesByIds, menu, onClose]);

  const runRefreshPromptInputs = useCallback(() => {
    if (!menu) return;
    const node = menu.node;
    if (node.type !== 'shotList' || node.data.type !== 'shot_list_node') return;
    refreshPromptInputsFromShotList(node.id);
    onClose();
  }, [menu, onClose, refreshPromptInputsFromShotList]);

  if (!menu) return null;

  const canExecute =
    menu.node.type === 'department' &&
    (menu.node.data.type === 'writing' ||
      menu.node.data.type === 'storyboard' ||
      menu.node.data.type === 'prompt') &&
    (menu.node.data.status === 'NOT_STARTED' || menu.node.data.status === 'REJECTED');
  const canRefreshPromptInputs =
    menu.node.type === 'shotList' && menu.node.data.type === 'shot_list_node';

  return (
    <div
      ref={ref}
      className="node-context-menu nodrag nopan"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {canExecute ? (
        <button type="button" className="node-context-menu__item" role="menuitem" onClick={runExecute}>
          立即执行
        </button>
      ) : null}
      {canRefreshPromptInputs ? (
        <button
          type="button"
          className="node-context-menu__item"
          role="menuitem"
          onClick={runRefreshPromptInputs}
        >
          更新 Prompt 可识别内容
        </button>
      ) : null}
      <button type="button" className="node-context-menu__item" role="menuitem" onClick={runDuplicate}>
        复制节点
      </button>
      <button type="button" className="node-context-menu__item" role="menuitem" onClick={runDelete}>
        删除节点
      </button>
      <button type="button" className="node-context-menu__item" role="menuitem" onClick={copyJson}>
        复制 JSON 数据
      </button>
    </div>
  );
}
