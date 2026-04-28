import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { writingOutputToJson } from '@/agents/writingAgents';
import { extractSceneLeaderHighlights } from '@/components/writing/writingSceneHighlights';
import {
  buildWritingScriptSections,
  formatWritingDataDump,
  sceneNarrativeSource,
  sceneRowKey,
} from '@/components/writing/writingScriptPreview';
import { resolveWritingExportTemplate } from '@/components/writing/writingExportSkillBridge';
import { ReviewFeedbackDialog } from '@/components/ReviewFeedbackDialog';
import { mergedTextNodeSourcesForDepartment } from '@/services/graphInput';
import { useStudioStore } from '@/store/useStudioStore';
import type { SceneRow, StudioNodeData } from '@/types/studio';

function isWritingOutput(o: unknown): o is import('@/types/studio').WritingOutput {
  if (!o || typeof o !== 'object') return false;
  const x = o as import('@/types/studio').WritingOutput;
  return Array.isArray(x.episodes) && Array.isArray(x.scenes);
}

type TabId = 'structured' | 'script';

function SceneNarrativeEditor(props: {
  rowKey: string;
  sourceText: string;
  disabled: boolean;
  onCommit: (key: string, text: string) => void;
}) {
  const { rowKey, sourceText, disabled, onCommit } = props;
  const [local, setLocal] = useState(sourceText);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(sourceText);
  }, [sourceText, rowKey]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const flush = useCallback(() => {
    onCommit(rowKey, local);
  }, [local, onCommit, rowKey]);

  return (
    <textarea
      className="writing-paper__edit"
      value={local}
      disabled={disabled}
      spellCheck={false}
      rows={10}
      aria-label="本场剧本文字（可编辑）"
      onChange={(e) => {
        const value = e.target.value;
        setLocal(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onCommit(rowKey, value), 480);
      }}
      onBlur={() => flush()}
    />
  );
}

