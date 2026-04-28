import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, type ChangeEvent } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';

type TextRF = Node<StudioNodeData, 'textNode'>;

export const TEXT_NODE_OUTPUT_HANDLE_ID = 'out';
export const TEXT_NODE_INPUT_HANDLE_ID = 'in';

function displayTextNodeLabel(label: string | undefined): string {
  if (!label) return '文本卡片';
  if (label === '閺傚洦婀伴崡锛勫') return '文本卡片';
  return label;
}

function TextNodeInner({ id, data, selected }: NodeProps<TextRF>) {
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const raw = data.raw_text ?? data.input ?? '';
  const displayLabel = displayTextNodeLabel(data.label);
  const onChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      patchNodeData(id, { raw_text: v, input: v }, false);
    },
    [id, patchNodeData],
  );

  return (
    <div className={`text-node ${selected ? 'text-node--selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={TEXT_NODE_INPUT_HANDLE_ID}
        className="text-node__handle text-node__handle--in"
        title="Input：接入上游文本或部门资产；拖向空白可创建节点并连线"
      />
      <header className="text-node__head">
        <span className="text-node__title">{displayLabel}</span>
        <span className="text-node__badge">In / Out</span>
      </header>
      <textarea
        className="text-node__area nodrag nopan nowheel"
        value={raw}
        onChange={onChange}
        placeholder="粘贴或编辑长文本；右侧 Output 连部门 Input，或左侧 Input 接上游"
        rows={5}
        spellCheck={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="text-node__handle text-node__handle--out"
        id={TEXT_NODE_OUTPUT_HANDLE_ID}
      />
    </div>
  );
}

export const TextNode = memo(TextNodeInner);
