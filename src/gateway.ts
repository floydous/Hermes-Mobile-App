export type GatewayPayload = Record<string, unknown>

export type GatewayEvent = {
  type: string
  payload: GatewayPayload
  sessionId?: string
  turnId?: string
  messageId?: string
  seq?: number
  terminal: boolean
}

type JsonRpcFrame = {
  id?: number | string
  method?: string
  result?: unknown
  error?: { code?: number; message?: string; data?: GatewayPayload }
  params?: GatewayPayload
}

type Pending = {
  method: string
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class GatewayRpcError extends Error {
  constructor(
    readonly method: string,
    message: string,
    readonly code?: number,
    readonly data: GatewayPayload = {},
  ) {
    super(message)
    this.name = 'GatewayRpcError'
  }

  get safeToResubmit() {
    return this.data.safe_to_resubmit === true
  }
}

const terminalTypes = new Set(['message.complete', 'turn.end', 'turn.error', 'error'])

export function buildSessionResumeParams(sessionId: string, profile?: string): GatewayPayload {
  return { session_id: sessionId, ...(profile ? { profile } : {}) }
}

export function parseGatewayEvent(params: GatewayPayload): GatewayEvent | null {
  if (typeof params.type !== 'string' || !params.type) return null
  const payload = params.payload && typeof params.payload === 'object'
    ? { ...(params.payload as GatewayPayload) }
    : {}
  const sessionId = typeof params.session_id === 'string' ? params.session_id : typeof params.sid === 'string' ? params.sid : undefined
  if (sessionId) payload.session_id = sessionId
  return {
    type: params.type,
    payload,
    sessionId,
    turnId: typeof params.turn_id === 'string' ? params.turn_id : undefined,
    messageId: typeof params.message_id === 'string' ? params.message_id : undefined,
    seq: typeof params.seq === 'number' && params.seq > 0 ? params.seq : undefined,
    terminal: terminalTypes.has(params.type),
  }
}

export type WebSocketFactory = (url: string) => WebSocket

/**
 * One durable Hermes Desktop Gateway connection.
 *
 * Request responses and pushed events are deliberately separate: the
 * prompt.submit response only acknowledges acceptance; terminal turn events
 * own completion. The client never retries a submitted turn automatically.
 */
export class HermesGatewayClient {
  private socket: WebSocket | null = null
  private connecting: Promise<void> | null = null
  private nextId = 1
  private generation = 0
  private readyResolve: (() => void) | null = null
  private readyReject: ((reason: Error) => void) | null = null
  private readonly pending = new Map<number, Pending>()
  private readonly sessionListeners = new Map<string, Set<(event: GatewayEvent) => void>>()
  private readonly requestHandlers = new Map<string, (params: GatewayPayload) => unknown>()
  private readonly activeTurnCancels = new Map<string, () => void>()
  private readonly replayedRequestIds = new Set<string>()
  private globalListener?: (event: GatewayEvent) => void

  constructor(
    private readonly urlFactory: () => Promise<string>,
    private readonly webSocketFactory: WebSocketFactory = url => new WebSocket(url),
  ) {}

  setEventListener(listener?: (event: GatewayEvent) => void) {
    this.globalListener = listener
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.connecting) return this.connecting
    this.connecting = this.open()
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async open(): Promise<void> {
    const url = await this.urlFactory()
    const generation = ++this.generation
    const socket = this.webSocketFactory(url)
    this.socket = socket

    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Hermes Gateway connection timed out')), 15_000)
      socket.onopen = () => { clearTimeout(timer); resolve() }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('Hermes Gateway connection failed')) }
    })
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })

    socket.onmessage = event => this.handleMessage(String(event.data), generation)
    socket.onclose = () => this.handleClose(generation)
    await opened
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Hermes Gateway did not announce readiness')), 15_000)),
    ])
  }

  private handleMessage(raw: string, generation: number) {
    if (generation !== this.generation) return
    for (const line of raw.split('\n').filter(Boolean)) {
      let frame: JsonRpcFrame
      try { frame = JSON.parse(line) as JsonRpcFrame } catch { continue }

      if (frame.method === 'event' && frame.params) {
        const event = parseGatewayEvent(frame.params)
        if (!event) continue
        if (event.type === 'gateway.ready') {
          void this.advertiseCapabilities().finally(() => {
            this.readyResolve?.()
          })
        }
        this.globalListener?.(event)
        if (event.sessionId && this.sessionListeners.has(event.sessionId)) {
          for (const listener of this.sessionListeners.get(event.sessionId) ?? []) listener(event)
        } else {
          for (const listeners of this.sessionListeners.values()) {
            for (const listener of listeners) listener(event)
          }
        }
        continue
      }

      // Handle server→client requests (id is string like "srq-...") per tui_gateway protocol
      if (typeof frame.id === 'string' && frame.id.startsWith('srq-') && frame.method) {
        const reqEvent: GatewayEvent = {
          type: `request.${frame.method}`,
          payload: {
            requestId: frame.id,
            method: frame.method,
            ...(frame.params || {}),
          },
          sessionId: typeof frame.params?.session_id === 'string' ? frame.params.session_id : undefined,
          terminal: false,
        }
        this.globalListener?.(reqEvent)
        if (reqEvent.sessionId && this.sessionListeners.has(reqEvent.sessionId)) {
          for (const listener of this.sessionListeners.get(reqEvent.sessionId) ?? []) listener(reqEvent)
        } else {
          for (const listeners of this.sessionListeners.values()) {
            for (const listener of listeners) listener(reqEvent)
          }
        }
        const handler = this.requestHandlers.get(frame.method)
        if (handler) {
          try {
            const res = handler(frame.params || {})
            if (res instanceof Promise) {
              res.then(
                val => { if (val !== undefined) this.respondToServerRequest(frame.id as string, val) },
                err => this.respondToServerRequest(frame.id as string, null, { code: -32603, message: String(err) })
              )
            } else if (res !== undefined) {
              this.respondToServerRequest(frame.id, res)
            }
          } catch (err) {
            this.respondToServerRequest(frame.id, null, { code: -32603, message: String(err) })
          }
        } else if (frame.method !== 'clarify') {
          this.respondToServerRequest(frame.id, null, {
            code: -32601,
            message: `Method ${frame.method} not implemented on this client`,
          })
        }
        continue
      }

      if (typeof frame.id === 'number') {
        const pending = this.pending.get(frame.id)
        if (!pending) continue
        this.pending.delete(frame.id)
        clearTimeout(pending.timer)
        if (frame.error) pending.reject(new GatewayRpcError(pending.method, frame.error.message || `${pending.method} failed`, frame.error.code, frame.error.data))
        else pending.resolve(frame.result)
      }
    }
  }

  private handleClose(generation: number) {
    if (generation !== this.generation) return
    this.generation += 1
    this.socket = null
    const error = new GatewayRpcError('connection', 'Hermes Gateway connection closed', undefined, { reason: 'connection_closed' })
    this.readyReject?.(error)
    this.readyResolve = null
    this.readyReject = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.sessionListeners.clear()
  }

  async call<T>(method: string, params: GatewayPayload, timeoutMs = 30_000): Promise<T> {
    await this.connect()
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Hermes Gateway is not connected')
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new GatewayRpcError(method, `${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve: value => resolve(value as T), reject, timer })
      socket.send(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  async resumeSession(sessionId: string, profile?: string): Promise<string> {
    const result = await this.call<{
      session_id?: string
      open_requests?: Array<{ id: string; method: string; params: Record<string, unknown> }>
    }>('session.resume', buildSessionResumeParams(sessionId, profile))
    const sid = result.session_id || sessionId
    if (Array.isArray(result.open_requests)) {
      for (const openReq of result.open_requests) {
        if (openReq && openReq.id && openReq.method && !this.replayedRequestIds.has(openReq.id)) {
          this.replayedRequestIds.add(openReq.id)
          this.handleMessage(JSON.stringify({
            jsonrpc: '2.0',
            id: openReq.id,
            method: openReq.method,
            params: { session_id: sid, ...(openReq.params || {}) },
          }), this.generation)
        }
      }
    }
    return sid
  }

  async submitPrompt(
    sessionId: string,
    text: string,
    listener: (event: GatewayEvent) => void,
    options?: { truncateMessageId?: number },
  ): Promise<void> {
    await this.connect()
    const listeners = this.sessionListeners.get(sessionId) ?? new Set()
    this.sessionListeners.set(sessionId, listeners)

    let settle!: () => void
    let fail!: (reason: Error) => void
    const terminal = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject })
    const terminalListener = (event: GatewayEvent) => {
      listener(event)
      if (!event.terminal) return
      if (event.type === 'error' || event.type === 'turn.error') fail(new GatewayRpcError('prompt.submit', String(event.payload.message || 'Hermes turn failed')))
      else settle()
    }
    listeners.add(terminalListener)
    this.activeTurnCancels.set(sessionId, settle)

    try {
      // An acknowledgement is not completion. Keep listening until a terminal
      // event is received, and never auto-resubmit after an ambiguous failure.
      const payload: Record<string, unknown> = { session_id: sessionId, text }
      if (options?.truncateMessageId != null) {
        payload.truncate_before_message_id = String(options.truncateMessageId)
        payload.confirm_truncate = true
        if (options.truncateMessageId === 0 || options.truncateMessageId === 1) {
          payload.confirm_empty_truncate = true
        }
      }
      await this.call('prompt.submit', payload, 30_000)
      await Promise.race([
        terminal,
        new Promise<never>((_, reject) => setTimeout(() => reject(new GatewayRpcError('prompt.submit', 'Hermes turn timed out')), 10 * 60_000)),
      ])
    } finally {
      listeners.delete(terminalListener)
      if (this.activeTurnCancels.get(sessionId) === settle) this.activeTurnCancels.delete(sessionId)
      if (!listeners.size) this.sessionListeners.delete(sessionId)
    }
  }

  attachFile(sessionId: string, input: { name: string; data_url: string; path?: string }) {
    return this.call<{ attached?: boolean; ref_text?: string; name?: string }>('file.attach', {
      session_id: sessionId,
      name: input.name,
      data_url: input.data_url,
      ...(input.path ? { path: input.path } : {}),
    }, 120_000)
  }

  async interruptSession(sessionId: string) {
    const result = await this.call('session.interrupt', { session_id: sessionId })
    this.activeTurnCancels.get(sessionId)?.()
    return result
  }

  async deleteSession(sessionId: string, profile?: string): Promise<boolean> {
    try {
      await this.call('session.close', { session_id: sessionId })
    } catch {}
    try {
      await this.call('session.delete', { session_id: sessionId, ...(profile ? { profile } : {}) })
      return true
    } catch {
      return false
    }
  }

  setSessionModel(sessionId: string, provider: string, model: string) {
    const providerFlag = provider && provider !== 'custom' ? ` --provider ${provider}` : ''
    return this.call('config.set', {
      session_id: sessionId,
      key: 'model',
      value: `${model}${providerFlag} --session`,
    })
  }

  setSessionReasoning(sessionId: string, effort: string) {
    return this.call('config.set', { session_id: sessionId, key: 'reasoning', value: effort })
  }

  private advertiseCapabilities(): Promise<void> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.resolve()
    const id = this.nextId++
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve()
      }, 5_000)
      this.pending.set(id, {
        method: 'client.capabilities',
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: () => {
          clearTimeout(timer)
          resolve()
        },
        timer,
      })
      try {
        socket.send(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'client.capabilities', params: { server_requests: true } })}\n`)
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve()
      }
    })
  }

  registerRequestHandler(method: string, handler: (params: GatewayPayload) => unknown): () => void {
    this.requestHandlers.set(method, handler)
    return () => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method)
      }
    }
  }

  respondToServerRequest(id: string, result: unknown, error?: { code: number; message: string }) {
    this.replayedRequestIds.delete(id)
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    const frame = error
      ? { jsonrpc: '2.0', id, error }
      : { jsonrpc: '2.0', id, result: result ?? {} }
    socket.send(`${JSON.stringify(frame)}\n`)
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.call<{ pong?: boolean }>('ping', {}, 5000)
      return res.pong === true
    } catch {
      return false
    }
  }

  close() {
    const socket = this.socket
    if (!socket) return
    this.handleClose(this.generation)
    socket.close()
  }
}
