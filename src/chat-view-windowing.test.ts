import { describe, expect, it } from 'vitest'
import { computeProgressiveRenderSlice } from './components/ChatView'

describe('Progressive Message Windowing Algorithm & Top Offset Tracking', () => {
  it('caps initial render to 25 items for a 100-message transcript with offset 75', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const initialOffset = Math.max(0, messages.length - 25) // 75
    const result = computeProgressiveRenderSlice(messages, initialOffset)

    expect(result.renderedMessages).toHaveLength(25)
    expect(result.hasEarlierInBatch).toBe(true)
    expect(result.remainingEarlier).toBe(75)

    // Oldest rendered item is item 76 (index 75)
    expect(result.renderedMessages[0].id).toBe(76)
    // Newest rendered item is item 100 (index 99)
    expect(result.renderedMessages[24].id).toBe(100)
  })

  it('progressively expands window upwards when earlier offset decreases by 25', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const expandedOffset = 75 - 25 // 50
    const expanded = computeProgressiveRenderSlice(messages, expandedOffset)

    expect(expanded.renderedMessages).toHaveLength(50)
    expect(expanded.hasEarlierInBatch).toBe(true)
    expect(expanded.remainingEarlier).toBe(50)
    expect(expanded.renderedMessages[0].id).toBe(51)
    expect(expanded.renderedMessages[49].id).toBe(100)
  })

  it('renders all items when history is smaller than 25 (offset = 0)', () => {
    const messages = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const offset = Math.max(0, messages.length - 25) // 0
    const result = computeProgressiveRenderSlice(messages, offset)

    expect(result.renderedMessages).toHaveLength(15)
    expect(result.hasEarlierInBatch).toBe(false)
    expect(result.remainingEarlier).toBe(0)
    expect(result.renderedMessages[0].id).toBe(1)
  })

  it('inherently preserves top visible message when new messages arrive at tail (zero eviction)', () => {
    const initialMessages = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    const offset = Math.max(0, initialMessages.length - 25) // 5
    const initial = computeProgressiveRenderSlice(initialMessages, offset)

    expect(initial.renderedMessages[0].id).toBe(6) // item 6 is at top
    expect(initial.renderedMessages).toHaveLength(25)

    // New messages arrive: messages.length becomes 32
    const updatedMessages = [
      ...initialMessages,
      { id: 31, content: 'Msg 31' },
      { id: 32, content: 'Msg 32' },
    ]

    // Top offset remains 5!
    const afterAppend = computeProgressiveRenderSlice(updatedMessages, offset)

    expect(afterAppend.renderedMessages).toHaveLength(27)
    // Top message MUST still be item 6! Zero eviction!
    expect(afterAppend.renderedMessages[0].id).toBe(6)
    expect(afterAppend.renderedMessages[26].id).toBe(32)
  })

  it('keeps initial render capped at 25 across chunked history loading (0 -> 25 -> 100)', () => {
    // Phase 1: 0 messages on mount
    let messages: any[] = []
    let offset = Math.max(0, messages.length - 25) // 0

    // Phase 2: First chunk arrives (25 messages)
    messages = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    offset = Math.max(0, messages.length - 25) // 0
    const slice1 = computeProgressiveRenderSlice(messages, offset)
    expect(slice1.renderedMessages).toHaveLength(25)

    // Phase 3: Remaining chunk arrives (100 messages total)
    messages = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, content: `Msg ${i + 1}` }))
    offset = Math.max(0, messages.length - 25) // 75
    const slice2 = computeProgressiveRenderSlice(messages, offset)
    expect(slice2.renderedMessages).toHaveLength(25)
    expect(slice2.hasEarlierInBatch).toBe(true)
    expect(slice2.remainingEarlier).toBe(75)
    expect(slice2.renderedMessages[0].id).toBe(76)
  })
})
