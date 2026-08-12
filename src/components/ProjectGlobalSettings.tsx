import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  listPromptStyleSkills,
  listSkillsForPipelineKind,
} from '@/services/skillLoader';
import { normalizeProjectSettings } from '@/services/projectSettings';
import { useStudioStore } from '@/store/useStudioStore';
import type { ProjectAspectRatio, ProjectSettings } from '@/types/studio';

export const STUDIO_OPEN_PROJECT_SETTINGS_EVENT = 'studio:open-project-settings';

const ASPECT_OPTIONS: Array<{
  value: ProjectAspectRatio;
  title: string;
  description: string;
}> = [
  { value: '16:9', title: '16:9 横屏', description: '电影、网络视频与常规横版分镜' },
  { value: '9:16', title: '9:16 竖屏', description: '手机短剧与竖版内容' },
  { value: '21:9', title: '21:9 超宽', description: '超宽银幕；不支持原生比例时使用安全区生成并裁切' },
];

function cloneSettings(settings: ProjectSettings): ProjectSettings {
  return {
    ...settings,
    overallStyle: { ...settings.overallStyle },
    defaultSkills: { ...settings.defaultSkills },
  };
}

export function ProjectGlobalSettings() {
  const currentProjectName = useStudioStore((state) => state.currentProjectName);
  const projectSettings = useStudioStore((state) => state.projectSettings);
  const updateProjectSettings = useStudioStore((state) => state.updateProjectSettings);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectSettings>(() => cloneSettings(projectSettings));
  const storyboardSkills = useMemo(() => listSkillsForPipelineKind('storyboard'), []);
  const promptSkills = useMemo(() => listPromptStyleSkills(), []);

  const openModal = useCallback(() => {
    setDraft(cloneSettings(useStudioStore.getState().projectSettings));
    setOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = () => openModal();
    window.addEventListener(STUDIO_OPEN_PROJECT_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(STUDIO_OPEN_PROJECT_SETTINGS_EVENT, onOpen);
  }, [openModal]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const save = useCallback(() => {
    updateProjectSettings(normalizeProjectSettings(draft));
    setOpen(false);
  }, [draft, updateProjectSettings]);

  if (!open) return null;

  return createPortal(
    <div className="studio-settings-backdrop project-settings-backdrop" role="presentation">
      <div
        className="studio-settings-modal project-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="studio-settings-modal__head">
          <div>
            <span className="project-settings-eyebrow">PROJECT GLOBAL SETTINGS</span>
            <h2 id="project-settings-title" className="studio-settings-modal__title">项目全局设定</h2>
            <p className="project-settings-project-name">{currentProjectName}</p>
          </div>
          <button type="button" className="studio-settings-modal__close" onClick={() => setOpen(false)}>
            关闭
          </button>
        </div>

        <div className="studio-settings-modal__body project-settings-body">
          <section className="studio-settings-section project-settings-section">
            <h3 className="studio-settings-section__title">项目画幅</h3>
            <p className="studio-settings-section__desc">
              统一作用于分镜部、提示词和影视分镜图。节点仍可单独覆盖。
            </p>
            <div className="project-aspect-grid" role="radiogroup" aria-label="项目画幅">
              {ASPECT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.aspectRatio === option.value}
                  className={`project-aspect-card${draft.aspectRatio === option.value ? ' project-aspect-card--active' : ''}`}
                  onClick={() => setDraft((prev) => ({ ...prev, aspectRatio: option.value }))}
                >
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="studio-settings-section project-settings-section">
            <div className="project-settings-section-head">
              <div>
                <h3 className="studio-settings-section__title">整体风格</h3>
                <p className="studio-settings-section__desc">
                  用户手动输入，系统只负责原样传给分镜部和提示词节点，不自动改写。
                </p>
              </div>
              <label className="project-style-toggle">
                <input
                  type="checkbox"
                  checked={draft.overallStyle.enabled}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      overallStyle: { ...prev.overallStyle, enabled: event.target.checked },
                    }))
                  }
                />
                <span>启用</span>
              </label>
            </div>
            <textarea
              className="project-style-textarea"
              value={draft.overallStyle.text}
              disabled={!draft.overallStyle.enabled}
              maxLength={12000}
              placeholder="例如：整体采用写实科幻电影质感，人物以严肃表演承接荒诞事件，通过停顿、错愕和意外结果形成反差喜剧。"
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  overallStyle: { ...prev.overallStyle, text: event.target.value },
                }))
              }
            />
            <div className="project-style-meta">
              <button
                type="button"
                className="project-style-clear"
                disabled={!draft.overallStyle.text}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    overallStyle: { ...prev.overallStyle, text: '' },
                  }))
                }
              >
                清空
              </button>
              <span>{draft.overallStyle.text.length} / 12000 字</span>
            </div>
          </section>

          <section className="studio-settings-section project-settings-section">
            <h3 className="studio-settings-section__title">默认 Skill</h3>
            <p className="studio-settings-section__desc">
              这里只设置节点的默认选项。节点仍可选择其他 Skill；实际生成始终使用当前节点选择的 Skill。
            </p>
            <div className="project-skill-grid">
              <label className="studio-settings-field project-skill-field">
                <span>默认分镜部 Skill</span>
                <select
                  value={draft.defaultSkills.storyboardSkillId}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      defaultSkills: {
                        ...prev.defaultSkills,
                        storyboardSkillId: event.target.value,
                      },
                    }))
                  }
                >
                  {storyboardSkills.map((skill) => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </select>
              </label>
              <label className="studio-settings-field project-skill-field">
                <span>默认提示词 Skill</span>
                <select
                  value={draft.defaultSkills.promptSkillId}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      defaultSkills: {
                        ...prev.defaultSkills,
                        promptSkillId: event.target.value,
                      },
                    }))
                  }
                >
                  {promptSkills.map((skill) => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <div className="project-settings-impact">
            保存后不会自动生成或消耗额度。已有结果保持不变，受影响节点会提示重新生成。
          </div>
          <div className="studio-settings-actions project-settings-actions">
            <button
              type="button"
              className="project-settings-action project-settings-action--cancel"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="project-settings-action project-settings-action--save"
              onClick={save}
            >
              保存并应用
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
