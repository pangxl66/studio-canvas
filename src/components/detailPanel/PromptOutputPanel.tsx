import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PromptOutput, PromptShotPack, StoryboardOutput } from '@/types/studio';
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

function findSourceShot(
  shot: PromptShotPack,
  index: number,
  storyboardInput: StoryboardOutput | null,
) {
  const shotIdNum = Number(shot.shot_id.replace(/[^\d]/g, ''));
  return storyboardInput?.shots.find((candidate) => candidate.id === shotIdNum) ??
    storyboardInput?.shots[index];
}

export function PromptOutputPanel({
  output,
  storyboardInput = null,
}: {
  output: PromptOutput;
  storyboardInput?: StoryboardOutput | null;
}) {
  const shots = output.shotPrompts?.length ? output.shotPrompts : null;
  const [selectedShotId, setSelectedShotId] = useState(shots?.[0]?.shot_id ?? '');

  useEffect(() => {
    if (!shots?.length) return;
    if (!shots.some((shot) => shot.shot_id === selectedShotId)) {
      setSelectedShotId(shots[0].shot_id);
    }
  }, [selectedShotId, shots]);

  const selectedIndex = useMemo(
    () => Math.max(0, shots?.findIndex((shot) => shot.shot_id === selectedShotId) ?? 0),
    [selectedShotId, shots],
  );
  const selectedShot = shots?.[selectedIndex] ?? null;

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
  const sourceShotCount = storyboardInput?.shots.length ?? shots.length;
  const coveredShotCount = Math.min(shots.length, sourceShotCount);
  const cardReadyCount = shots.filter((shot) => Boolean(shot.seedanceCard?.trim())).length;
  const segmentCount = shots.reduce((total, shot) => total + (shot.shotSegments?.length ?? 0), 0);
  const aspect =
    output.parameters.aspect ??
    output.parameters.aspect_ratio ??
    output.parameters.aspectRatio ??
    '未声明';

  const selectedPrompt = selectedShot ? formatPromptShotPack(selectedShot) : '';
  const selectedSourceShot = selectedShot
    ? findSourceShot(selectedShot, selectedIndex, storyboardInput)
    : undefined;
  const selectedCard = selectedShot
    ? formatSeedanceShotPack(selectedShot, selectedSourceShot)
    : '';

  return (
    <div className="detail-panel__prompt-output">
      <div className="prompt-output-summary" aria-label="Prompt 输出校验摘要">
        <span>
          <strong>{shots.length}</strong>
          个提示词包
        </span>
        <span className={coveredShotCount === sourceShotCount ? 'is-ready' : 'is-warning'}>
          <strong>
            {coveredShotCount}/{sourceShotCount}
          </strong>
          镜头覆盖
        </span>
        <span className={cardReadyCount === shots.length ? 'is-ready' : 'is-warning'}>
          <strong>
            {cardReadyCount}/{shots.length}
          </strong>
          工业卡
        </span>
        <span>
          <strong>{segmentCount || '—'}</strong>
          宫格切片
        </span>
        <span>
          <strong>{aspect}</strong>
          画幅
        </span>
      </div>

      <div className="prompt-output-workbench">
        <nav className="prompt-output-workbench__shots" aria-label="选择镜头">
          {shots.map((shot, index) => (
            <button
              key={`${shot.shot_id}-${index}`}
              type="button"
              className={shot.shot_id === selectedShot?.shot_id ? 'is-active' : ''}
              onClick={() => setSelectedShotId(shot.shot_id)}
            >
              <strong>镜头 {shot.shot_id}</strong>
              <span>
                {shot.shotSegments?.length
                  ? `${shot.shotSegments.length} 个切片`
                  : shot.seedanceCard?.trim()
                    ? '卡片就绪'
                    : '待补全'}
              </span>
            </button>
          ))}
        </nav>

        {selectedShot ? (
          <section className="prompt-output-workbench__content">
            <div className="prompt-output-workbench__heading">
              <div>
                <span>当前镜头</span>
                <strong>{selectedShot.shot_id}</strong>
              </div>
              <div className="prompt-output-workbench__copy-actions">
                <CopyCodeButton text={selectedPrompt} label="复制 Prompt" />
                <CopyCodeButton text={selectedCard} label="复制工业卡" />
              </div>
            </div>
            <div className="detail-panel__code-block-wrap">
              <div className="detail-panel__code-block-toolbar">
                <span className="detail-panel__code-block-title">Seedance 工业卡</span>
              </div>
              <pre className="detail-panel__code-block">{selectedCard}</pre>
            </div>
            <details className="prompt-output-workbench__prompt-details">
              <summary>查看本镜头结构化 Prompt</summary>
              <pre className="detail-panel__code-block">{selectedPrompt}</pre>
            </details>
          </section>
        ) : null}
      </div>

      <details className="prompt-output-advanced">
        <summary>高级输出与批量复制</summary>
        <div className="detail-panel__code-block-wrap">
          <div className="detail-panel__code-block-toolbar">
            <span className="detail-panel__code-block-title">全局参数</span>
            <CopyCodeButton text={globalText} label="复制全局" />
          </div>
          <pre className="detail-panel__code-block">{globalText}</pre>
        </div>
        <div className="detail-panel__code-block-wrap">
          <div className="detail-panel__code-block-toolbar">
            <span className="detail-panel__code-block-title">全部 Seedance 卡片</span>
            <CopyCodeButton text={seedanceAll} label="复制全部卡片" />
          </div>
          <pre className="detail-panel__code-block">{seedanceAll}</pre>
        </div>
        <div className="detail-panel__code-block-wrap">
          <div className="detail-panel__code-block-toolbar">
            <span className="detail-panel__code-block-title">完整 Prompt 包</span>
            <CopyCodeButton text={formatPrompt(output)} label="复制完整包" />
          </div>
        </div>
      </details>
    </div>
  );
}
