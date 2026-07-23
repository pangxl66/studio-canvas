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

function safeDownloadName(value: string | undefined): string {
  const name = value?.trim() || `image-${Date.now()}.png`;
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '-');
}

async function imageAsPngBlob(dataUrl: string): Promise<Blob> {
  const sourceBlob = await fetch(dataUrl).then((response) => response.blob());
  if (sourceBlob.type === 'image/png') return sourceBlob;
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('图片读取失败。'));
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理图片。');
  context.drawImage(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('图片转换失败。')),
      'image/png',
    );
  });
}

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

  const copyImage = useCallback(async () => {
    const imageDataUrl = menu?.node.data.imageDataUrl;
    if (!menu || typeof imageDataUrl !== 'string' || !imageDataUrl) return;
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器不支持复制图片。');
      }
      const blob = await imageAsPngBlob(imageDataUrl);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      useStudioStore.getState().pushMessage({ role: 'system', text: '已复制图片到系统剪贴板。', nodeId: menu.node.id });
    } catch (error) {
      useStudioStore.getState().pushMessage({
        role: 'system',
        text: error instanceof Error ? `复制图片失败：${error.message}` : '复制图片失败。',
        nodeId: menu.node.id,
      });
    }
    onClose();
  }, [menu, onClose]);

  const downloadImage = useCallback(() => {
    const imageDataUrl = menu?.node.data.imageDataUrl;
    if (!menu || typeof imageDataUrl !== 'string' || !imageDataUrl) return;
    const anchor = document.createElement('a');
    anchor.href = imageDataUrl;
    anchor.download = safeDownloadName(menu.node.data.imageFileName || menu.node.data.label);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    useStudioStore.getState().pushMessage({ role: 'system', text: '图片下载已开始。', nodeId: menu.node.id });
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
  const canUseImage = menu.node.type === 'imageNode' && Boolean(menu.node.data.imageDataUrl);

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
      {canUseImage ? (
        <>
          <button type="button" className="node-context-menu__item" role="menuitem" onClick={copyImage}>
            复制图片
          </button>
          <button type="button" className="node-context-menu__item" role="menuitem" onClick={downloadImage}>
            下载图片
          </button>
        </>
      ) : null}
      <button type="button" className="node-context-menu__item" role="menuitem" onClick={runDuplicate}>
        复制节点
      </button>
      <button type="button" className="node-context-menu__item" role="menuitem" onClick={copyJson}>
        复制 JSON 数据
      </button>
      <button type="button" className="node-context-menu__item" role="menuitem" onClick={runDelete}>
        删除节点
      </button>
    </div>
  );
}
