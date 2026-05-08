import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import {
  downloadStoryboardShotlistCsvIntl,
  downloadStoryboardShotlistExcelCsv,
} from '@/components/detailPanel/storyboardShotlistExport';
import {
  DetailPanelHeaderActionsBar,
  type DetailPanelHeaderActionItem,
} from '@/components/detailPanel/DetailPanelHeaderActionsBar';
import { PromptOutputPanel } from '@/components/detailPanel/PromptOutputPanel';
import { SkillExportExtensionHeaderButtons } from '@/components/detailPanel/SkillExportExtensionHeaderButtons';
import { ShotListReviewDecisionBar } from '@/components/detailPanel/ShotListReviewDecisionBar';
import { StoryboardShotListTable } from '@/components/detailPanel/StoryboardShotListTable';
import { StoryboardShotlistDownload } from '@/components/detailPanel/StoryboardShotlistDownload';
import { PipelineReviewDecisionPanel } from '@/components/detailPanel/PipelineReviewDecisionPanel';
import { NodeDetailPanelLayout } from '@/components/NodeDetailPanelLayout';
import { formatWritingDataDump } from '@/components/writing/writingScriptPreview';
import { SkillSlotSection } from '@/components/SkillSlotSection';
import { ReviewFeedbackDialog } from '@/components/ReviewFeedbackDialog';
import { WritingDetailWorkspace } from '@/components/writing/WritingDetailWorkspace';
import { WritingHeaderActions } from '@/components/writing/WritingHeaderActions';
import { useStudioStore } from '@/store/useStudioStore';
import type {
  PromptOutput,
  SceneRow,
  StoryboardOutput,
  StudioNodeData,
  WritingOutput,
} from '@/types/studio';
import { SHOT_LIST_LINK_HANDLE_ID } from '@/utils/shotListWire';
import { collectMountedSkillExportExtensions } from '@/services/skillExportExtensions';
import { departmentNodeHasInputWire } from '@/utils/departmentInputWire';
import { formatPrompt, formatSeedanceCards } from '@/utils/promptFormat';

function isWritingOutput(o: unknown): o is WritingOutput {
  if (!o || typeof o !== 'object') return false;
  const x = o as WritingOutput;
  if (!Array.isArray(x.episodes) || !Array.isArray(x.scenes)) return false;
  return x.scenes.every(
    (s) =>
      s &&
      typeof s === 'object' &&
      typeof (s as SceneRow).sceneNo === 'number' &&
      typeof (s as SceneRow).title === 'string',
  );
}

function isPromptOutput(o: unknown): o is PromptOutput {
  if (!o || typeof o !== 'object') return false;
  const x = o as PromptOutput;
  return (
    typeof x.system === 'string' &&
    typeof x.userTemplate === 'string' &&
    x.parameters != null &&
    typeof x.parameters === 'object'
  );
}

function formatStoryboard(o: StoryboardOutput): string {
  const lines = o.shots.map((s) => {
    const act = typeof s.action === 'string' && s.action.trim() !== '' ? s.action : '';
    const dlg = typeof s.content === 'string' ? s.content : '';
    const dlgLine = dlg !== '' ? `\n台词：${dlg}` : '';
    return `#${s.id} [${s.type}] 运镜：${s.movement}\n动作：${act || '—'}\n${s.description}${dlgLine}${s.sceneRef ? `  (${s.sceneRef})` : ''}`;
  });
  return [...o.narrativeBeats.map((b) => `· ${b}`), '', ...lines].join('\n');
}

/** 分镜 input 为旧版编剧资产 JSON 时的一行提示（不再全文展示上游内容） */
function storyboardLegacyJsonHint(input: string): string | null {
  const raw = input?.trim() ?? '';
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j.source === 'APPROVED_WRITING_ASSET') {
      return '当前 input 为旧版编剧资产 JSON：请清空后粘贴纯文本剧本。';
    }
  } catch {
    /* 纯文本 */
  }
  return null;
}

function parseStoryboardInputText(raw: string): StoryboardOutput | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    return tryParseStoryboardOutput(JSON.parse(text));
  } catch {
    return null;
  }
}

function safeScript(node: {
  type: string;
  output: unknown;
  input: string;
}): string {
  if (node.type === 'writing' && node.output && isWritingOutput(node.output)) {
    try {
      return formatWritingDataDump(node.output);
    } catch {
      return '（剧本数据格式异常）';
    }
  }
  if (node.type === 'storyboard' && node.output) {
    const sb = tryParseStoryboardOutput(node.output);
    if (sb) {
      try {
        return formatStoryboard(sb);
      } catch {
        return '（分镜数据格式异常）';
      }
    }
  }
  if (node.type === 'prompt' && node.output && isPromptOutput(node.output)) {
    try {
      return formatPrompt(node.output);
    } catch {
      return '（Prompt 数据格式异常）';
    }
  }
  return node.input || '（暂无内容）';
}

