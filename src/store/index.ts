/**
 * Zustand 状态入口
 *
 * 1. 节点业务字段：id, type, department, status, input, output, review_result, version → `StudioNodeData`（@/types/studio）
 * 2. 状态机与「仅 APPROVED 可给下游用」→ `workflow.ts` + `assets` 登记逻辑（见 useStudioStore）
 */
export { useStudioStore } from './useStudioStore';
export { useProjectContextStore } from './useProjectContextStore';
export {
  canTransitionPipelineStatus,
  getLatestApprovedWritingAsset,
  getLatestApprovedWritingBundle,
  PIPELINE_INITIAL_STATUS,
} from './workflow';
