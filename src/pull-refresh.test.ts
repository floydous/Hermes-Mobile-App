import { describe, expect, it } from 'vitest'

export const PULL_TRIGGER_THRESHOLD_PX = 48

export function computePullDistance(rawDeltaY: number): number {
  if (rawDeltaY <= 8) return 0
  return Math.min(72, Math.max(0, (rawDeltaY - 8) * 0.55))
}

export function shouldTriggerPullRefresh(pullDistance: number): boolean {
  return pullDistance >= PULL_TRIGGER_THRESHOLD_PX
}

export function computePullRotationDegrees(pullDistance: number): number {
  return Math.min(360, (pullDistance / PULL_TRIGGER_THRESHOLD_PX) * 360)
}

describe('Pull-to-refresh floating physics and cancellation', () => {
  it('suppresses drag for sub-slop movements', () => {
    expect(computePullDistance(5)).toBe(0)
    expect(computePullDistance(8)).toBe(0)
  })

  it('dampens pull movement smoothly and caps at 72px max', () => {
    // 20px raw delta -> (20 - 8) * 0.55 = 6.6px
    expect(computePullDistance(20)).toBeCloseTo(6.6, 1)
    // 80px raw delta -> (80 - 8) * 0.55 = 39.6px
    expect(computePullDistance(80)).toBeCloseTo(39.6, 1)
    // Huge drag -> clamped to 72px
    expect(computePullDistance(500)).toBe(72)
  })

  it('evaluates trigger threshold at exactly 48px', () => {
    // Under 48px -> cancelled
    expect(shouldTriggerPullRefresh(0)).toBe(false)
    expect(shouldTriggerPullRefresh(35)).toBe(false)
    expect(shouldTriggerPullRefresh(47.9)).toBe(false)

    // At or over 48px -> triggers refresh
    expect(shouldTriggerPullRefresh(48)).toBe(true)
    expect(shouldTriggerPullRefresh(60)).toBe(true)
  })

  it('rotates icon continuously up to 360 degrees as user drags to threshold', () => {
    // 0px -> 0 deg
    expect(computePullRotationDegrees(0)).toBe(0)
    // Halfway (24px) -> 180 deg
    expect(computePullRotationDegrees(24)).toBe(180)
    // At threshold (48px) -> full 360 deg
    expect(computePullRotationDegrees(48)).toBe(360)
    // Beyond threshold -> capped at 360 deg
    expect(computePullRotationDegrees(65)).toBe(360)
  })

  it('cancels refresh if user slides thumb back up before lifting', () => {
    // User pulls deep to 55px (past threshold)
    let currentDistance = 55
    expect(shouldTriggerPullRefresh(currentDistance)).toBe(true)

    // User slides back up toward top (distance decreases to 30px)
    currentDistance = 30
    // Releasing now will cancel the refresh!
    expect(shouldTriggerPullRefresh(currentDistance)).toBe(false)
  })
})