export function DetailPanel() {
  const [reviewDialogState, setReviewDialogState] = useState<{ nodeId: string; initialValue: string } | null>(null);
  const detailOpen = useStudioStore((s) => s.detailOpen);
  const selectedId = useStudioStore((s) => s.selectedNodeId);
  const edges = useStudioStore((s) => s.edges);
  const rfNodes = useStudioStore((s) => s.nodes);
  const node = useStudioStore((s) => s.nodes.find((n) => n.id === selectedId)?.data);
  const setDetailOpen = useStudioStore((s) => s.setDetailOpen);
  const removeNodesByIds = useStudioStore((s) => s.removeNodesByIds);
  const submitLeaderReviewFeedback = useStudioStore((s) => s.submitLeaderReviewFeedback);
  const manualPassLeaderReview = useStudioStore((s) => s.manualPassLeaderReview);
  const retryPipeline = useStudioStore((s) => s.retryPipeline);
  const regenerateNode = useStudioStore((s) => s.regenerateNode);
  const patchNodeData = useStudioStore((s) => s.patchNodeData);
  const syncDepartmentInputFromGraph = useStudioStore((s) => s.syncDepartmentInputFromGraph);
  const executeNodeTask = useStudioStore((s) => s.executeNodeTask);
  const runTextPolish = useStudioStore((s) => s.runTextPolish);
  const stopNodeTask = useStudioStore((s) => s.stopNodeTask);
  const pushMessage = useStudioStore((s) => s.pushMessage);
  const focusNode = useStudioStore((s) => s.focusNode);
  const patchShotListNodeOutput = useStudioStore((s) => s.patchShotListNodeOutput);

  const patchDepartmentOrShotList = useCallback(
    (nid: string, patch: Partial<StudioNodeData>, bump?: boolean) => {
      const row = useStudioStore.getState().nodes.find((x) => x.id === nid)?.data;
      if (row?.type === 'shot_list_node' && patch.output != null) {
        const o = tryParseStoryboardOutput(patch.output);
        if (o) {
          patchShotListNodeOutput(nid, o, bump !== false);
          return;
        }
      }
      patchNodeData(nid, patch, bump);
    },
    [patchNodeData, patchShotListNodeOutput],
  );

  const textFileInputRef = useRef<HTMLInputElement>(null);

  const onTextFilePicked = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !selectedId) return;
      const id = selectedId;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        patchNodeData(id, { raw_text: text, input: text }, false);
        pushMessage({
          role: 'system',
          text: `已从「${file.name}」导入文本（${text.length} 字）。`,
          nodeId: id,
        });
      };
      reader.onerror = () => window.alert('读取文件失败');
      reader.readAsText(file, 'UTF-8');
    },
    [patchNodeData, pushMessage, selectedId],
  );

  const onTextChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const id = useStudioStore.getState().selectedNodeId;
      if (!id) return;
      const v = e.target.value;
      const d = useStudioStore.getState().nodes.find((n) => n.id === id)?.data;
      if (d?.type === 'text_node') {
        patchNodeData(id, { raw_text: v, input: v }, false);
      } else {
        /** 手动覆盖：用户粘贴/编辑后优先使用面板内容，不随端口连线覆盖 */
        patchNodeData(id, { input: v, inputSource: 'manual' }, false);
      }
    },
    [patchNodeData],
  );

  const detailPanelRootRef = useRef<HTMLElement | null>(null);
  const layoutBodyRef = useRef<HTMLDivElement>(null);

  const scrollDetailContentToBottom = useCallback(() => {
    const run = () => {
      const layoutBody = layoutBodyRef.current;
      if (layoutBody) layoutBody.scrollTop = layoutBody.scrollHeight;
    };
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
  }, []);

  useLayoutEffect(() => {
    if (!detailOpen || !node) return;
    if (node.status !== 'IN_PROGRESS') return;
    scrollDetailContentToBottom();
    const t = window.setTimeout(scrollDetailContentToBottom, 80);
    return () => window.clearTimeout(t);
  }, [
    detailOpen,
    node?.generation_phase,
    node?.id,
    node?.output,
    node?.status,
    node?.streaming_preview,
    scrollDetailContentToBottom,
  ]);

  const headerActionItems = useMemo((): DetailPanelHeaderActionItem[] => {
    if (!node) return [];
    const isPipe =
      node.type === 'writing' || node.type === 'storyboard' || node.type === 'prompt';
    const hasStoredInput = Boolean(node.input?.trim());
    const hasInputWire =
      isPipe && selectedId ? departmentNodeHasInputWire(selectedId, edges, rfNodes) : true;
    const hasRunnableInput = hasStoredInput || hasInputWire;
    const canFreshExecute = isPipe && node.status === 'NOT_STARTED';
    const canRegenerate =
      isPipe &&
      node.status !== 'IN_PROGRESS' &&
      (node.status === 'REJECTED' ||
        node.status === 'WAITING_REVIEW' ||
        node.status === 'REVIEWED' ||
        node.status === 'APPROVED');
    const executeDisabled = !(canFreshExecute || canRegenerate) || !hasRunnableInput;
    const executeLabel = canFreshExecute ? '执行' : '重新生成';
    const executeTitle = !hasRunnableInput
      ? node.type === 'storyboard'
        ? '请先连接输入源或填写剧本正文'
        : '请先连接输入源'
      : canFreshExecute
        ? '执行任务'
        : '按当前输入重新生成并覆盖当前结果';
    const items: DetailPanelHeaderActionItem[] = [];
    if (isPipe && node.type !== 'storyboard') {
      items.push({
        id: 'execute',
        label: executeLabel,
        node: (
          <button
            type="button"
            className="node-detail-layout__btn-execute node-detail-action-btn"
            disabled={executeDisabled}
            title={executeTitle}
            onClick={() => {
              if (canFreshExecute) {
                void executeNodeTask(node.id);
                return;
              }
              regenerateNode(node.id);
            }}
          >
            <svg className="node-detail-layout__btn-execute-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <path fill="currentColor" d="M8 5v14l11-7z" />
            </svg>
            <span className="node-detail-layout__btn-execute-label">{executeLabel}</span>
          </button>
        ),
      });
    }
    if (node.type === 'writing') {
      items.push({
        id: 'writing-download',
        label: '下载',
        node: <WritingHeaderActions node={node} />,
      });
    }
    if (node.type === 'storyboard' && node.output != null) {
      const sbDl = tryParseStoryboardOutput(node.output);
      if (sbDl !== null) {
        items.push({
          id: 'storyboard-shooting-list-export',
          label: '导出拍摄清单',
          node: (
            <StoryboardShotlistDownload
              nodeId={node.id}
              baseLabel={node.label}
              exportDisabled={sbDl.shots.length === 0}
              onNotify={(text) => pushMessage({ role: 'system', text, nodeId: node.id })}
            />
          ),
        });
      }
    }
    if (node.type === 'prompt') {
      const canPromptAct = Boolean(node.output && isPromptOutput(node.output));
      const promptSourceStoryboard = parseStoryboardInputText(node.input ?? '');
      items.push(
        {
          id: 'prompt-copy-all',
          label: '拷贝全部提示词',
          node: (
            <button
              type="button"
              className="writing-header-actions__download node-detail-action-btn"
              disabled={!canPromptAct}
              title={canPromptAct ? '复制完整 Prompt 包文本' : '请先生成 Prompt 输出'}
              onClick={() => {
                if (!node.output || !isPromptOutput(node.output)) return;
                const text = formatPrompt(node.output);
                void navigator.clipboard.writeText(text).then(
                  () => {
                    pushMessage({
                      role: 'system',
                      text: '已复制全部提示词到剪贴板。',
                      nodeId: node.id,
                    });
                  },
                  () => window.alert('复制失败：请检查浏览器权限'),
                );
              }}
            >
              拷贝全部提示词
            </button>
          ),
        },
        {
          id: 'prompt-copy-seedance-cards',
          label: '复制 Seedance 卡片',
          node: (
            <button
              type="button"
              className="writing-header-actions__download node-detail-action-btn"
              disabled={!canPromptAct}
              title={
                canPromptAct
                  ? '复制按镜头整理好的 Seedance 卡片文本'
                  : '请先生成 Prompt 输出'
              }
              onClick={() => {
                if (!node.output || !isPromptOutput(node.output) || !node.output.shotPrompts?.length) return;
                const text = formatSeedanceCards(node.output.shotPrompts, promptSourceStoryboard);
                void navigator.clipboard.writeText(text).then(
                  () => {
                    pushMessage({
                      role: 'system',
                      text: '已复制全部 Seedance 卡片到剪贴板。',
                      nodeId: node.id,
                    });
                  },
                  () => window.alert('复制失败：请检查浏览器权限'),
                );
              }}
            >
              复制 Seedance 卡片
            </button>
          ),
        },
        {
          id: 'prompt-sync-video',
          label: '同步至视频生成引擎',
          node: (
            <button
              type="button"
              className="writing-header-actions__download node-detail-action-btn"
              disabled={!canPromptAct}
              title={
                canPromptAct
                  ? '将结构化 Prompt 推送给外部引擎（事件 + sessionStorage）'
                  : '请先生成 Prompt 输出'
              }
              onClick={() => {
                if (!node.output || !isPromptOutput(node.output)) return;
                const po = node.output;
                const promptText = formatPrompt(po);
                const payload = {
                  nodeId: node.id,
                  at: Date.now(),
                  promptText,
                  structured: po,
                };
                try {
                  sessionStorage.setItem('studio:videoEnginePrompt', JSON.stringify(payload));
                } catch {
                  /* 隐私模式等 */
                }
                window.dispatchEvent(
                  new CustomEvent('studio:sync-prompt-to-video-engine', { detail: payload }),
                );
                pushMessage({
                  role: 'system',
                  text: '已同步至视频生成引擎（CustomEvent「studio:sync-prompt-to-video-engine」+ sessionStorage「studio:videoEnginePrompt」）。',
                  nodeId: node.id,
                });
              }}
            >
              同步至视频生成引擎
            </button>
          ),
        },
      );
    }
    if (node.type === 'writing' || node.type === 'storyboard' || node.type === 'prompt') {
      const skillExports = collectMountedSkillExportExtensions(node.mounted_skills ?? [], node.type);
      if (skillExports.length) {
        items.push({
          id: 'skill-export-extensions',
          label: '技能导出',
          node: (
            <SkillExportExtensionHeaderButtons
              node={node}
              items={skillExports}
              pushMessage={pushMessage}
            />
          ),
        });
      }
    }
    if (node.type === 'text_node') {
      const textBusy = node.status === 'IN_PROGRESS';
      const hasText = Boolean((node.raw_text ?? node.input ?? '').trim());
      items.push(
        {
          id: 'text-polish',
          label: textBusy ? '停止润色' : 'LLM 润色',
          node: (
            <button
              type="button"
              className="writing-header-actions__download node-detail-action-btn"
              disabled={!textBusy && !hasText}
              title={textBusy ? '停止当前润色任务' : '调用 LLM 润色当前文本'}
              onClick={() => {
                if (textBusy) {
                  stopNodeTask(node.id);
                  return;
                }
                void runTextPolish(node.id);
              }}
            >
              {textBusy ? '停止润色' : 'LLM 润色'}
            </button>
          ),
        },
        {
          id: 'text-clear',
          label: '清空内容',
          node: (
            <button
              type="button"
              className="writing-header-actions__download node-detail-action-btn"
              onClick={() => {
                if (!window.confirm('确定清空正文？')) return;
                patchNodeData(node.id, { raw_text: '', input: '' }, false);
              }}
            >
              清空内容
            </button>
          ),
        },
        {
          id: 'text-import',
          label: '从文件导入',
          node: (
            <>
              <input
                ref={textFileInputRef}
                type="file"
                className="node-detail-file-input-hidden"
                accept=".txt,text/plain"
                aria-hidden
                tabIndex={-1}
                onChange={onTextFilePicked}
              />
              <button
                type="button"
                className="writing-header-actions__download node-detail-action-btn"
                onClick={() => textFileInputRef.current?.click()}
              >
                从文件导入
              </button>
            </>
          ),
        },
      );
    }
    if (node.type === 'shot_list_node') {
      const sl = node.output ? tryParseStoryboardOutput(node.output) : null;
      if (sl?.shots?.length) {
        items.push({
          id: 'shot-list-shooting-export',
          label: '导出拍摄清单',
          node: (
            <StoryboardShotlistDownload
              nodeId={node.id}
              baseLabel={node.label}
              exportDisabled={false}
              onNotify={(text) => pushMessage({ role: 'system', text, nodeId: node.id })}
            />
          ),
        });
      }
    }
    items.push({
      id: 'delete-node',
      label: '删除节点',
      node: (
        <button
          type="button"
          className="node-detail-layout__btn-delete node-detail-action-btn"
          title="从画布删除此节点"
          onClick={() => {
            if (!window.confirm(`确定删除节点「${node.label}」？此操作不可撤销。`)) return;
            removeNodesByIds([node.id]);
            setDetailOpen(false);
          }}
        >
          <svg className="node-detail-layout__btn-delete-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="currentColor"
              d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2zM9 10v9h2v-9H9zm4 0v9h2v-9h-2z"
            />
          </svg>
          <span className="node-detail-layout__btn-delete-label">删除</span>
        </button>
      ),
    });
    return items;
  }, [
    edges,
    executeNodeTask,
    regenerateNode,
    node,
    onTextFilePicked,
    patchNodeData,
    pushMessage,
    removeNodesByIds,
    rfNodes,
    runTextPolish,
    selectedId,
    setDetailOpen,
    stopNodeTask,
  ]);

  const headerActions =
    !node || headerActionItems.length === 0 ? null : (
      <DetailPanelHeaderActionsBar
        items={headerActionItems}
        pinnedCount={
          node.type === 'writing' ||
          node.type === 'storyboard' ||
          node.type === 'prompt' ||
          node.type === 'shot_list_node'
            ? 1
            : 0
        }
      />
    );

  if (!detailOpen || !node) return null;

  const storyboardShotListChildId =
    node.type === 'storyboard' && selectedId
      ? edges.find((e) => e.source === selectedId && e.sourceHandle === SHOT_LIST_LINK_HANDLE_ID)
          ?.target ?? null
      : null;
  const hasShotListChild = Boolean(storyboardShotListChildId);

  const shotListShotParsed =
    node.type === 'shot_list_node' && node.output ? tryParseStoryboardOutput(node.output) : null;

  const storyboardParsed =
    node.type === 'storyboard' && node.output ? tryParseStoryboardOutput(node.output) : null;

  const storyboardLegacyHint =
    node.type === 'storyboard' ? storyboardLegacyJsonHint(node.input ?? '') : null;

  const script =
    node.type === 'writing' || node.type === 'storyboard' || node.type === 'text_node'
      ? ''
      : safeScript(node);

  const leaderFeedbackLabel =
    node.type === 'writing'
      ? '编剧总监 反馈'
      : node.type === 'storyboard'
        ? '分镜总监 反馈'
        : node.type === 'prompt'
          ? 'Prompt总监 反馈'
          : '总监 反馈';

  const supportsReview = node.type === 'writing' || node.type === 'storyboard';

  const canReviewLegacy =
    supportsReview &&
    node.status === 'WAITING_REVIEW';

  const showReviewedDecision =
    supportsReview &&
    node.status === 'REVIEWED';

  const canRetry =
    (node.type === 'writing' || node.type === 'storyboard' || node.type === 'prompt') &&
    node.status === 'REJECTED';
  const displayStatus =
    node.type === 'prompt' && (node.status === 'WAITING_REVIEW' || node.status === 'REVIEWED')
      ? 'APPROVED'
      : node.status;

  const pipelineKind =
    node.type === 'writing' || node.type === 'storyboard' || node.type === 'prompt';
  const showSkillSlot = pipelineKind && selectedId;
  const showStreamingBlock =
    pipelineKind &&
    node.status === 'IN_PROGRESS' &&
    (Boolean(node.streaming_preview?.trim()) || node.generation_phase != null);

  const streamingSection = showStreamingBlock ? (
    <div className="detail-panel__section">
      <div className="detail-panel__hint">
        {node.generation_phase === 'leader' ? '总监大脑 · 审核/流式' : '员工大脑 · 流式预览'}
      </div>
      <pre className="detail-panel__script detail-panel__script--streaming">
        {node.streaming_preview?.trim()
          ? node.streaming_preview
          : node.generation_phase === 'leader'
            ? '（正在连接总监审核 API…）'
            : '…'}
      </pre>
    </div>
  ) : null;

  const generationErrorSection =
    pipelineKind && node.generation_error?.trim() ? (
      <div className="detail-panel__section detail-panel__section--generation-error">
        <div className="detail-panel__hint">生成未成功</div>
        <p className="detail-panel__feedback detail-panel__feedback--generation">{node.generation_error.trim()}</p>
      </div>
    ) : null;

  const shotListParentStoryboard =
    node.type === 'shot_list_node' && node.sourceStoryboardNodeId
      ? rfNodes.find(
          (n) =>
            n.id === node.sourceStoryboardNodeId &&
            n.type === 'department' &&
            n.data.type === 'storyboard',
        )?.data ?? null
      : null;

  const shotListBody =
    node.type === 'shot_list_node' ? (
      <>
        <div className="detail-panel__section detail-panel__section--shotlist-intro">
          <div className="detail-panel__hint">交互式分镜工作台</div>
          <p className="detail-panel__tip detail-panel__tip--tight">
            父分镜：<code>{node.sourceStoryboardNodeId ?? '—'}</code>
            。            定稿镜头请从本节点右侧 Output 连到 Prompt 部 Input；与下方导出同源，均为手改后的最新{' '}
            <code>output</code>。
          </p>
        </div>
        {shotListShotParsed?.shots?.length ? (
          <div className="detail-panel__section detail-panel__section--shotlist-export">
            <div className="detail-panel__hint">导出定稿资产</div>
            <p className="detail-panel__tip detail-panel__tip--tight">
              自 store 实时读取当前节点数据，与表格及 Prompt 合并输入一致（合并镜头、删除行、单元格编辑均已反映）。
            </p>
            <div className="detail-panel__shotlist-export-actions">
              <button
                type="button"
                className="detail-panel__primary"
                onClick={() => {
                  const row = useStudioStore.getState().nodes.find((n) => n.id === node.id)?.data;
                  const parsed = row?.output ? tryParseStoryboardOutput(row.output) : null;
                  if (!parsed?.shots?.length) {
                    pushMessage({ role: 'system', text: '当前无镜头行可导出。', nodeId: node.id });
                    return;
                  }
                  downloadStoryboardShotlistExcelCsv(parsed, node.label);
                  pushMessage({
                    role: 'system',
                    text: '已下载 CSV（UTF-8 BOM · 中文表头，Excel 可直接打开）。',
                    nodeId: node.id,
                  });
                }}
              >
                导出 CSV（Excel）
              </button>
              <button
                type="button"
                className="detail-panel__secondary"
                onClick={() => {
                  const row = useStudioStore.getState().nodes.find((n) => n.id === node.id)?.data;
                  const parsed = row?.output ? tryParseStoryboardOutput(row.output) : null;
                  if (!parsed?.shots?.length) {
                    pushMessage({ role: 'system', text: '当前无镜头行可导出。', nodeId: node.id });
                    return;
                  }
                  downloadStoryboardShotlistCsvIntl(parsed, node.label);
                  pushMessage({
                    role: 'system',
                    text: '已下载 CSV（英文表头 · 工具链）。',
                    nodeId: node.id,
                  });
                }}
              >
                导出 CSV（英文表头）
              </button>
            </div>
          </div>
        ) : null}
        {shotListParentStoryboard && node.sourceStoryboardNodeId ? (
          <div className="detail-panel__section detail-panel__section--shotlist-review">
            <ShotListReviewDecisionBar
              parentNodeId={node.sourceStoryboardNodeId}
              parentNode={shotListParentStoryboard}
            />
          </div>
        ) : null}
        {shotListShotParsed ? (
          <div className="detail-panel__section detail-panel__section--table-preview detail-panel__section--shotlist-workbench">
            <div className="detail-panel__table-preview-frame detail-panel__table-preview-frame--workbench">
              <StoryboardShotListTable
                output={shotListShotParsed}
                preview
                workbench
                nodeId={node.id}
                patchNodeData={patchDepartmentOrShotList}
                editable
                storyboardAiSnapshot={node.storyboard_ai_snapshot ?? null}
              />
            </div>
          </div>
        ) : (
          <div className="detail-panel__section">
            <p className="detail-panel__tip">暂无镜头行：请在父分镜节点执行生成。</p>
          </div>
        )}
      </>
    ) : null;

  const writingBody =
    node.type === 'writing' ? (
      <div className="detail-panel__writing-body-column">
        <div className="detail-panel__writing-stack">
          <div className="detail-panel__writing-main">
            {showSkillSlot ? (
              <SkillSlotSection
                nodeId={node.id}
                kind={node.type}
                mounted={node.mounted_skills ?? []}
                patchNodeData={patchNodeData}
              />
            ) : null}
            {generationErrorSection}
            {streamingSection}
            {showReviewedDecision ? (
              <PipelineReviewDecisionPanel nodeId={node.id} node={node} />
            ) : null}
            <WritingDetailWorkspace nodeId={node.id} node={node} />
          </div>
        </div>
        {node.review_result ? (
          <div className="detail-panel__section detail-panel__section--leader-feedback">
            <div className="detail-panel__hint">{leaderFeedbackLabel}</div>
            <p className="detail-panel__feedback">{node.review_result}</p>
          </div>
        ) : null}
      </div>
    ) : null;

  const scrollBody = node.type !== 'writing' && node.type !== 'shot_list_node' && (
    <>
      {node.type === 'prompt' && selectedId ? (
        <SkillSlotSection
          nodeId={selectedId}
          kind={node.type}
          mounted={node.mounted_skills ?? []}
          patchNodeData={patchNodeData}
        />
      ) : null}
      {node.type !== 'storyboard' ? generationErrorSection : null}
      {node.type !== 'storyboard' ? streamingSection : null}
      {showReviewedDecision && node.type !== 'storyboard' ? (
        <PipelineReviewDecisionPanel nodeId={node.id} node={node} />
      ) : null}
      {node.type === 'text_node' ? (
        <div className="detail-panel__section">
          <div className="detail-panel__hint">文本卡片内容</div>
          <textarea
            className="detail-panel__text-editor"
            value={
              node.status === 'IN_PROGRESS'
                ? (node.streaming_preview ?? node.raw_text ?? node.input)
                : (node.raw_text ?? node.input)
            }
            onChange={onTextChange}
            placeholder="长文本素材；连线到部门节点后自动同步为对方 input"
            spellCheck={false}
            rows={16}
            disabled={node.status === 'IN_PROGRESS'}
          />
          <p className="detail-panel__tip">
            画布内可直接编辑；从本节点右侧 Output 连到编剧/分镜/Prompt 部门左侧 Input 即可同步为任务原始输入。
          </p>
        </div>
      ) : node.type === 'storyboard' ? (
        <>
          <div className="detail-panel__section detail-panel__section--storyboard-slim">
            <div className="detail-panel__hint">执行生成</div>
            <div className="detail-panel__actions">
              <button
                type="button"
                className="detail-panel__primary"
                disabled={
                  node.status === 'IN_PROGRESS' ||
                  (node.status !== 'NOT_STARTED' && node.status !== 'REJECTED') ||
                  (!Boolean(node.input?.trim()) &&
                    !(selectedId != null && departmentNodeHasInputWire(selectedId, edges, rfNodes)))
                }
                title={
                  node.status === 'IN_PROGRESS'
                    ? '生成中'
                    : !Boolean(node.input?.trim()) &&
                        !(selectedId != null && departmentNodeHasInputWire(selectedId, edges, rfNodes))
                      ? '请先连接文本卡片，或在下方填写剧本正文'
                      : '运行分镜员工与总监流水线'
                }
                onClick={() => void executeNodeTask(node.id)}
              >
                执行生成
              </button>
            </div>
            <p className="detail-panel__tip detail-panel__tip--tight">
              这里不重复展示上游文本卡片全文；请用左侧 Input 连线，或在下框手动粘贴剧本正文。
            </p>
            {storyboardLegacyHint ? (
              <p className="detail-panel__feedback" style={{ marginTop: 8 }}>
                {storyboardLegacyHint}
              </p>
            ) : null}
            <textarea
              className="detail-panel__text-editor detail-panel__text-editor--compact"
              value={node.input}
              onChange={onTextChange}
              placeholder="剧本正文（可选；与连线输入二选一或合并策略以当前节点为准）"
              spellCheck={false}
              rows={4}
              disabled={node.status === 'IN_PROGRESS' || node.status === 'WAITING_REVIEW'}
            />
            {node.inputSource === 'manual' && (
              <button
                type="button"
                className="detail-panel__secondary"
                style={{ marginTop: 8 }}
                onClick={() => selectedId && syncDepartmentInputFromGraph(selectedId)}
              >
                从连线同步
              </button>
            )}
          </div>
          {selectedId ? (
            <SkillSlotSection
              nodeId={selectedId}
              kind="storyboard"
              mounted={node.mounted_skills ?? []}
              patchNodeData={patchNodeData}
            />
          ) : null}
          {generationErrorSection}
          {streamingSection}
          {showReviewedDecision ? (
            <PipelineReviewDecisionPanel nodeId={node.id} node={node} />
          ) : null}
          {node.status === 'REJECTED' && node.review_result ? (
            <div
              className="detail-panel__section detail-panel__section--leader-card"
              role="region"
              aria-label="总监审核建议"
            >
              <div className="detail-panel__hint">审核意见</div>
              <p className="detail-panel__feedback">{node.review_result}</p>
            </div>
          ) : null}
          {storyboardParsed && !hasShotListChild ? (
            <div className="detail-panel__section detail-panel__section--table-preview">
              <div className="detail-panel__hint">镜头表（无子节点时在此编辑）</div>
              <p className="detail-panel__tip detail-panel__tip--tight">
                旧画布兼容：未生成「镜头表」子节点前可在此改表；新流程请用下方按钮跳转子节点。
                {node.status === 'IN_PROGRESS' ? '（生成中不可编辑）' : ''}
              </p>
              <div className="detail-panel__table-preview-frame">
                <StoryboardShotListTable
                  output={storyboardParsed}
                  preview
                  nodeId={node.id}
                  patchNodeData={patchNodeData}
                  editable={node.status !== 'IN_PROGRESS'}
                  storyboardAiSnapshot={node.storyboard_ai_snapshot ?? null}
                />
              </div>
            </div>
          ) : null}
          {canReviewLegacy ? (
            <div className="detail-panel__actions detail-panel__actions--review">
              <button
                type="button"
                className="detail-panel__primary"
                onClick={() => {
                  setReviewDialogState({
                    nodeId: node.id,
                    initialValue: node.ai_review_feedback?.trim() ?? '',
                  });
                }}
              >
                填写审核意见
              </button>
              <button
                type="button"
                className="detail-panel__secondary"
                onClick={() => manualPassLeaderReview(node.id)}
              >
                手动通过
              </button>
            </div>
          ) : null}
          <div className="detail-panel__section detail-panel__footer-nav">
            <button
              type="button"
              className="detail-panel__nav-shotlist"
              disabled={!storyboardShotListChildId}
              title={
                storyboardShotListChildId
                  ? '在画布上定位并打开镜头表子节点'
                  : '执行生成成功后将自动创建镜头表子节点'
              }
              onClick={() => {
                if (!storyboardShotListChildId) {
                  pushMessage({
                    role: 'system',
                    text: '暂无关联的镜头表子节点：请先成功执行生成。',
                    nodeId: node.id,
                  });
                  return;
                }
                focusNode(storyboardShotListChildId, { openDetail: true });
              }}
            >
              跳转至分镜清单
            </button>
          </div>
        </>
      ) : node.type === 'prompt' ? (
        <>
          <div className="detail-panel__section">
            <div className="detail-panel__hint">Input 原文（镜头表 / 任务描述）</div>
            <pre className="detail-panel__script detail-panel__script--source">
              {node.input?.trim()
                ? node.input
                : '（暂无输入：请从镜头表子节点右侧 Output 或文本卡片连到 Input）'}
            </pre>
          </div>
      {node.output_stale_reason?.trim() ? (
        <div className="detail-panel__section detail-panel__section--generation-error">
          <div className="detail-panel__hint">需要重新生成</div>
          <p className="detail-panel__feedback detail-panel__feedback--generation">
            {node.output_stale_reason.trim()}
          </p>
        </div>
      ) : null}
      <div className="detail-panel__section">
        <div className="detail-panel__hint">Output 结果（Prompt 包）</div>
        {node.output && isPromptOutput(node.output) ? (
              <PromptOutputPanel
                output={node.output}
                storyboardInput={parseStoryboardInputText(node.input ?? '')}
              />
            ) : (
              <p className="detail-panel__tip">
                {node.status === 'IN_PROGRESS'
                  ? '正在生成逐镜提示词…'
                  : '尚无输出：点击 Play 或「执行」后生成。'}
              </p>
            )}
          </div>
          {canReviewLegacy && (
            <div className="detail-panel__section">
              <div className="detail-panel__hint">Prompt 总监 · 二次终裁（旧画布）</div>
              <p className="detail-panel__tip">
                「待终裁」下可选二次审核或手动通过；「已阅」请用上方「执行优化迭代 / 维持现状通过」。
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="detail-panel__section">
          <div className="detail-panel__hint">AI 生成内容</div>
          <pre className="detail-panel__script">{script}</pre>
        </div>
      )}
      {node.review_result && node.type !== 'storyboard' && node.type !== 'prompt' ? (
        <div className="detail-panel__section">
          <div className="detail-panel__hint">{leaderFeedbackLabel}</div>
          <p className="detail-panel__feedback">{node.review_result}</p>
        </div>
      ) : null}
      {canReviewLegacy && node.type !== 'storyboard' && (
        <div className="detail-panel__actions detail-panel__actions--review">
          <button
            type="button"
            className="detail-panel__primary"
            onClick={() => {
                  setReviewDialogState({
                    nodeId: node.id,
                    initialValue: node.ai_review_feedback?.trim() ?? '',
                  });
                }}
          >
            填写审核意见
          </button>
          <button
            type="button"
            className="detail-panel__secondary"
            onClick={() => manualPassLeaderReview(node.id)}
          >
            手动通过（Manual Pass）
          </button>
          <p className="detail-panel__tip detail-panel__tip--full">
            仅「待终裁」旧态可用；也可在聊天输入 @Leader。新版「已阅」节点请用顶部决策区的双选按钮。
          </p>
        </div>
      )}
      {canRetry && (
        <div className="detail-panel__actions">
          <button type="button" className="detail-panel__secondary" onClick={() => retryPipeline(node.id)}>
            根据意见重新生成
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      <ReviewFeedbackDialog
        open={Boolean(reviewDialogState)}
        initialValue={reviewDialogState?.initialValue ?? ''}
        onClose={() => setReviewDialogState(null)}
        onSubmit={(feedback) => {
          if (!reviewDialogState) return;
          submitLeaderReviewFeedback(reviewDialogState.nodeId, feedback);
        }}
      />
      <aside
      ref={detailPanelRootRef}
      className={`detail-panel${
        node.type === 'writing' || node.type === 'shot_list_node' ? ' detail-panel--writing' : ''
      }`}
      aria-label="节点详情"
    >
      <NodeDetailPanelLayout
        kind={node.type}
        nodeLabel={node.label}
        nodeId={node.id}
        status={displayStatus}
        leaderFeedback={
          node.type === 'storyboard' || node.type === 'shot_list_node' || node.type === 'prompt'
            ? null
            : node.status === 'REVIEWED'
              ? (node.ai_review_feedback ?? null)
              : node.review_result
        }
        headerActions={headerActions}
        footerTokens={node.usageTokensTotal ?? null}
        footerUpdatedAt={node.lastUpdatedAt ?? null}
        onClose={() => setDetailOpen(false)}
        bodyRef={layoutBodyRef}
      >
        {writingBody}
        {shotListBody}
        {scrollBody}
      </NodeDetailPanelLayout>
      </aside>
    </>
  );
}
