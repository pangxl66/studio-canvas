import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatToStandardScript } from '@/components/writing/formatToStandardScript';
import {
  resolveWritingExportTemplate,
  writingExportTemplateLabel,
} from '@/components/writing/writingExportSkillBridge';
import type { StudioNodeData } from '@/types/studio';

function isWritingOutput(o: unknown): o is import('@/types/studio').WritingOutput {
  if (!o || typeof o !== 'object') return false;
  const x = o as import('@/types/studio').WritingOutput;
  return Array.isArray(x.episodes) && Array.isArray(x.scenes);
}

type Props = { node: StudioNodeData };

/** 编剧节点详情 Header：下载与导出弹窗（执行按钮由 NodeDetailPanel 统一放置） */
export function WritingHeaderActions(props: Props) {
  const { node } = props;
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<'docx' | 'pdf' | null>(null);
  const [exportModal, setExportModal] = useState<'docx' | 'pdf' | null>(null);
  const [exportIncludeStoryboard, setExportIncludeStoryboard] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement>(null);

  const out = node.output && isWritingOutput(node.output) ? node.output : null;

  const exportTemplate = useMemo(
    () => resolveWritingExportTemplate(node.mounted_skills ?? []),
    [node.mounted_skills],
  );
  const exportTemplateDescription = useMemo(
    () => writingExportTemplateLabel(exportTemplate),
    [exportTemplate],
  );

  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: PointerEvent) => {
      if (exportWrapRef.current?.contains(e.target as Node)) return;
      setExportOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [exportOpen]);

  const openExportModal = useCallback((format: 'docx' | 'pdf') => {
    setExportOpen(false);
    setExportIncludeStoryboard(false);
    setExportModal(format);
  }, []);

  const confirmExport = useCallback(async () => {
    if (!out || !exportModal) return;
    const fmt = exportModal;
    const includeSb = exportIncludeStoryboard;
    setExportModal(null);
    setExportBusy(fmt);
    try {
      const doc = formatToStandardScript(
        out,
        { workTitle: node.label },
        { template: exportTemplate, includeStoryboardNotes: includeSb },
      );
      if (fmt === 'docx') {
        const { exportStandardScriptDocx } = await import('@/components/writing/writingScriptExport');
        await exportStandardScriptDocx(doc, node.label);
      } else {
        const { exportStandardScriptPdf } = await import('@/components/writing/writingScriptExport');
        await exportStandardScriptPdf(doc, node.label);
      }
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExportBusy(null);
    }
  }, [exportIncludeStoryboard, exportModal, exportTemplate, node.label, out]);

  return (
    <>
      <div className="writing-header-actions__download-wrap" ref={exportWrapRef}>
        <button
          type="button"
          className="writing-header-actions__download node-detail-action-btn"
          disabled={!out || exportBusy !== null}
          title={!out ? '请先生成结构化场次' : '导出剧本'}
          aria-expanded={exportOpen}
          aria-haspopup="menu"
          onClick={() => setExportOpen((v) => !v)}
        >
          {exportBusy === 'docx' || exportBusy === 'pdf' ? '导出中…' : '下载'}
        </button>
        {exportOpen && out ? (
          <div className="writing-header-actions__menu" role="menu" aria-label="导出格式">
            <button
              type="button"
              role="menuitem"
              className="writing-header-actions__menu-item"
              disabled={exportBusy !== null}
              onClick={() => openExportModal('docx')}
            >
              Word（.docx）
            </button>
            <button
              type="button"
              role="menuitem"
              className="writing-header-actions__menu-item"
              disabled={exportBusy !== null}
              onClick={() => openExportModal('pdf')}
            >
              PDF（.pdf）
            </button>
          </div>
        ) : null}
      </div>

      {exportModal ? (
        <div
          className="writing-export-modal-backdrop"
          role="presentation"
          onClick={() => setExportModal(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setExportModal(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="writing-export-title"
            className="writing-export-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="writing-export-title" className="writing-export-modal__title">
              导出{exportModal === 'docx' ? ' Word' : ' PDF'}
            </h3>
            <p className="writing-export-modal__template">
              <span className="writing-export-modal__label">导出模版（随挂载 Skill）</span>
              <span className="writing-export-modal__value">{exportTemplateDescription}</span>
            </p>
            <label className="writing-export-modal__check">
              <input
                type="checkbox"
                checked={exportIncludeStoryboard}
                onChange={(e) => setExportIncludeStoryboard(e.target.checked)}
              />
              包含「分镜建议」作为剧本注释（场次旁灰色批注；无 AI 字段时生成一句启发式说明）
            </label>
            <div className="writing-export-modal__actions">
              <button
                type="button"
                className="writing-export-modal__btn writing-export-modal__btn--ghost"
                onClick={() => setExportModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="writing-export-modal__btn writing-export-modal__btn--primary"
                disabled={exportBusy !== null}
                onClick={() => void confirmExport()}
              >
                {exportBusy ? '导出中…' : '开始导出'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
