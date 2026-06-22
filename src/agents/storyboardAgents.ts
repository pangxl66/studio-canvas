import type { StoryboardOutput, StoryboardShot, WritingOutput } from '@/types/studio';
import {
  STORYBOARD_DEPT_AGENT_SYSTEM,
  STORYBOARD_DEPT_OUTPUT_SHAPE,
  STORYBOARD_LEADER_SPEC,
} from '@/agents/storyboardDeptSpec';
import { invokeLlmJsonObjectStream, invokeLlmLeaderReview } from '@/services/llmJsonClient';
import { createStoryboardShotWireId } from '@/utils/shotListWire';

export {
  STORYBOARD_DEPT_AGENT_SYSTEM,
  STORYBOARD_DEPT_OUTPUT_SHAPE,
  STORYBOARD_LEADER_SPEC,
} from '@/agents/storyboardDeptSpec';

export function getStoryboardDeptSystemPrompt(): string {
  return STORYBOARD_DEPT_AGENT_SYSTEM;
}

export function storyboardOutputToJson(output: StoryboardOutput): string {
  return JSON.stringify(output, null, 2);
}

export function cloneStoryboardOutput(o: StoryboardOutput): StoryboardOutput {
  return JSON.parse(JSON.stringify(o)) as StoryboardOutput;
}

export function reindexStoryboardShotIds(shots: StoryboardShot[]): StoryboardShot[] {
  return shots.map((s, i) => ({ ...s, id: i + 1 }));
}

export function splitScriptIntoSceneBlocks(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  const byDelim = t
    .split(/\n-{3,}\n|\n\*{3,}\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byDelim.length > 1) return byDelim.slice(0, 24);
  const lines = t.split('\n').map((l) => l.trim());
  const scenes: string[] = [];
  let buf: string[] = [];
  const sceneHead = /^(场\s*景|第\s*[一二三四五六七八九十百零\d]+\s*场|Scene\s*\d+)/i;
  for (const line of lines) {
    if (sceneHead.test(line) && buf.length) {
      scenes.push(buf.join('\n').trim());
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) scenes.push(buf.join('\n').trim());
  if (scenes.length === 0) return [t];
  return scenes.slice(0, 24);
}

function deriveNarrativeBeatsFromShots(shots: StoryboardShot[]): string[] {
  if (!shots.length) return [];
  const refs = shots.map((s) => s.sceneRef?.trim()).filter(Boolean) as string[];
  const unique = [...new Set(refs)];
  if (unique.length >= 2) {
    return unique.map((ref, idx) => `节奏段 ${idx + 1}：场次 ${ref}`);
  }
  const first = shots[0];
  const last = shots[shots.length - 1];
  return [
    `蓄势：从镜头 ${first.id} 建立空间与力量关系`,
    `转势：在中段镜头推动关系变化`,
    `爆发：在镜头 ${last.id} 附近完成局势改写`,
  ];
}

function extractShotsPayload(parsed: unknown): { shotsRaw: unknown[]; narrativeBeatsRaw: unknown } | null {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { shotsRaw: [], narrativeBeatsRaw: undefined };
    }
    const allObjects = parsed.every((x) => x != null && typeof x === 'object' && !Array.isArray(x));
    if (!allObjects) return null;
    return { shotsRaw: parsed, narrativeBeatsRaw: undefined };
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.shots)) return null;
  return { shotsRaw: o.shots, narrativeBeatsRaw: o.narrativeBeats };
}

function coerceShotId(r: Record<string, unknown>, idx: number): number {
  if (typeof r.id === 'number' && Number.isFinite(r.id)) return Math.floor(r.id);
  if (typeof r.shotNo === 'number' && Number.isFinite(r.shotNo)) return Math.floor(r.shotNo);
  return idx + 1;
}

function normalizeMergedMembers(value: unknown): StoryboardShot[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, idx) => normalizeStoryboardApiShot(item, idx));
}

