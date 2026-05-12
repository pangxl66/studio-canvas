import { useCallback, useState } from 'react';
import {
  getLlmSettingsFormDefaults,
  getResolvedLlmGatewayConfig,
  pipelineModeForLlmMode,
  pipelineModeNeedsGateway,
} from '@/config/llmSettings';
import { STUDIO_OPEN_SETTINGS_EVENT } from '@/components/StudioSettings';
import { useStudioStore } from '@/store/useStudioStore';

export function StudioWelcomePanel() {
  const nodeCount = useStudioStore((state) => state.nodes.length);
  const addTextNode = useStudioStore((state) => state.addTextNode);
  const focusNode = useStudioStore((state) => state.focusNode);
  const [dismissed, setDismissed] = useState(false);

  const llmMode = getLlmSettingsFormDefaults().mode;
  const pipelineMode = pipelineModeForLlmMode(llmMode);
  const configReady = getResolvedLlmGatewayConfig() != null;
  const gatewayRequired = pipelineModeNeedsGateway(pipelineMode);
  const modeReady = !gatewayRequired || configReady;

  const createTextCard = useCallback(() => {
    const id = addTextNode('', { x: 120, y: 250 });
    focusNode(id, { openDetail: true });
  }, [addTextNode, focusNode]);

  const openSettings = useCallback(() => {
    window.dispatchEvent(new Event(STUDIO_OPEN_SETTINGS_EVENT));
  }, []);

  if (nodeCount > 0 || dismissed) return null;

  return (
    <div className="studio-welcome-panel" role="region" aria-label="新手引导">
      <div className={`studio-welcome-panel__badge ${modeReady ? 'studio-welcome-panel__badge--ok' : ''}`}>
        {modeReady ? `已就绪 · ${llmMode === 'deep' ? 'Deep' : 'Fast'}` : `请先配置 ${llmMode === 'deep' ? 'Deep' : 'Fast'} 模式`}
      </div>
      <h2 className="studio-welcome-panel__title">第一次使用？从这 3 步开始</h2>
      <p className="studio-welcome-panel__desc">
        现在支持 <code>Fast / Deep</code> 两种运行方式。<code>Fast</code> 适合快速起草，<code>Deep</code> 适合高质量生成，推荐配合代理网关使用。
      </p>

      <div className="studio-welcome-panel__steps">
        <div className="studio-welcome-panel__step">
          <span className="studio-welcome-panel__step-no">1</span>
          <div>
            <strong>先确定运行模式</strong>
            <p>右上角可以直接切换 Fast 和 Deep。Deep 模式需要先完成模型设置，优先推荐填写代理 URL。</p>
          </div>
        </div>
        <div className="studio-welcome-panel__step">
          <span className="studio-welcome-panel__step-no">2</span>
          <div>
            <strong>输入故事素材</strong>
            <p>可以直接粘贴小说正文、剧本片段、人物设定，或者先创建一个文本卡片作为起点。</p>
          </div>
        </div>
        <div className="studio-welcome-panel__step">
          <span className="studio-welcome-panel__step-no">3</span>
          <div>
            <strong>让节点接力工作</strong>
            <p>先放入文本素材，再接分镜和 Prompt。你也可以导入 Excel 分镜表，或者用图片表格识别快速起稿。</p>
          </div>
        </div>
      </div>

      <div className="studio-welcome-panel__actions">
        <button type="button" className="studio-welcome-panel__primary" onClick={openSettings}>
          {gatewayRequired ? '查看模型设置' : '查看 Fast / Deep 设置'}
        </button>
        <button type="button" className="studio-welcome-panel__secondary" onClick={createTextCard}>
          创建文本卡片
        </button>
      </div>

      <button type="button" className="studio-welcome-panel__dismiss" onClick={() => setDismissed(true)}>
        先收起
      </button>
    </div>
  );
}
