import { describe, expect, it } from 'vitest'

import {
  classifyInteractiveRowGesture,
  computeNextSwipeTab,
  isHorizontalSwipeIntent,
} from './tab-swipe'

describe('Horizontal Tab Swipe Navigation', () => {
  it('correctly advances tabs upon horizontal left swipe', () => {
    expect(computeNextSwipeTab('bots', -60, 5)).toBe('sessions')
    expect(computeNextSwipeTab('sessions', -70, 10)).toBe('tasks')
    // At the rightmost tab, cannot swipe further left
    expect(computeNextSwipeTab('tasks', -60, 0)).toBeNull()
  })

  it('correctly navigates backwards upon horizontal right swipe', () => {
    expect(computeNextSwipeTab('tasks', 60, 5)).toBe('sessions')
    expect(computeNextSwipeTab('sessions', 70, 10)).toBe('bots')
    // At the leftmost tab, cannot swipe further right
    expect(computeNextSwipeTab('bots', 60, 0)).toBeNull()
  })

  it('rejects predominantly vertical scrolling gestures', () => {
    // Vertical swipe with slight horizontal drift must yield to page scrolling
    expect(computeNextSwipeTab('bots', -45, 50)).toBeNull()
    expect(computeNextSwipeTab('sessions', 50, 80)).toBeNull()
  })

  it('rejects gestures below the threshold to preserve taps and micro-jitters', () => {
    expect(computeNextSwipeTab('bots', -40, 2)).toBeNull()
    expect(computeNextSwipeTab('sessions', 45, 0)).toBeNull()
  })

  it('detects horizontal intent past slop threshold', () => {
    // Below slop -> not confirmed
    expect(isHorizontalSwipeIntent(10, 2)).toBe(false)
    // Clear horizontal dominance past slop -> confirmed
    expect(isHorizontalSwipeIntent(25, 5)).toBe(true)
    // Diagonal or vertical -> yields to scroll
    expect(isHorizontalSwipeIntent(15, 15)).toBe(false)
    expect(isHorizontalSwipeIntent(5, 20)).toBe(false)
  })

  it('correctly validates interactive threshold and directional dominance for row taps', () => {
    // Movement on interactive row below 40px must NOT be classified as swipe
    // Boundary checks:
    expect(classifyInteractiveRowGesture(39, 0)).toBe('tap_preserve')
    expect(classifyInteractiveRowGesture(40, 0)).toBe('horizontal_swipe')
    expect(classifyInteractiveRowGesture(-40, 0)).toBe('horizontal_swipe')

    // Natural thumb jitter on tap
    expect(classifyInteractiveRowGesture(14, 2)).toBe('tap_preserve')
    expect(classifyInteractiveRowGesture(25, 4)).toBe('tap_preserve')
    expect(classifyInteractiveRowGesture(35, 10)).toBe('tap_preserve')

    // Strict boundary checks for exact 1.25x dominance:
    // vertical: 15 === 12 * 1.25, so strict `>` must NOT classify as vertical
    expect(classifyInteractiveRowGesture(12, 15)).toBe('tap_preserve')
    // horizontal: 40 === 32 * 1.25, so strict `>` must NOT classify as horizontal
    expect(classifyInteractiveRowGesture(40, 32)).toBe('tap_preserve')
    expect(classifyInteractiveRowGesture(-40, 32)).toBe('tap_preserve')

    // Vertical scroll over row (dy >= 12 and dy > dx * 1.25)
    expect(classifyInteractiveRowGesture(5, 20)).toBe('vertical_scroll')
    expect(classifyInteractiveRowGesture(0, 12)).toBe('vertical_scroll')

    // Intentional horizontal swipe across row
    expect(classifyInteractiveRowGesture(50, 10)).toBe('horizontal_swipe')
    expect(classifyInteractiveRowGesture(-60, 15)).toBe('horizontal_swipe')
  })
})
