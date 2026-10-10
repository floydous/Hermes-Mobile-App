import { describe, expect, it, vi } from 'vitest'

import { GatewayRpcError, HermesGatewayClient, parseGatewayEvent } from './gateway'

export class MockWebSocket {
  static OPEN = 1
  readyState = MockWebSocket.OPEN
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  private waiters: Array<{ predicate: (msg: string) => boolean; resolve: (msg: string) => void }> = []

  constructor(public url: string) {
    queueMicrotask(() => this.onopen?.())
  }

  send(data: string) {
    this.sent.push(data)
    try {
      const parsed = JSON.parse(data)
      if (parsed.method === 'client.capabilities' && typeof parsed.id === 'number') {
        setTimeout(() => this.receive({ jsonrpc: '2.0', id: parsed.id, result: { accepted: true } }), 0)
      }
    } catch {}
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].predicate(data)) {
        const item = this.waiters[i]
        this.waiters.splice(i, 1)
        item.resolve(data)
      }
    }
  }

  waitForSent(predicate: (line: string) => boolean, timeout = 2000): Promise<string> {
    const existing = this.sent.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for sent message')), timeout)
      this.waiters.push({
        predicate,
        resolve: msg => {
          clearTimeout(timer)
          resolve(msg)
        },
      })
    })
  }

  close() {
    this.onclose?.()
  }

  receive(data: string | object) {
    const raw = typeof data === 'string' ? data : JSON.stringify(data)
    this.onmessage?.({ data: raw })
  }
}

