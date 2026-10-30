import { useEffect, useRef, type RefObject } from 'react'
import { remoteLog } from './remote-logger'

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
  // What moves: the page's PageHost when it has one, so the whole page
  // (with its own background) follows the finger and uncovers the page
  // underneath, as on iOS. The transform is written inline each frame; a
  // CSS variable here was inherited by every element of the page and
  // restyled all of them on every frame.
  let moving: HTMLElement = element
  let zoom = 1
  // Set once a committed page is sliding out on its own; teardown leaves it be.
  let handedOff = false

  const setOffset = (px: number) => {
    moving.style.transform = `translate3d(${px}px, 0, 0)`
  }

  const clearMotion = () => {
    window.clearTimeout(resetTimer)
    resetTimer = undefined
    moving.classList.remove('edge-swipe-active', 'edge-swipe-cancelling')
    moving.style.transform = ''
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
    moving.classList.remove('edge-swipe-active')
    moving.classList.add('edge-swipe-cancelling')
    setOffset(0)
    window.clearTimeout(resetTimer)
    resetTimer = window.setTimeout(clearMotion, 240)
  }

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input,textarea,select,button,[data-no-edge-swipe],.table-scroll,pre,code')) return
    window.clearTimeout(resetTimer)
    handedOff = false
    moving = (element.closest?.('.page-host') as HTMLElement | null) ?? element
    // Touches are in visual pixels; the transform is in CSS pixels, which the
    // root zoom scales. Read once per gesture.
    zoom = parseFloat(globalThis.document?.documentElement?.style.zoom || '') || 1
    startX = event.touches[0].clientX
    startY = event.touches[0].clientY
    startTime = Date.now()
    tracking = true
    intentConfirmed = false
    cancelling = false
    committed = false
    remoteLog('DEBUG', 'EdgeSwipe', `TouchStart at x=${Math.round(startX)} y=${Math.round(startY)} target=${target?.tagName}`)
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
    const durationMs = Date.now() - startTime
    moving.classList.remove('edge-swipe-cancelling')
    moving.classList.add('edge-swipe-active')
    // A page with a host follows the finger 1:1; a bare page only hints.
    const followsFinger = moving !== element
    setOffset(Math.max(0, followsFinger ? deltaX / zoom : Math.min(EDGE_SWIPE_MAX_OFFSET_PX, (deltaX - 8) * .55)))
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
      remoteLog('DEBUG', 'EdgeSwipe', `Edge swipe committed: deltaX=${Math.round(deltaX)} duration=${durationMs}ms -> executing onBack immediately`)
      if (event.cancelable) {
        event.preventDefault()
      }
      if (document.activeElement && (
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement).isContentEditable ||
        (document.activeElement.tagName === undefined && typeof (document.activeElement as any).blur === 'function' && document.activeElement !== (document as any).body)
      )) {
        (document.activeElement as HTMLElement).blur()
      }
      if (moving === element) {
        clearMotion()
        onBack()
      } else {
        // Hand the page to its exit slide where the finger left it: the exit
        // keyframes have no start frame, so they begin at this inline offset
        // instead of snapping back to 0 first.
        const page = moving
        page.classList.remove('edge-swipe-active')
        tracking = false
        committed = false
        handedOff = true
        onBack()
        // If nothing took the page away (going back was refused), ease it back.
        resetTimer = window.setTimeout(() => {
          if (page.isConnected && !page.classList.contains('is-page-exiting')) cancelMotion()
        }, 120)
      }
      try { window.focus() } catch {}
    } else {
      remoteLog('DEBUG', 'EdgeSwipe', `Edge swipe cancelled: deltaX=${Math.round(deltaX)} duration=${durationMs}ms`)
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
    if (!handedOff) clearMotion()
  }
}

export function useEdgeSwipeBack<T extends HTMLElement>(ref: RefObject<T | null>, onBack: () => void, enabled = true) {
  // Callers pass a fresh callback on every render. Reading it from a ref keeps
  // one subscription per page instead of tearing the listeners down and
  // re-adding them on every render (every streamed token, in a chat).
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    return createEdgeSwipeController(element, () => onBackRef.current())
  }, [enabled, ref])
}
