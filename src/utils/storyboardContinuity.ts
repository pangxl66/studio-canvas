import type {
  StoryboardCharacterContinuityState,
  StoryboardFrameState,
  StoryboardOutput,
  StoryboardSceneSpatialMap,
  StoryboardShot,
  StoryboardShotContinuity,
} from '@/types/studio';

const text = (value: unknown): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
};

const stringList = (value: unknown): string[] | undefined => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[、，,;；|/]+/)
      : [];
  const result = Array.from(new Set(source.map((item) => String(item ?? '').trim()).filter(Boolean)));
  return result.length ? result : undefined;
};

export function normalizeStoryboardCharacterState(
  value: unknown,
): StoryboardCharacterContinuityState | null {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name = text(row.name ?? row.character ?? row.role ?? row.角色 ?? row.人物);
  if (!name) return null;
  return {
    name,
    worldPosition: text(
      row.worldPosition ?? row.world_position ?? row.zone ?? row.anchor ?? row.世界位置 ?? row.场景位置,
    ),
    screenPosition: text(
      row.screenPosition ?? row.screen_position ?? row.framePosition ?? row.画面位置 ?? row.银幕位置,
    ),
    depth: text(row.depth ?? row.depthPlane ?? row.depth_plane ?? row.纵深 ?? row.景深层级),
    facing: text(row.facing ?? row.orientation ?? row.朝向),
    gazeTarget: text(row.gazeTarget ?? row.gaze_target ?? row.视线目标 ?? row.注视目标),
    movementDirection: text(
      row.movementDirection ?? row.movement_direction ?? row.travelDirection ?? row.移动方向,
    ),
    posture: text(row.posture ?? row.pose ?? row.姿态),
    heldProps: stringList(row.heldProps ?? row.held_props ?? row.props ?? row.持有道具),
  };
}

export function normalizeStoryboardFrameState(
  value: unknown,
  fallbackCharacters: string[] = [],
): StoryboardFrameState {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const rawCharacters = row.characters ?? row.characterStates ?? row.character_states ?? row.角色状态;
  const characters = Array.isArray(rawCharacters)
    ? rawCharacters
        .map(normalizeStoryboardCharacterState)
        .filter((item): item is StoryboardCharacterContinuityState => item != null)
    : fallbackCharacters.map((name) => ({ name }));
  return {
    characters,
    cameraSide: text(row.cameraSide ?? row.camera_side ?? row.机位侧 ?? row.轴线侧),
    actionAxis: text(row.actionAxis ?? row.action_axis ?? row.动作轴 ?? row.轴线),
    actionPhase: text(row.actionPhase ?? row.action_phase ?? row.动作阶段),
    propState: stringList(row.propState ?? row.prop_state ?? row.道具状态),
    environmentState: stringList(
      row.environmentState ?? row.environment_state ?? row.环境状态,
    ),
  };
}

export function normalizeStoryboardShotContinuity(
  value: unknown,
  shot: Pick<StoryboardShot, 'characters' | 'action' | 'description'>,
): StoryboardShotContinuity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const inheritRaw = row.inheritsFromShotId ?? row.inherits_from_shot_id ?? row.previousShotId ?? row.继承镜头;
  const inheritsFromShotId = typeof inheritRaw === 'number' && Number.isFinite(inheritRaw)
    ? Math.floor(inheritRaw)
    : typeof inheritRaw === 'string' && /^\d+$/.test(inheritRaw.trim())
      ? Number.parseInt(inheritRaw, 10)
      : undefined;
  const fallbackCharacters = shot.characters ?? [];
  const rawStartState = row.startState ?? row.start_state ?? row.起始状态;
  const rawEndState = row.endState ?? row.end_state ?? row.结束状态;
  const startState = normalizeStoryboardFrameState(
    rawStartState,
    fallbackCharacters,
  );
  const endState = normalizeStoryboardFrameState(
    rawEndState,
    fallbackCharacters,
  );
  if (!endState.actionPhase) endState.actionPhase = shot.action?.trim() || shot.description.trim() || undefined;
  return {
    inheritsFromShotId,
    startState,
    endState,
    transition: text(row.transition ?? row.transitionType ?? row.transition_type ?? row.衔接方式),
    intentionalBreak: row.intentionalBreak === true || row.intentional_break === true || row.有意跳变 === true,
    breakReason: text(row.breakReason ?? row.break_reason ?? row.跳变原因),
    inferred: row.inferred === true || !rawStartState || !rawEndState,
  };
}

