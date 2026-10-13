import { describe, expect, it } from 'vitest'
import { computeProgressiveRenderSlice } from './components/ChatView'

describe('Progressive Message Windowing Algorithm & Tail Retention', () => {
  it('caps initial render to 25 items for a 100-message transcript', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const result = computeProgressiveRenderSlice(messages, 25)

    expect(result.renderedMessages).toHaveLength(25)
    expect(result.hasEarlierInBatch).toBe(true)
    expect(result.remainingEarlier).toBe(75)

    // Oldest rendered item is item 76 (100 - 25 + 1)
    expect(result.renderedMessages[0].id).toBe(76)
    // Newest rendered item is item 100
    expect(result.renderedMessages[24].id).toBe(100)
  })

  it('progressively expands window when earlier batch is loaded', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const expanded = computeProgressiveRenderSlice(messages, 50)

    expect(expanded.renderedMessages).toHaveLength(50)
    expect(expanded.hasEarlierInBatch).toBe(true)
    expect(expanded.remainingEarlier).toBe(50)
    expect(expanded.renderedMessages[0].id).toBe(51)
    expect(expanded.renderedMessages[49].id).toBe(100)
  })

  it('renders all items when history is smaller than window limit', () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const result = computeProgressiveRenderSlice(messages, 25)

    expect(result.renderedMessages).toHaveLength(15)
    expect(result.hasEarlierInBatch).toBe(false)
    expect(result.remainingEarlier).toBe(0)
    expect(result.renderedMessages[0].id).toBe(1)
  })

  it('preserves top visible message when new messages arrive at tail (no eviction)', () => {
    const initialMessages = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const initial = computeProgressiveRenderSlice(initialMessages, 25)

    expect(initial.renderedMessages[0].id).toBe(6) // item 6 is at top
    expect(initial.renderedMessages).toHaveLength(25)

    // New messages arrive: delta = 2, messages.length = 32
    const updatedMessages = [
      ...initialMessages,
      { id: 31, content: 'Msg 31' },
      { id: 32, content: 'Msg 32' },
    ]

    // Our tail-expansion hook expands renderedLimit by delta (25 + 2 = 27)
    const afterAppend = computeProgressiveRenderSlice(updatedMessages, 27)

    expect(afterAppend.renderedMessages).toHaveLength(27)
    // Top message MUST still be item 6! It is NOT evicted!
    expect(afterAppend.renderedMessages[0].id).toBe(6)
    expect(afterAppend.renderedMessages[26].id).toBe(32)
  })
})
