import { create } from 'zustand';
import type { WritingOutput } from '@/types/studio';

/** 从编剧场次表聚合出的核心角色条目，供分镜/Prompt 统一引用 */
export type ProjectCharacterEntry = {
  name: string;
  /** 出场与冲突摘要（来自场次） */
  contextSnippet: string;
  sceneCount: number;
};

export type ProjectContextState = {
  characters: ProjectCharacterEntry[];
  /** 由分集梗概拼接的全剧风格/叙事锚点 */
  styleBible: string;
  lastIngestedWritingNodeId: string | null;
  lastIngestedAt: number;
};

type Actions = {
  /** 从编剧部结构化产出合并角色与风格（可多次调用，按角色名合并） */
  ingestFromWritingOutput: (writingNodeId: string, output: WritingOutput) => void;
  reset: () => void;
  /** 供 LLM system 末尾拼接；无数据时返回空串 */
  getSystemAppend: () => string;
};

const initial: ProjectContextState = {
  characters: [],
  styleBible: '',
  lastIngestedWritingNodeId: null,
  lastIngestedAt: 0,
};

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function expandRoleNames(raw: string): string[] {
  const t = normalizeName(raw);
  if (!t || t === '—' || t === '-') return [];
  return t
    .split(/[、，,;；/|｜]/)
    .map((x) => normalizeName(x))
    .filter(Boolean);
}

function extractWritingIntoMaps(output: WritingOutput): {
  charMap: Map<string, ProjectCharacterEntry>;
  styleBible: string;
} {
  const charMap = new Map<string, ProjectCharacterEntry>();

  for (const sc of output.scenes ?? []) {
    const ref = `E${sc.episodeNo ?? '?'}·场${sc.sceneNo}「${sc.title ?? ''}」`;
    const hint = (sc.coreConflict ?? sc.beat ?? '').slice(0, 120);
    const line = hint ? `${ref}：${hint}` : ref;
    const names: string[] = [];
    for (const cell of sc.characters ?? []) {
      names.push(...expandRoleNames(typeof cell === 'string' ? cell : String(cell)));
    }
    const uniq = [...new Set(names)];
    for (const name of uniq) {
      const prev = charMap.get(name);
      if (prev) {
        prev.sceneCount += 1;
        prev.contextSnippet = `${prev.contextSnippet}\n${line}`;
      } else {
        charMap.set(name, {
          name,
          contextSnippet: line,
          sceneCount: 1,
        });
      }
    }
  }

  const styleBible = (output.episodes ?? [])
    .slice(0, 32)
    .map((e) => {
      const n = e.episodeNo != null ? `第${e.episodeNo}集 ` : '';
      return `【${n}${e.title}】${e.summary ?? ''}`;
    })
    .join('\n')
    .slice(0, 5000);

  return { charMap, styleBible };
}

export const useProjectContextStore = create<ProjectContextState & Actions>((set, get) => ({
  ...initial,

  ingestFromWritingOutput: (writingNodeId, output) => {
    if (!output?.scenes?.length && !output?.episodes?.length) return;
    const { charMap, styleBible } = extractWritingIntoMaps(output);

    set((s) => {
      const merged = new Map<string, ProjectCharacterEntry>();
      for (const c of s.characters) {
        merged.set(c.name, { ...c, contextSnippet: c.contextSnippet });
      }
      for (const [name, incoming] of charMap) {
        const ex = merged.get(name);
        if (ex) {
          merged.set(name, {
            name,
            sceneCount: ex.sceneCount + incoming.sceneCount,
            contextSnippet: `${ex.contextSnippet}\n${incoming.contextSnippet}`.slice(0, 8000),
          });
        } else {
          merged.set(name, { ...incoming });
        }
      }

      const nextStyle = [s.styleBible, styleBible].filter(Boolean).join('\n---\n').slice(0, 8000);

      return {
        characters: Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
        styleBible: nextStyle,
        lastIngestedWritingNodeId: writingNodeId,
        lastIngestedAt: Date.now(),
      };
    });
  },

  reset: () => set({ ...initial }),

  getSystemAppend: () => {
    const { characters, styleBible } = get();
    if (characters.length === 0 && !styleBible.trim()) return '';

    const charBlock =
      characters.length > 0
        ? [
            '【ProjectContext · 全剧核心角色设定】',
            '以下角色须在全部分镜画面描述与视频提示词中保持外貌、气质与服装逻辑一致；不得无故换脸或改人设。',
            ...characters.map((c) => {
              const snip = c.contextSnippet.replace(/\s+/g, ' ').trim().slice(0, 500);
              return `- **${c.name}**（${c.sceneCount} 场相关）：${snip}`;
            }),
          ].join('\n')
        : '';

    const styleBlock = styleBible.trim()
      ? [
          '',
          '【ProjectContext · 全剧视觉与叙事风格锚点】',
          '分镜与 Prompt 须与此处整体气质、时代感、类型片取向保持一致；关键词与光影词汇应自洽。',
          styleBible.trim().slice(0, 3500),
        ].join('\n')
      : '';

    return `\n\n--- ProjectContext（全局一致性，必须遵守）---\n${charBlock}${styleBlock}\n`;
  },
}));
