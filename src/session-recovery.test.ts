import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  isSessionNotFoundError,
  isStaleTargetError,
  withSessionNotFoundResume,
  connectAndSubmit,
} from './hermes'
import { HermesGatewayClient, GatewayRpcError } from './gateway'
import { MockWebSocket } from './gateway.test'

describe('Session Recovery & 4001 Stale Runtime Rebinding', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('isSessionNotFoundError', () => {
    it('detects 4001 and 4007 RPC codes', () => {
      expect(isSessionNotFoundError({ code: 4001, message: 'session not found' })).toBe(true)
      expect(isSessionNotFoundError({ code: 4007, message: 'session not found in db' })).toBe(true)
      expect(isSessionNotFoundError(new GatewayRpcError('prompt.submit', 'session not found', 4001))).toBe(true)
    })

    it('detects session not found / not in memory string messages', () => {
      expect(isSessionNotFoundError(new Error('session not found'))).toBe(true)
      expect(isSessionNotFoundError(new Error('Session not found: session-xyz'))).toBe(true)
      expect(isSessionNotFoundError(new Error('not in memory (detached/reaped runtime)'))).toBe(true)
      expect(isSessionNotFoundError('Error: 4001: session not found')).toBe(true)
    })

    it('rejects unrelated error signatures', () => {
      expect(isSessionNotFoundError(null)).toBe(false)
      expect(isSessionNotFoundError(undefined)).toBe(false)
      expect(isSessionNotFoundError(new Error('connection timed out'))).toBe(false)
      expect(isSessionNotFoundError(new Error('disk full'))).toBe(false)
    })
  })

  describe('isStaleTargetError (4018)', () => {
    it('detects 4018 RPC code and message variations', () => {
      expect(isStaleTargetError({ code: 4018, message: 'target user message is no longer in session history' })).toBe(true)
      expect(isStaleTargetError(new GatewayRpcError('prompt.submit', 'target user message is no longer in session history', 4018))).toBe(true)
      expect(isStaleTargetError(new Error('target user message is no longer in session history'))).toBe(true)
      expect(isStaleTargetError(new Error('target message_id 5 not in session history'))).toBe(true)
    })

    it('rejects non-stale errors', () => {
      expect(isStaleTargetError(null)).toBe(false)
      expect(isStaleTargetError(new Error('session not found'))).toBe(false)
      expect(isStaleTargetError(new Error('connection closed'))).toBe(false)
    })
  })

  describe('withSessionNotFoundResume', () => {
    it('succeeds without retry when initial live session is healthy', async () => {
      const endpoint = 'http://127.0.0.1:9199'
      vi.spyOn(HermesGatewayClient.prototype, 'resumeSession').mockResolvedValue('live-runtime-1')

      let callCount = 0
      const outcome = await withSessionNotFoundResume(
        'stored-session-a',
        'default',
        async liveId => {
          callCount++
          return `result-from-${liveId}`
        },
        endpoint
      )

      expect(callCount).toBe(1)
      expect(outcome.liveSessionId).toBe('live-runtime-1')
      expect(outcome.result).toBe('result-from-live-runtime-1')
    })

    it('re-resumes stored session and retries once when initial call throws 4001 session not found', async () => {
      const endpoint = 'http://127.0.0.1:9199'
      let resumeCalls = 0
      vi.spyOn(HermesGatewayClient.prototype, 'resumeSession').mockImplementation(async () => {
        resumeCalls++
        return resumeCalls === 1 ? 'stale-reaped-runtime' : 'fresh-rebound-runtime'
      })

      let callAttempts = 0
      const outcome = await withSessionNotFoundResume(
        'stored-session-b',
        'default',
        async liveId => {
          callAttempts++
          if (liveId === 'stale-reaped-runtime') {
            throw new GatewayRpcError('prompt.submit', 'session not found', 4001)
          }
          return `ok-from-${liveId}`
        },
        endpoint
      )

      expect(callAttempts).toBe(2)
      expect(outcome.liveSessionId).toBe('fresh-rebound-runtime')
      expect(outcome.result).toBe('ok-from-fresh-rebound-runtime')
    })

    it('rethrows if the error is not a session-not-found error', async () => {
      const endpoint = 'http://127.0.0.1:9199'
      vi.spyOn(HermesGatewayClient.prototype, 'resumeSession').mockResolvedValue('live-runtime-x')

      await expect(
        withSessionNotFoundResume(
          'stored-session-c',
          'default',
          async () => {
            throw new Error('LLM provider rate limit exceeded')
          },
          endpoint
        )
      ).rejects.toThrow('LLM provider rate limit exceeded')
    })

    it('coalesces concurrent recoveries and does not evict freshly rebound bindings', async () => {
      const endpoint = 'http://127.0.0.1:9199'
      let resumeCalls = 0
      vi.spyOn(HermesGatewayClient.prototype, 'resumeSession').mockImplementation(async () => {
        resumeCalls++
        await new Promise(r => setTimeout(r, 20))
        return 'coalesced-runtime-id'
      })

      // Run two parallel requests against the same stored session
      const [res1, res2] = await Promise.all([
        withSessionNotFoundResume('stored-session-parallel', 'default', async id => `req1:${id}`, endpoint),
        withSessionNotFoundResume('stored-session-parallel', 'default', async id => `req2:${id}`, endpoint),
      ])

      expect(res1.result).toBe('req1:coalesced-runtime-id')
      expect(res2.result).toBe('req2:coalesced-runtime-id')
      // Shared in-flight promise coalesced calls into 1 network RPC
      expect(resumeCalls).toBe(1)
    })
  })

  describe('Rewind / Edit message truncation fallback', () => {
    it('serializes truncate_before_row_id exclusively when truncateRowId is supplied', async () => {
      let mockWs!: MockWebSocket
      const client = new HermesGatewayClient(
        async () => 'ws://127.0.0.1:9119/api/ws',
        url => {
          mockWs = new MockWebSocket(url)
          return mockWs as unknown as WebSocket
        }
      )

      const connectPromise = client.connect()
      await Promise.resolve()
      mockWs.receive({ method: 'event', params: { type: 'gateway.ready', payload: {} } })
      await connectPromise

      void client.submitPrompt(
        'session-rowid-test',
        'Edited question',
        () => {},
        { truncateRowId: 14, truncateOrdinal: 1 }
      )

      const promptFrame = await mockWs.waitForSent(line => line.includes('"prompt.submit"'))
      expect(promptFrame).toContain('"prompt.submit"')
      const parsed = JSON.parse(promptFrame.trim())
      expect(parsed.params.truncate_before_row_id).toBe(14)
      expect(parsed.params.confirm_truncate).toBe(true)
      // Must NOT include truncate_before_message_id when truncate_before_row_id is provided
      expect(parsed.params.truncate_before_message_id).toBeUndefined()
    })

    it('falls back to submission without truncation when gateway returns 4018 stale target error', async () => {
      const endpoint = 'http://127.0.0.1:9199'
      vi.spyOn(HermesGatewayClient.prototype, 'resumeSession').mockResolvedValue('live-edit-session')

      const submittedPayloads: any[] = []
      vi.spyOn(HermesGatewayClient.prototype, 'submitPrompt').mockImplementation(async (sid, text, listener, options) => {
        submittedPayloads.push({ sid, text, options })
        if (options?.truncateRowId === 42 || options?.truncateMessageId === 42) {
          // First attempt: gateway rejects because target message was compacted away
          throw new GatewayRpcError('prompt.submit', 'target user message is no longer in session history', 4018)
        }

        // Second fallback attempt without truncation: succeeds
        listener({
          type: 'message.complete',
          payload: { text: 'Edited response generated' },
          terminal: true,
        })
      })

      const result = await connectAndSubmit(
        'stored-session-edit',
        'default',
        'Updated question',
        () => {},
        endpoint,
        { truncateRowId: 42, truncateMessageId: 42, truncateOrdinal: 2 }
      )

      expect(submittedPayloads).toHaveLength(2)
      // First attempt sent the truncation target
      expect(submittedPayloads[0].options?.truncateRowId).toBe(42)
      // Second attempt fell back to undefined options so user input is never dropped
      expect(submittedPayloads[1].options).toBeUndefined()
      expect(result.sessionId).toBe('live-edit-session')
    })
  })

  describe('connectAndSubmit resilience on long-running turn sleep / reap', () => {
    it('transparently recovers and submits prompt when previous runtime was reaped (simulating "What took you so long?")', async () => {
      const endpoint = 'http://127.0.0.1:9199'
      let resumedId = 'first-runtime-reaped'
      vi.spyOn(HermesGatewayClient.prototype, 'resumeSession').mockImplementation(async () => resumedId)

      let submitCallCount = 0
      let isFirstRuntimeReaped = false
      vi.spyOn(HermesGatewayClient.prototype, 'submitPrompt').mockImplementation(async (sid, text, listener) => {
        submitCallCount++
        if (isFirstRuntimeReaped && sid === 'first-runtime-reaped') {
          // Reaped during the 2-minute gap between turns
          throw new GatewayRpcError('prompt.submit', 'session not found', 4001)
        }

        // Succeeds and streams
        listener({
          type: 'message.delta',
          payload: { text: 'I over-scoped your request into a fairly deep review.' },
          terminal: false,
        })
        listener({
          type: 'message.complete',
          payload: { text: 'I over-scoped your request into a fairly deep review.' },
          terminal: true,
        })
      })

      // Turn 1 resolves and primes the cache with 'first-runtime-reaped'
      await connectAndSubmit(
        'stored-durable-123',
        'default',
        'Can you have a look at this repo?',
        () => {},
        endpoint
      )
      expect(submitCallCount).toBe(1)

      // Time passes: the gateway reaps 'first-runtime-reaped' during the long research run.
      // Next resume on stored session will return 'second-runtime-fresh'.
      isFirstRuntimeReaped = true
      resumedId = 'second-runtime-fresh'
      const receivedEvents: string[] = []

      const result = await connectAndSubmit(
        'stored-durable-123',
        'default',
        'What took you so long?',
        (type, payload) => {
          if (type === 'message.complete') {
            receivedEvents.push(String(payload.text))
          }
        },
        endpoint
      )

      expect(submitCallCount).toBe(3) // 1 for turn 1 + 2 for turn 2 (stale call caught + retried on fresh)
      expect(result.sessionId).toBe('second-runtime-fresh')
      expect(receivedEvents).toEqual(['I over-scoped your request into a fairly deep review.'])
    })
  })
})
