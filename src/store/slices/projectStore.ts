import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import {
  normalizeRestoredStudioNode,
  rebindStudioNodeRuntimeHandlers,
} from '@/utils/studioNodePersistence';
import { removeDeprecatedScriptNodes } from '@/utils/deprecatedScriptNodes';
import { SHOT_LIST_LINK_HANDLE_ID } from '@/utils/shotListWire';
import {
  createDefaultProjectSettings,
  normalizeProjectSettings,
  projectSettingsEqual,
} from '@/services/projectSettings';
import {
  isPromptStyleSkillId,
  normalizeMountedSkillIdsForKind,
} from '@/services/skillLoader';
import type { StudioState } from '../useStudioStore';

type StudioSet = (
  partial:
    | Partial<StudioState>
    | StudioState
    | ((state: StudioState) => Partial<StudioState> | StudioState),
) => void;

type StudioGet = () => StudioState;

type ProjectSlice = Pick<
  StudioState,
  'setCurrentProjectMeta' | 'updateProjectSettings' | 'createNewProject' | 'hydrateProject'
>;

type ProjectSliceDeps = {
  uid: (prefix: string) => string;
  nextProjectName: (projectName?: string | null) => string;
  pushUndoSnapshot: (set: StudioSet) => void;
};

export function createProjectStoreSlice(
  set: StudioSet,
  get: StudioGet,
  deps: ProjectSliceDeps,
): ProjectSlice {
  return {
    setCurrentProjectMeta: (projectId, projectName) => {
      set({
        currentProjectId: projectId,
        currentProjectName: deps.nextProjectName(projectName),
      });
    },

    updateProjectSettings: (settings) => {
      const previous = get().projectSettings;
      const normalized = normalizeProjectSettings(settings);
      if (projectSettingsEqual(previous, normalized)) return;

      const nextSettings = { ...normalized, revision: previous.revision + 1 };
      const aspectChanged = previous.aspectRatio !== nextSettings.aspectRatio;
      const styleChanged =
        previous.overallStyle.enabled !== nextSettings.overallStyle.enabled
        || previous.overallStyle.text.trim() !== nextSettings.overallStyle.text.trim();
      const storyboardSkillChanged =
        previous.defaultSkills.storyboardSkillId
        !== nextSettings.defaultSkills.storyboardSkillId;
      const promptSkillChanged =
        previous.defaultSkills.promptSkillId !== nextSettings.defaultSkills.promptSkillId;

      set((state) => ({
        projectSettings: nextSettings,
        nodes: state.nodes.map((node) => {
          const data = node.data;
          if (node.type === 'department' && data.type === 'storyboard') {
            const currentPrimary = (data.mounted_skills ?? [])[0];
            const followsProject =
              data.skill_source === 'project'
              || (data.skill_source == null
                && (!currentPrimary || currentPrimary === previous.defaultSkills.storyboardSkillId));
            const affected = aspectChanged || styleChanged || (storyboardSkillChanged && followsProject);
            if (!affected && data.skill_source != null) return node;
            return {
              ...node,
              data: {
                ...data,
                ...(followsProject
                  ? {
                      mounted_skills: normalizeMountedSkillIdsForKind(
                        'storyboard',
                        [nextSettings.defaultSkills.storyboardSkillId],
                      ),
                      skill_source: 'project' as const,
                    }
                  : { skill_source: 'node' as const }),
                ...(affected && data.output
                  ? { output_stale_reason: '项目全局设定已更新，请重新生成后生效。' }
                  : {}),
              },
            };
          }

          if (node.type === 'department' && data.type === 'prompt') {
            const mounted = data.mounted_skills ?? [];
            const currentPrimary = mounted.find(isPromptStyleSkillId);
            const followsProject =
              data.skill_source === 'project'
              || (data.skill_source == null
                && (!currentPrimary || currentPrimary === previous.defaultSkills.promptSkillId));
            const affected = aspectChanged || styleChanged || (promptSkillChanged && followsProject);
            if (!affected && data.skill_source != null) return node;
            const enhancements = mounted.filter((id) => !isPromptStyleSkillId(id));
            return {
              ...node,
              data: {
                ...data,
                ...(followsProject
                  ? {
                      mounted_skills: normalizeMountedSkillIdsForKind('prompt', [
                        nextSettings.defaultSkills.promptSkillId,
                        ...enhancements,
                      ]),
                      skill_source: 'project' as const,
                    }
                  : { skill_source: 'node' as const }),
                ...(affected && data.output
                  ? { output_stale_reason: '项目全局设定已更新，请重新生成后生效。' }
                  : {}),
              },
            };
          }

          if (node.type === 'aiFilmStoryboard') {
            const followsAspect =
              data.film_storyboard_aspect_ratio_source === 'project'
              || (data.film_storyboard_aspect_ratio_source == null
                && (!data.film_storyboard_aspect_ratio
                  || data.film_storyboard_aspect_ratio === previous.aspectRatio));
            const followsSkill =
              data.film_storyboard_skill_source === 'project'
              || (data.film_storyboard_skill_source == null
                && (!data.film_storyboard_skill_id
                  || data.film_storyboard_skill_id === previous.defaultSkills.storyboardSkillId));
            const affected =
              styleChanged
              || (aspectChanged && followsAspect)
              || (storyboardSkillChanged && followsSkill);
            if (
              !affected
              && data.film_storyboard_aspect_ratio_source != null
              && data.film_storyboard_skill_source != null
            ) {
              return node;
            }
            return {
              ...node,
              data: {
                ...data,
                ...(followsAspect
                  ? {
                      film_storyboard_aspect_ratio: nextSettings.aspectRatio,
                      film_storyboard_aspect_ratio_source: 'project' as const,
                    }
                  : { film_storyboard_aspect_ratio_source: 'node' as const }),
                ...(followsSkill
                  ? {
                      film_storyboard_skill_id: nextSettings.defaultSkills.storyboardSkillId,
                      film_storyboard_skill_source: 'project' as const,
                    }
                  : { film_storyboard_skill_source: 'node' as const }),
                ...(affected && (data.storyboardGridImages?.length || data.imageGenerationCompletedAt)
                  ? { output_stale_reason: '项目全局设定已更新，请重新生成影视分镜图。' }
                  : {}),
              },
            };
          }

          return node;
        }),
      }));
      get().pushMessage({
        role: 'broadcast',
        text: '项目全局设定已保存。已有生成结果不会自动重算；受影响节点已标记为需要重新生成。',
      });
    },

    createNewProject: (projectName) => {
      const nextProjectId = deps.uid('project');
      const nextName = deps.nextProjectName(projectName);
      deps.pushUndoSnapshot(set);
      set({
        nodes: [],
        edges: [],
        assets: [],
        messages: [],
        currentProjectId: nextProjectId,
        currentProjectName: nextName,
        projectSettings: createDefaultProjectSettings(),
        selectedNodeId: null,
        activeNodeId: null,
        detailOpen: false,
        requestFitNodeId: null,
        shotListSelectedWiresByNodeId: {},
        workflowAgentSession: null,
      });
      get().pushMessage({
        role: 'broadcast',
        text: `已新建项目「${nextName}」。`,
      });
      return nextProjectId;
    },

    hydrateProject: (nodes: StudioRFNode[], edges: Edge[], opts) => {
      const migratedStoryboardStates = nodes.filter(
        (node) =>
          node.type === 'department' &&
          node.data.type === 'storyboard' &&
          (
            node.data.status === 'WAITING_REVIEW' ||
            node.data.status === 'REVIEWED' ||
            node.data.status === 'REJECTED' ||
            node.data.review_result != null ||
            node.data.ai_review_feedback != null ||
            node.data.leader_review_suggested_pass != null ||
            node.data.generation_phase != null ||
            node.data.streaming_preview != null
          ),
      ).length;
      const normalized = nodes.map(normalizeRestoredStudioNode);
      const filtered = removeDeprecatedScriptNodes(normalized, edges);
      const api = {
        executeNodeTask: (id: string) => get().executeNodeTask(id),
        focusNode: (id: string, o?: { openDetail?: boolean }) => get().focusNode(id, o),
        removeNodesByIds: (ids: string[]) => get().removeNodesByIds(ids),
      };
      const bound = rebindStudioNodeRuntimeHandlers(filtered.nodes, api);
      const cleaned: StudioRFNode[] = bound.map((node) => ({
        ...node,
        selected: false,
        dragging: false,
      }));
      set({
        nodes: cleaned,
        edges: filtered.edges,
        assets: [],
        messages: [],
        selectedNodeId: null,
        activeNodeId: null,
        detailOpen: false,
        requestFitNodeId: null,
        shotListSelectedWiresByNodeId: {},
        currentProjectId: opts?.projectId ?? null,
        currentProjectName: deps.nextProjectName(opts?.projectName),
        projectSettings: normalizeProjectSettings(opts?.projectSettings),
        workflowAgentSession: null,
      });
      const repairedShotLists: string[] = [];
      for (const node of cleaned) {
        if (
          node.type !== 'department'
          || node.data.type !== 'storyboard'
          || node.data.status !== 'APPROVED'
          || !node.data.output
        ) {
          continue;
        }
        const hasCanonicalShotListChild = get().edges.some(
          (edge) =>
            edge.source === node.id
            && edge.sourceHandle === SHOT_LIST_LINK_HANDLE_ID
            && get().nodes.some(
              (candidate) => candidate.id === edge.target && candidate.type === 'shotList',
            ),
        );
        const childId = get().ensureShotListForStoryboard(node.id);
        if (childId && !hasCanonicalShotListChild) repairedShotLists.push(childId);
      }
      get().reconcileShotListGraphBindings();
      get().pushMessage({
        role: 'broadcast',
        text:
          opts?.broadcastText ??
          `已恢复项目，包含 ${nodes.length} 个节点、${edges.length} 条连线。`
          + (repairedShotLists.length
            ? ` 已自动补齐 ${repairedShotLists.length} 个分解表节点。`
            : '')
          + (migratedStoryboardStates
            ? ` 已清理 ${migratedStoryboardStates} 个分镜节点的旧审核状态。`
            : ''),
      });
    },
  };
}
