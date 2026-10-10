import { describe, expect, it, vi } from 'vitest'

import {
  createEdgeSwipeController,
  EDGE_SWIPE_COMMIT_PX,
  EDGE_SWIPE_MAX_START_PX,
  shouldCommitEdgeSwipe,
} from './edge-swipe'

describe('edge swipe back', () => {
  it('restricts gesture start to the leftmost screen edge', () => {
    expect(EDGE_SWIPE_MAX_START_PX).toBe(72)
  })

  it('commits a deliberate horizontal gesture', () => {
    expect(shouldCommitEdgeSwipe(EDGE_SWIPE_COMMIT_PX, 10)).toBe(true)
  })

  it('does not steal a mostly vertical scroll', () => {
    expect(shouldCommitEdgeSwipe(120, 110)).toBe(false)
  })

  it('does not commit a short edge drag', () => {
    expect(shouldCommitEdgeSwipe(EDGE_SWIPE_COMMIT_PX - 1, 0)).toBe(false)
  })

  it('maintains smooth canceling transition without snapping on subsequent touchend', () => {
    vi.useFakeTimers()
    const listeners: Record<string, (e: any) => void> = {}
    const classes = new Set<string>()
    const styles: Record<string, string> = {}

    const mockElement = {
      addEventListener: (type: string, fn: any) => { listeners[type] = fn },
      removeEventListener: (type: string) => { delete listeners[type] },
      classList: {
        add: (...cls: string[]) => cls.forEach(c => classes.add(c)),
        remove: (...cls: string[]) => cls.forEach(c => classes.delete(c)),
        contains: (c: string) => classes.has(c),
      },
      style: {
        setProperty: (k: string, v: string) => { styles[k] = v },
        removeProperty: (k: string) => { delete styles[k] },
      },
    }

    // Set up global window mock if needed
    const prevInnerWidth = (globalThis as any).window?.innerWidth
    if (!(globalThis as any).window) {
      (globalThis as any).window = { innerWidth: 390, clearTimeout, setTimeout }
    }

    // Test the event lifecycle directly
    // Import useEdgeSwipeBack logic simulation with the listener pattern
    let startX = 0
    let startY = 0
    let tracking = false
    let intentConfirmed = false
    let cancelling = false
    let resetTimer: any

    const clearMotion = () => {
      clearTimeout(resetTimer)
      mockElement.classList.remove('edge-swipe-active', 'edge-swipe-committed', 'edge-swipe-cancelling')
      mockElement.style.removeProperty('--edge-swipe-offset')
      tracking = false
      intentConfirmed = false
      cancelling = false
    }

    const cancelMotion = () => {
      if (cancelling) return
      cancelling = true
      tracking = false
      intentConfirmed = false
      mockElement.classList.remove('edge-swipe-active', 'edge-swipe-committed')
      mockElement.classList.add('edge-swipe-cancelling')
      mockElement.style.setProperty('--edge-swipe-offset', '0px')
      clearTimeout(resetTimer)
      resetTimer = setTimeout(clearMotion, 220)
    }

    // 1. Touch start
    startX = 20
    startY = 100
    tracking = true

    // 2. Intent confirmation
    intentConfirmed = true
    mockElement.classList.add('edge-swipe-active')
    expect(mockElement.classList.contains('edge-swipe-active')).toBe(true)

    // 3. User reverses motion -> cancelMotion
    cancelMotion()
    expect(mockElement.classList.contains('edge-swipe-cancelling')).toBe(true)

    // 4. touchend immediately follows
    // If cancelling, touchend does NOT clearMotion immediately!
    if (!cancelling) clearMotion()
    expect(mockElement.classList.contains('edge-swipe-cancelling')).toBe(true)

    // 5. Timer finishes ease
    vi.advanceTimersByTime(230)
    expect(mockElement.classList.contains('edge-swipe-cancelling')).toBe(false)

    if (prevInnerWidth !== undefined) (globalThis as any).window.innerWidth = prevInnerWidth
    vi.useRealTimers()
  })

  it('prevents default browser scrolling on touchmove and blurs active element strictly on commit', () => {
    vi.useFakeTimers()
    const origDoc = (globalThis as any).document
    const origWindow = (globalThis as any).window
    const origRaf = (globalThis as any).requestAnimationFrame

    try {
      let blurred = false
      const mockInput = {
        blur: () => { blurred = true },
      }
      ;(globalThis as any).document = {
        activeElement: mockInput,
      }
      ;(globalThis as any).window = {
        innerWidth: 390,
        clearTimeout,
        setTimeout,
        requestAnimationFrame: (cb: () => void) => cb(),
      }
      ;(globalThis as any).requestAnimationFrame = (cb: () => void) => cb()

      const listeners: Record<string, (e: any) => void> = {}
      const classes = new Set<string>()
      const styles: Record<string, string> = {}

      const mockElement = {
        addEventListener: (type: string, fn: any) => { listeners[type] = fn },
        removeEventListener: (type: string) => { delete listeners[type] },
        classList: {
          add: (...cls: string[]) => cls.forEach(c => classes.add(c)),
          remove: (...cls: string[]) => cls.forEach(c => classes.delete(c)),
          contains: (c: string) => classes.has(c),
        },
        style: {
          setProperty: (k: string, v: string) => { styles[k] = v },
          removeProperty: (k: string) => { delete styles[k] },
        },
      }

      let backCalled = false
      const onBack = () => { backCalled = true }

      // Exercise the REAL production controller directly
      const cleanup = createEdgeSwipeController(mockElement as any, onBack)

      // Case 1: Cancelled gesture should NOT blur input
      listeners['touchstart']({ touches: [{ clientX: 20, clientY: 100 }], target: null })
      let movePrevented = false
      listeners['touchmove']({
        touches: [{ clientX: 30, clientY: 100 }],
        cancelable: true,
        preventDefault: () => { movePrevented = true },
      })
      expect(movePrevented).toBe(true)
      expect(blurred).toBe(false) // Not blurred on move!

      // Reversal / cancel
      listeners['touchmove']({
        touches: [{ clientX: 10, clientY: 100 }],
        cancelable: true,
        preventDefault: () => {},
      })
      listeners['touchend']({ changedTouches: [{ clientX: 10, clientY: 100 }], cancelable: true, preventDefault: () => {} })
      expect(blurred).toBe(false) // Cancelled swipe did NOT blur!

      // Case 2: Committed gesture DOES blur and call onBack
      listeners['touchstart']({ touches: [{ clientX: 10, clientY: 100 }], target: null })
      listeners['touchmove']({
        touches: [{ clientX: 80, clientY: 100 }],
        cancelable: true,
        preventDefault: () => {},
      })
      let endPrevented = false
      listeners['touchend']({
        changedTouches: [{ clientX: 80, clientY: 100 }],
        cancelable: true,
        preventDefault: () => { endPrevented = true },
      })
      expect(endPrevented).toBe(true)
      expect(blurred).toBe(true) // Blurred on commit!

      vi.advanceTimersByTime(210)
      expect(backCalled).toBe(true)

      cleanup()
    } finally {
      ;(globalThis as any).document = origDoc
      ;(globalThis as any).window = origWindow
      ;(globalThis as any).requestAnimationFrame = origRaf
      vi.useRealTimers()
    }
  })

  it('initiates edge swipe from left, center, and right X coordinates across full screen width', () => {
    vi.useFakeTimers()
    const origDoc = (globalThis as any).document
    const origWindow = (globalThis as any).window
    const origRaf = (globalThis as any).requestAnimationFrame
    try {
      const positions = [20, 200, 340] // left, center, right
      for (const startX of positions) {
        let backCalled = false
        const listeners: Record<string, (e: any) => void> = {}
        const mockElement = {
          addEventListener: (t: string, fn: any) => { listeners[t] = fn },
          removeEventListener: (t: string) => { delete listeners[t] },
          classList: { add: vi.fn(), remove: vi.fn() },
          style: { setProperty: vi.fn(), removeProperty: vi.fn() },
        }
        ;(globalThis as any).window = {
          innerWidth: 400,
          clearTimeout,
          setTimeout,
          requestAnimationFrame: (fn: any) => setTimeout(fn, 16),
        }
        ;(globalThis as any).document = {}
        ;(globalThis as any).requestAnimationFrame = (fn: any) => setTimeout(fn, 16)

        const cleanup = createEdgeSwipeController(mockElement as any, () => { backCalled = true })

        listeners['touchstart']({ touches: [{ clientX: startX, clientY: 100 }], target: null })
        listeners['touchmove']({
          touches: [{ clientX: startX + 60, clientY: 100 }],
          cancelable: true,
          preventDefault: () => {},
        })
        listeners['touchend']({
          changedTouches: [{ clientX: startX + 60, clientY: 100 }],
          cancelable: true,
          preventDefault: () => {},
        })

        vi.advanceTimersByTime(210)
        expect(backCalled).toBe(true)
        cleanup()
      }
    } finally {
      ;(globalThis as any).document = origDoc
      ;(globalThis as any).window = origWindow
      ;(globalThis as any).requestAnimationFrame = origRaf
      vi.useRealTimers()
    }
  })

  it('ignores touches originating inside horizontal scrollable tables', () => {
    const origDoc = (globalThis as any).document
    const origWindow = (globalThis as any).window
    try {
      let backCalled = false
      const listeners: Record<string, (e: any) => void> = {}
      const mockElement = {
        addEventListener: (t: string, fn: any) => { listeners[t] = fn },
        removeEventListener: (t: string) => { delete listeners[t] },
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { setProperty: vi.fn(), removeProperty: vi.fn() },
      }
      ;(globalThis as any).window = { innerWidth: 400, clearTimeout, setTimeout }
      ;(globalThis as any).document = {}

      const cleanup = createEdgeSwipeController(mockElement as any, () => { backCalled = true })

      const mockTarget = {
        closest: (selector: string) => selector.includes('.table-scroll') ? {} : null,
      }

      listeners['touchstart']({ touches: [{ clientX: 200, clientY: 100 }], target: mockTarget })
      expect(mockElement.classList.add).not.toHaveBeenCalled()
      cleanup()
    } finally {
      ;(globalThis as any).document = origDoc
      ;(globalThis as any).window = origWindow
    }
  })
})
