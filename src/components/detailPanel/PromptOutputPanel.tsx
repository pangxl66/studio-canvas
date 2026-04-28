import { useCallback, useState } from 'react';
import type { PromptOutput, StoryboardOutput } from '@/types/studio';
import {
  formatPrompt,
  formatPromptGlobal,
  formatPromptShotPack,
  formatSeedanceCards,
  formatSeedanceShotPack,
} from '@/utils/promptFormat';

function CopyCodeButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const onClick = useCallback(() => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setDone(true);
        window.setTimeout(() => setDone(false), 1600);
      },
      () => window.alert('复制失败：请检查浏览器权限'),
    );
  }, [text]);
  return (
    <button type="button" className="detail-panel__code-copy node-detail-action-btn" onClick={onClick}>
      {done ? '已复制' : label}
    </button>
  );
}

export function PromptOutputPanel({
  output,
  storyboardInput = null,
}: {
  output: PromptOutput;
  storyboardInput?: StoryboardOutput | null;
}) {
  const shots = output.shotPrompts?.length ? output.shotPrompts : null;

  if (!shots) {
    const full = formatPrompt(output);
    return (
      <div className="detail-panel__prompt-output">
        <div className="detail-panel__code-block-wrap">
          <div className="detail-panel__code-block-toolbar">
            <span className="detail-panel__code-block-title">完整 Prompt 包</span>
            <CopyCodeButton text={full} />
          </div>
          <pre className="detail-panel__code-block">{full}</pre>
        </div>
      </div>
    );
  }

  const globalText = formatPromptGlobal(output);
  const seedanceAll = formatSeedanceCards(shots, storyboardInput);

  return (
    <div className="detail-panel__prompt-output">
      <div className="detail-panel__code-block-wrap">
        <div className="detail-panel__code-block-toolbar">
          <span className="detail-panel__code-block-title">全局（system / user / parameters）</span>
          <CopyCodeButton text={globalText} label="复制全局" />
        </div>
        <pre className="detail-panel__code-block">{globalText}</pre>
      </div>
      <div className="detail-panel__code-block-wrap">
        <div className="detail-panel__code-block-toolbar">
          <span className="detail-panel__code-block-title">Seedance 卡片（全部镜头）</span>
          <CopyCodeButton text={seedanceAll} label="复制全部卡片" />
        </div>
        <pre className="detail-panel__code-block">{seedanceAll}</pre>
      </div>
      {shots.map((sp, idx) => {
        const body = formatPromptShotPack(sp);
        const shotIdNum = Number(sp.shot_id.replace(/[^\d]/g, ''));
        const sourceShot =
          storyboardInput?.shots.find((shot) => shot.id === shotIdNum) ??
          storyboardInput?.shots[idx];
        const seedanceCard = formatSeedanceShotPack(sp, sourceShot);
        return (
          <div key={sp.shot_id}>
            <div className="detail-panel__code-block-wrap">
              <div className="detail-panel__code-block-toolbar">
                <span className="detail-panel__code-block-title">镜头 {sp.shot_id} · Prompt 包</span>
                <CopyCodeButton text={body} label="复制本镜 Prompt" />
              </div>
              <pre className="detail-panel__code-block">{body}</pre>
            </div>
            <div className="detail-panel__code-block-wrap">
              <div className="detail-panel__code-block-toolbar">
                <span className="detail-panel__code-block-title">镜头 {sp.shot_id} · Seedance 卡片</span>
                <CopyCodeButton text={seedanceCard} label="复制本镜卡片" />
              </div>
              <pre className="detail-panel__code-block">{seedanceCard}</pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