const cloneState = (state: StoryboardFrameState): StoryboardFrameState => ({
  ...state,
  characters: state.characters.map((item) => ({
    ...item,
    heldProps: item.heldProps ? [...item.heldProps] : undefined,
  })),
  propState: state.propState ? [...state.propState] : undefined,
  environmentState: state.environmentState ? [...state.environmentState] : undefined,
});

const sameScene = (left: StoryboardShot | undefined, right: StoryboardShot): boolean => {
  if (!left) return false;
  const a = left.sceneRef?.trim() ?? '';
  const b = right.sceneRef?.trim() ?? '';
  return a === b;
};

/**
 * Makes continuity structurally available for both new and legacy projects.
 * Missing legacy data is inherited conservatively and marked inferred, never presented as model-confirmed fact.
 */
export function ensureStoryboardContinuity(shots: StoryboardShot[]): StoryboardShot[] {
  let previous: StoryboardShot | undefined;
  return shots.map((source) => {
    const explicit = source.continuity;
    const carriesPrevious = sameScene(previous, source);
    const fallbackCharacters = source.characters ?? [];
    const previousEnd = carriesPrevious ? previous?.continuity?.endState : undefined;
    const startState = explicit?.startState
      ? cloneState(explicit.startState)
      : previousEnd
        ? cloneState(previousEnd)
        : normalizeStoryboardFrameState(undefined, fallbackCharacters);
    const endState = explicit?.endState
      ? cloneState(explicit.endState)
      : cloneState(startState);
    if (!endState.actionPhase) {
      endState.actionPhase = source.action?.trim() || source.description.trim() || undefined;
    }
    const continuity: StoryboardShotContinuity = {
      inheritsFromShotId:
        explicit?.inheritsFromShotId ?? (carriesPrevious ? previous?.id : undefined),
      startState,
      endState,
      transition: explicit?.transition ?? (carriesPrevious ? 'continuous' : 'establishing'),
      intentionalBreak: explicit?.intentionalBreak ?? false,
      breakReason: explicit?.breakReason,
      inferred: explicit?.inferred === true || !explicit,
    };
    const shot = { ...source, continuity };
    previous = shot;
    return shot;
  });
}

export function normalizeStoryboardSceneSpatialMaps(value: unknown): StoryboardSceneSpatialMap[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const maps = value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const sceneRef = text(row.sceneRef ?? row.scene_ref ?? row.sceneId ?? row.场景编号);
    if (!sceneRef) return [];
    return [{
      sceneRef,
      sceneLabel: text(row.sceneLabel ?? row.scene_label ?? row.场景名称),
      anchors: stringList(row.anchors ?? row.spatialAnchors ?? row.spatial_anchors ?? row.空间锚点) ?? [],
      actionAxis: text(row.actionAxis ?? row.action_axis ?? row.动作轴),
      defaultCameraSide: text(row.defaultCameraSide ?? row.default_camera_side ?? row.默认机位侧),
      initialState: row.initialState || row.initial_state || row.初始状态
        ? normalizeStoryboardFrameState(row.initialState ?? row.initial_state ?? row.初始状态)
        : undefined,
      notes: stringList(row.notes ?? row.备注),
      inferred: row.inferred === true,
    } satisfies StoryboardSceneSpatialMap];
  });
  return maps.length ? maps : undefined;
}

export function ensureStoryboardSceneSpatialMaps(
  shots: StoryboardShot[],
  maps: StoryboardSceneSpatialMap[] | undefined,
): StoryboardSceneSpatialMap[] | undefined {
  const existing = new Map((maps ?? []).map((map) => [map.sceneRef.trim(), map]));
  const sceneRefs = Array.from(new Set(shots.map((shot) => shot.sceneRef?.trim()).filter(Boolean))) as string[];
  sceneRefs.forEach((sceneRef) => {
    if (existing.has(sceneRef)) return;
    const first = shots.find((shot) => shot.sceneRef?.trim() === sceneRef);
    const initialState = first?.continuity?.startState;
    const anchors = Array.from(new Set(
      (initialState?.characters ?? []).map((item) => item.worldPosition?.trim()).filter(Boolean),
    )) as string[];
    existing.set(sceneRef, {
      sceneRef,
      anchors,
      actionAxis: initialState?.actionAxis,
      defaultCameraSide: initialState?.cameraSide,
      initialState: initialState ? cloneState(initialState) : undefined,
      notes: ['旧工程自动建立的空间底图，建议在连续性面板中确认。'],
      inferred: true,
    });
  });
  return existing.size ? Array.from(existing.values()) : undefined;
}

