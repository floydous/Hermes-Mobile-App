import { useEffect, type RefObject } from 'react'

export const EDGE_SWIPE_MAX_START_PX = 36
export const EDGE_SWIPE_COMMIT_PX = 42
export const EDGE_SWIPE_MAX_OFFSET_PX = 140

export function shouldCommitEdgeSwipe(deltaX: number, deltaY: number, durationMs = 300): boolean {
  if (deltaX < 24) return false
  const isHorizontal = deltaX > Math.abs(deltaY) * 1.2
  if (!isHorizontal) return false
  const isQuickFlick = deltaX >= 30 && durationMs < 280
  return deltaX >= EDGE_SWIPE_COMMIT_PX || isQuickFlick
}

export function useEdgeSwipeBack<T extends HTMLElement>(ref: RefObject<T | null>, onBack: () => void, enabled = true) {
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    let startX = 0
    let startY = 0
    let startTime = 0
    let tracking = false
    let committed = false
    let resetTimer: number | undefined

    const clearMotion = () => {
      element.classList.remove('edge-swipe-active', 'edge-swipe-committed', 'edge-swipe-cancelling')
      element.style.removeProperty('--edge-swipe-offset')
      tracking = false
      committed = false
    }
    const onTouchStart = (event: TouchEvent) => {
      // Must start strictly within the leftmost 36px to prevent hijacking general in-page gestures
      if (event.touches.length !== 1 || event.touches[0].clientX > EDGE_SWIPE_MAX_START_PX) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,button,[data-no-edge-swipe]')) return
      window.clearTimeout(resetTimer)
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
      startTime = Date.now()
      tracking = true
      committed = false
    }
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return
      const deltaX = event.touches[0].clientX - startX
      const deltaY = event.touches[0].clientY - startY
      // If moving backwards or distinctly vertical, cancel motion smoothly
      if (deltaX < -15 || (Math.abs(deltaY) > 24 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5)) {
        tracking = false
        element.classList.remove('edge-swipe-active', 'edge-swipe-committed')
        element.classList.add('edge-swipe-cancelling')
        element.style.setProperty('--edge-swipe-offset', '0px')
        resetTimer = window.setTimeout(clearMotion, 220)
        return
      }
      if (deltaX <= 0) {
        element.style.setProperty('--edge-swipe-offset', '0px')
        return
      }
      const durationMs = Date.now() - startTime
      const offset = Math.min(EDGE_SWIPE_MAX_OFFSET_PX, Math.max(0, deltaX * .55))
      element.classList.remove('edge-swipe-cancelling')
      element.classList.add('edge-swipe-active')
      element.style.setProperty('--edge-swipe-offset', `${offset}px`)
      committed = shouldCommitEdgeSwipe(deltaX, deltaY, durationMs)
    }
    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking) return
      const deltaX = (event.changedTouches[0]?.clientX || startX) - startX
      const deltaY = (event.changedTouches[0]?.clientY || startY) - startY
      const durationMs = Date.now() - startTime
      tracking = false
      if (committed || shouldCommitEdgeSwipe(deltaX, deltaY, durationMs)) {
        element.classList.remove('edge-swipe-active', 'edge-swipe-cancelling')
        element.classList.add('edge-swipe-committed')
        element.style.setProperty('--edge-swipe-offset', '100vw')
        resetTimer = window.setTimeout(() => { clearMotion(); onBack() }, 200)
      } else {
        // Smoothly ease back to original position (0px)
        element.classList.remove('edge-swipe-committed', 'edge-swipe-active')
        element.classList.add('edge-swipe-cancelling')
        element.style.setProperty('--edge-swipe-offset', '0px')
        resetTimer = window.setTimeout(clearMotion, 220)
      }
    }
    const onTouchCancel = () => {
      if (tracking) {
        tracking = false
        element.classList.remove('edge-swipe-committed', 'edge-swipe-active')
        element.classList.add('edge-swipe-cancelling')
        element.style.setProperty('--edge-swipe-offset', '0px')
        resetTimer = window.setTimeout(clearMotion, 220)
      }
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd, { passive: true })
    element.addEventListener('touchcancel', onTouchCancel, { passive: true })
    return () => {
      window.clearTimeout(resetTimer)
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchCancel)
      clearMotion()
    }
  }, [enabled, onBack, ref])
}
