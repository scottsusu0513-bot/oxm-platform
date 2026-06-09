export const PTR_THRESHOLD = 72;
export const PTR_MAX_PULL = 120;
export const PTR_RESISTANCE = 0.45;
export const PTR_DIRECTION_RATIO = 1.2;

export function computePullDistance(deltaY: number): number {
  return Math.min(deltaY * PTR_RESISTANCE, PTR_MAX_PULL);
}

export function determineGestureDirection(
  deltaY: number,
  deltaX: number,
  minMovement = 4,
): "vertical" | "horizontal" | null {
  if (Math.abs(deltaY) <= minMovement && Math.abs(deltaX) <= minMovement) return null;
  return Math.abs(deltaY) > Math.abs(deltaX) * PTR_DIRECTION_RATIO ? "vertical" : "horizontal";
}

export function shouldTriggerRefresh(visualDistance: number): boolean {
  return visualDistance >= PTR_THRESHOLD;
}
