import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react';
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
  const nodes = useStudioStore((s) => s.nodes);
  const edges = useStudioStore((s) => s.edges);
  const imageReferences = useMemo(() => {
    const incoming = edges.filter((edge) => {
      if (edge.target !== id || (edge.targetHandle != null && edge.targetHandle !== TEXT_NODE_INPUT_HANDLE_ID)) return false;
      return nodes.find((node) => node.id === edge.source)?.type === 'imageNode';
    });
    return incoming
      .map((edge) => nodes.find((node) => node.id === edge.source))
      .filter((node): node is Node<StudioNodeData, 'imageNode'> => node != null && node.type === 'imageNode')
      .map((node) => ({
        id: node.id,
        label: node.data.imageFileName?.trim() || node.data.label?.trim() || '图片参考',
        src: node.data.imageDataUrl,
      }));
  }, [edges, id, nodes]);
  const [instruction, setInstruction] = useState('');
  const raw = data.raw_text ?? data.input ?? '';
  const busy = data.status === 'IN_PROGRESS';
  const displayText = busy ? (data.streaming_preview ?? raw) : raw;
  const displayLabel = displayTextNodeLabel(data.label);
  const hasText = Boolean(displayText.trim());
  const hasImages = imageReferences.length > 0;
  const canGenerate = busy || Boolean(instruction.trim() || raw.trim() || hasImages);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      patchNodeData(id, { raw_text: value, input: value }, false);
    },
    [id, patchNodeData],
  );

  const onInstructionChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setInstruction(event.target.value);
  }, []);

  const onStop = useCallback(() => {
    stopNodeTask(id);
  }, [id, stopNodeTask]);

  const onGenerate = useCallback(
    (event?: MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation();
      if (busy) {
        onStop();
        return;
      }
      const nextInstruction = instruction.trim();
      void runTextPolish(id, nextInstruction ? { instruction: nextInstruction } : undefined);
      if (nextInstruction) setInstruction('');
    },
    [busy, id, instruction, onStop, runTextPolish],
  );

  return (
    <div className={`text-node ${hasText ? 'text-node--filled' : 'text-node--empty'} ${selected ? 'text-node--selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={TEXT_NODE_INPUT_HANDLE_ID}
        className="text-node__handle text-node__handle--in"
        title="Input：接入上游文本或部门资产；拖向空白可创建节点并连线"
      />
      <header className="text-node__head">
        <span className="text-node__title">
          <span className="text-node__title-icon" aria-hidden />
          <span className="text-node__title-label">{displayLabel}</span>
        </span>
      </header>
      <section className="text-node__surface">
        {hasText || busy ? (
          <textarea
            className="text-node__area nodrag nopan nowheel"
            value={displayText}
            onChange={onChange}
            placeholder="生成后的文本会出现在这里"
            rows={10}
            spellCheck={false}
            disabled={busy}
          />
        ) : (
          <div className="text-node__empty-state">
            <div className="text-node__empty-mark" aria-hidden>
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="text-node__try-label">尝试:</div>
            <div className="text-node__try-list" aria-label="文本节点示例">
              <div className="text-node__try-item">
                <span className="text-node__try-icon text-node__try-icon--doc" aria-hidden />
                <span>自己编写内容</span>
              </div>
              <div className="text-node__try-item">
                <span className="text-node__try-icon text-node__try-icon--video" aria-hidden />
                <span>文生视频</span>
              </div>
              <div className="text-node__try-item">
                <span className="text-node__try-icon text-node__try-icon--image" aria-hidden />
                <span>图片反推提示词</span>
              </div>
              <div className="text-node__try-item">
                <span className="text-node__try-icon text-node__try-icon--audio" aria-hidden />
                <span>文字生音乐</span>
              </div>
            </div>
          </div>
        )}
      </section>
      {data.generation_error?.trim() ? (
        <div className="text-node__error">{data.generation_error.trim()}</div>
      ) : null}
      {selected ? (
        <div className="text-node__workspace nodrag nopan nowheel">
          {hasImages ? (
            <div className="text-node__workspace-images">
              {imageReferences.slice(0, 4).map((image, index) => (
                <div className="text-node__workspace-thumb" key={image.id} title={image.label}>
                  {image.src ? <img src={image.src} alt={image.label} /> : <span className="text-node__workspace-thumb-empty">图</span>}
                  <span className="text-node__workspace-thumb-count">{index + 1}</span>
                </div>
              ))}
              {imageReferences.length > 4 ? <span className="text-node__workspace-more">+{imageReferences.length - 4}</span> : null}
            </div>
          ) : null}
          <textarea
            className="text-node__workspace-input"
            value={instruction}
            onChange={onInstructionChange}
            placeholder={
              hasImages
                ? '图片会作为视频首帧。输入首帧之后的动作或情绪变化。例如：笑容逐渐变得狰狞，突然冲向镜头。'
                : '写下你想讲的故事、场景或角色设定。例如：一个来自未来的机器人，在城市屋顶看星星。'
            }
            spellCheck={false}
            disabled={busy}
          />
          <div className="text-node__workspace-footer">
            <div className="text-node__workspace-model">
              <span className="text-node__workspace-model-icon" aria-hidden />
              <span>{hasImages ? '视觉 LLM' : 'LLM'}</span>
              <span className="text-node__workspace-caret" aria-hidden />
            </div>
            <div className="text-node__workspace-actions">
              <span className="text-node__workspace-mini text-node__workspace-mini--translate" aria-hidden />
              <span className="text-node__workspace-mini text-node__workspace-mini--bolt" aria-hidden />
              <span className="text-node__workspace-cost">6</span>
              <button
                type="button"
                className={`text-node__workspace-submit ${busy ? 'text-node__workspace-submit--stop' : ''}`}
                disabled={!canGenerate}
                onClick={onGenerate}
                aria-label={busy ? '停止生成' : '生成到文本节点'}
                title={busy ? '停止生成' : '生成到上方文本节点'}
              >
                <span aria-hidden />
              </button>
            </div>
          </div>
        </div>
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
