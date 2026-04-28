import { useReactFlow } from '@xyflow/react';
import { useStudioStore } from '@/store/useStudioStore';
import type { NodeKind } from '@/types/studio';

type PipelineKind = Exclude<
  NodeKind,
  'text_node' | 'shot_list_node' | 'storyboard_file_node' | 'prompt_review_node' | 'image_node'
>;

function IconPen() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.83H5v-.92l8.06-8.06.92.92L5.92 20.08zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
      />
    </svg>
  );
}

function IconBoard() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        fill="currentColor"
        d="M4 5h16v2H4V5zm0 6h10v2H4v-2zm0 6h16v2H4v-2zm12-4h4v2h-4v-2z"
      />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2l1.2 4.2L17 8l-3.8 1.8L12 14l-1.2-4.2L7 8l3.8-1.8L12 2zm0 10.5l.9 3.1 3.1.9-3.1.9L12 21l-.9-3.1-3.1-.9 3.1-.9.9-3.1z"
      />
    </svg>
  );
}

function IconTextNode() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        fill="currentColor"
        d="M4 5h16v2H4V5zm0 4h10v2H4V9zm0 4h16v2H4v-2zm0 4h12v2H4v-2z"
      />
    </svg>
  );
}

export function Sidebar() {
  const { screenToFlowPosition } = useReactFlow();
  const addDepartmentNode = useStudioStore((s) => s.addDepartmentNode);
  const addTextNode = useStudioStore((s) => s.addTextNode);
  const startStoryboardPipeline = useStudioStore((s) => s.startStoryboardPipeline);

  const placeNearSidebar = () => {
    const p = screenToFlowPosition({ x: 120, y: window.innerHeight * 0.42 });
    return { x: p.x, y: p.y };
  };

  const onAdd = (kind: PipelineKind) => {
    const pos = placeNearSidebar();
    if (kind === 'storyboard') {
      const id = startStoryboardPipeline(pos);
      useStudioStore.getState().focusNode(id);
      return;
    }
    const id = addDepartmentNode(kind, pos);
    useStudioStore.getState().focusNode(id);
  };

  return (
    <nav className="studio-sidebar nowheel nopan" aria-label="部门工具栏">
      <button type="button" className="studio-sidebar__btn" title="编剧部" onClick={() => onAdd('writing')}>
        <IconPen />
        <span>编剧部</span>
      </button>
      <button type="button" className="studio-sidebar__btn" title="分镜部" onClick={() => onAdd('storyboard')}>
        <IconBoard />
        <span>分镜部</span>
      </button>
      <button type="button" className="studio-sidebar__btn" title="Prompt部" onClick={() => onAdd('prompt')}>
        <IconSpark />
        <span>Prompt部</span>
      </button>
      <button
        type="button"
        className="studio-sidebar__btn"
        title="文本卡片"
        onClick={() => {
          const pos = placeNearSidebar();
          const id = addTextNode('', pos);
          useStudioStore.getState().focusNode(id, { openDetail: false });
        }}
      >
        <IconTextNode />
        <span>文本卡片</span>
      </button>
    </nav>
  );
}
