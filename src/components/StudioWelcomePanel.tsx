import { useState } from 'react';
import { useStudioStore } from '@/store/useStudioStore';

export function StudioWelcomePanel() {
  const nodeCount = useStudioStore((state) => state.nodes.length);
  const [dismissed, setDismissed] = useState(false);

  if (nodeCount > 0 || dismissed) return null;

  return (
    <div className="studio-welcome-panel" role="region" aria-label="提示词工作流引导">
      <div className="studio-welcome-panel__badge">提示词工作流</div>
      <h2 className="studio-welcome-panel__title">选择一种节点连接方式</h2>
      <div className="studio-welcome-panel__guides">
        <div className="studio-welcome-panel__guide">
          <strong>长镜头提示词</strong>
          <div className="studio-welcome-panel__flow" aria-label="文本节点连接提示词节点">
            <span>文本节点</span>
            <i />
            <span>提示词节点</span>
          </div>
          <p>适合一段连续动作、长镜头或单次画面推进，文本节点直接连接提示词节点生成。</p>
        </div>
        <div className="studio-welcome-panel__guide">
          <strong>多镜头提示词</strong>
          <div className="studio-welcome-panel__flow" aria-label="文本节点连接分镜节点连接提示词节点">
            <span>文本节点</span>
            <i />
            <span>分镜节点</span>
            <i />
            <span>提示词节点</span>
          </div>
          <p>适合需要先拆分镜头、明确镜头接力和节奏变化的内容，再由提示词节点生成多镜头提示词。</p>
        </div>
      </div>
      <button type="button" className="studio-welcome-panel__dismiss" onClick={() => setDismissed(true)}>
        先收起
      </button>
    </div>
  );
}
