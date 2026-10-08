import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ImageLightbox, triggerDownload } from './components/MarkdownContent'
import {
  computeDismissDelay,
  computeSwipeTransform,
  processSwipeMove,
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
})
