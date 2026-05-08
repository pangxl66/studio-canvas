import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, type ChangeEvent } from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';

type TextRF = Node<StudioNodeData, 'textNode'>;

export const TEXT_NODE_OUTPUT_HANDLE_ID = 'out';
export const TEXT_NODE_INPUT_HANDLE_ID = 'in';

function displayTextNodeLabel(label: string | undefined): string {
  if (!label) return '文本卡片';
  return label.trim() || '文本卡片';
}

function TextNodeInner({ id, data, selected }: NodeProps<TextRF>) {
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const runTextPolish = useStudioStore((s) => s.runTextPolish);
  const stopNodeTask = useStudioStore((s) => s.stopNodeTask);
  const raw = data.raw_text ?? data.input ?? '';
  const busy = data.status === 'IN_PROGRESS';
  const displayText = busy ? (data.streaming_preview ?? raw) : raw;
  const displayLabel = displayTextNodeLabel(data.label);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      patchNodeData(id, { raw_text: value, input: value }, false);
    },
    [id, patchNodeData],
  );

  const onPolish = useCallback(() => {
    void runTextPolish(id);
  }, [id, runTextPolish]);

  const onStop = useCallback(() => {
    stopNodeTask(id);
  }, [id, stopNodeTask]);

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
        <div className="text-node__head-actions nodrag nopan">
          <button
            type="button"
            className={`text-node__polish ${busy ? 'text-node__polish--stop' : ''}`}
            disabled={!busy && !raw.trim()}
            title={busy ? '停止当前润色任务' : '调用 LLM 润色当前文本'}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (busy) {
                onStop();
                return;
              }
              onPolish();
            }}
          >
            {busy ? '停止' : '润色'}
          </button>
          <span className="text-node__badge">In / Out</span>
        </div>
      </header>
      <textarea
        className="text-node__area nodrag nopan nowheel"
        value={displayText}
        onChange={onChange}
        placeholder="粘贴或编辑长文本；右侧 Output 连部门 Input，或左侧 Input 接上游"
        rows={5}
        spellCheck={false}
        disabled={busy}
      />
      {data.generation_error?.trim() ? (
        <div className="text-node__error">{data.generation_error.trim()}</div>
      ) : null}
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