function normalizeStoryboardApiShot(row: unknown, idx: number): StoryboardShot {
  if (!row || typeof row !== 'object') {
    throw new Error(`分镜模型返回：shots[${idx}] 必须是对象。`);
  }
  const r = row as Record<string, unknown>;
  const id = coerceShotId(r, idx);
  const shotNoRaw = String(r.shotNo ?? r.shot_no ?? r.shotId ?? r.镜头号 ?? r.镜号 ?? '').trim();
  const shotNo = shotNoRaw || undefined;
  const wireId =
    typeof r.wireId === 'string' && r.wireId.trim() ? r.wireId.trim() : createStoryboardShotWireId(id);
  const type = String(r.type ?? r.shot_type ?? r.景别 ?? '中景').trim() || '中景';
  const movement = String(r.movement ?? r.camera_movement ?? r.运镜 ?? '固定').trim() || '固定';
  const description = String(r.description ?? r.visual_description ?? r.画面描述 ?? '').trim();
  const content =
    typeof r.content === 'string'
      ? r.content
      : typeof r.dialogue === 'string'
        ? r.dialogue
        : '';
  const sceneRef = typeof r.sceneRef === 'string' && r.sceneRef.trim() ? r.sceneRef.trim() : undefined;
  const actionRaw = String(r.action ?? r.动作 ?? r.blocking ?? '').trim();
  const action = actionRaw || undefined;
  const soundRaw = String(r.sound ?? '').trim();
  const sound = soundRaw || undefined;
  const durationRaw = r.durationSec ?? r.duration_sec ?? r.duration ?? r.seconds ?? r.时间 ?? r.时长 ?? r.秒数;
  const durationSec =
    typeof durationRaw === 'number' && Number.isFinite(durationRaw)
      ? Math.max(0.5, Math.round(durationRaw * 10) / 10)
      : typeof durationRaw === 'string' && /^\d+(?:\.\d+)?(?:\s*(?:秒|s))?$/i.test(durationRaw.trim())
        ? Math.max(0.5, Math.round(Number.parseFloat(durationRaw.trim().replace(/秒|s/gi, '')) * 10) / 10)
        : undefined;
  const noteRaw = String(r.note ?? r.备注 ?? '').trim();
  const note = noteRaw || undefined;
  const mergedMembers = normalizeMergedMembers(r.mergedMembers ?? r.merged_members);
  return {
    id,
    shotNo,
    wireId,
    type,
    movement,
    description,
    content,
    sceneRef,
    action,
    sound,
    durationSec,
    note,
    mergedMembers,
  };
}

function parseStoryboardPayload(
  x: unknown,
  opts: { strictDescriptions: boolean; allowEmptyShots: boolean },
): StoryboardOutput {
  const extracted = extractShotsPayload(x);
  if (!extracted) {
    throw new Error('分镜模型返回：必须是镜头 JSON 数组，或形如 { "shots": [ ... ] } 的对象。');
  }
  const shots = extracted.shotsRaw.map((row, i) => normalizeStoryboardApiShot(row, i));
  if (!opts.allowEmptyShots && shots.length === 0) {
    throw new Error('分镜模型返回：必须包含非空 shots。');
  }
  if (opts.strictDescriptions) {
    for (const s of shots) {
      if (!s.description.trim()) {
        throw new Error(`分镜模型返回：镜头 ${s.id} 缺少 description / visual_description / 画面描述。`);
      }
    }
  }
  const narrativeBeats =
    Array.isArray(extracted.narrativeBeatsRaw) && extracted.narrativeBeatsRaw.length > 0
      ? extracted.narrativeBeatsRaw.map((b, i) => (typeof b === 'string' ? b : String(b ?? `节拍 ${i + 1}`)))
      : deriveNarrativeBeatsFromShots(shots);
  return { narrativeBeats, shots };
}

export function assertStoryboardOutput(x: unknown): StoryboardOutput {
  return parseStoryboardPayload(x, { strictDescriptions: true, allowEmptyShots: false });
}

export function tryParseStoryboardOutput(x: unknown): StoryboardOutput | null {
  try {
    return parseStoryboardPayload(x, { strictDescriptions: false, allowEmptyShots: true });
  } catch {
    return null;
  }
}

function buildStoryboardUserPromptFromWriting(script: WritingOutput): string {
  return `以下为结构化场次表（WritingOutput JSON）。请严格按“徐克式导演分镜流程”处理：先判断场面命题、主次机制、空间结构、人物功能、势能递进与英雄画面，再把这些判断落实到镜头表里，但最终只输出合法 JSON。

硬性要求：
1. narrativeBeats 尽量写成“蓄势 / 转势 / 爆发 / 收束”式节奏摘要，而不是单纯复述剧情。
2. shots 中每条镜头都必须体现空间关系、力量变化、环境参与或英雄画面任务，不能只是平铺动作。
3. note 优先写镜头意图、主机制、转势点、环境发动方式、英雄画面属性。
4. 武侠 / 奇幻 / 围猎 / 追逐 / 突围场面优先加强纵深、高低差、遮挡揭示、突然现身与第二波压迫。
5. 若同场连续镜头确实适合 15 秒内组合，可用 mergedMembers；否则优先细分镜头。
6. 若输入包含“视觉场景参考图 / 图片场景分析”，必须把图片当作场景设定硬约束：所有镜头的地点、时代、空间方向、光影色彩、美术质感、可见道具/建筑/环境元素和氛围都必须与图片一致，并在 sceneRef、description 或 note 中落地，不得生成与参考图冲突的场景设定。
7. shots 中每条镜头都必须输出 durationSec，单位为秒；请根据动作复杂度、对白长度、情绪停顿、景别变化和信息密度合理分配镜头时间，不要平均分配，也不要为了凑时长硬拉长。

只输出形如 { "shots": [ ... ], "narrativeBeats": [ ... ] } 的 JSON。

${JSON.stringify(script)}`;
}

