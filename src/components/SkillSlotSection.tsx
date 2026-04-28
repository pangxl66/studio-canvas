import { useCallback, useMemo, useState } from 'react';
import {
  getFixedSkillIdsForPipelineKind,
  getSkillById,
  listSkillsForPipelineKind,
  normalizeMountedSkillIdsForKind,
  skillToDownloadPayload,
} from '@/services/skillLoader';
import type { SkillFileRecord } from '@/types/skill';
import type { NodeKind, StudioNodeData } from '@/types/studio';

type PipelineKind = Exclude<
  NodeKind,
  'text_node' | 'shot_list_node' | 'storyboard_file_node' | 'prompt_review_node' | 'image_node'
>;

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
  prompt: 'Prompt 增强',
};

export function SkillSlotSection(props: {
  nodeId: string;
  kind: PipelineKind;
  mounted: string[];
  patchNodeData: (id: string, patch: Partial<StudioNodeData>, bumpVersion?: boolean) => void;
}) {
  const { nodeId, kind, mounted, patchNodeData } = props;
  const [open, setOpen] = useState(false);
  const catalog = useMemo(() => listSkillsForPipelineKind(kind), [kind]);
  const fixedIds = useMemo(() => getFixedSkillIdsForPipelineKind(kind), [kind]);
  const fixedSet = useMemo(() => new Set(fixedIds), [fixedIds]);
  const normalizedMounted = useMemo(
    () => normalizeMountedSkillIdsForKind(kind, mounted),
    [kind, mounted],
  );

  const setMounted = useCallback(
    (next: string[]) => {
      patchNodeData(nodeId, { mounted_skills: next }, false);
    },
    [nodeId, patchNodeData],
  );

  const mount = useCallback(
    (id: string) => {
      if (normalizedMounted.includes(id)) return;
      setMounted([...normalizedMounted, id]);
    },
    [normalizedMounted, setMounted],
  );

  const unmount = useCallback(
    (id: string) => {
      if (fixedSet.has(id)) return;
      setMounted(normalizedMounted.filter((x) => x !== id));
    },
    [fixedSet, normalizedMounted, setMounted],
  );

  return (
    <div className="detail-panel__section detail-panel__section--skill">
      <div className="detail-panel__hint">技能插槽</div>
      <p className="detail-panel__tip">
        执行时 LLM 的 system = 部门基础指令 + 下方挂载技能的片段；user 侧为任务输入。编剧/分镜列表含本部门与「Prompt
        增强」；Prompt 部列表含全部技能目录。从部门 Output 拉线创建下游节点时，会按 Skill Chain
        自动继承/对齐技能（例如上游挂载「动作片技能」时，新建分镜会带上「快节奏动作分镜技能」）。
      </p>
      {normalizedMounted.length === 0 ? (
        <p className="detail-panel__tip">尚未挂载技能。</p>
      ) : (
        <ul className="skill-slot__chips" aria-label="已挂载技能">
          {normalizedMounted.map((id) => {
            const s = getSkillById(id);
            const label = s ? `${s.name} (${id})` : id;
            const fixed = fixedSet.has(id);
            return (
              <li key={id} className="skill-slot__chip">
                <span className="skill-slot__chip-label">{fixed ? `${label} · 固定` : label}</span>
                <button
                  type="button"
                  className="skill-slot__chip-remove"
                  disabled={fixed}
                  title={fixed ? '这是 Prompt 节点固定技能，不能卸下' : '卸下技能'}
                  onClick={() => unmount(id)}
                >
                  {fixed ? '固定' : '卸下'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="detail-panel__secondary skill-slot__open" onClick={() => setOpen(true)}>
        选择 / 下载技能…
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
            aria-label="技能列表"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="skill-picker__head">
              <span className="skill-picker__title">挂载技能</span>
              <button type="button" className="skill-picker__close" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <ul className="skill-picker__list">
              {catalog.map((skill) => {
                const on = normalizedMounted.includes(skill.id);
                const fixed = fixedSet.has(skill.id);
                return (
                  <li key={skill.id} className="skill-picker__row">
                    <div className="skill-picker__meta">
                      <div className="skill-picker__name">
                        {skill.name}
                        <span className="skill-picker__badge">{folderLabel[skill.folder] ?? skill.folder}</span>
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
                          已挂载
                        </button>
                      ) : (
                        <button type="button" className="skill-picker__btn" onClick={() => mount(skill.id)}>
                          挂载
                        </button>
                      )}
                      <button type="button" className="skill-picker__btn skill-picker__btn--ghost" onClick={() => downloadSkillJson(skill)}>
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
