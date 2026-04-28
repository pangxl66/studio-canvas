import { useCallback, useEffect, useRef, useState } from 'react';
import { tryParseStoryboardOutput } from '@/agents/storyboardAgents';
import { useStudioStore } from '@/store/useStudioStore';
import type { StoryboardOutput } from '@/types/studio';
import {
  buildStoryboardShootingListPlainText,
  downloadStoryboardShotlistCsvIntl,
  downloadStoryboardShotlistExcelCsv,
  downloadStoryboardShotlistPdf,
} from './storyboardShotlistExport';

/** 点击导出时从 store 读取，确保与表格手改后的 output 一致 */
function readLatestStoryboardOutput(nodeId: string): StoryboardOutput | null {
  const d = useStudioStore.getState().nodes.find((n) => n.id === nodeId)?.data;
  if (!d || (d.type !== 'storyboard' && d.type !== 'shot_list_node') || d.output == null) {
    return null;
  }
  return tryParseStoryboardOutput(d.output);
}

type Props = {
  nodeId: string;
  baseLabel: string;
  /** 无镜头行时禁用（仍可在有节拍无镜时放宽，当前与表格一致） */
  exportDisabled?: boolean;
  onNotify?: (text: string) => void;
};

export function StoryboardShotlistDownload({
  nodeId,
  baseLabel,
  exportDisabled = false,
  onNotify,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const onCsvExcel = useCallback(() => {
    const output = readLatestStoryboardOutput(nodeId);
    if (!output?.shots?.length) {
      onNotify?.('当前无镜头数据可导出，请确认表格中至少有一条镜头。');
      setOpen(false);
      return;
    }
    downloadStoryboardShotlistExcelCsv(output, baseLabel);
    onNotify?.('已下载拍摄清单 CSV（Excel 可打开），数据为当前节点最新版本。');
    setOpen(false);
  }, [baseLabel, nodeId, onNotify]);

  const onCsvIntl = useCallback(() => {
    const output = readLatestStoryboardOutput(nodeId);
    if (!output?.shots?.length) {
      onNotify?.('当前无镜头数据可导出。');
      setOpen(false);
      return;
    }
    downloadStoryboardShotlistCsvIntl(output, baseLabel);
    onNotify?.('已下载英文表头 CSV（当前最新镜头表）。');
    setOpen(false);
  }, [baseLabel, nodeId, onNotify]);

  const onCopyPlainText = useCallback(() => {
    const output = readLatestStoryboardOutput(nodeId);
    if (!output) {
      onNotify?.('无法读取分镜数据。');
      return;
    }
    const text = buildStoryboardShootingListPlainText(output);
    void navigator.clipboard.writeText(text).then(
      () => {
        onNotify?.('已复制拍摄清单文本到剪贴板（与当前表格一致）。');
        setOpen(false);
      },
      () => window.alert('复制失败：请检查浏览器权限'),
    );
  }, [nodeId, onNotify]);

  const onPdf = useCallback(async () => {
    const output = readLatestStoryboardOutput(nodeId);
    if (!output?.shots?.length) {
      onNotify?.('当前无镜头数据可导出。');
      setOpen(false);
      return;
    }
    setBusyPdf(true);
    try {
      await downloadStoryboardShotlistPdf(output, baseLabel);
      onNotify?.('已生成 PDF（当前最新镜头表）。');
      setOpen(false);
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : 'PDF 导出失败');
    } finally {
      setBusyPdf(false);
    }
  }, [baseLabel, nodeId, onNotify]);

  const disabled = exportDisabled || busyPdf;

  return (
    <div className="writing-header-actions__download-wrap" ref={wrapRef}>
      <button
        type="button"
        className="writing-header-actions__download node-detail-action-btn"
        disabled={disabled}
        title={
          exportDisabled
            ? '请先生成镜头表或保留至少一条镜头'
            : '导出拍摄清单：CSV（Excel）、文本复制、PDF（均为当前表格最新数据）'
        }
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        {busyPdf ? '导出中…' : '导出拍摄清单'}
      </button>
      {open && !exportDisabled ? (
        <div className="writing-header-actions__menu" role="menu" aria-label="拍摄清单导出格式">
          <button
            type="button"
            role="menuitem"
            className="writing-header-actions__menu-item"
            disabled={busyPdf}
            onClick={onCsvExcel}
          >
            CSV（Excel 可打开 · UTF-8 · 中文表头）
          </button>
          <button
            type="button"
            role="menuitem"
            className="writing-header-actions__menu-item"
            disabled={busyPdf}
            onClick={onCopyPlainText}
          >
            复制文本预览（剪贴板）
          </button>
          <button
            type="button"
            role="menuitem"
            className="writing-header-actions__menu-item"
            disabled={busyPdf}
            onClick={onCsvIntl}
          >
            CSV（英文表头 · 工具链）
          </button>
          <button
            type="button"
            role="menuitem"
            className="writing-header-actions__menu-item"
            disabled={busyPdf}
            onClick={() => void onPdf()}
          >
            PDF（打印 / 传阅）
          </button>
        </div>
      ) : null}
    </div>
  );
}
