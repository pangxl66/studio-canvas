import type { Edge } from '@xyflow/react';
import type { StudioRFNode } from '@/types/reactFlow';

/** 大脑执行时所需的画布上下文 */
export type BrainExecuteContext = {
  nodes: StudioRFNode[];
  edges: Edge[];
};

/**
 * 输入不完整或类型不匹配时抛出，供 UI 捕获并提示用户连线/补全数据。
 */
export class BrainInputError extends Error {
  readonly code: string;

  constructor(message: string, code = 'BRAIN_INPUT_INCOMPLETE') {
    super(message);
    this.name = 'BrainInputError';
    this.code = code;
  }
}

export function isBrainInputError(e: unknown): e is BrainInputError {
  return e instanceof BrainInputError;
}
