import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useCallback, useMemo, type ChangeEvent } from 'react';
import {
  DEFAULT_STORYBOARD_SKILL_ID,
  getSkillById,
  listSkillsInFolder,
} from '@/services/skillLoader';
import { FILM_INPUT_HANDLE_ID, FILM_OUTPUT_HANDLE_ID } from '@/store/slices/aiFilmmakingStore';
import { useStudioStore } from '@/store/useStudioStore';
import type { NodeKind, StudioNodeData } from '@/types/studio';

type FilmNodeType = 'aiFilmCharacter' | 'aiFilmStoryboard' | 'aiFilmVideoPrompt';
type FilmNodeKind = Extract<NodeKind, 'film_character_node' | 'film_storyboard_node' | 'film_video_prompt_node'>;
type FilmRF = Node<StudioNodeData, FilmNodeType>;

const NODE_META: Record<
  FilmNodeKind,
  {
    eyebrow: string;
    title: string;
    action: string;
    empty: string;
    accent: string;
  }
> = {
  film_character_node: {
    eyebrow: 'CHARACTER',
    title: '角色设定',
    action: '生成角色设定',
    empty: '连接图片节点或文本节点后，生成角色参考表提示词。',
    accent: 'character',
  },
  film_storyboard_node: {
    eyebrow: 'STORYBOARD',
    title: '影视分镜',
    action: '生成宫格提示词',
    empty: '连接文本节点或分镜表镜头输出后，按镜头数量生成分镜宫格提示词。',
    accent: 'storyboard',
  },
  film_video_prompt_node: {
    eyebrow: 'SEEDANCE',
    title: '影视分镜提示词',
    action: '生成视频提示词',
    empty: '连接文本、角色设定、影视分镜或图片参考后，自动识别 A/B/C 模式。',
    accent: 'video',
  },
};

function isFilmKind(kind: StudioNodeData['type']): kind is FilmNodeKind {
  return (
    kind === 'film_character_node' ||
    kind === 'film_storyboard_node' ||
    kind === 'film_video_prompt_node'
  );
}

function textFromData(data: StudioNodeData): string {
  if (data.status === 'IN_PROGRESS' && data.streaming_preview?.trim()) return data.streaming_preview.trim();
  if (data.raw_text?.trim()) return data.raw_text.trim();
  if (data.input?.trim()) return data.input.trim();
  if (data.output && typeof data.output === 'object' && typeof (data.output as { text?: unknown }).text === 'string') {
    return (data.output as { text: string }).text.trim();
  }
  return '';
}

function videoModeLabel(data: StudioNodeData): string | null {
  if (data.type !== 'film_video_prompt_node') return null;
  const mode = data.output && typeof data.output === 'object' ? (data.output as { videoMode?: unknown }).videoMode : null;
  if (mode === 'A' || mode === 'B' || mode === 'C') return `模式 ${mode}`;
  return '自动识别';
}

