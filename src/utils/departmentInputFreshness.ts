type DepartmentInputEdge = {
  target: string;
  targetHandle?: string | null;
};

export function hasDepartmentInputConnections(
  deptId: string,
  edges: DepartmentInputEdge[],
): boolean {
  return edges.some(
    (edge) =>
      edge.target === deptId &&
      (edge.targetHandle === 'in' || edge.targetHandle == null),
  );
}

export function resolveFreshDepartmentInput(
  mergedInput: string | null,
  fallbackInput: string,
  hasGraphInput: boolean,
  preferManualInput = false,
): string {
  if (preferManualInput && fallbackInput.trim()) return fallbackInput.trim();
  return hasGraphInput ? mergedInput?.trim() ?? '' : fallbackInput.trim();
}

export function hasUsableImageReference(data: { imageDataUrl?: string }): boolean {
  return Boolean(data.imageDataUrl?.trim());
}
