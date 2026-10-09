import { describe, expect, it } from 'vitest'

import { computeNextSwipeTab, isHorizontalSwipeIntent } from './tab-swipe'

describe('Horizontal Tab Swipe Navigation', () => {
  it('correctly advances tabs upon horizontal left swipe', () => {
    expect(computeNextSwipeTab('bots', -50, 5)).toBe('sessions')
    expect(computeNextSwipeTab('sessions', -60, 10)).toBe('tasks')
    // At the rightmost tab, cannot swipe further left
    expect(computeNextSwipeTab('tasks', -50, 0)).toBeNull()
  })

  it('correctly navigates backwards upon horizontal right swipe', () => {
    expect(computeNextSwipeTab('tasks', 50, 5)).toBe('sessions')
    expect(computeNextSwipeTab('sessions', 60, 10)).toBe('bots')
    // At the leftmost tab, cannot swipe further right
    expect(computeNextSwipeTab('bots', 50, 0)).toBeNull()
  })

  it('rejects predominantly vertical scrolling gestures', () => {
    // Vertical swipe with slight horizontal drift must yield to page scrolling
    expect(computeNextSwipeTab('bots', -45, 50)).toBeNull()
    expect(computeNextSwipeTab('sessions', 50, 80)).toBeNull()
  })

  it('rejects gestures below the 44px threshold to preserve taps and micro-jitters', () => {
    expect(computeNextSwipeTab('bots', -30, 2)).toBeNull()
    expect(computeNextSwipeTab('sessions', 40, 0)).toBeNull()
  })

  it('detects horizontal intent past slop threshold', () => {
    // Less than 10px slop -> not confirmed
    expect(isHorizontalSwipeIntent(5, 2)).toBe(false)
    // Clear horizontal dominance -> confirmed
    expect(isHorizontalSwipeIntent(15, 5)).toBe(true)
    // Diagonal or vertical -> yields to scroll
    expect(isHorizontalSwipeIntent(15, 15)).toBe(false)
    expect(isHorizontalSwipeIntent(5, 20)).toBe(false)
  })
})
