import { describe, expect, it } from 'vitest'
import {
  INITIAL_SPINNER_PHRASES,
  PROGRESSIVE_SPINNER_PHRASES,
  getInitialSpinnerPhrase,
  getProgressiveSpinnerPhrase,
  getRandomToolThreshold,
} from './spinner-phrases'

describe('Spinner phrase dual-collection and tool-driven threshold switching', () => {
  it('initial spinner phrase always selects from Collection 1 (understanding / digesting)', () => {
    for (let i = 0; i < 30; i++) {
      const phrase = getInitialSpinnerPhrase()
      expect(phrase.endsWith('…')).toBe(true)
      const base = phrase.slice(0, -1)
      expect(INITIAL_SPINNER_PHRASES as readonly string[]).toContain(base)
      expect(PROGRESSIVE_SPINNER_PHRASES as readonly string[]).not.toContain(base)
    }
  })

  it('progressive spinner phrase always selects from Collection 2 (deep work / synthesizing)', () => {
    for (let i = 0; i < 30; i++) {
      const phrase = getProgressiveSpinnerPhrase()
      expect(phrase.endsWith('…')).toBe(true)
      const base = phrase.slice(0, -1)
      expect(PROGRESSIVE_SPINNER_PHRASES as readonly string[]).toContain(base)
      expect(INITIAL_SPINNER_PHRASES as readonly string[]).not.toContain(base)
    }
  })

  it('picks next progressive phrase that differs from the previous one in consecutive sequence', () => {
    let current = getProgressiveSpinnerPhrase()
    for (let i = 0; i < 50; i++) {
      const next = getProgressiveSpinnerPhrase(current)
      expect(next.endsWith('…')).toBe(true)
      expect(next).not.toBe(current)
      current = next
    }
  })

  it('generates integer tool thresholds bounded between 1 and 2', () => {
    for (let i = 0; i < 50; i++) {
      const threshold = getRandomToolThreshold(1, 2)
      expect(Number.isInteger(threshold)).toBe(true)
      expect(threshold).toBeGreaterThanOrEqual(1)
      expect(threshold).toBeLessThanOrEqual(2)
    }
  })

  it('models turn tool count progression: starts in Collection 1 and transitions to Collection 2 upon reaching threshold', () => {
    let phrase = getInitialSpinnerPhrase()
    expect(INITIAL_SPINNER_PHRASES as readonly string[]).toContain(phrase.slice(0, -1))

    // Threshold = 2 tool calls
    const threshold = 2
    let toolCount = 0

    // Tool 1 triggers
    toolCount = 1
    if (toolCount >= threshold) {
      phrase = getProgressiveSpinnerPhrase(phrase)
    }
    // Still in Collection 1 because 1 < 2
    expect(INITIAL_SPINNER_PHRASES as readonly string[]).toContain(phrase.slice(0, -1))

    // Tool 2 triggers -> reaches threshold
    toolCount = 2
    if (toolCount >= threshold) {
      phrase = getProgressiveSpinnerPhrase(phrase)
    }
    // Now transitioned to Collection 2!
    expect(PROGRESSIVE_SPINNER_PHRASES as readonly string[]).toContain(phrase.slice(0, -1))

    // Turn settles -> resets to Collection 1
    phrase = getInitialSpinnerPhrase()
    expect(INITIAL_SPINNER_PHRASES as readonly string[]).toContain(phrase.slice(0, -1))
  })
})
