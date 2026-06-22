import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloneStoryboardOutput, reindexStoryboardShotIds } from '@/agents/storyboardAgents';
import type { StoryboardOutput, StoryboardShot, StudioNodeData } from '@/types/studio';
import { mergeSameSceneShots, mergeStoryboardShotSlice } from '@/utils/storyboardSeedance';
import { createStoryboardShotWireId } from '@/utils/shotListWire';

export function blankShot(sceneRef?: string): StoryboardShot {
  return {
    id: 0,
    wireId: createStoryboardShotWireId('blank'),
    type: '中景',
    movement: '固定',
    durationSec: 3,
    description: '',
    content: '',
    sceneRef,
  };
}

function formatShotDuration(value: StoryboardShot['durationSec']): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1).replace(/\.0$/, '')}秒`;
}

function parseShotDuration(value: string): number | undefined {
  const normalized = value.replace(/秒|s/gi, '').trim();
  if (!normalized) return undefined;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(60, Math.round(parsed * 10) / 10);
}

/** 将一段连续下标的镜头合并为一行：描述/台词/动作拼接，景别与运镜去重后用「 / 」连接 */
export function mergeConsecutiveRange(shots: StoryboardShot[], lo: number, hi: number): StoryboardShot[] {
  const slice = shots.slice(lo, hi + 1);
  const merged: StoryboardShot = mergeStoryboardShotSlice(slice);
  return [...shots.slice(0, lo), merged, ...shots.slice(hi + 1)];
}

export function mergeSameSceneGroups(shots: StoryboardShot[], maxDurationSec = 15): StoryboardShot[] {
  return mergeSameSceneShots(shots, maxDurationSec);
}

export function selectionCanMergeConsecutive(indices: Set<number>): {
  ok: boolean;
  lo?: number;
  hi?: number;
} {
  if (indices.size < 2) return { ok: false };
  const sorted = [...indices].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return { ok: false };
  }
  return { ok: true, lo: sorted[0], hi: sorted[sorted.length - 1] };
}

type EditableShotField = 'description' | 'content' | 'type' | 'movement' | 'durationSec';

type PatchFn = (id: string, patch: Partial<StudioNodeData>, bumpVersion?: boolean) => void;

export function StoryboardShotListTable({
  output,
  preview = false,
  nodeId,
  patchNodeData,
  editable = false,
  storyboardAiSnapshot,
  /** 镜头表子节点工作台：精简列（镜头号/景别/运镜/描述/台词）、顶部合并与末尾添加行 */
  workbench = false,
}: {
  output: StoryboardOutput;
  preview?: boolean;
  /** 与 patchNodeData 同时传入且 editable 为 true 时启用行内编辑与批量操作 */
  nodeId?: string;
  patchNodeData?: PatchFn;
  /** 为 false 时只读（如生成中） */
  editable?: boolean;
  /** 员工 AI 首次生成快照；存在时可「重置为 AI 原始生成」 */
  storyboardAiSnapshot?: StoryboardOutput | null;
  workbench?: boolean;
}) {
  const canEdit = Boolean(editable && nodeId && patchNodeData);
  const shots = output.shots;

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [editing, setEditing] = useState<{ index: number; field: EditableShotField } | null>(null);
  const editDraftRef = useRef('');
  const skipBlurCommitRef = useRef(false);

  const mergeInfo = useMemo(() => selectionCanMergeConsecutive(selected), [selected]);

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < shots.length) next.add(i);
      }
      return next;
    });
  }, [shots.length]);

  useEffect(() => {
    if (editing && editing.index >= shots.length) setEditing(null);
  }, [editing, shots.length]);

  const commitShots = useCallback(
    (nextShots: StoryboardShot[]) => {
      if (!canEdit || !nodeId || !patchNodeData) return;
      const reindexed = reindexStoryboardShotIds(nextShots);
      patchNodeData(
        nodeId,
        {
          output: { ...output, shots: reindexed },
        },
        true,
      );
    },
    [canEdit, nodeId, patchNodeData, output],
  );

  const onResetToAiSnapshot = useCallback(() => {
    if (!canEdit || !nodeId || !patchNodeData || !storyboardAiSnapshot) return;
    if (
      !window.confirm(
        '将丢失当前表格中的手动修改（删除、合并、插入与编辑），恢复为员工 AI 首次生成的镜头表。确定？',
      )
    ) {
      return;
    }
    setSelected(new Set());
    setEditing(null);
    patchNodeData(
      nodeId,
      { output: cloneStoryboardOutput(storyboardAiSnapshot) },
      true,
    );
  }, [canEdit, nodeId, patchNodeData, storyboardAiSnapshot]);

  const toggleSelect = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const onMerge = useCallback(() => {
    if (!mergeInfo.ok || mergeInfo.lo == null || mergeInfo.hi == null) return;
    const next = mergeConsecutiveRange(shots, mergeInfo.lo, mergeInfo.hi);
    clearSelection();
    setEditing(null);
    commitShots(next);
  }, [mergeInfo, shots, commitShots, clearSelection]);

  const onMergeSameScene = useCallback(() => {
    clearSelection();
    setEditing(null);
    commitShots(mergeSameSceneGroups(shots));
  }, [shots, commitShots, clearSelection]);

  const onDelete = useCallback(
    (index: number) => {
      const next = shots.filter((_, i) => i !== index);
      setSelected((prev) => {
        const n = new Set<number>();
        for (const i of prev) {
          if (i === index) continue;
          if (i > index) n.add(i - 1);
          else n.add(i);
        }
        return n;
      });
      if (editing?.index === index) setEditing(null);
      else if (editing && editing.index > index) {
        setEditing({ ...editing, index: editing.index - 1 });
      }
      commitShots(next);
    },
    [shots, editing, commitShots],
  );

  const onInsertAt = useCallback(
    (insertIndex: number) => {
      const left = shots[insertIndex - 1];
      const right = shots[insertIndex];
      const sceneRef = right?.sceneRef ?? left?.sceneRef;
      const row = blankShot(sceneRef);
      const next = [...shots.slice(0, insertIndex), row, ...shots.slice(insertIndex)];
      setSelected(new Set());
      setEditing(null);
      commitShots(next);
    },
    [shots, commitShots],
  );

  const startEdit = useCallback(
    (index: number, field: EditableShotField) => {
      if (!canEdit) return;
      const s = shots[index];
      editDraftRef.current =
        field === 'description'
          ? s.description
          : field === 'content'
            ? s.content
            : field === 'type'
              ? s.type
              : field === 'movement'
                ? s.movement
                : formatShotDuration(s.durationSec).replace(/^—$/, '');
      setEditing({ index, field });
    },
    [canEdit, shots],
  );

  const commitEdit = useCallback(() => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    if (!editing) return;
    const { index, field } = editing;
    const v = editDraftRef.current;
    const next = shots.map((s, i) => {
      if (i !== index) return s;
      if (field === 'description') return { ...s, description: v };
      if (field === 'content') return { ...s, content: v };
      if (field === 'type') return { ...s, type: v };
      if (field === 'movement') return { ...s, movement: v };
      return { ...s, durationSec: parseShotDuration(v) };
    });
    setEditing(null);
    commitShots(next);
  }, [editing, shots, commitShots]);

  const showSceneCol = !workbench;
  const showActionCol = !workbench;
  const showInsertRows = !workbench;
  const colCount =
    canEdit && workbench
      ? 8
      : canEdit
        ? 10
        : workbench
          ? 6
          : 8;

  const scrollBox = (
    <div
      className={`detail-panel__table-scroll${preview ? ' detail-panel__table-scroll--preview' : ''}${
        canEdit ? ' detail-panel__table-scroll--editor-body' : ''
      }${workbench ? ' detail-panel__table-scroll--workbench' : ''}`}
    >
      <table
        className={`detail-panel__shot-table${preview ? ' detail-panel__shot-table--preview' : ''}${
          canEdit ? ' detail-panel__shot-table--editable' : ''
        }${workbench ? ' detail-panel__shot-table--workbench' : ''}`}
      >
        <thead>
          <tr>
            {canEdit ? (
              <th scope="col" className="detail-panel__shot-table__th--narrow">
                选
              </th>
            ) : null}
            {showSceneCol ? <th scope="col">场次</th> : null}
            <th scope="col">{workbench ? '镜头号' : '镜头'}</th>
            <th scope="col">景别</th>
            <th scope="col">运镜</th>
            <th scope="col" className="detail-panel__shot-table__th--duration">
              时间
            </th>
            <th scope="col">{workbench ? '描述' : '画面'}</th>
            {showActionCol ? <th scope="col">动作</th> : null}
            <th scope="col">{workbench ? '台词' : '对白'}</th>
            {canEdit ? (
              <th scope="col" className="detail-panel__shot-table__th--narrow">
                操作
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {canEdit && showInsertRows ? (
            <tr className="detail-panel__shot-table__insert-row">
              <td colSpan={colCount}>
                <button
                  type="button"
                  className="detail-panel__shot-insert-btn"
                  aria-label="在开头插入镜头"
                  title="在开头插入空白镜头"
                  onClick={() => onInsertAt(0)}
                >
                  +
                </button>
              </td>
            </tr>
          ) : null}
          {shots.map((s, rowIdx) => {
            const sh = s as StoryboardShot;
            const scene = sh.sceneRef?.trim() ? sh.sceneRef : '—';
            const shotCell = sh.shotNo?.trim() || `#${sh.id}`;
            const act =
              typeof sh.action === 'string' && sh.action.trim() !== '' ? sh.action.trim() : '—';
            const dlgDisplay = typeof sh.content === 'string' && sh.content !== '' ? sh.content : '—';
            const descDisplay = sh.description.trim() !== '' ? sh.description : '—';

            const isEditingDesc = editing?.index === rowIdx && editing.field === 'description';
            const isEditingContent = editing?.index === rowIdx && editing.field === 'content';
            const isEditingType = editing?.index === rowIdx && editing.field === 'type';
            const isEditingMovement = editing?.index === rowIdx && editing.field === 'movement';
            const isEditingDuration = editing?.index === rowIdx && editing.field === 'durationSec';

            const cellEditable = canEdit ? 'detail-panel__shot-table__cell--editable' : undefined;

            return (
              <Fragment key={`shot-block-${rowIdx}`}>
                <tr className="detail-panel__shot-table__data-row">
                  {canEdit ? (
                    <td
                      className="detail-panel__shot-table__td--check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(rowIdx)}
                        onChange={() => toggleSelect(rowIdx)}
                        aria-label={`选择镜头 ${rowIdx + 1}`}
                      />
                    </td>
                  ) : null}
                  {showSceneCol ? <td className="detail-panel__shot-table__td--scene">{scene}</td> : null}
                  <td className="detail-panel__shot-table__lens">{shotCell}</td>
                  <td
                    className={cellEditable}
                    onClick={() => {
                      if (!canEdit || isEditingType) return;
                      startEdit(rowIdx, 'type');
                    }}
                  >
                    {isEditingType ? (
                      <input
                        className="detail-panel__shot-table__cell-input"
                        defaultValue={sh.type}
                        aria-label="编辑景别"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onInput={(e) => {
                          editDraftRef.current = (e.target as HTMLInputElement).value;
                        }}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            skipBlurCommitRef.current = true;
                            setEditing(null);
                          }
                        }}
                      />
                    ) : sh.type.trim() !== '' ? (
                      sh.type
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={cellEditable}
                    onClick={() => {
                      if (!canEdit || isEditingMovement) return;
                      startEdit(rowIdx, 'movement');
                    }}
                  >
                    {isEditingMovement ? (
                      <input
                        className="detail-panel__shot-table__cell-input"
                        defaultValue={sh.movement}
                        aria-label="编辑运镜"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onInput={(e) => {
                          editDraftRef.current = (e.target as HTMLInputElement).value;
                        }}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            skipBlurCommitRef.current = true;
                            setEditing(null);
                          }
                        }}
                      />
                    ) : sh.movement.trim() !== '' ? (
                      sh.movement
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={`detail-panel__shot-table__td--duration${cellEditable ? ` ${cellEditable}` : ''}`}
                    onClick={() => {
                      if (!canEdit || isEditingDuration) return;
                      startEdit(rowIdx, 'durationSec');
                    }}
                  >
                    {isEditingDuration ? (
                      <input
                        className="detail-panel__shot-table__cell-input"
                        defaultValue={formatShotDuration(sh.durationSec).replace(/^—$/, '')}
                        aria-label="编辑时间"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onInput={(e) => {
                          editDraftRef.current = (e.target as HTMLInputElement).value;
                        }}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            skipBlurCommitRef.current = true;
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      formatShotDuration(sh.durationSec)
                    )}
                  </td>
                  <td
                    className={cellEditable}
                    onClick={() => {
                      if (!canEdit || isEditingDesc) return;
                      startEdit(rowIdx, 'description');
                    }}
                  >
                    {isEditingDesc ? (
                      <textarea
                        className="detail-panel__shot-table__textarea"
                        defaultValue={sh.description}
                        aria-label="编辑画面描述"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onInput={(e) => {
                          editDraftRef.current = (e.target as HTMLTextAreaElement).value;
                        }}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            skipBlurCommitRef.current = true;
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      descDisplay
                    )}
                  </td>
                  {showActionCol ? <td>{act}</td> : null}
                  <td
                    className={cellEditable}
                    onClick={() => {
                      if (!canEdit || isEditingContent) return;
                      startEdit(rowIdx, 'content');
                    }}
                  >
                    {isEditingContent ? (
                      <textarea
                        className="detail-panel__shot-table__textarea"
                        defaultValue={sh.content}
                        aria-label="编辑台词"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onInput={(e) => {
                          editDraftRef.current = (e.target as HTMLTextAreaElement).value;
                        }}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            skipBlurCommitRef.current = true;
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      dlgDisplay
                    )}
                  </td>
                  {canEdit ? (
                    <td className="detail-panel__shot-table__td--action">
                      {workbench ? (
                        <button
                          type="button"
                          className="detail-panel__shot-delete-btn detail-panel__shot-delete-btn--text"
                          title="删除此镜头"
                          aria-label={`删除镜头 ${rowIdx + 1}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(rowIdx);
                          }}
                        >
                          删除
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="detail-panel__shot-delete-btn"
                          title="删除此镜头"
                          aria-label={`删除镜头 ${rowIdx + 1}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(rowIdx);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                            <path
                              fill="currentColor"
                              d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2zM9 10v9h2v-9H9zm4 0v9h2v-9h-2z"
                            />
                          </svg>
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
                {canEdit && showInsertRows ? (
                  <tr className="detail-panel__shot-table__insert-row">
                    <td colSpan={colCount}>
                      <button
                        type="button"
                        className="detail-panel__shot-insert-btn"
                        aria-label={`在镜头 ${rowIdx + 1} 后插入`}
                        title="在此后插入空白镜头"
                        onClick={() => onInsertAt(rowIdx + 1)}
                      >
                        +
                      </button>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (canEdit) {
    return (
      <div className={`detail-panel__shot-editor${workbench ? ' detail-panel__shot-editor--workbench' : ''}`}>
        <div className="detail-panel__shot-table-toolbar">
          <button
            type="button"
            className="detail-panel__shot-table-toolbar__btn detail-panel__shot-table-toolbar__btn--secondary"
            title="将同一场次下的连续镜头按 15 秒上限自动合并"
            onClick={onMergeSameScene}
          >
            同场合并
          </button>
          <button
            type="button"
            className="detail-panel__shot-table-toolbar__btn"
            disabled={!mergeInfo.ok}
            title={
              mergeInfo.ok
                ? '将连续多选的镜头合并为一行（描述、台词、动作拼接；景别/运镜去重合并）'
                : '请勾选至少 2 行且行号必须连续（中间不能空行）'
            }
            onClick={onMerge}
          >
            {workbench ? '合并镜头' : '合并所选镜头'}
          </button>
          {workbench ? (
            <button
              type="button"
              className="detail-panel__shot-table-toolbar__btn detail-panel__shot-table-toolbar__btn--secondary"
              title="在表格末尾追加一行空白镜头"
              onClick={() => onInsertAt(shots.length)}
            >
              在末尾添加镜头
            </button>
          ) : null}
          <button
            type="button"
            className="detail-panel__shot-table-toolbar__btn detail-panel__shot-table-toolbar__btn--secondary"
            disabled={!storyboardAiSnapshot}
            title={
              storyboardAiSnapshot
                ? '恢复为员工 AI 首次写入的分镜（会丢弃手动修改）'
                : '无快照：请重新执行分镜生成后可用'
            }
            onClick={onResetToAiSnapshot}
          >
            重置为 AI 原始生成
          </button>
          {selected.size > 0 ? (
            <span className="detail-panel__shot-table-toolbar__hint">
              已选 {selected.size} 行
              {!mergeInfo.ok && selected.size >= 2 ? '（须为连续行号）' : ''}
            </span>
          ) : (
            <span className="detail-panel__shot-table-toolbar__hint">
              {workbench
                ? '可直接做同场合并；也可勾选连续多行后点「合并镜头」；点击单元格编辑会同步父分镜节点'
                : '勾选连续多行后可合并；删/并/插/改后会更新版本号'}
            </span>
          )}
        </div>
        {scrollBox}
      </div>
    );
  }

  return scrollBox;
}
