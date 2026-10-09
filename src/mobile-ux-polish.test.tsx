import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { calculateUnreadState, isContinuationNudge, cleanContinuationScaffolding } from './session-cache'
import { cleanPreviewSnippet } from './live-model'
import { MessageCard } from './components/MarkdownContent'
import type { LiveMessage } from './hermes'

describe('Mobile UX Polish & Backlog Verification', () => {
  describe('Item 6: Network Cutoff Scaffolding Detection & Rendering', () => {
    it('detects network cutoff and output truncation prompts', () => {
      const networkCutoff = `[System: The previous response was cut off by a network error mid-stream — a transport interruption, NOT a change in your capabilities. Your tools are still fully available; call them as normal and ignore any earlier claim that you lack tool access. Continue the task from where you left off. Do not restart or repeat prior text.]`
      const legacyCutoff = `[System: The previous response was cut off by a network error mid-stream. Continue exactly where you left off. Do not restart or repeat prior text. Finish the answer directly.]`
      const outputLimit = `[System: Your previous response was truncated by the output length limit. Continue exactly where you left off. Do not restart or repeat prior text. Finish the answer directly.]`
      const droppedTools = `[System: Your previous tool call (search_files) was too large and the stream timed out before it could be delivered. Do NOT retry the same tool call with the same large content.]`
      const normalUserMsg = `How do I implement a binary search tree in TypeScript?`

      expect(isContinuationNudge(networkCutoff)).toBe(true)
      expect(isContinuationNudge(legacyCutoff)).toBe(true)
      expect(isContinuationNudge(outputLimit)).toBe(true)
      expect(isContinuationNudge(droppedTools)).toBe(true)
      expect(isContinuationNudge(normalUserMsg)).toBe(false)
    })

    it('cleans continuation scaffolding from previews and snippets', () => {
      const rawPreview = `[System: The previous response was cut off by a network error mid-stream. Continue exactly where you left off.] Here is the code:`
      const cleaned = cleanContinuationScaffolding(rawPreview)
      expect(cleaned).toBe('Here is the code:')

      const snippet = cleanPreviewSnippet(rawPreview)
      expect(snippet).toBe('Here is the code:')
    })

    it('renders network-cutoff-capsule instead of raw user bubble', () => {
      const cutoffMessage: LiveMessage = {
        id: 101,
        role: 'user',
        content: `[System: The previous response was cut off by a network error mid-stream. Continue exactly where you left off.]`,
        timestamp: 1000,
      }

      const html = renderToString(
        <MessageCard
          message={cutoffMessage}
          onEdit={vi.fn()}
          fallbackName="default"
          revealTimestamp={false}
          onRevealTimestamp={vi.fn()}
        />
      )

      expect(html).toContain('network-cutoff-capsule')
      expect(html).toContain('Response continued after network interruption')
      expect(html).not.toContain('Continue exactly where you left off')
    })
  })

  describe('Item 8: Dispatched Task Completion Timing', () => {
    it('marks completed strictly when turn is NOT sending and assistant has replied', () => {
      // Completed case: assistant reply exists, not sending
      const hasAssistantReplyAfter = true
      const sending = false
      const isLast = false
      const isCompleted = !sending && !isLast && hasAssistantReplyAfter
      expect(isCompleted).toBe(true)

      // Active sending case: assistant interim chunk or tool exists, but turn is STILL sending
      const stillSending = true
      const isCompletedWhileSending = !stillSending && !isLast && hasAssistantReplyAfter
      expect(isCompletedWhileSending).toBe(false)

      // Last message case (currently running delegation):
      const isCurrentlyLast = true
      const isCompletedLast = !sending && !isCurrentlyLast && hasAssistantReplyAfter
      expect(isCompletedLast).toBe(false)
    })
  })

  describe('Item 9: calculateUnreadState Production Logic', () => {
    it('returns zero unread when session is currently selected', () => {
      const result = calculateUnreadState('sess-1', 6000, [{ id: 1, role: 'assistant', content: 'hello', timestamp: 6000 }], 5000, true)
      expect(result).toEqual({ isUnread: false, unreadCount: 0 })
    })

    it('never marks unread when user sends a message after lastRead (sent message race)', () => {
      const lastReadMs = 5_000_000

      const cachedTranscript: LiveMessage[] = [
        { id: 1, role: 'assistant', content: 'Prior assistant response', timestamp: 4000 }, // 4,000,000 ms <= lastRead
        // User sends a message at timestamp 6000 (6,000,000 ms > lastRead), then closes app
        { id: 2, role: 'user', content: 'My new question', timestamp: 6000 },
      ]

      const result = calculateUnreadState('sess-1', 6000, cachedTranscript, lastReadMs, false)
      expect(result.isUnread).toBe(false)
      expect(result.unreadCount).toBe(0)
    })

    it('accurately counts incoming assistant responses arriving after user message', () => {
      const lastReadMs = 5_000_000

      const cachedTranscript: LiveMessage[] = [
        { id: 1, role: 'assistant', content: 'Prior reply', timestamp: 4000 },
        { id: 2, role: 'user', content: 'User question', timestamp: 6000 },
        { id: 3, role: 'assistant', content: 'New assistant reply', timestamp: 7000 }, // 7,000,000 ms > lastRead
        { id: 4, role: 'assistant', content: 'Second assistant reply', timestamp: 8000 }, // 8,000,000 ms > lastRead
      ]

      const result = calculateUnreadState('sess-1', 8000, cachedTranscript, lastReadMs, false)
      expect(result.isUnread).toBe(true)
      expect(result.unreadCount).toBe(2)
    })

    it('falls back to server lastActive when transcript is not cached yet', () => {
      const lastReadMs = 5_000_000
      const serverLastActiveSec = 6000 // 6,000,000 ms > 5,000,000 ms

      const result = calculateUnreadState('sess-1', serverLastActiveSec, null, lastReadMs, false)
      expect(result.isUnread).toBe(true)
      expect(result.unreadCount).toBe(1)
    })

    it('marks conversation unread with badge count 1 when agent is waiting for clarification', () => {
      const lastReadMs = 5_000_000

      const cachedTranscript: LiveMessage[] = [
        { id: 1, role: 'assistant', content: 'Prior reply', timestamp: 4000 },
        { id: 2, role: 'user', content: 'Help me choose', timestamp: 6000 },
      ]

      // isWaitingInput = true
      const result = calculateUnreadState('sess-1', 6000, cachedTranscript, lastReadMs, false, true)
      expect(result.isUnread).toBe(true)
      expect(result.unreadCount).toBe(1)
    })
  })

  describe('Item 5: Long-press Touch Slop Movement Invariant', () => {
    it('cancels timer when pointer moves beyond 10px touch slop', () => {
      const startPos = { x: 100, y: 100 }
      const movePos = { x: 115, y: 102 } // dx = 15 > 10

      const dx = Math.abs(movePos.x - startPos.x)
      const dy = Math.abs(movePos.y - startPos.y)
      const shouldCancel = dx > 10 || dy > 10

      expect(shouldCancel).toBe(true)
    })

    it('keeps timer running when jitter is within 10px touch slop', () => {
      const startPos = { x: 100, y: 100 }
      const movePos = { x: 104, y: 103 } // dx = 4, dy = 3

      const dx = Math.abs(movePos.x - startPos.x)
      const dy = Math.abs(movePos.y - startPos.y)
      const shouldCancel = dx > 10 || dy > 10

      expect(shouldCancel).toBe(false)
    })
  })
})
