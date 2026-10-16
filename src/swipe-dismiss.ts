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

export function computeSwipeTransform(dragY: number, _isDragging?: boolean) {
  const clampedY = Math.max(0, dragY)
  const backdropOpacity = Math.max(0.15, 1 - clampedY / 320)
  const scale = Math.max(0.8, 1 - clampedY / 1000)
  return { backdropOpacity, scale }
}

export function computeDismissDelay(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 200
}

export function shouldDismissOnBackdropClick(
  target: unknown,
  currentTarget: unknown,
  didDrag: boolean
): boolean {
  return target === currentTarget && !didDrag
}

export function classifyDoubleTap(
  lastTapTime: number,
  now: number,
  thresholdMs: number = 300
): { isDoubleTap: boolean; nextTapTime: number } {
  if (lastTapTime > 0 && now - lastTapTime < thresholdMs) {
    return { isDoubleTap: true, nextTapTime: 0 }
  }
  return { isDoubleTap: false, nextTapTime: now }
}

export class LightboxDismissCoordinator {
  private closeTimer: number | null = null
  private isDismissing = false

  constructor(
    private readonly getDelay: () => number,
    private readonly onClosed: () => void,
    private readonly scheduler: LightboxScheduler = defaultLightboxScheduler
  ) {}

  public dismiss(immediate = false): { delay: number; scheduled: boolean } {
    if (this.isDismissing) return { delay: 0, scheduled: false }
    this.isDismissing = true
    const delay = immediate ? 0 : this.getDelay()
    if (delay === 0) {
      this.onClosed()
      return { delay: 0, scheduled: false }
    }
    this.closeTimer = this.scheduler.setTimer(() => {
      this.closeTimer = null
      this.onClosed()
    }, delay)
    return { delay, scheduled: true }
  }

  public isDismissed(): boolean {
    return this.isDismissing
  }

  public dispose(): void {
    if (this.closeTimer != null) {
      this.scheduler.clearTimer(this.closeTimer)
      this.closeTimer = null
    }
  }
}

export interface LightboxScheduler {
  now: () => number
  requestFrame: (cb: () => void) => number
  cancelFrame: (handle: number) => void
  setTimer: (cb: () => void, ms: number) => number
  clearTimer: (handle: number) => void
}

export const defaultLightboxScheduler: LightboxScheduler = {
  now: () => Date.now(),
  requestFrame: (cb: () => void) =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number),
  cancelFrame: (h: number) =>
    typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(h) : clearTimeout(h),
  setTimer: (cb: () => void, ms: number) => setTimeout(cb, ms) as unknown as number,
  clearTimer: (h: number) => clearTimeout(h),
}

export interface LightboxGestureSnapshot {
  dragY: number
  isDragging: boolean
  zoomScale: number
  pan: { x: number; y: number }
  isDismissed: boolean
  didDrag: boolean
}

export class LightboxGestureController {
  private scheduler: LightboxScheduler
  private listeners = new Set<(state: LightboxGestureSnapshot) => void>()

  private dragY = 0
  private isDragging = false
  private zoomScale = 1
  private pan = { x: 0, y: 0 }
  private isDismissed = false
  private didDrag = false

  private startX: number | null = null
  private startY: number | null = null
  private isSwipeDown = false
  private lastTapTime = 0
  private panStart: { x: number; y: number } | null = null
  private initialPan = { x: 0, y: 0 }
  private initialPinchDist: number | null = null
  private initialPinchScale = 1

  private springBackRaf: number | null = null
  private springBackToken = 0

  private clickSuppressTimer: number | null = null
  private clickSuppressToken = 0

  private disposed = false

  constructor(scheduler: Partial<LightboxScheduler> = {}) {
    this.scheduler = { ...defaultLightboxScheduler, ...scheduler }
  }

  public getSnapshot(): LightboxGestureSnapshot {
    return {
      dragY: this.dragY,
      isDragging: this.isDragging,
      zoomScale: this.zoomScale,
      pan: { ...this.pan },
      isDismissed: this.isDismissed,
      didDrag: this.didDrag,
    }
  }

