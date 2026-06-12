import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_PROMPT_STYLE_SKILL_ID,
  getFixedSkillIdsForPipelineKind,
  getSkillById,
  isPromptStyleSkillId,
  listSkillsForPipelineKind,
  normalizeMountedSkillIdsForKind,
  skillToDownloadPayload,
} from '@/services/skillLoader';
import type { SkillFileRecord } from '@/types/skill';
import type { StudioNodeData } from '@/types/studio';

type PipelineKind = 'writing' | 'storyboard' | 'prompt';

function downloadSkillJson(skill: SkillFileRecord) {
  const payload = skillToDownloadPayload(skill);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${skill.name.replace(/[/\\?%*:|"<>]/g, '_')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const folderLabel: Record<string, string> = {
  writing: '编剧',
  storyboard: '分镜',
  prompt: '提示词',
};

function skillDisplayLabel(id: string): string {
  const skill = getSkillById(id);
  return skill ? `${skill.name} (${id})` : id;
}

export function SkillSlotSection(props: {
  nodeId: string;
  kind: PipelineKind;
  mounted: string[];
  patchNodeData: (id: string, patch: Partial<StudioNodeData>, bumpVersion?: boolean) => void;
}) {
  const { nodeId, kind, mounted, patchNodeData } = props;
  const [open, setOpen] = useState(false);
  const isPromptKind = kind === 'prompt';
  const catalog = useMemo(() => listSkillsForPipelineKind(kind), [kind]);
  const fixedIds = useMemo(() => getFixedSkillIdsForPipelineKind(kind), [kind]);
  const fixedSet = useMemo(() => new Set(fixedIds), [fixedIds]);
  const normalizedMounted = useMemo(
    () => normalizeMountedSkillIdsForKind(kind, mounted),
    [kind, mounted],
  );
  const activePromptStyleId = useMemo(
    () => (isPromptKind ? normalizedMounted.find(isPromptStyleSkillId) : undefined),
    [isPromptKind, normalizedMounted],
  );
  const enhancementIds = useMemo(
    () => (isPromptKind ? normalizedMounted.filter((id) => !isPromptStyleSkillId(id)) : normalizedMounted),
    [isPromptKind, normalizedMounted],
  );

  const setMounted = useCallback(
    (next: string[]) => {
      patchNodeData(nodeId, { mounted_skills: normalizeMountedSkillIdsForKind(kind, next) }, false);
    },
    [kind, nodeId, patchNodeData],
  );

  const mount = useCallback(
    (id: string) => {
      if (isPromptKind && isPromptStyleSkillId(id)) {
        setMounted([id, ...normalizedMounted.filter((mountedId) => !isPromptStyleSkillId(mountedId))]);
        return;
      }
      const skill = getSkillById(id);
      if (kind === 'storyboard' && skill?.folder === 'storyboard') {
        setMounted([id, ...normalizedMounted.filter((mountedId) => getSkillById(mountedId)?.folder !== 'storyboard')]);
        return;
      }
      if (normalizedMounted.includes(id)) return;
      setMounted([...normalizedMounted, id]);
    },
    [isPromptKind, kind, normalizedMounted, setMounted],
  );

  const unmount = useCallback(
    (id: string) => {
      if (fixedSet.has(id)) return;
      const next =
        isPromptKind && isPromptStyleSkillId(id)
          ? normalizedMounted.filter((mountedId) => !isPromptStyleSkillId(mountedId))
          : normalizedMounted.filter((mountedId) => mountedId !== id);
      setMounted(next);
    },
    [fixedSet, isPromptKind, normalizedMounted, setMounted],
  );

  const renderChip = (id: string, options?: { styleSlot?: boolean }) => {
    const fixed = fixedSet.has(id);
    const isDefaultPromptStyle = isPromptKind && id === DEFAULT_PROMPT_STYLE_SKILL_ID;
    const disabled = fixed || isDefaultPromptStyle;
    const chipClass = options?.styleSlot ? 'skill-slot__chip skill-slot__chip--style' : 'skill-slot__chip';
    const actionLabel = fixed ? '固定' : isDefaultPromptStyle ? '默认' : options?.styleSlot ? '恢复默认' : '卸下';
    const title = fixed
      ? '这是固定技能，不能卸下'
      : isDefaultPromptStyle
        ? '这是 Prompt 节点默认规范槽'
        : options?.styleSlot
          ? '移除此规范后会恢复默认规范'
          : '卸下技能';

    return (
      <li key={id} className={chipClass}>
        <span className="skill-slot__chip-label">
          {skillDisplayLabel(id)}
          {options?.styleSlot ? <span className="skill-slot__chip-tag">规范槽</span> : null}
          {fixed ? <span className="skill-slot__chip-tag">固定</span> : null}
        </span>
        <button
          type="button"
          className="skill-slot__chip-remove"
          disabled={disabled}
          title={title}
          onClick={() => unmount(id)}
        >
          {actionLabel}
        </button>
      </li>
    );
  };

  return (
    <div className="detail-panel__section detail-panel__section--skill">
      <div className="detail-panel__hint">{isPromptKind ? 'Prompt 规范技能槽' : '技能插槽'}</div>
      <p className="detail-panel__tip">
        {isPromptKind
          ? '提示词节点只显示提示词类 Skill。主规范槽决定最终提示词结构；增强技能只补风格、动作、清晰度等偏好，不能改掉主结构。'
            : kind === 'storyboard'
              ? '分镜节点只显示分镜类 Skill，一次只启用一个；选择新的分镜 Skill 会替换当前分镜规范。'
              : '编剧节点只显示编剧类 Skill。执行时 LLM 的 system = 部门基础指令 + 下方挂载技能片段，user 侧为任务输入。'}
      </p>

      {isPromptKind ? (
        <>
          <div className="skill-slot__slot-title">当前规范</div>
          {activePromptStyleId ? (
            <ul className="skill-slot__chips" aria-label="当前 Prompt 规范">
              {renderChip(activePromptStyleId, { styleSlot: true })}
            </ul>
          ) : (
            <p className="detail-panel__tip">未找到可用 Prompt 规范技能。</p>
          )}

          <div className="skill-slot__slot-title">增强技能</div>
          {enhancementIds.length === 0 ? (
            <p className="detail-panel__tip">尚未挂载增强技能。</p>
          ) : (
            <ul className="skill-slot__chips" aria-label="已挂载增强技能">
              {enhancementIds.map((id) => renderChip(id))}
            </ul>
          )}
        </>
      ) : normalizedMounted.length === 0 ? (
        <p className="detail-panel__tip">尚未挂载技能。</p>
      ) : (
        <ul className="skill-slot__chips" aria-label="已挂载技能">
          {normalizedMounted.map((id) => renderChip(id))}
        </ul>
      )}

      <button type="button" className="detail-panel__secondary skill-slot__open" onClick={() => setOpen(true)}>
        {isPromptKind ? '选择规范 / 挂载增强…' : '选择 / 下载技能…'}
      </button>

      {open ? (
        <div
          className="skill-picker-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          <div
            className="skill-picker"
            role="dialog"
            aria-modal="true"
            aria-label={isPromptKind ? 'Prompt 技能槽' : '技能列表'}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="skill-picker__head">
              <span className="skill-picker__title">{isPromptKind ? 'Prompt 技能槽' : '挂载技能'}</span>
              <button type="button" className="skill-picker__close" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <ul className="skill-picker__list">
              {catalog.map((skill) => {
                const styleSlot = isPromptStyleSkillId(skill.id);
                const storyboardSlot = kind === 'storyboard' && skill.folder === 'storyboard';
                const on = styleSlot ? activePromptStyleId === skill.id : normalizedMounted.includes(skill.id);
                const fixed = fixedSet.has(skill.id);
                const rowClass = styleSlot ? 'skill-picker__row skill-picker__row--style' : 'skill-picker__row';
                return (
                  <li key={skill.id} className={rowClass}>
                    <div className="skill-picker__meta">
                      <div className="skill-picker__name">
                        {skill.name}
                        <span className="skill-picker__badge">
                          {styleSlot ? '提示词规范' : folderLabel[skill.folder] ?? skill.folder}
                        </span>
                        <span className="skill-picker__ver">v{skill.version}</span>
                      </div>
                      <div className="skill-picker__desc">{skill.description || '—'}</div>
                      <code className="skill-picker__id">{skill.id}</code>
                    </div>
                    <div className="skill-picker__actions">
                      {fixed ? (
                        <button type="button" className="skill-picker__btn skill-picker__btn--muted" disabled>
                          已固定
                        </button>
                      ) : on ? (
                        <button type="button" className="skill-picker__btn skill-picker__btn--muted" disabled>
                          {styleSlot ? '当前规范' : storyboardSlot ? '当前' : '已挂载'}
                        </button>
                      ) : (
                        <button type="button" className="skill-picker__btn" onClick={() => mount(skill.id)}>
                          {styleSlot ? '使用规范' : storyboardSlot ? '使用' : '挂载'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="skill-picker__btn skill-picker__btn--ghost"
                        onClick={() => downloadSkillJson(skill)}
                      >
                        下载 JSON
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