export function WritingDetailWorkspace(props: {
  nodeId: string;
  node: StudioNodeData;
}) {
  const { nodeId, node } = props;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('structured');
  const [compareMode, setCompareMode] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const nodes = useStudioStore((s) => s.nodes);
  const edges = useStudioStore((s) => s.edges);
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const submitLeaderReviewFeedback = useStudioStore((s) => s.submitLeaderReviewFeedback);
  const manualPassLeaderReview = useStudioStore((s) => s.manualPassLeaderReview);
  const retryPipeline = useStudioStore((s) => s.retryPipeline);

  const out = node.output && isWritingOutput(node.output) ? node.output : null;
  const sections = useMemo(() => (out ? buildWritingScriptSections(out) : []), [out]);

  const textNodeNovel = useMemo(
    () => mergedTextNodeSourcesForDepartment(nodeId, nodes, edges),
    [nodeId, nodes, edges],
  );

  const novelPaneText = textNodeNovel?.trim() ? textNodeNovel : node.input ?? '';
  const novelPaneHint = textNodeNovel?.trim()
    ? '文本卡片原文（由 Input 端口连线合并）'
    : '未检测到文本卡片连线：这里展示当前任务素材；你也可以补连文本卡片后再对比。';

  const previewLocked = node.status === 'IN_PROGRESS' || node.status === 'NOT_STARTED';
  const canReview = node.status === 'WAITING_REVIEW';
  const canRetry = node.status === 'REJECTED';

  const commitNarrativeDraft = useCallback(
    (key: string, text: string) => {
      if (!out) return;
      const row = out.scenes.find((scene) => sceneRowKey(scene) === key);
      if (!row) return;
      const canon = [row.coreConflict, row.beat].filter(Boolean).join('\n').trim();
      const trimmed = text.trim();
      const clearDraft = trimmed === '' || trimmed === canon;
      const nextScenes: SceneRow[] = out.scenes.map((scene) => {
        if (sceneRowKey(scene) !== key) return scene;
        if (clearDraft) {
          const { narrativeDraft: _draft, ...rest } = scene;
          return rest as SceneRow;
        }
        return { ...scene, narrativeDraft: text };
      });
      patchNodeData(nodeId, { output: { ...out, scenes: nextScenes } }, true);
    },
    [nodeId, out, patchNodeData],
  );

  const toggleCompare = useCallback(() => {
    setCompareMode((mode) => {
      const next = !mode;
      if (next && out) setTab('script');
      return next;
    });
  }, [out]);

  useEffect(() => {
    if (!out && compareMode) setCompareMode(false);
  }, [out, compareMode]);

  const handleDownloadDocx = useCallback(async () => {
    if (!out) return;
    setDocxBusy(true);
    try {
      const { exportWritingJsonToStandardDocx } = await import(
        '@/services/writingStandardDocxExport'
      );
      await exportWritingJsonToStandardDocx(out, {
        workTitle: node.label,
        template: resolveWritingExportTemplate(node.mounted_skills ?? []),
        includeStoryboardNotes: false,
      });
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : 'Docx 导出失败');
    } finally {
      setDocxBusy(false);
    }
  }, [node.label, node.mounted_skills, out]);

  return (
    <div className="writing-workspace writing-workspace--external-scroll">
      <ReviewFeedbackDialog
        open={reviewOpen}
        initialValue={node.ai_review_feedback?.trim() ?? ''}
        onClose={() => setReviewOpen(false)}
        onSubmit={(feedback) => submitLeaderReviewFeedback(nodeId, feedback)}
      />

      <div className="writing-workspace__chrome">
        <div className="writing-workspace__tabs-row">
          <div className="writing-workspace__tabs" role="tablist" aria-label="编剧详情标签">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'structured'}
              className={`writing-workspace__tab ${tab === 'structured' ? 'writing-workspace__tab--active' : ''}`}
              onClick={() => setTab('structured')}
            >
              结构化数据
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'script'}
              className={`writing-workspace__tab ${tab === 'script' ? 'writing-workspace__tab--active' : ''}`}
              onClick={() => setTab('script')}
              disabled={!out}
              title={!out ? '生成结构化场次后可用' : undefined}
            >
              剧本预览
            </button>
          </div>

          <button
            type="button"
            className={`writing-workspace__compare-toggle${compareMode ? ' writing-workspace__compare-toggle--on' : ''}`}
            disabled={!out}
            aria-pressed={compareMode}
            title={!out ? '生成结构化场次后可用' : '左：文本卡片原文 · 右：改编草案'}
            onClick={toggleCompare}
          >
            对比模式
          </button>

          <button
            type="button"
            className="writing-workspace__docx-btn"
            disabled={!out || docxBusy}
            title={
              !out
                ? '请先生成结构化场次'
                : '标准剧本 Word：场次标题加粗、角色居中、对白缩进（docx + file-saver）'
            }
            onClick={() => void handleDownloadDocx()}
          >
            {docxBusy ? '导出中…' : '下载 Docx'}
          </button>
        </div>

        {(canReview || canRetry) && (
          <div className={`writing-workspace__actions${canReview ? ' writing-workspace__actions--review' : ''}`}>
            {canReview ? (
              <>
                <button
                  type="button"
                  className="writing-workspace__primary"
                  onClick={() => setReviewOpen(true)}
                >
                  填写审核意见
                </button>
                <button
                  type="button"
                  className="writing-workspace__secondary"
                  onClick={() => manualPassLeaderReview(nodeId)}
                >
                  手动通过
                </button>
              </>
            ) : null}
            {canRetry ? (
              <button
                type="button"
                className="writing-workspace__secondary"
                onClick={() => retryPipeline(nodeId)}
              >
                根据意见重新生成
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div
        className={`writing-workspace__scroll${tab === 'script' && compareMode && out ? ' writing-workspace__scroll--compare-host' : ''}`}
      >
        {tab === 'structured' ? (
          <div className="writing-workspace__panel">
            <div className="detail-panel__hint">小说 / IP 素材</div>
            <pre className="detail-panel__script detail-panel__script--source writing-workspace__source">
              {node.input?.trim() ? node.input : '（暂时没有素材，可在聊天里用 @编剧部[正文] 传入）'}
            </pre>

            {out ? (
              <>
                <div className="detail-panel__hint" style={{ marginTop: 14 }}>
                  员工 AI · 文字剧本（结构化摘要）
                </div>
                <pre className="detail-panel__script writing-workspace__mono">
                  {formatWritingDataDump(out)}
                </pre>
                <div className="detail-panel__hint" style={{ marginTop: 14 }}>
                  结构化输出（JSON）
                </div>
                <pre className="detail-panel__script detail-panel__script--json writing-workspace__mono">
                  {writingOutputToJson(out)}
                </pre>
              </>
            ) : (
              <div className="writing-workspace__empty">
                <p className="detail-panel__tip">
                  {node.status === 'IN_PROGRESS'
                    ? '正在生成分集大纲与场次表…'
                    : '尚无结构化结果：点击「执行生成」或侧栏创建编剧节点。'}
                </p>
              </div>
            )}

            {canReview && (
              <p className="detail-panel__tip" style={{ marginTop: 12 }}>
                节点进入“待审核”后，请先填写审核意见；进入“已审核”后，再使用详情顶部的“执行优化迭代 / 维持现状通过”。
              </p>
            )}
          </div>
        ) : (
          <div
            className={`writing-workspace__panel writing-workspace__panel--paper${compareMode && out ? ' writing-workspace__panel--split' : ''}`}
          >
            {compareMode && out ? (
              <div className="writing-workspace__compare" role="region" aria-label="改编对比">
                <div className="writing-workspace__compare-col writing-workspace__compare-col--source">
                  <div className="detail-panel__hint writing-workspace__compare-hint">{novelPaneHint}</div>
                  <pre className="writing-workspace__compare-pre">{novelPaneText.trim() || '（无文本）'}</pre>
                </div>
                <div className="writing-workspace__compare-divider" aria-hidden />
                <div className="writing-workspace__compare-col writing-workspace__compare-col--draft">
                  {sections.length > 0 ? (
                    <div className="writing-paper-a4-frame writing-paper-a4-frame--compare">
                      <article
                        className="writing-paper writing-paper--a4 writing-paper--in-compare"
                        aria-label="AI 改编草案"
                      >
                        {out.plannedEpisodeCount != null && (
                          <header className="writing-paper__meta">
                            全剧共{out.plannedEpisodeCount}集 · 场次 {sections.length}
                          </header>
                        )}
                        {sections.map((sec) => {
                          const row = out.scenes.find((scene) => sceneRowKey(scene) === sec.rowKey);
                          const hi = row ? extractSceneLeaderHighlights(row) : { conflict: '—', hook: '—' };
                          const sourceText = row
                            ? sceneNarrativeSource(row)
                            : sec.blocks.map((block) => block.text).join('\n');

                          return (
                            <section
                              key={`${sec.episodeNo ?? 0}-${sec.sceneNo}-${sec.globalSceneIndex}`}
                              className="writing-paper__scene"
                            >
                              {sec.isNewEpisode && sec.episodeTitle ? (
                                <h2 className="writing-paper__episode">{sec.episodeTitle}</h2>
                              ) : null}
                              <h3 className="writing-paper__scene-title">
                                第{sec.globalSceneIndex}场　{sec.title}　{sec.inOut}　{sec.dayNight}
                              </h3>
                              <div className="writing-paper__leader" aria-label="Leader 审核要点">
                                <div className="writing-paper__leader-row">
                                  <span className="writing-paper__leader-k">冲突点</span>
                                  <span className="writing-paper__leader-v">{hi.conflict}</span>
                                </div>
                                <div className="writing-paper__leader-row">
                                  <span className="writing-paper__leader-k">钩子</span>
                                  <span className="writing-paper__leader-v">{hi.hook}</span>
                                </div>
                              </div>
                              {sec.charactersLine ? (
                                <p className="writing-paper__characters">{sec.charactersLine}</p>
                              ) : null}
                              <SceneNarrativeEditor
                                rowKey={sec.rowKey}
                                sourceText={sourceText}
                                disabled={previewLocked}
                                onCommit={commitNarrativeDraft}
                              />
                            </section>
                          );
                        })}
                      </article>
                    </div>
                  ) : (
                    <p className="detail-panel__tip writing-paper writing-paper--placeholder">暂无场次数据。</p>
                  )}
                </div>
              </div>
            ) : out && sections.length > 0 ? (
              <div className="writing-paper-a4-host">
                <p className="writing-paper-a4-host__label">A4 剧本预览</p>
                <div className="writing-paper-a4-frame">
                  <article className="writing-paper writing-paper--a4" aria-label="剧本预览">
                    {out.plannedEpisodeCount != null && (
                      <header className="writing-paper__meta">
                        全剧共{out.plannedEpisodeCount}集 · 场次 {sections.length}
                      </header>
                    )}
                    {sections.map((sec) => {
                      const row = out.scenes.find((scene) => sceneRowKey(scene) === sec.rowKey);
                      const hi = row ? extractSceneLeaderHighlights(row) : { conflict: '—', hook: '—' };
                      const sourceText = row
                        ? sceneNarrativeSource(row)
                        : sec.blocks.map((block) => block.text).join('\n');

                      return (
                        <section
                          key={`${sec.episodeNo ?? 0}-${sec.sceneNo}-${sec.globalSceneIndex}`}
                          className="writing-paper__scene"
                        >
                          {sec.isNewEpisode && sec.episodeTitle ? (
                            <h2 className="writing-paper__episode">{sec.episodeTitle}</h2>
                          ) : null}
                          <h3 className="writing-paper__scene-title">
                            第{sec.globalSceneIndex}场　{sec.title}　{sec.inOut}　{sec.dayNight}
                          </h3>
                          <div className="writing-paper__leader" aria-label="Leader 审核要点">
                            <div className="writing-paper__leader-row">
                              <span className="writing-paper__leader-k">冲突点</span>
                              <span className="writing-paper__leader-v">{hi.conflict}</span>
                            </div>
                            <div className="writing-paper__leader-row">
                              <span className="writing-paper__leader-k">钩子</span>
                              <span className="writing-paper__leader-v">{hi.hook}</span>
                            </div>
                          </div>
                          {sec.charactersLine ? (
                            <p className="writing-paper__characters">{sec.charactersLine}</p>
                          ) : null}
                          <SceneNarrativeEditor
                            rowKey={sec.rowKey}
                            sourceText={sourceText}
                            disabled={previewLocked}
                            onCommit={commitNarrativeDraft}
                          />
                        </section>
                      );
                    })}
                  </article>
                </div>
              </div>
            ) : (
              <p className="detail-panel__tip writing-paper writing-paper--placeholder">
                暂无场次数据，请先在「结构化数据」中完成生成。
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