  public subscribe(fn: (state: LightboxGestureSnapshot) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    if (this.disposed) return
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  public clearSpringBack(): void {
    this.springBackToken++
    if (this.springBackRaf != null) {
      this.scheduler.cancelFrame(this.springBackRaf)
      this.springBackRaf = null
    }
  }

  public clearClickSuppress(): void {
    this.clickSuppressToken++
    if (this.clickSuppressTimer != null) {
      this.scheduler.clearTimer(this.clickSuppressTimer)
      this.clickSuppressTimer = null
    }
  }

  public onTouchStartOne(x: number, y: number, time?: number): void {
    if (this.disposed || this.isDismissed) return
    this.clearSpringBack()

    const now = time ?? this.scheduler.now()
    const tapResult = classifyDoubleTap(this.lastTapTime, now)
    this.lastTapTime = tapResult.nextTapTime
    if (tapResult.isDoubleTap) {
      this.toggleZoom()
      return
    }

    this.startX = x
    this.startY = y

    if (this.zoomScale > 1.05) {
      this.panStart = { x, y }
      this.initialPan = { ...this.pan }
      this.isDragging = true
      this.emit()
    } else {
      this.isSwipeDown = false
      this.isDragging = false
    }
  }

  public onPinchStart(dist: number): void {
    if (this.disposed || this.isDismissed) return
    this.clearSpringBack()
    this.initialPinchDist = dist
    this.initialPinchScale = this.zoomScale
    this.isDragging = false
    this.isSwipeDown = false
  }

  public onPinchMove(dist: number): void {
    if (this.disposed || this.isDismissed || this.initialPinchDist == null) return
    const ratio = dist / this.initialPinchDist
    const nextScale = Math.min(4, Math.max(1, this.initialPinchScale * ratio))
    this.zoomScale = nextScale
    if (nextScale <= 1.05) {
      this.pan = { x: 0, y: 0 }
    }
    this.emit()
  }

  public onTouchMoveOne(x: number, y: number, viewportWidth = 390, viewportHeight = 844): boolean {
    if (this.disposed || this.isDismissed) return false

    if (this.zoomScale > 1.05 && this.panStart) {
      const deltaX = x - this.panStart.x
      const deltaY = y - this.panStart.y
      const maxPanX = (viewportWidth * (this.zoomScale - 1)) / 1.8
      const maxPanY = (viewportHeight * (this.zoomScale - 1)) / 1.8
      this.pan = {
        x: Math.max(-maxPanX, Math.min(maxPanX, this.initialPan.x + deltaX)),
        y: Math.max(-maxPanY, Math.min(maxPanY, this.initialPan.y + deltaY)),
      }
      this.emit()
      return true
    }

    if (this.startY != null && this.startX != null) {
      const res = processSwipeMove(this.startX, this.startY, x, y, this.isSwipeDown)
      if (res.active) {
        this.isSwipeDown = true
        this.didDrag = true
        this.lastTapTime = 0 // qualified drag cancels any pending double-tap
        this.isDragging = true
        this.dragY = res.dragY
        this.emit()
        return res.shouldPreventDefault
      }
    }
    return false
  }

  public onTouchEnd(reducedMotion = false): 'dismissed' | 'spring-back' | 'none' {
    if (this.disposed || this.isDismissed) return 'none'
    this.initialPinchDist = null
    this.panStart = null

    if (this.zoomScale <= 1.05 && this.isSwipeDown && shouldDismissOnRelease(this.dragY)) {
      this.isDismissed = true
      this.clearSpringBack()
      this.clearClickSuppress()
      this.isDragging = false
      this.dragY = this.dragY + 600
      this.emit()
      return 'dismissed'
    }

    if (this.isDragging || this.dragY > 0) {
      this.isDragging = false
      if (reducedMotion) {
        this.dragY = 0
        this.emit()
      } else {
        this.emit() // Step 1: transition enabled on current dragY
        this.clearSpringBack()
        const token = ++this.springBackToken
        this.springBackRaf = this.scheduler.requestFrame(() => {
          if (this.disposed || this.springBackToken !== token) return
          this.dragY = 0
          this.springBackRaf = null
          this.emit()
        })
      }

      this.startX = null
      this.startY = null
      this.isSwipeDown = false

      if (this.didDrag) {
        this.clearClickSuppress()
        const token = ++this.clickSuppressToken
        this.clickSuppressTimer = this.scheduler.setTimer(() => {
          if (this.disposed || this.clickSuppressToken !== token) return
          this.didDrag = false
          this.clickSuppressTimer = null
          this.emit()
        }, 180)
      }
      return 'spring-back'
    }

    this.startX = null
    this.startY = null
    this.isSwipeDown = false
    return 'none'
  }

  public onTouchCancel(reducedMotion = false): void {
    this.onTouchEnd(reducedMotion)
  }

  public onBackdropClick(isDirectBackdrop: boolean): boolean {
    if (this.disposed || this.isDismissed) return false
    if (!shouldDismissOnBackdropClick(isDirectBackdrop ? 1 : 0, 1, this.didDrag)) {
      return false
    }
    this.isDismissed = true
    this.clearSpringBack()
    this.clearClickSuppress()
    this.emit()
    return true
  }

  public toggleZoom(): void {
    if (this.disposed || this.isDismissed) return
    if (this.zoomScale > 1.05) {
      this.zoomScale = 1
      this.pan = { x: 0, y: 0 }
    } else {
      this.zoomScale = 2.5
      this.pan = { x: 0, y: 0 }
    }
    this.emit()
  }

  public onExplicitDismiss(): void {
    if (this.disposed || this.isDismissed) return
    this.isDismissed = true
    this.clearSpringBack()
    this.clearClickSuppress()
    this.emit()
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearSpringBack()
    this.clearClickSuppress()
    this.listeners.clear()
  }
}
