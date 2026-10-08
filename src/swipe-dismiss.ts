export type SwipeDismissState = {
  dragY: number
  isDragging: boolean
  isDismissing: boolean
  backdropOpacity: number
  scale: number
}

export const SWIPE_DISMISS_THRESHOLD_PX = 80
export const SWIPE_DISMISS_TOUCH_SLOP_PX = 10

export function processSwipeMove(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  isAlreadyActive: boolean
): { active: boolean; dragY: number; shouldPreventDefault: boolean } {
  const deltaX = currentX - startX
  const deltaY = currentY - startY

  if (!isAlreadyActive) {
    if (deltaY > SWIPE_DISMISS_TOUCH_SLOP_PX && deltaY > Math.abs(deltaX) * 1.25) {
      return { active: true, dragY: deltaY, shouldPreventDefault: true }
    }
    return { active: false, dragY: 0, shouldPreventDefault: false }
  }

  if (deltaY > 0) {
    return { active: true, dragY: deltaY, shouldPreventDefault: true }
  }

  return { active: true, dragY: 0, shouldPreventDefault: false }
}

export function shouldDismissOnRelease(dragY: number): boolean {
  return dragY >= SWIPE_DISMISS_THRESHOLD_PX
}

export function computeSwipeTransform(dragY: number, isDragging: boolean) {
  const backdropOpacity = isDragging ? Math.max(0.15, 1 - dragY / 320) : 1
  const scale = isDragging ? Math.max(0.8, 1 - dragY / 1000) : 1
  return { backdropOpacity, scale }
}

export function computeDismissDelay(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 200
}
