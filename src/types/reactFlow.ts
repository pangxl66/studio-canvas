import type { Node } from '@xyflow/react';
import type { StudioNodeData } from '@/types/studio';

export type StudioRFNode =
  | Node<StudioNodeData, 'department'>
  | Node<StudioNodeData, 'textNode'>
  | Node<StudioNodeData, 'shotList'>
  | Node<StudioNodeData, 'storyboardFile'>
  | Node<StudioNodeData, 'promptReview'>
  | Node<StudioNodeData, 'imageNode'>
  | Node<StudioNodeData, 'scriptInput'>
  | Node<StudioNodeData, 'scriptAnalyzer'>
  | Node<StudioNodeData, 'scriptOutput'>;
