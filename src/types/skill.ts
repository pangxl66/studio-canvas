/** 与 src/skills 下子目录名一致 */
export type SkillFolder = 'writing' | 'storyboard' | 'prompt';

/** 技能在节点里的插槽职责。Prompt 节点会把 style 作为唯一主规范槽。 */
export type SkillSlotKind = 'style' | 'enhancement';

export type SkillExportExtensionCapability =
  | 'writing_download'
  | 'storyboard_shotlist'
  | 'prompt_copy_all'
  | 'prompt_sync_video';

/** 与 `writingExportSkillBridge` 中模版 id 一致 */
export type SkillExportWritingTemplate = 'standard' | 'vertical_short' | 'hollywood';

/** Skill JSON：`export_extensions` 声明侧栏 Header 额外导出能力 */
export type SkillExportExtension = {
  label: string;
  capability: SkillExportExtensionCapability;
  /** 仅 `writing_download`：覆盖本次快捷导出的剧本模版 */
  writingTemplate?: SkillExportWritingTemplate;
};

export type SkillFileRecord = {
  /** 稳定 id，如 writing/daily_skit_v1 */
  id: string;
  folder: SkillFolder;
  fileName: string;
  name: string;
  description: string;
  version: string;
  system_instruction: string;
  /** 可选：Prompt 节点用它区分“主规范槽”和普通增强技能 */
  slot?: SkillSlotKind;
  /** 可选：详情面板 Header 动态导出按钮 */
  export_extensions?: SkillExportExtension[];
};
