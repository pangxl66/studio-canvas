import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';
import { parseShotListItemOutputHandleId } from '@/utils/shotListWire';

/** 与 `DepartmentNode` 左侧 Input 目标 Handle 一致 */
export const DEPT_INPUT_HANDLE_ID = 'in';
export const DEPT_OUTPUT_HANDLE_ID = 'out';
export const DEPT_INPUT_PULL_HANDLE_ID = 'input-pull';

/**
 * 是否存在有效连线：TEXT_NODE 或上游部门 Output → 本节点 Input（`in`）。
 * 与画布 `DepartmentNode` 展示逻辑一致。
 */
export function departmentNodeHasInputWire(deptNodeId: string, edges: Edge[], nodes: StudioRFNode[]): boolean {
  return edges.some((e) => {
    if (e.target !== deptNodeId) return false;
    if (e.targetHandle != null && e.targetHandle !== DEPT_INPUT_HANDLE_ID) return false;
    const src = nodes.find((n) => n.id === e.source);
    if (!src) return false;
    if (src.type === 'textNode') return true;
    if (src.type === 'imageNode' && src.data.type === 'image_node') {
      const target = nodes.find((n) => n.id === deptNodeId);
      return target?.type === 'department' && target.data.type === 'storyboard';
    }
    if (src.type === 'department' && (e.sourceHandle == null || e.sourceHandle === DEPT_OUTPUT_HANDLE_ID))
      return true;
    if (src.type === 'storyboardFile' && (e.sourceHandle == null || e.sourceHandle === DEPT_OUTPUT_HANDLE_ID))
      return true;
    if (
      src.type === 'shotList' &&
      src.data.type === 'shot_list_node' &&
      parseShotListItemOutputHandleId(e.sourceHandle) != null
    )
      return true;
    return false;
  });
}
