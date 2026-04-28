import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadStoryboardShotlistCsv,
  downloadStoryboardShotlistPdf,
} from '@/components/detailPanel/storyboardShotlistExport';
import { runWritingScriptExport } from '@/components/writing/writingExportRunner';
import {
  resolveWritingExportTemplate,
  writingExportTemplateLabel,
} from '@/components/writing/writingExportSkillBridge';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import { useStudioStore } from '@/store/useStudioStore';
import type { MountedSkillExportItem } from '@/services/skillExportExtensions';
import type { PromptOutput, StudioNodeData, WritingOutput } from '@/types/studio';
import { formatPrompt } from '@/utils/promptFormat';

function isWritingOutput(o: unknown): o is WritingOutput {
  if (!o || typeof o !== 'object') return false;
  const x = o as WritingOutput;
  return Array.isArray(x.episodes) && Array.isArray(x.scenes);
}

function readLatestStoryboardOutput(nodeId: string) {
  const d = useStudioStore.getState().nodes.find((n) => n.id === nodeId)?.data;
  if (!d || (d.type !== 'storyboard' && d.type !== 'shot_list_node') || d.output == null) {
    return null;
  }
  return tryParseStoryboardOutput(d.output);
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

function WritingSkillExportBtn(props: {
  node: StudioNodeData;
  item: MountedSkillExportItem;
}) {
  const { node, item } = props;
  const { ext } = item;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'docx' | 'pdf' | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const out = node.output && isWritingOutput(node.output) ? node.output : null;
  const template =
    ext.writingTemplate ?? resolveWritingExportTemplate(node.mounted_skills ?? []);
  const tplLabel = writingExportTemplateLabel(template);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const run = useCallback(
    async (fmt: 'docx' | 'pdf') => {
      if (!out) return;
      setOpen(false);
      setBusy(fmt);
      try {
        await runWritingScriptExport({
          output: out,
          workTitle: node.label,
          template,
          format: fmt,
          includeStoryboardNotes: false,
        });
      } catch (e) {
        console.error(e);
        window.alert(e instanceof Error ? e.message : '导出失败');
      } finally {
        setBusy(null);
      }
    },
    [node.label, out, template],
  );

  const disabled = !out || busy !== null;

  return (
    <div className="writing-header-actions__download-wrap" ref={wrapRef}>
      <button
        type="button"
        className="writing-header-actions__download node-detail-action-btn"
        disabled={disabled}
        title={
          !out
            ? '请先生成结构化场次'
            : `${ext.label}（模版：${tplLabel}，不含分镜建议批注）`
        }
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? '导出中…' : ext.label}
      </button>
      {open && out ? (
        <div className="writing-header-actions__menu" role="menu" aria-label={`${ext.label} 格式`}>
          <button
            type="button"
            role="menuitem"
            className="writing-header-actions__menu-item"
            disabled={busy !== null}
            onClick={() => void run('docx')}
          >
            Word（.docx）
          </button>
          <button
            type="button"
            role="menuitem"
            className="writing-header-actions__menu-item"
            disabled={busy !== null}
            onClick={() => void run('pdf')}
          >
            PDF（.pdf）
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StoryboardSkillExportBtn(props: { node: StudioNodeData; item: MountedSkillExportItem }) {
  const { node, item } = props;
  const { ext } = item;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const outputPreview = node.output ? tryParseStoryboardOutput(node.output) : null;
  const hasShots = Boolean(outputPreview?.shots?.length);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const disabled = !hasShots || busy;

  return (
    <div className="writing-header-actions__download-wrap" ref={wrapRef}>
      <button
        type="button"
        className="writing-header-actions__download node-detail-action-btn"
        disabled={disabled}
        title={!hasShots ? '请先生成镜头表' : ext.label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? '导出中…' : ext.label}
      </button>
      {open && hasShots ? (
        <div className="writing-header-actions__menu" role="menu" aria-label={`${ext.label} 格式`}>
          <button
            type="button"
            role="menuitem"
            className="writing-header-actions__menu-item"
            disabled={busy}
            onClick={() => {
              const latest = readLatestStoryboardOutput(node.id);
              if (!latest?.shots?.length) return;
              downloadStoryboardShotlistCsv(latest, node.label);
              setOpen(false);
            }}
          >
            分镜清单 CSV（Excel）
          </button>
          <button
            type="button"
            role="menuitem"
            className="writing-header-actions__menu-item"
            disabled={busy}
            onClick={() => {
              const latest = readLatestStoryboardOutput(node.id);
              if (!latest?.shots?.length) return;
              setBusy(true);
              void downloadStoryboardShotlistPdf(latest, node.label)
                .catch((e) => {
                  console.error(e);
                  window.alert(e instanceof Error ? e.message : 'PDF 导出失败');
                })
                .finally(() => {
                  setBusy(false);
                  setOpen(false);
                });
            }}
          >
            PDF（.pdf）
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PromptSkillExportBtn(props: {
  node: StudioNodeData;
  item: MountedSkillExportItem;
  pushMessage: (m: { role: 'system'; text: string; nodeId: string }) => void;
}) {
  const { node, item, pushMessage } = props;
  const { ext } = item;
  const can = Boolean(node.output && isPromptOutput(node.output));

  const onCopy = useCallback(() => {
    if (!node.output || !isPromptOutput(node.output)) return;
    const text = formatPrompt(node.output);
    void navigator.clipboard.writeText(text).then(
      () => {
        pushMessage({ role: 'system', text: '已复制全部提示词到剪贴板。', nodeId: node.id });
      },
      () => window.alert('复制失败：请检查浏览器权限'),
    );
  }, [node.id, node.output, pushMessage]);

  const onSync = useCallback(() => {
    if (!node.output || !isPromptOutput(node.output)) return;
    const po = node.output;
    const promptText = formatPrompt(po);
    const payload = { nodeId: node.id, at: Date.now(), promptText, structured: po };
    try {
      sessionStorage.setItem('studio:videoEnginePrompt', JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('studio:sync-prompt-to-video-engine', { detail: payload }));
    pushMessage({
      role: 'system',
      text: '已同步至视频生成引擎（CustomEvent + sessionStorage）。',
      nodeId: node.id,
    });
  }, [node.id, node.output, pushMessage]);

  if (ext.capability === 'prompt_copy_all') {
    return (
      <button
        type="button"
        className="writing-header-actions__download node-detail-action-btn"
        disabled={!can}
        title={can ? ext.label : '请先生成 Prompt 输出'}
        onClick={onCopy}
      >
        {ext.label}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="writing-header-actions__download node-detail-action-btn"
      disabled={!can}
      title={can ? ext.label : '请先生成 Prompt 输出'}
      onClick={onSync}
    >
      {ext.label}
    </button>
  );
}

export function SkillExportExtensionHeaderButtons(props: {
  node: StudioNodeData;
  items: MountedSkillExportItem[];
  pushMessage: (m: { role: 'system'; text: string; nodeId?: string }) => void;
}) {
  const { node, items, pushMessage } = props;
  if (!items.length) return null;
  return (
    <div className="detail-panel__skill-export-exts">
      {items.map((item) => {
        const key = `${item.skillId}:${item.ext.label}:${item.ext.capability}`;
        if (item.ext.capability === 'writing_download') {
          return <WritingSkillExportBtn key={key} node={node} item={item} />;
        }
        if (item.ext.capability === 'storyboard_shotlist') {
          return <StoryboardSkillExportBtn key={key} node={node} item={item} />;
        }
        return <PromptSkillExportBtn key={key} node={node} item={item} pushMessage={pushMessage} />;
      })}
    </div>
  );
}
