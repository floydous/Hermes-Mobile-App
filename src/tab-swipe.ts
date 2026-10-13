export type Tab = 'bots' | 'sessions' | 'tasks'

export function computeNextSwipeTab(
  currentTab: Tab,
  deltaX: number,
  deltaY: number,
  minDelta = 56
): Tab | null {
  if (Math.abs(deltaX) < minDelta) return null
  if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return null

  const tabOrder: Tab[] = ['bots', 'sessions', 'tasks']
  const currentIndex = tabOrder.indexOf(currentTab)
  if (currentIndex === -1) return null

  if (deltaX < 0) {
    // Swipe left -> next tab
    return currentIndex < tabOrder.length - 1 ? tabOrder[currentIndex + 1] : null
  } else {
    // Swipe right -> previous tab
    return currentIndex > 0 ? tabOrder[currentIndex - 1] : null
  }
}

export type GestureIntent = 'vertical_scroll' | 'horizontal_swipe' | 'tap_preserve'

export function classifyInteractiveRowGesture(
  deltaX: number,
  deltaY: number,
  minHorizontalDrag = 40,
  minVerticalScroll = 12,
  dominanceRatio = 1.25
): GestureIntent {
  const absX = Math.abs(deltaX)
  const absY = Math.abs(deltaY)
  if (absY >= minVerticalScroll && absY > absX * dominanceRatio) {
    return 'vertical_scroll'
  }
  if (absX >= minHorizontalDrag && absX > absY * dominanceRatio) {
    return 'horizontal_swipe'
  }
  return 'tap_preserve'
}

export function isHorizontalSwipeIntent(
  deltaX: number,
  deltaY: number,
  slop = 20
): boolean {
  const distance = Math.hypot(deltaX, deltaY)
  if (distance < slop) return false
  return Math.abs(deltaX) > slop && Math.abs(deltaX) > Math.abs(deltaY) * 1.25
}
