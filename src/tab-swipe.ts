export type Tab = 'bots' | 'sessions' | 'tasks'

export function computeNextSwipeTab(
  currentTab: Tab,
  deltaX: number,
  deltaY: number,
  minDelta = 44
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

export function isHorizontalSwipeIntent(
  deltaX: number,
  deltaY: number,
  slop = 10
): boolean {
  const distance = Math.hypot(deltaX, deltaY)
  if (distance < slop) return false
  return Math.abs(deltaX) > slop && Math.abs(deltaX) > Math.abs(deltaY) * 1.25
}