function AiFilmmakingNodeInner({ id, data, selected }: NodeProps<FilmRF>) {
  const runAiFilmmakingNode = useStudioStore((state) => state.runAiFilmmakingNode);
  const stopNodeTask = useStudioStore((state) => state.stopNodeTask);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const patchNodeData = useStudioStore((state) => state.patchNodeData);
  const meta = isFilmKind(data.type) ? NODE_META[data.type] : NODE_META.film_video_prompt_node;
  const busy = data.status === 'IN_PROGRESS';
  const text = textFromData(data);
  const hasText = Boolean(text);
  const modeLabel = videoModeLabel(data);
  const isStoryboardNode = data.type === 'film_storyboard_node';
  const storyboardSkills = useMemo(
    () => (isStoryboardNode ? listSkillsInFolder('storyboard') : []),
    [isStoryboardNode],
  );
  const selectedStoryboardSkillId =
    isStoryboardNode && typeof data.film_storyboard_skill_id === 'string' && data.film_storyboard_skill_id.trim()
      ? data.film_storyboard_skill_id.trim()
      : DEFAULT_STORYBOARD_SKILL_ID;
  const effectiveStoryboardSkillId = storyboardSkills.some((skill) => skill.id === selectedStoryboardSkillId)
    ? selectedStoryboardSkillId
    : storyboardSkills[0]?.id ?? DEFAULT_STORYBOARD_SKILL_ID;

  const onRun = useCallback(() => {
    if (busy) {
      stopNodeTask(id);
      return;
    }
    void runAiFilmmakingNode(id);
  }, [busy, id, runAiFilmmakingNode, stopNodeTask]);

  const onCopy = useCallback(async () => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      pushMessage({ role: 'system', text: '已复制节点提示词。', nodeId: id });
    } catch {
      pushMessage({ role: 'system', text: '复制失败：请检查浏览器剪贴板权限。', nodeId: id });
    }
  }, [id, pushMessage, text]);

  const onSkillChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextId = event.target.value;
      const skill = getSkillById(nextId);
      patchNodeData(id, { film_storyboard_skill_id: nextId, generation_error: undefined }, false);
      pushMessage({
        role: 'system',
        text: `影视分镜 Skill 已切换为：${skill?.name ?? nextId}。`,
        nodeId: id,
      });
    },
    [id, patchNodeData, pushMessage],
  );

  return (
    <div
      className={`ai-film-node ai-film-node--${meta.accent} ${selected ? 'ai-film-node--selected' : ''} ${
        busy ? 'ai-film-node--busy' : ''
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={FILM_INPUT_HANDLE_ID}
        className="ai-film-node__handle ai-film-node__handle--in"
        title="Input：接入文本、图片、角色设定或分镜提示词。"
      />
      <header className="ai-film-node__head">
        <div>
          <div className="ai-film-node__eyebrow">{meta.eyebrow}</div>
          <div className="ai-film-node__title">{data.label?.trim() || meta.title}</div>
        </div>
        <span className={`ai-film-node__status ${busy ? 'ai-film-node__status--busy' : ''}`}>
          {busy ? '生成中' : modeLabel ?? '待生成'}
        </span>
      </header>
      <section className={`ai-film-node__body ${hasText ? 'ai-film-node__body--filled' : ''}`}>
        {hasText ? (
          <pre className="ai-film-node__prompt">{text}</pre>
        ) : (
          <div className="ai-film-node__empty">
            <span />
            <p>{meta.empty}</p>
          </div>
        )}
      </section>
      {data.generation_error?.trim() ? (
        <div className="ai-film-node__error">{data.generation_error.trim()}</div>
      ) : null}
      <footer className={`ai-film-node__footer nodrag nopan ${isStoryboardNode ? 'ai-film-node__footer--stacked' : ''}`}>
        {isStoryboardNode ? (
          <label className="ai-film-node__skill">
            <span>分镜 Skill</span>
            <select
              className="ai-film-node__skill-select"
              value={effectiveStoryboardSkillId}
              onChange={onSkillChange}
              disabled={busy}
            >
              {storyboardSkills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="ai-film-node__actions">
          <button
            type="button"
            className={`ai-film-node__primary ${busy ? 'ai-film-node__primary--stop' : ''}`}
            onClick={onRun}
          >
            {busy ? '停止' : meta.action}
          </button>
          <button type="button" className="ai-film-node__secondary" onClick={onCopy} disabled={!hasText || busy}>
            复制
          </button>
        </div>
      </footer>
      <Handle
        type="source"
        position={Position.Right}
        id={FILM_OUTPUT_HANDLE_ID}
        className="ai-film-node__handle ai-film-node__handle--out"
        title="Output：把生成的提示词连接到下游 AI Filmmaking 节点。"
      />
    </div>
  );
}

export const AiFilmCharacterNode = memo(AiFilmmakingNodeInner);
export const AiFilmStoryboardNode = memo(AiFilmmakingNodeInner);
export const AiFilmVideoPromptNode = memo(AiFilmmakingNodeInner);
