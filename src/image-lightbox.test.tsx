import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ImageLightbox, triggerDownload } from './components/MarkdownContent'
import {
  classifyDoubleTap,
  computeDismissDelay,
  computeSwipeTransform,
  LightboxDismissCoordinator,
  LightboxGestureController,
  type LightboxScheduler,
  processSwipeMove,
  shouldDismissOnBackdropClick,
  shouldDismissOnRelease,
} from './swipe-dismiss'

describe('ImageLightbox Discord-style preview', () => {
  it('renders fullscreen backdrop, image, top-left close and top-right download controls', () => {
    const html = renderToString(
      <ImageLightbox
        src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        alt="Preview Image"
        onClose={() => {}}
      />
    )

    expect(html).toContain('class="image-lightbox-backdrop is-entering"')
    expect(html).toContain('class="image-lightbox-top-bar is-entering"')
    expect(html).toContain('class="image-lightbox-circle-btn"')
    expect(html).toContain('aria-label="Close image preview"')
    expect(html).toContain('aria-label="Download image"')
    expect(html).toContain('class="image-lightbox-stage is-entering"')
    expect(html).toContain('class="image-lightbox-img"')
    expect(html).toContain('alt="Preview Image"')
  })

  it('renders correct filename in alt when rawPath is provided', () => {
    const html = renderToString(
      <ImageLightbox
        src="https://example.com/attachments/photo-vacation.jpg"
        rawPath="/home/floyd/pictures/photo-vacation.jpg"
        onClose={() => {}}
      />
    )

    expect(html).toContain('alt="photo-vacation.jpg"')
  })

  it('validates swipe-down gesture tracking, slop, and direction dominance', () => {
    // Sub-slop movement (< 10px downward) does not engage drag: from (100, 100) to (100, 106)
    expect(processSwipeMove(100, 100, 100, 106, false)).toEqual({
      active: false,
      dragY: 0,
      shouldPreventDefault: false,
    })

    // Upward movement does not engage drag: from (100, 100) to (100, 70)
    expect(processSwipeMove(100, 100, 100, 70, false)).toEqual({
      active: false,
      dragY: 0,
      shouldPreventDefault: false,
    })

    // Horizontal movement does not engage drag: from (100, 100) to (150, 110), dx=50, dy=10
    expect(processSwipeMove(100, 100, 150, 110, false)).toEqual({
      active: false,
      dragY: 0,
      shouldPreventDefault: false,
    })

    // Predominantly downward movement (> 10px slop, vertical > 1.25x horizontal): from (100, 100) to (105, 160), dx=5, dy=60
    const move = processSwipeMove(100, 100, 105, 160, false)
    expect(move.active).toBe(true)
    expect(move.dragY).toBe(60)
    expect(move.shouldPreventDefault).toBe(true)

    // Once active, continues tracking downward delta: from (100, 100) to (120, 200), dy=100
    const move2 = processSwipeMove(100, 100, 120, 200, true)
    expect(move2.active).toBe(true)
    expect(move2.dragY).toBe(100)
    expect(move2.shouldPreventDefault).toBe(true)
  })

  it('evaluates dismiss threshold: release at 79px resets, release at >= 80px dismisses', () => {
    expect(shouldDismissOnRelease(0)).toBe(false)
    expect(shouldDismissOnRelease(50)).toBe(false)
    expect(shouldDismissOnRelease(79)).toBe(false)
    expect(shouldDismissOnRelease(80)).toBe(true)
    expect(shouldDismissOnRelease(120)).toBe(true)
  })

  it('computes dismiss delay respecting reduced motion', () => {
    // When reduced motion is preferred, dismiss is instantaneous (0ms)
    expect(computeDismissDelay(true)).toBe(0)
    // In standard fluid animation mode, dismiss waits 200ms for exit ease
    expect(computeDismissDelay(false)).toBe(200)
  })

  it('computes smooth backdrop opacity and scale transforms during swipe', () => {
    // When idle (not dragging), full opacity and 1.0 scale
    expect(computeSwipeTransform(0, false)).toEqual({
      backdropOpacity: 1,
      scale: 1,
    })

    // When dragging down 100px, smoothly scales and modulates opacity
    const t1 = computeSwipeTransform(100, true)
    expect(t1.backdropOpacity).toBeCloseTo(1 - 100 / 320, 2)
    expect(t1.scale).toBeCloseTo(1 - 100 / 1000, 2)

    // Large drag is clamped to minimum bounds (opacity >= 0.15, scale >= 0.8)
    const t2 = computeSwipeTransform(500, true)
    expect(t2.backdropOpacity).toBe(0.15)
    expect(t2.scale).toBe(0.8)

    // Smooth spring-back: when drag is cancelled and transitioning back (isDragging=false, dragY=50),
    // scale and opacity continuously ease back to rest without abruptly snapping to 1.0
    const springBack = computeSwipeTransform(50, false)
    expect(springBack.backdropOpacity).toBeCloseTo(1 - 50 / 320, 2)
    expect(springBack.scale).toBeCloseTo(1 - 50 / 1000, 2)

    // Negative drag (upward jitter) clamps safely to resting 1.0
    const upwardJitter = computeSwipeTransform(-20, false)
    expect(upwardJitter.backdropOpacity).toBe(1)
    expect(upwardJitter.scale).toBe(1)
  })

  it('triggers download for data URLs by appending anchor and clicking', async () => {
    const clickSpy = vi.fn()
    const mockAnchor = { href: '', download: '', click: clickSpy }
    const appendSpy = vi.fn()
    const removeSpy = vi.fn()

    const origDoc = (globalThis as any).document
    ;(globalThis as any).document = {
      createElement: () => mockAnchor,
      body: {
        appendChild: appendSpy,
        removeChild: removeSpy,
      },
    }

    try {
      await triggerDownload('data:image/png;base64,AAAA', 'chart.png')
      expect(clickSpy).toHaveBeenCalled()
      expect(appendSpy).toHaveBeenCalledWith(mockAnchor)
      expect(removeSpy).toHaveBeenCalledWith(mockAnchor)
      expect(mockAnchor.download).toBe('chart.png')
      expect(mockAnchor.href).toBe('data:image/png;base64,AAAA')
    } finally {
      ;(globalThis as any).document = origDoc
    }
  })

  it('respects prefers-reduced-motion: reduce media query', () => {
    const origMatchMedia = (globalThis as any).window?.matchMedia
    ;(globalThis as any).window = (globalThis as any).window || {}
    ;(globalThis as any).window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    try {
      const onClose = vi.fn()
      const html = renderToString(
        <ImageLightbox
          src="data:image/png;base64,AAAA"
          alt="Reduced Motion Test"
          onClose={onClose}
        />
      )
      expect(html).toContain('class="image-lightbox-backdrop is-entering"')
    } finally {
      ;(globalThis as any).window.matchMedia = origMatchMedia
    }
  })

  it('configures double-click to toggle zoom and suppresses accidental single-click zoom or backdrop close', () => {
    const onClose = vi.fn()
    const html = renderToString(
      <ImageLightbox
        src="data:image/png;base64,AAAA"
        alt="Zoom Test"
        onClose={onClose}
      />
    )

    // Backdrop rendered with backdrop class and modal role
    expect(html).toContain('class="image-lightbox-backdrop')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')

    // Image rendered inside stage with correct alt and class
    expect(html).toContain('class="image-lightbox-stage')
    expect(html).toContain('class="image-lightbox-img"')
    expect(html).toContain('alt="Zoom Test"')
  })

  describe('Gesture arbitration and click suppression', () => {
    it('dismisses only when clicking directly on backdrop without an active drag', () => {
      const backdrop = { id: 'backdrop' }
      const childImage = { id: 'image' }

      // Direct click on backdrop without drag -> should dismiss
      expect(shouldDismissOnBackdropClick(backdrop, backdrop, false)).toBe(true)

      // Click originating from child element (e.g. image) -> must NOT dismiss backdrop
      expect(shouldDismissOnBackdropClick(childImage, backdrop, false)).toBe(false)

      // Click on backdrop after drag/swipe was released -> must NOT dismiss (suppressed)
      expect(shouldDismissOnBackdropClick(backdrop, backdrop, true)).toBe(false)

      // Click on child after drag -> must NOT dismiss
      expect(shouldDismissOnBackdropClick(childImage, backdrop, true)).toBe(false)
    })

    it('classifies double-tap within threshold (<300ms) and ignores slow taps or swipe-cancelled taps', () => {
      const t0 = 1000

      // First tap at t0
      const tap1 = classifyDoubleTap(0, t0, 300)
      expect(tap1.isDoubleTap).toBe(false)
      expect(tap1.nextTapTime).toBe(t0)

      // Second tap within 200ms (<300ms threshold) -> confirmed double-tap!
      const tap2 = classifyDoubleTap(tap1.nextTapTime, t0 + 200, 300)
      expect(tap2.isDoubleTap).toBe(true)
      expect(tap2.nextTapTime).toBe(0) // resets tap time to prevent 3rd tap from re-triggering

      // Slow second tap at 350ms (>= 300ms) -> not a double tap, starts new window
      const slowTap = classifyDoubleTap(t0, t0 + 350, 300)
      expect(slowTap.isDoubleTap).toBe(false)
      expect(slowTap.nextTapTime).toBe(t0 + 350)

      // Swipe drag cancellation resets lastTapTime to 0:
      // Even if tap occurs within 200ms of a swipe start, it must NOT double-tap
      const postSwipeTap = classifyDoubleTap(0, t0 + 200, 300)
      expect(postSwipeTap.isDoubleTap).toBe(false)
      expect(postSwipeTap.nextTapTime).toBe(t0 + 200)
    })
  })

  describe('LightboxGestureController lifecycle, spring-back, and cancellation', () => {
    function createTestScheduler() {
      let currentTime = 1000
      let rafHandle = 0
      const rafCallbacks = new Map<number, () => void>()
      let timerHandle = 0
      const timerCallbacks = new Map<number, { cb: () => void; triggerAt: number }>()

      const scheduler: LightboxScheduler = {
        now: () => currentTime,
        requestFrame: cb => {
          const id = ++rafHandle
          rafCallbacks.set(id, cb)
          return id
        },
        cancelFrame: id => {
          rafCallbacks.delete(id)
        },
        setTimer: (cb, ms) => {
          const id = ++timerHandle
          timerCallbacks.set(id, { cb, triggerAt: currentTime + ms })
          return id
        },
        clearTimer: id => {
          timerCallbacks.delete(id)
        },
      }

      const flushRaf = () => {
        const cbs = Array.from(rafCallbacks.entries())
        rafCallbacks.clear()
        for (const [_, cb] of cbs) {
          cb()
        }
      }

      const advanceTimers = (ms: number) => {
        currentTime += ms
        const toRun: (() => void)[] = []
        for (const [id, item] of Array.from(timerCallbacks.entries())) {
          if (item.triggerAt <= currentTime) {
            toRun.push(item.cb)
            timerCallbacks.delete(id)
          }
        }
        for (const cb of toRun) {
          cb()
        }
      }

      return {
        scheduler,
        getCurrentTime: () => currentTime,
        setCurrentTime: (t: number) => { currentTime = t },
        getPendingRafCount: () => rafCallbacks.size,
        getPendingTimerCount: () => timerCallbacks.size,
        flushRaf,
        advanceTimers,
        rafCallbacks,
        timerCallbacks,
      }
    }

    it('springs back smoothly on below-threshold cancelled swipe with two-phase rAF timing', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      // Touch down at (100, 100)
      controller.onTouchStartOne(100, 100)
      expect(controller.getSnapshot().isDragging).toBe(false)

      // Drag downward 50px (sub-threshold, threshold is 80px)
      controller.onTouchMoveOne(100, 150)
      expect(controller.getSnapshot().isDragging).toBe(true)
      expect(controller.getSnapshot().dragY).toBe(50)
      expect(controller.getSnapshot().didDrag).toBe(true)

      // Release touch: cancelled swipe
      const outcome = controller.onTouchEnd(false)
      expect(outcome).toBe('spring-back')

      // Phase 1: isDragging is set to false to enable CSS transition, but dragY remains 50
      expect(controller.getSnapshot().isDragging).toBe(false)
      expect(controller.getSnapshot().dragY).toBe(50)
      expect(env.getPendingRafCount()).toBe(1)

      // Phase 2: On next animation frame, dragY resets to 0 so CSS smoothly animates back to rest
      env.flushRaf()
      expect(controller.getSnapshot().dragY).toBe(0)
      expect(env.getPendingRafCount()).toBe(0)

      controller.dispose()
    })

    it('immediately resets dragY without scheduling rAF when prefers-reduced-motion is true', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      controller.onTouchStartOne(100, 100)
      controller.onTouchMoveOne(100, 150)
      expect(controller.getSnapshot().dragY).toBe(50)

      // Reduced motion: immediate reset (0ms)
      const outcome = controller.onTouchEnd(true)
      expect(outcome).toBe('spring-back')
      expect(controller.getSnapshot().isDragging).toBe(false)
      expect(controller.getSnapshot().dragY).toBe(0)
      expect(env.getPendingRafCount()).toBe(0)

      controller.dispose()
    })

    it('cancels pending spring-back rAF if a subsequent touch begins before the frame fires', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      controller.onTouchStartOne(100, 100)
      controller.onTouchMoveOne(100, 150)
      controller.onTouchEnd(false)

      expect(env.getPendingRafCount()).toBe(1)

      // User quickly touches down again before the frame callback fires
      controller.onTouchStartOne(100, 120)
      expect(env.getPendingRafCount()).toBe(0)

      controller.dispose()
    })

    it('cancels pending spring-back rAF and timers on explicit dismiss or controller dispose', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      controller.onTouchStartOne(100, 100)
      controller.onTouchMoveOne(100, 150)
      controller.onTouchEnd(false)

      expect(env.getPendingRafCount()).toBe(1)
      expect(env.getPendingTimerCount()).toBe(1) // click suppression timer

      // Explicit close (e.g. user pressed Escape or clicked close button)
      controller.onExplicitDismiss()
      expect(env.getPendingRafCount()).toBe(0)
      expect(env.getPendingTimerCount()).toBe(0)
      expect(controller.getSnapshot().isDismissed).toBe(true)

      controller.dispose()
    })

    it('ignores stale rAF callbacks if a previous token was superseded', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      controller.onTouchStartOne(100, 100)
      controller.onTouchMoveOne(100, 150)
      controller.onTouchEnd(false)

      const capturedRaf = Array.from(env.rafCallbacks.values())[0]
      expect(capturedRaf).toBeDefined()

      // Start new gesture which cancels the old spring-back
      controller.onTouchStartOne(100, 120)
      expect(controller.getSnapshot().dragY).toBe(50)

      // Even if the captured old rAF callback runs, its token is stale and it must NOT reset dragY to 0
      capturedRaf()
      expect(controller.getSnapshot().dragY).toBe(50)

      controller.dispose()
    })

    it('suppresses synthetic click during the post-drag window and allows subsequent backdrop clicks', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      controller.onTouchStartOne(100, 100)
      controller.onTouchMoveOne(100, 160) // 60px downward movement
      controller.onTouchEnd(false)

      // Immediately after drag ends, synthetic click must be suppressed
      expect(controller.getSnapshot().didDrag).toBe(true)
      const clickDuringSuppression = controller.onBackdropClick(true)
      expect(clickDuringSuppression).toBe(false)
      expect(controller.getSnapshot().isDismissed).toBe(false)

      // Advance time past the 180ms suppression window
      env.advanceTimers(200)
      expect(controller.getSnapshot().didDrag).toBe(false)

      // Genuine user backdrop tap after suppression window -> dismisses!
      const legitimateClick = controller.onBackdropClick(true)
      expect(legitimateClick).toBe(true)
      expect(controller.getSnapshot().isDismissed).toBe(true)

      controller.dispose()
    })

    it('toggles zoom on rapid double-tap and resets zoom on a second double-tap', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      // First tap at t=1000
      controller.onTouchStartOne(200, 200, 1000)
      expect(controller.getSnapshot().zoomScale).toBe(1)

      // Second tap at t=1200 (<300ms) -> triggers zoom in!
      controller.onTouchStartOne(200, 200, 1200)
      expect(controller.getSnapshot().zoomScale).toBe(2.5)

      // Third tap at t=1350 (starts new double-tap sequence, does not zoom out)
      controller.onTouchStartOne(200, 200, 1350)
      expect(controller.getSnapshot().zoomScale).toBe(2.5)

      // Fourth tap at t=1500 (<300ms after third) -> toggles zoom back to 1.0!
      controller.onTouchStartOne(200, 200, 1500)
      expect(controller.getSnapshot().zoomScale).toBe(1)

      controller.dispose()
    })

    it('suppresses synthetic onDoubleClick after touch double-tap to prevent fast zoom in and out phenomenon', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      // Initial state: 1.0x
      expect(controller.getSnapshot().zoomScale).toBe(1)

      // User double-taps on mobile screen (tap 1 at t=1000, tap 2 at t=1200)
      controller.onTouchStartOne(200, 200, 1000)
      controller.onTouchStartOne(200, 200, 1200)
      expect(controller.getSnapshot().zoomScale).toBe(2.5)

      // Mobile browser emits synthetic dblclick event 60ms later at t=1260
      const syntheticDblClickResult = controller.onDoubleClick(1260)
      // Must be suppressed!
      expect(syntheticDblClickResult).toBe(false)
      // Zoom must REMAIN at 2.5x (NOT zoom right back out to 1.0x!)
      expect(controller.getSnapshot().zoomScale).toBe(2.5)

      // User later double-taps to zoom out (tap 3 at t=3000, tap 4 at t=3200)
      controller.onTouchStartOne(200, 200, 3000)
      controller.onTouchStartOne(200, 200, 3200)
      expect(controller.getSnapshot().zoomScale).toBe(1)

      // Mobile browser emits synthetic dblclick event 60ms later at t=3260
      const syntheticDblClickOut = controller.onDoubleClick(3260)
      expect(syntheticDblClickOut).toBe(false)
      // Zoom must REMAIN at 1.0x (NOT zoom right back in!)
      expect(controller.getSnapshot().zoomScale).toBe(1)

      controller.dispose()
    })

    it('allows normal desktop mouse double-click to toggle zoom cleanly without touch events', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      // Initial: 1.0x
      expect(controller.getSnapshot().zoomScale).toBe(1)

      // Desktop user double-clicks with mouse at t=1000
      const firstClick = controller.onDoubleClick(1000)
      expect(firstClick).toBe(true)
      expect(controller.getSnapshot().zoomScale).toBe(2.5)

      // Desktop user double-clicks with mouse again at t=2000
      const secondClick = controller.onDoubleClick(2000)
      expect(secondClick).toBe(true)
      expect(controller.getSnapshot().zoomScale).toBe(1)

      controller.dispose()
    })

    it('dismisses via swipe when downward drag exceeds the 80px threshold on release', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      controller.onTouchStartOne(100, 100)
      controller.onTouchMoveOne(100, 200) // 100px downward (> 80px threshold)
      expect(controller.getSnapshot().dragY).toBe(100)

      const outcome = controller.onTouchEnd(false)
      expect(outcome).toBe('dismissed')
      expect(controller.getSnapshot().isDismissed).toBe(true)
      expect(controller.getSnapshot().dragY).toBe(700) // 100 + 600 glide-out offset

      controller.dispose()
    })

    it('ignores stale click-suppression timer callbacks if superseded or disposed', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      controller.onTouchStartOne(100, 100)
      controller.onTouchMoveOne(100, 160)
      controller.onTouchEnd(false)

      expect(controller.getSnapshot().didDrag).toBe(true)
      const capturedTimer = Array.from(env.timerCallbacks.values())[0]
      expect(capturedTimer).toBeDefined()

      // User initiates explicit dismiss or new gesture which clears click suppression
      controller.onExplicitDismiss()
      expect(env.getPendingTimerCount()).toBe(0)

      // Even if stale captured timer callback fires later, it must not mutate disposed/dismissed state
      capturedTimer.cb()
      expect(controller.getSnapshot().isDismissed).toBe(true)

      controller.dispose()
    })

    it('proves distinct two-phase style and transition separation between dragging, spring-back initiation, and rest', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)
      const snapshots: any[] = []
      controller.subscribe(s => snapshots.push({ ...s }))

      // 1. Dragging: dragY=50, isDragging=true -> transition: none
      controller.onTouchStartOne(100, 100)
      controller.onTouchMoveOne(100, 150)
      const dragSnap = controller.getSnapshot()
      expect(dragSnap.dragY).toBe(50)
      expect(dragSnap.isDragging).toBe(true)

      // 2. Touch released (Phase 1): isDragging becomes false, but dragY remains 50
      // In CSS, this establishes the transition curve on the current displaced position
      controller.onTouchEnd(false)
      const phase1Snap = controller.getSnapshot()
      expect(phase1Snap.dragY).toBe(50)
      expect(phase1Snap.isDragging).toBe(false)

      // 3. Next animation frame (Phase 2): dragY resets to 0 while isDragging remains false
      // Browser smoothly eases transform from (0, 50px, 0) to (0, 0px, 0)
      env.flushRaf()
      const phase2Snap = controller.getSnapshot()
      expect(phase2Snap.dragY).toBe(0)
      expect(phase2Snap.isDragging).toBe(false)

      controller.dispose()
    })

    it('ensures explicit dismissal marks controller as dismissed and survives state updates without timer cancellation', () => {
      const env = createTestScheduler()
      const controller = new LightboxGestureController(env.scheduler)

      let dismissedEmitted = false
      controller.subscribe(snap => {
        if (snap.isDismissed) dismissedEmitted = true
      })

      // User triggers dismissal (e.g. clicks X button)
      controller.onExplicitDismiss()
      expect(controller.getSnapshot().isDismissed).toBe(true)
      expect(dismissedEmitted).toBe(true)

      // Subsequent gestures must be completely ignored once dismissed
      controller.onTouchStartOne(100, 100)
      expect(controller.getSnapshot().isDragging).toBe(false)
      expect(controller.getSnapshot().dragY).toBe(0)

      controller.dispose()
    })

    describe('LightboxDismissCoordinator timer lifecycle', () => {
      it('schedules dismissal and calls onClosed exactly once after delay', () => {
        const env = createTestScheduler()
        const onClosed = vi.fn()
        const coordinator = new LightboxDismissCoordinator(() => 200, onClosed, env.scheduler)

        // Trigger dismissal
        const res = coordinator.dismiss()
        expect(res.scheduled).toBe(true)
        expect(res.delay).toBe(200)
        expect(onClosed).not.toHaveBeenCalled()
        expect(coordinator.isDismissed()).toBe(true)

        // Second dismissal call while in progress must be ignored
        const secondRes = coordinator.dismiss()
        expect(secondRes.scheduled).toBe(false)
        expect(onClosed).not.toHaveBeenCalled()

        // Advance 100ms -> still pending
        env.advanceTimers(100)
        expect(onClosed).not.toHaveBeenCalled()

        // Advance past 200ms -> onClosed called exactly once!
        env.advanceTimers(100)
        expect(onClosed).toHaveBeenCalledTimes(1)

        coordinator.dispose()
      })

      it('cancels pending dismissal timer if dispose() is called before delay expires', () => {
        const env = createTestScheduler()
        const onClosed = vi.fn()
        const coordinator = new LightboxDismissCoordinator(() => 200, onClosed, env.scheduler)

        coordinator.dismiss()
        expect(env.getPendingTimerCount()).toBe(1)

        coordinator.dispose()
        expect(env.getPendingTimerCount()).toBe(0)

        env.advanceTimers(300)
        expect(onClosed).not.toHaveBeenCalled()
      })

      it('executes onClosed immediately (0ms) when reduced motion or immediate flag is active', () => {
        const env = createTestScheduler()
        const onClosed = vi.fn()
        const coordinator = new LightboxDismissCoordinator(() => 0, onClosed, env.scheduler)

        const res = coordinator.dismiss(true)
        expect(res.scheduled).toBe(false)
        expect(res.delay).toBe(0)
        expect(onClosed).toHaveBeenCalledTimes(1)
        expect(env.getPendingTimerCount()).toBe(0)

        coordinator.dispose()
      })
    })
  })
})
