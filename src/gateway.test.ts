import { describe, expect, it, vi } from 'vitest'

import { GatewayRpcError, HermesGatewayClient, parseGatewayEvent } from './gateway'

class MockWebSocket {
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
})
