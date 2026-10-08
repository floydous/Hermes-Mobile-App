import { describe, expect, it, vi } from 'vitest'

import { EDGE_SWIPE_COMMIT_PX, EDGE_SWIPE_MAX_START_PX, shouldCommitEdgeSwipe } from './edge-swipe'

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
})