describe('Desktop Gateway protocol', () => {
  it('projects the canonical event envelope without losing routing metadata', () => {
    expect(parseGatewayEvent({
      type: 'message.delta',
      session_id: 'bot-chat-1',
      turn_id: 'turn-7',
      message_id: 'message-9',
      seq: 4,
      payload: { text: 'hello' },
    })).toEqual({
      type: 'message.delta',
      payload: { text: 'hello', session_id: 'bot-chat-1' },
      sessionId: 'bot-chat-1',
      turnId: 'turn-7',
      messageId: 'message-9',
      seq: 4,
      terminal: false,
    })
  })

  it.each(['message.complete', 'turn.end', 'turn.error', 'error'])('treats %s as terminal', type => {
    expect(parseGatewayEvent({ type, payload: {} })?.terminal).toBe(true)
  })

  it('rejects malformed event envelopes', () => {
    expect(parseGatewayEvent({ payload: { text: 'orphan' } })).toBeNull()
  })

  it('exposes but never acts on safe-to-resubmit server guidance', () => {
    const error = new GatewayRpcError('prompt.submit', 'connection lost', 4009, { safe_to_resubmit: true })
    expect(error.safeToResubmit).toBe(true)
  })

  it('advertises client.capabilities on gateway.ready handshake', async () => {
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

    const capabilitiesCall = await mockWs.waitForSent(line => line.includes('"client.capabilities"'))
    expect(capabilitiesCall).toContain('"server_requests":true')
  })

  it('probes gateway liveness via ping()', async () => {
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

    const pingPromise = client.ping()
    const pingFrame = await mockWs.waitForSent(line => line.includes('"ping"'))
    const pingSent = JSON.parse(pingFrame.trim())
    expect(pingSent.method).toBe('ping')

    mockWs.receive({ jsonrpc: '2.0', id: pingSent.id, result: { pong: true } })
    const result = await pingPromise
    expect(result).toBe(true)
  })

  it('handles server-to-client requests (srq-) and responds with -32601 when unhandled', async () => {
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

    const listener = vi.fn()
    client.setEventListener(listener)

    mockWs.receive({
      jsonrpc: '2.0',
      id: 'srq-abc123456789',
      method: 'approval',
      params: { command: 'rm -rf test', session_id: 's-1' },
    })

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'request.approval',
      sessionId: 's-1',
    }))

    const fallbackResponse = await mockWs.waitForSent(line => line.includes('srq-abc123456789'))
    expect(fallbackResponse).toContain('-32601')
  })

  it('handles server-to-client requests with registered handler', async () => {
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

    client.registerRequestHandler('approval', params => {
      expect(params.command).toBe('echo hello')
      return { choice: 'once' }
    })

    mockWs.receive({
      jsonrpc: '2.0',
      id: 'srq-xyz987654321',
      method: 'approval',
      params: { command: 'echo hello', session_id: 's-2' },
    })

    const response = await mockWs.waitForSent(line => line.includes('srq-xyz987654321'))
    expect(response).toContain('"choice":"once"')
  })

  it('defers clarify server-to-client requests without sending -32601 and accepts async user answers', async () => {
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

    const listener = vi.fn()
    client.setEventListener(listener)

    mockWs.receive({
      jsonrpc: '2.0',
      id: 'srq-clarify-12345',
      method: 'clarify',
      params: {
        session_id: 's-clarify',
        questions: [{ qid: 'q1', question: 'Which DB?' }],
      },
    })

    // Listener receives the clarify event
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'request.clarify',
      sessionId: 's-clarify',
      payload: expect.objectContaining({
        requestId: 'srq-clarify-12345',
      }),
    }))

    // Client responds with user answer
    client.respondToServerRequest('srq-clarify-12345', {
      answers: { q1: 'PostgreSQL' },
    })

    const response = await mockWs.waitForSent(line => line.includes('srq-clarify-12345'))
    expect(response).toContain('"answers":{"q1":"PostgreSQL"}')
    expect(response).not.toContain('-32601')
  })

  it('replays open_requests on resumeSession and ensures duplicate resumes are idempotent', async () => {
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

    const listener = vi.fn()
    client.setEventListener(listener)

    // Simulate resume response carrying an open clarify request
    const resumePromise = client.resumeSession('session-background-1', 'default')
    const resumeSent = await mockWs.waitForSent(line => line.includes('"session.resume"'))
    const parsedResume = JSON.parse(resumeSent)

    mockWs.receive({
      jsonrpc: '2.0',
      id: parsedResume.id,
      result: {
        session_id: 'session-background-1',
        open_requests: [
          {
            id: 'srq-replayed-888',
            method: 'clarify',
            params: {
              session_id: 'session-background-1',
              questions: [{ qid: 'q_db', question: 'Select DB' }],
            },
          },
        ],
      },
    })

    await resumePromise

    // Verify open_requests was replayed to listener
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'request.clarify',
      payload: expect.objectContaining({
        requestId: 'srq-replayed-888',
      }),
    }))

    // Second resume of the same session: must NOT re-dispatch the same request twice
    const secondResumePromise = client.resumeSession('session-background-1', 'default')
    const secondSent = await mockWs.waitForSent(line => line.includes(`"id":${parsedResume.id + 1}`))
    mockWs.receive({
      jsonrpc: '2.0',
      id: parsedResume.id + 1,
      result: {
        session_id: 'session-background-1',
        open_requests: [
          {
            id: 'srq-replayed-888',
            method: 'clarify',
            params: {
              session_id: 'session-background-1',
              questions: [{ qid: 'q_db', question: 'Select DB' }],
            },
          },
        ],
      },
    })
    await secondResumePromise

    // Idempotency: listener was not called a second time
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('passes confirm_empty_truncate on prompt.submit when truncating at ordinal 0/1', async () => {
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

    const submitPromise = client.submitPrompt(
      's-1',
      'Edited prompt',
      vi.fn(),
      { truncateMessageId: 1 }
    )

    const promptFrame = await mockWs.waitForSent(line => line.includes('"prompt.submit"'))
    const promptCall = JSON.parse(promptFrame.trim())
    expect(promptCall.params.confirm_truncate).toBe(true)
    expect(promptCall.params.confirm_empty_truncate).toBe(true)
    expect(promptCall.params.truncate_before_message_id).toBe('1')

    mockWs.receive({ jsonrpc: '2.0', id: promptCall.id, result: { status: 'streaming' } })
    mockWs.receive({
      method: 'event',
      params: { type: 'message.complete', session_id: 's-1', payload: { status: 'complete', text: 'Answer' } },
    })
    await submitPromise
  })

  it('dispatches terminal message.complete event to active turn listener even if event carries remapped runtime session_id', async () => {
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

    const listener = vi.fn()
    const submitPromise = client.submitPrompt(
      'stored-canonical-id',
      'Can you try use clarify tool?',
      listener
    )

    const promptFrame = await mockWs.waitForSent(line => line.includes('"prompt.submit"'))
    const promptCall = JSON.parse(promptFrame.trim())
    mockWs.receive({ jsonrpc: '2.0', id: promptCall.id, result: { status: 'streaming' } })

    // Gateway server emits message.complete with internal runtime session_id instead of stored-canonical-id!
    mockWs.receive({
      method: 'event',
      params: {
        type: 'message.complete',
        session_id: 'runtime-internal-session-key-999',
        payload: { text: 'The clarify tool worked.' },
      },
    })

    // submitPromise must settle and NOT get stuck indefinitely!
    await submitPromise
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message.complete',
      payload: expect.objectContaining({ text: 'The clarify tool worked.' }),
    }))
  })

  it('sends periodic heartbeat pings while connected to keep tunnel and NAT alive', async () => {
    vi.useFakeTimers()
    try {
      let mockWs!: MockWebSocket
      const client = new HermesGatewayClient(
        async () => 'ws://127.0.0.1:9119/api/ws',
        url => {
          mockWs = new MockWebSocket(url)
          return mockWs as unknown as WebSocket
        }
      )

      const connectPromise = client.connect()
      await vi.advanceTimersByTimeAsync(10)
      mockWs.receive({ method: 'event', params: { type: 'gateway.ready', payload: {} } })
      await vi.advanceTimersByTimeAsync(10)
      await connectPromise

      // Advance 20 seconds (the heartbeat interval)
      await vi.advanceTimersByTimeAsync(20_000)

      expect(mockWs.sent.some(line => line.includes('"ping"'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves in-flight turn listeners across unexpected socket drop and re-binds with session.resume', async () => {
    let sockets: MockWebSocket[] = []
    const client = new HermesGatewayClient(
      async () => 'ws://127.0.0.1:9119/api/ws',
      url => {
        const ws = new MockWebSocket(url)
        sockets.push(ws)
        return ws as unknown as WebSocket
      }
    )

    const connectPromise = client.connect()
    await Promise.resolve()
    await Promise.resolve()
    sockets[0].receive({ method: 'event', params: { type: 'gateway.ready', payload: {} } })
    await connectPromise

    const listener = vi.fn()
    const submitPromise = client.submitPrompt(
      'session-long-running',
      'Research query',
      listener
    )

    const promptFrame = await sockets[0].waitForSent(line => line.includes('"prompt.submit"'))
    const promptCall = JSON.parse(promptFrame.trim())
    sockets[0].receive({ jsonrpc: '2.0', id: promptCall.id, result: { status: 'streaming' } })

    // Simulate Cloudflare tunnel or NAT idle drop: socket closes while turn is in-flight!
    sockets[0].close()

    // Trigger reconnect attempt
    const secondConnect = client.connect()
    await Promise.resolve()
    await Promise.resolve()
    expect(sockets.length).toBe(2)
    sockets[1].receive({ method: 'event', params: { type: 'gateway.ready', payload: {} } })
    await secondConnect

    // Second socket must receive session.resume to re-bind the active turn
    const resumeFrame = await sockets[1].waitForSent(line => line.includes('"session.resume"'))
    expect(resumeFrame).toContain('"session-long-running"')
    const resumeCall = JSON.parse(resumeFrame.trim())
    sockets[1].receive({ jsonrpc: '2.0', id: resumeCall.id, result: { session_id: 'session-long-running' } })

    // Now gateway sends completion over the reconnected socket
    sockets[1].receive({
      method: 'event',
      params: {
        type: 'message.complete',
        session_id: 'session-long-running',
        payload: { text: 'Comparison completed successfully.' },
      },
    })

    // Turn resolves cleanly without dropping history or timing out!
    await submitPromise
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message.complete',
      payload: expect.objectContaining({ text: 'Comparison completed successfully.' }),
    }))

    client.close()
  })
})
