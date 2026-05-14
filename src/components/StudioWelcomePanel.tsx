import { useCallback, useState } from 'react';
import { STUDIO_OPEN_SETTINGS_EVENT } from '@/components/StudioSettings';
import { getResolvedLlmGatewayConfig } from '@/config/llmSettings';
import { useStudioStore } from '@/store/useStudioStore';

export function StudioWelcomePanel() {
  const nodeCount = useStudioStore((state) => state.nodes.length);
  const addTextNode = useStudioStore((state) => state.addTextNode);
  const focusNode = useStudioStore((state) => state.focusNode);
  const [dismissed, setDismissed] = useState(false);
  const configReady = getResolvedLlmGatewayConfig() != null;

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
      <div className={`studio-welcome-panel__badge ${configReady ? 'studio-welcome-panel__badge--ok' : ''}`}>
        {configReady ? 'API 模型已就绪' : '请先配置 API 模型'}
      </div>
      <h2 className="studio-welcome-panel__title">第一次使用？从这 3 步开始</h2>
      <p className="studio-welcome-panel__desc">
        现在统一使用 <code>API 模型</code> 生成内容。推荐先配置代理网关，这样浏览器不会暴露 API Key，线上和本地行为也会保持一致。
      </p>
      <div className="studio-welcome-panel__steps">
        <div className="studio-welcome-panel__step">
          <strong>1. 配置模型</strong>
          <span>确认代理 URL 或 API Key 可用，后续文本润色、分镜和提示词都会走同一套模型通道。</span>
        </div>
        <div className="studio-welcome-panel__step">
          <strong>2. 写入原文</strong>
          <span>创建文本卡片，把剧本、动作描述或镜头说明放进去。</span>
        </div>
        <div className="studio-welcome-panel__step">
          <strong>3. 串联节点</strong>
          <span>连接分镜表和 Prompt 节点，生成后可自动进入审核节点继续精修。</span>
        </div>
      </div>
      <div className="studio-welcome-panel__actions">
        <button type="button" className="studio-welcome-panel__primary" onClick={openSettings}>
          查看模型设置
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