export type StoryboardContinuitySeverity = 'ok' | 'warning' | 'untracked';

export interface StoryboardContinuityAudit {
  severity: StoryboardContinuitySeverity;
  issues: string[];
}

const indexCharacters = (state: StoryboardFrameState | undefined) =>
  new Map((state?.characters ?? []).map((item) => [item.name.trim(), item]));

export function auditStoryboardShotContinuity(
  shot: StoryboardShot,
  previous?: StoryboardShot,
): StoryboardContinuityAudit {
  const continuity = shot.continuity;
  if (!continuity) return { severity: 'untracked', issues: ['尚未建立连续性状态'] };
  const issues: string[] = [];
  if (continuity.inferred) issues.push('状态由旧数据自动补齐，建议确认');
  if (sameScene(previous, shot) && !continuity.intentionalBreak) {
    const expected = previous?.continuity?.endState;
    if (expected && continuity.inheritsFromShotId !== previous?.id) {
      issues.push(`应继承镜头 ${previous?.id ?? '-'}`);
    }
    if (
      expected?.cameraSide && continuity.startState.cameraSide &&
      expected.cameraSide !== continuity.startState.cameraSide
    ) {
      issues.push(`机位侧不连续：${expected.cameraSide} → ${continuity.startState.cameraSide}`);
    }
    const expectedCharacters = indexCharacters(expected);
    const actualCharacters = indexCharacters(continuity.startState);
    expectedCharacters.forEach((before, name) => {
      const after = actualCharacters.get(name);
      if (!after) return;
      if (before.worldPosition && after.worldPosition && before.worldPosition !== after.worldPosition) {
        issues.push(`${name} 场景位置跳变：${before.worldPosition} → ${after.worldPosition}`);
      }
      if (before.heldProps?.length && after.heldProps?.length) {
        const beforeProps = [...before.heldProps].sort().join('|');
        const afterProps = [...after.heldProps].sort().join('|');
        if (beforeProps !== afterProps) issues.push(`${name} 持有道具不连续`);
      }
    });
  }
  return {
    severity: issues.length ? (continuity.inferred ? 'untracked' : 'warning') : 'ok',
    issues,
  };
}

const stateLine = (state: StoryboardFrameState): string => {
  const characters = state.characters.map((item) => {
    const position = [item.worldPosition, item.screenPosition, item.depth].filter(Boolean).join(' / ');
    const behavior = [item.facing && `朝向${item.facing}`, item.gazeTarget && `看向${item.gazeTarget}`]
      .filter(Boolean)
      .join('，');
    return `${item.name}${position ? `（${position}）` : ''}${behavior ? `：${behavior}` : ''}`;
  });
  return [
    state.cameraSide && `机位侧=${state.cameraSide}`,
    state.actionAxis && `动作轴=${state.actionAxis}`,
    characters.length ? `主体=${characters.join('；')}` : undefined,
    state.actionPhase && `动作阶段=${state.actionPhase}`,
  ].filter(Boolean).join('；');
};

export function summarizeStoryboardShotContinuity(shot: StoryboardShot): string {
  const continuity = shot.continuity;
  if (!continuity) return '连续性：未记录';
  return [
    `衔接=${continuity.transition ?? 'continuous'}`,
    continuity.inheritsFromShotId ? `继承镜头=${continuity.inheritsFromShotId}` : undefined,
    `起始[${stateLine(continuity.startState) || '未填写'}]`,
    `结束[${stateLine(continuity.endState) || '未填写'}]`,
    continuity.intentionalBreak ? `有意跳变=${continuity.breakReason || '已标记'}` : undefined,
  ].filter(Boolean).join('；');
}

export function buildStoryboardContinuityContext(output: StoryboardOutput): string {
  const spatialMaps = (output.sceneSpatialMaps ?? []).map((map) =>
    `${map.sceneRef}：锚点=${map.anchors.join('、') || '未记录'}；动作轴=${map.actionAxis || '未记录'}；默认机位侧=${map.defaultCameraSide || '未记录'}`,
  );
  const shots = output.shots.map((shot) => `镜头${shot.shotNo || shot.id}：${summarizeStoryboardShotContinuity(shot)}`);
  return ['【场景空间底图】', ...spatialMaps, '【逐镜连续性账本】', ...shots].join('\n');
}