function buildStoryboardUserPromptFromRawText(t: string): string {
  return `以下为剧本或剧情文本。请先自行提炼场面命题，再分析主次机制、空间结构、人物功能、势能递进与英雄画面，然后把这些判断落实为镜头表，但最终只输出合法 JSON。

硬性要求：
1. 不得跳过场面机制分析后直接切镜。
2. narrativeBeats 尽量体现“蓄势 / 转势 / 爆发 / 收束”。
3. 每个镜头都要服务关系变化，环境必须参与动作，不能只写剧情摘要。
4. 对话戏也要处理显藏关系、空间压迫与力量变化。
5. 若信息不足，可以合理推定空间层次、危险源、可借力物，但应体现在 note 或 narrativeBeats 中。
6. 只有在同场连续镜头明确适合 15 秒内合并时，才使用 mergedMembers。
7. 若输入包含“视觉场景参考图 / 图片场景分析”，必须把图片当作场景设定硬约束：所有镜头的地点、时代、空间方向、光影色彩、美术质感、可见道具/建筑/环境元素和氛围都必须与图片一致，并在 sceneRef、description 或 note 中落地，不得生成与参考图冲突的场景设定。
8. shots 中每条镜头都必须输出 durationSec，单位为秒；请根据动作复杂度、对白长度、情绪停顿、景别变化和信息密度合理分配镜头时间，不要平均分配，也不要为了凑时长硬拉长。

只输出形如 { "shots": [ ... ], "narrativeBeats": [ ... ] } 的 JSON。

${t}`;
}

export async function runStoryboardDesigner(
  script: WritingOutput,
  executionSystemPrompt?: string,
  onDelta?: (delta: string, accumulated: string) => void,
  signal?: AbortSignal,
): Promise<StoryboardOutput> {
  const sys = `${(executionSystemPrompt ?? STORYBOARD_DEPT_AGENT_SYSTEM).trim()}\n\n【输出 JSON 形状参考】\n${STORYBOARD_DEPT_OUTPUT_SHAPE}`;
  const parsed = await invokeLlmJsonObjectStream({
    systemPrompt: sys,
    userPrompt: buildStoryboardUserPromptFromWriting(script),
    temperature: 0.35,
    onDelta,
    signal,
  });
  return assertStoryboardOutput(parsed);
}

function tryParseWritingOutput(raw: string): WritingOutput | null {
  const t = raw?.trim() ?? '';
  if (!t.startsWith('{')) return null;
  try {
    const j = JSON.parse(t) as unknown;
    if (!j || typeof j !== 'object') return null;
    const x = j as Record<string, unknown>;
    if (!Array.isArray(x.scenes) || x.scenes.length === 0) return null;
    return j as WritingOutput;
  } catch {
    return null;
  }
}

export async function runStoryboardDesignerFromScriptText(
  raw: string,
  executionSystemPrompt: string,
  onDelta?: (delta: string, accumulated: string) => void,
  signal?: AbortSignal,
): Promise<StoryboardOutput> {
  const script = tryParseWritingOutput(raw);
  if (script) {
    return runStoryboardDesigner(script, executionSystemPrompt, onDelta, signal);
  }
  const t = raw.trim();
  if (!t) {
    return { shots: [], narrativeBeats: [] };
  }
  const sys = `${executionSystemPrompt.trim()}\n\n【输出 JSON 形状参考】\n${STORYBOARD_DEPT_OUTPUT_SHAPE}`;
  const parsed = await invokeLlmJsonObjectStream({
    systemPrompt: sys,
    userPrompt: buildStoryboardUserPromptFromRawText(t),
    temperature: 0.35,
    onDelta,
    signal,
  });
  return assertStoryboardOutput(parsed);
}

export type LeaderDecision = { approved: true } | { approved: false; feedback: string };

export async function runStoryboardLeaderReview(
  output: StoryboardOutput,
  sourceSceneCount: number,
  signal?: AbortSignal,
): Promise<LeaderDecision> {
  const userPrompt = [
    sourceSceneCount > 0 ? `参考场次数（用于节奏对齐）：${sourceSceneCount}\n` : '',
    '以下为员工产出的分镜 JSON，请按徐克式分镜总监规范审核，重点检查场面机制、空间层次、环境参与、势能递进、英雄画面与徐克误区。\n\n',
    JSON.stringify(output, null, 2),
  ].join('');
  const res = await invokeLlmLeaderReview({
    systemPrompt: STORYBOARD_LEADER_SPEC,
    userPrompt,
    temperature: 0.2,
    signal,
  });
  return res.approved ? { approved: true } : { approved: false, feedback: res.feedback ?? '请按审核意见强化场面机制、空间关系与势能设计。' };
}
