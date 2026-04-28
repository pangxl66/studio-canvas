import type { ApprovedAsset, NodeKind, NodeStatus, WritingOutput } from '@/types/studio';

/**
 * 画布节点业务数据必须包含（见 StudioNodeData）：
 * id, type, department, status, input, output, review_result, version
 *
 * 部门流水线初始状态一律为 NOT_STARTED；文本便签（type: text）不参与审核机。
 */

export const PIPELINE_INITIAL_STATUS: NodeStatus = 'NOT_STARTED';

/** 允许的部门流水线状态边（不含 text 节点） */
const ALLOWED_TRANSITIONS: Record<NodeStatus, NodeStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS'],
  /** 员工 + 自动总监结束后进入已阅；失败回退 NOT_STARTED；异常打回保留 REJECTED */
  IN_PROGRESS: ['REVIEWED', 'WAITING_REVIEW', 'NOT_STARTED', 'REJECTED'],
  /** 旧版终裁态（兼容已存画布） */
  WAITING_REVIEW: ['APPROVED', 'REJECTED', 'IN_PROGRESS'],
  /** 已阅：优化迭代回到生成中，或终审通过 / 打回 */
  REVIEWED: ['IN_PROGRESS', 'APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: ['IN_PROGRESS', 'NOT_STARTED'],
};

/**
 * 标准流转：NOT_STARTED → IN_PROGRESS（AI）→ WAITING_REVIEW → APPROVED | REJECTED
 * Prompt 节点例外：生成完成后可直接从 IN_PROGRESS 进入 APPROVED，跳过总监审核。
 */
export function canTransitionPipelineStatus(from: NodeStatus, to: NodeStatus, kind?: NodeKind): boolean {
  if (kind === 'prompt' && from === 'IN_PROGRESS' && to === 'APPROVED') {
    return true;
  }
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 下游部门（如分镜部）**仅允许**使用已通过 Leader 审核的产出。
 * 实现上只从 `assets` 读取：登记发生在节点 status 变为 APPROVED 时，
 * 禁止直接读取仍处于 WAITING_REVIEW / REJECTED 的节点 `output` 作为跨部门输入。
 */
export function getLatestApprovedWritingAsset(assets: ApprovedAsset[]): WritingOutput | null {
  const b = getLatestApprovedWritingBundle(assets);
  return b?.script ?? null;
}

/** 分镜部拉取剧本时携带的资产元数据，便于节点 input 审计溯源 */
export type ApprovedWritingBundle = {
  script: WritingOutput;
  assetNodeId: string;
  assetVersion: number;
  registeredAt: number;
};

function isValidWritingPayload(p: unknown): p is WritingOutput {
  if (!p || typeof p !== 'object') return false;
  const x = p as WritingOutput;
  return Array.isArray(x.episodes) && Array.isArray(x.scenes) && x.scenes.length > 0;
}

/**
 * 从资产系统取**最新一条**已登记 WRITING 资产；payload 非法则视为不可用。
 */
export function getLatestApprovedWritingBundle(assets: ApprovedAsset[]): ApprovedWritingBundle | null {
  const list = assets.filter((a) => a.department === 'WRITING').sort((a, b) => b.createdAt - a.createdAt);
  const top = list[0];
  if (!top) return null;
  if (!isValidWritingPayload(top.payload)) return null;
  return {
    script: top.payload,
    assetNodeId: top.nodeId,
    assetVersion: top.version,
    registeredAt: top.createdAt,
  };
}
