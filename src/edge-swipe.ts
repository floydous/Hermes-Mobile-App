import { useEffect, type RefObject } from 'react'

export const EDGE_SWIPE_MAX_START_PX = 72
export const EDGE_SWIPE_COMMIT_PX = 48
export const EDGE_SWIPE_MAX_OFFSET_PX = 140

export function shouldCommitEdgeSwipe(deltaX: number, deltaY: number, durationMs = 300): boolean {
  if (deltaX < 28) return false
  const isHorizontal = deltaX > Math.abs(deltaY) * 1.3
  if (!isHorizontal) return false
  const isQuickFlick = deltaX >= 36 && durationMs < 280
  return deltaX >= EDGE_SWIPE_COMMIT_PX || isQuickFlick
}

export function createEdgeSwipeController<T extends HTMLElement>(
  element: T,
  onBack: () => void
): () => void {
  let startX = 0
  let startY = 0
  let startTime = 0
  let tracking = false
  let intentConfirmed = false
  let cancelling = false
  let committed = false
  let resetTimer: number | undefined

  const clearMotion = () => {
    window.clearTimeout(resetTimer)
    resetTimer = undefined
    element.classList.remove('edge-swipe-active', 'edge-swipe-committed', 'edge-swipe-cancelling')
    element.style.removeProperty('--edge-swipe-offset')
    tracking = false
    intentConfirmed = false
    cancelling = false
    committed = false
  }

  const cancelMotion = () => {
    if (cancelling) return
    cancelling = true
    tracking = false
    intentConfirmed = false
    committed = false
    element.classList.remove('edge-swipe-active', 'edge-swipe-committed')
    element.classList.add('edge-swipe-cancelling')
    element.style.setProperty('--edge-swipe-offset', '0px')
    window.clearTimeout(resetTimer)
    resetTimer = window.setTimeout(clearMotion, 220)
  }

  const onTouchStart = (event: TouchEvent) => {
    // Natural mobile trigger edge: within leftmost 72px or 22% of screen width
    const maxStart = Math.min(EDGE_SWIPE_MAX_START_PX, window.innerWidth * 0.22)
    if (event.touches.length !== 1 || event.touches[0].clientX > maxStart) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input,textarea,select,button,[data-no-edge-swipe],.table-scroll,pre,code')) return
    window.clearTimeout(resetTimer)
    startX = event.touches[0].clientX
    startY = event.touches[0].clientY
    startTime = Date.now()
    tracking = true
    intentConfirmed = false
    cancelling = false
    committed = false
  }

  const onTouchMove = (event: TouchEvent) => {
    if (!tracking || cancelling || event.touches.length !== 1) return
    const deltaX = event.touches[0].clientX - startX
    const deltaY = event.touches[0].clientY - startY

    // Slop and direction check: lock in only if movement is distinctly horizontal right
    if (!intentConfirmed) {
      const distance = Math.hypot(deltaX, deltaY)
      if (distance < 8) return
      if (deltaX > 8 && deltaX > Math.abs(deltaY) * 1.4) {
        intentConfirmed = true
      } else {
        // Mostly vertical scroll or swipe left: immediately yield to page scrolling
        tracking = false
        return
      }
    }

    // Once horizontal gesture intent is confirmed, prevent browser/Android native scroll interception
    if (event.cancelable) {
      event.preventDefault()
    }

    // If moving backwards or distinctly vertical, cancel motion smoothly
    if (deltaX < -15 || (Math.abs(deltaY) > 24 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5)) {
      cancelMotion()
      return
    }
    if (deltaX <= 0) {
      element.style.setProperty('--edge-swipe-offset', '0px')
      return
    }
    const durationMs = Date.now() - startTime
    const offset = Math.min(EDGE_SWIPE_MAX_OFFSET_PX, Math.max(0, (deltaX - 8) * .55))
    element.classList.remove('edge-swipe-cancelling')
    element.classList.add('edge-swipe-active')
    element.style.setProperty('--edge-swipe-offset', `${offset}px`)
    committed = shouldCommitEdgeSwipe(deltaX, deltaY, durationMs)
  }

  const onTouchEnd = (event: TouchEvent) => {
    if (cancelling) {
      // Let the in-flight ease-back animation finish cleanly without snapping
      return
    }
    if (!tracking || !intentConfirmed) {
      clearMotion()
      return
    }
    const deltaX = (event.changedTouches[0]?.clientX || startX) - startX
    const deltaY = (event.changedTouches[0]?.clientY || startY) - startY
    const durationMs = Date.now() - startTime
    tracking = false
    intentConfirmed = false
    if (committed || shouldCommitEdgeSwipe(deltaX, deltaY, durationMs)) {
      if (event.cancelable) {
        event.preventDefault()
      }
      if (typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      } else if (document.activeElement && typeof (document.activeElement as any).blur === 'function') {
        (document.activeElement as any).blur()
      }
      element.classList.remove('edge-swipe-active', 'edge-swipe-cancelling')
      element.classList.add('edge-swipe-committed')
      element.style.setProperty('--edge-swipe-offset', '100vw')
      resetTimer = window.setTimeout(() => {
        onBack()
        window.requestAnimationFrame(() => {
          clearMotion()
        })
      }, 200)
    } else {
      cancelMotion()
    }
  }

  const onTouchCancel = () => {
    if (cancelling) return
    if (tracking && intentConfirmed) {
      cancelMotion()
    } else {
      clearMotion()
    }
  }

  element.addEventListener('touchstart', onTouchStart, { passive: true })
  element.addEventListener('touchmove', onTouchMove, { passive: false })
  element.addEventListener('touchend', onTouchEnd, { passive: false })
  element.addEventListener('touchcancel', onTouchCancel, { passive: true })

  return () => {
    window.clearTimeout(resetTimer)
    element.removeEventListener('touchstart', onTouchStart)
    element.removeEventListener('touchmove', onTouchMove)
    element.removeEventListener('touchend', onTouchEnd)
    element.removeEventListener('touchcancel', onTouchCancel)
    clearMotion()
  }
}

export function useEdgeSwipeBack<T extends HTMLElement>(ref: RefObject<T | null>, onBack: () => void, enabled = true) {
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    return createEdgeSwipeController(element, onBack)
  }, [enabled, onBack, ref])
}
