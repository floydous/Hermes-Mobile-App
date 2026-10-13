/**
 * Remote Performance Diagnostics & Structured Telemetry Transport
 *
 * Provides high-efficiency, batched, asynchronous transmission of structured
 * performance measurements and debug logs to the configured Hermes debug log server.
 */

export interface PerformanceRecord {
  /** High-level interaction or operation name (e.g. 'session_open', 'prompt_submit', 'storage', 'stream_render') */
  op: string
  /** Phase within the operation (e.g. 'input_delay', 'cache_hydrate', 'rpc_ack', 'first_delta', 'settle') */
  phase: string
  /** Correlation trace ID */
  traceId: string
  /** Duration of this phase in milliseconds (monotonic performance timestamp delta) */
  durationMs: number
  /** Wall-clock timestamp ISO string for log alignment */
  timestamp: string
  /** Structured numeric or categorization metrics (e.g. { messageCount: 10, domNodes: 54 }) */
  metrics?: Record<string, number | string | boolean>
}

const STORAGE_KEY_PERF_ENABLED = 'hermes_perf_debug_enabled'
const STORAGE_KEY_PERF_TOKEN = 'hermes_perf_debug_token'
const STORAGE_KEY_LOG_HOST = 'hermes_perf_debug_host'

const DEFAULT_PRIMARY_HOST = '100.117.86.67'
const DEFAULT_LOG_PORT = 8765
const MAX_QUEUE_SIZE = 250
const FLUSH_INTERVAL_MS = 2000
const MAX_BATCH_SIZE = 50

let isPerformanceEnabled = false
let customLogHost: string | null = null
let authToken: string | null = null
let activeEndpointHost: string | null = null
let droppedRecordsCount = 0

// In-memory bounded queue for events
const eventQueue: PerformanceRecord[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let isFlushing = false

// Trace tracker
interface ActiveTrace {
  traceId: string
  op: string
  startTime: number
  phaseStartTime: number
  metrics: Record<string, number | string | boolean>
}

const activeTraces = new Map<string, ActiveTrace>()

// Initialize settings from localStorage safely (fail-closed if malformed or unavailable)
try {
  if (typeof localStorage !== 'undefined') {
    isPerformanceEnabled = localStorage.getItem(STORAGE_KEY_PERF_ENABLED) === 'true'
    authToken = localStorage.getItem(STORAGE_KEY_PERF_TOKEN) || null
    customLogHost = localStorage.getItem(STORAGE_KEY_LOG_HOST) || null
  }
} catch {
  isPerformanceEnabled = false
}

/**
 * Configure whether performance diagnostics are active.
 */
export function setPerformanceDiagnosticsEnabled(enabled: boolean) {
  isPerformanceEnabled = enabled
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_PERF_ENABLED, enabled ? 'true' : 'false')
    }
  } catch {}

  if (enabled) {
    setupLifecycleFlushListeners()
    setupLongTaskObserver()
  } else {
    teardownLongTaskObserver()
  }
}

export function isPerformanceDiagnosticsEnabled(): boolean {
  return isPerformanceEnabled
}

/**
 * Configure optional debug auth token for protected environments.
 */
export function setPerformanceAuthToken(token: string | null) {
  authToken = token
  try {
    if (typeof localStorage !== 'undefined') {
      if (token) localStorage.setItem(STORAGE_KEY_PERF_TOKEN, token)
      else localStorage.removeItem(STORAGE_KEY_PERF_TOKEN)
    }
  } catch {}
}

/**
 * Set target log server host override.
 */
export function setPerformanceLogHost(host: string | null) {
  customLogHost = host
  try {
    if (typeof localStorage !== 'undefined') {
      if (host) localStorage.setItem(STORAGE_KEY_LOG_HOST, host)
      else localStorage.removeItem(STORAGE_KEY_LOG_HOST)
    }
  } catch {}
}

/**
 * Update the active endpoint host when connecting to a remote Hermes gateway.
 */
export function setRemoteLoggerEndpoint(endpointUrl: string) {
  try {
    const parsed = new URL(endpointUrl)
    if (parsed.hostname && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      activeEndpointHost = parsed.hostname
    }
  } catch {}
}

/**
 * Generate a unique correlation trace ID.
 */
export function createTraceId(prefix = 'tr'): string {
  const rand = Math.random().toString(36).substring(2, 8)
  const time = Date.now().toString(36).slice(-4)
  return `${prefix}_${time}${rand}`
}

/**
 * Sanitize metrics recursively to prevent accidental leakage of sensitive tokens or text.
 */
function sanitizeMetrics(input?: Record<string, any>): Record<string, number | string | boolean> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const result: Record<string, number | string | boolean> = {}

  for (const [key, val] of Object.entries(input)) {
    const lowerKey = key.toLowerCase()
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('auth') ||
      lowerKey.includes('prompt') ||
      lowerKey.includes('content')
    ) {
      if (typeof val === 'string') {
        result[`${key}Length`] = val.length
      }
      continue
    }

    if (typeof val === 'number' || typeof val === 'boolean') {
      result[key] = val
    } else if (typeof val === 'string') {
      // Truncate non-sensitive strings to reasonable length
      result[key] = val.slice(0, 100)
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Start tracking a multi-phase trace.
 */
export function startPerformanceTrace(op: string, traceId = createTraceId()): string {
  if (!isPerformanceEnabled) return traceId
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  activeTraces.set(traceId, {
    traceId,
    op,
    startTime: now,
    phaseStartTime: now,
    metrics: {},
  })
  return traceId
}

/**
 * Record a phase within an ongoing trace.
 */
export function recordTracePhase(
  traceId: string,
  phase: string,
  metrics?: Record<string, any>
) {
  if (!isPerformanceEnabled) return
  const trace = activeTraces.get(traceId)
  if (!trace) return

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const durationMs = Math.max(0, now - trace.phaseStartTime)
  trace.phaseStartTime = now

  const sanitized = sanitizeMetrics(metrics)
  if (sanitized) {
    Object.assign(trace.metrics, sanitized)
  }

  recordPerformanceEvent({
    op: trace.op,
    phase,
    traceId,
    durationMs: Math.round(durationMs * 100) / 100,
    timestamp: new Date().toISOString(),
    metrics: sanitized,
  })
}

/**
 * Finish an ongoing trace and record the total duration.
 */
export function finishPerformanceTrace(
  traceId: string,
  finalPhase = 'settle',
  finalMetrics?: Record<string, any>
) {
  if (!isPerformanceEnabled) return
  const trace = activeTraces.get(traceId)
  if (!trace) return

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const totalDurationMs = Math.max(0, now - trace.startTime)
  const phaseDurationMs = Math.max(0, now - trace.phaseStartTime)

  const sanitized = sanitizeMetrics(finalMetrics)
  if (sanitized) {
    Object.assign(trace.metrics, sanitized)
  }

  recordPerformanceEvent({
    op: trace.op,
    phase: finalPhase,
    traceId,
    durationMs: Math.round(phaseDurationMs * 100) / 100,
    timestamp: new Date().toISOString(),
    metrics: {
      ...trace.metrics,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
    },
  })

  activeTraces.delete(traceId)
}

/**
 * Record a single self-contained performance event directly.
 */
export function recordPerformanceEvent(record: PerformanceRecord) {
  if (!isPerformanceEnabled) return

  const sanitizedRecord: PerformanceRecord = {
    ...record,
    metrics: sanitizeMetrics(record.metrics),
  }

  // Push to bounded memory queue
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    eventQueue.shift()
    droppedRecordsCount += 1
  }
  eventQueue.push(sanitizedRecord)

  scheduleFlush()
}

/**
 * Schedule asynchronous batch flush with timer coalescing.
 */
function scheduleFlush() {
  if (flushTimer != null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushPerformanceEvents()
  }, FLUSH_INTERVAL_MS)
}

/**
 * Determine the single authoritative target URL for remote log ingestion.
 * Avoids duplicate transmissions to primary vs host.
 */
export function resolveLogServerUrl(): string {
  const host = customLogHost || activeEndpointHost || DEFAULT_PRIMARY_HOST
  return `http://${host}:${DEFAULT_LOG_PORT}/`
}

/**
 * Asynchronously flush batched events over HTTP or sendBeacon to the log server.
 */
export async function flushPerformanceEvents(isUnload = false): Promise<void> {
  if (isFlushing || eventQueue.length === 0) return
  isFlushing = true

  const batch = eventQueue.splice(0, MAX_BATCH_SIZE)
  if (droppedRecordsCount > 0) {
    batch.unshift({
      op: 'perf_logger',
      phase: 'dropped_records',
      traceId: 'overflow',
      durationMs: 0,
      timestamp: new Date().toISOString(),
      metrics: { droppedCount: droppedRecordsCount },
    })
    droppedRecordsCount = 0
  }

  const url = resolveLogServerUrl()
  const ndjsonBody = batch.map(rec => JSON.stringify(rec)).join('\n')

  // Unload fast-path: navigator.sendBeacon is guaranteed to outlive page teardown
  if (isUnload && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([ndjsonBody], { type: 'text/plain' })
      const queued = navigator.sendBeacon(url, blob)
      if (queued) {
        isFlushing = false
        return
      }
    } catch {}
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-ndjson',
    }
    if (authToken) {
      headers['X-Hermes-Debug-Token'] = authToken
      headers['Authorization'] = `Bearer ${authToken}`
    }

    if (typeof fetch === 'function') {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timeoutId = controller ? setTimeout(() => controller.abort(), 3500) : null

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: ndjsonBody,
        mode: 'cors',
        keepalive: isUnload,
        signal: controller ? controller.signal : undefined,
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (!res.ok) {
        // Server rejected (4xx/5xx): re-insert to avoid loss, respecting queue bounds
        eventQueue.unshift(...batch)
        if (eventQueue.length > MAX_QUEUE_SIZE) {
          eventQueue.splice(MAX_QUEUE_SIZE)
        }
      }
    }
  } catch {
    // Network failure: re-insert batch for retry on next window
    eventQueue.unshift(...batch)
    if (eventQueue.length > MAX_QUEUE_SIZE) {
      eventQueue.splice(MAX_QUEUE_SIZE)
    }
  } finally {
    isFlushing = false
    if (eventQueue.length > 0 && !isUnload) {
      scheduleFlush()
    }
  }
}

/**
 * Export current buffered performance events as JSON array.
 */
export function exportBufferedPerformanceEvents(): PerformanceRecord[] {
  return [...eventQueue]
}

/**
 * Clear buffered performance records.
 */
export function clearPerformanceBuffer() {
  eventQueue.length = 0
  activeTraces.clear()
  droppedRecordsCount = 0
}

/**
 * Standard log transport - preserves simple strings with remoteLog().
 */
export function remoteLog(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', tag: string, message: string) {
  const line = `[${level}][${tag}] ${message}`
  if (level === 'ERROR') {
    console.error(line)
  } else if (level === 'WARN') {
    console.warn(line)
  } else {
    console.log(line)
  }

  // Transmit to the single resolved endpoint
  if (typeof fetch === 'function') {
    const url = resolveLogServerUrl()
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
    if (authToken) {
      headers['X-Hermes-Debug-Token'] = authToken
      headers['Authorization'] = `Bearer ${authToken}`
    }

    void fetch(url, {
      method: 'POST',
      headers,
      body: line,
      mode: 'cors',
    }).catch(() => {})
  }
}

// Attach lifecycle listeners for immediate flushing on tab backgrounding/exit
let lifecycleListenersAttached = false
function setupLifecycleFlushListeners() {
  if (lifecycleListenersAttached || typeof window === 'undefined') return
  lifecycleListenersAttached = true

  const flushImmediate = () => {
    void flushPerformanceEvents(true)
  }

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushImmediate()
  })
  window.addEventListener('pagehide', flushImmediate)
  window.addEventListener('beforeunload', flushImmediate)
}

// Observe browser Performance Long Tasks (>50ms frame freezes) safely
let longTaskObserver: PerformanceObserver | null = null
function setupLongTaskObserver() {
  if (longTaskObserver != null || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return
  try {
    const supported = PerformanceObserver.supportedEntryTypes
    if (Array.isArray(supported) && !supported.includes('longtask')) return

    longTaskObserver = new PerformanceObserver(entryList => {
      if (!isPerformanceEnabled) return
      for (const entry of entryList.getEntries()) {
        if (entry.entryType === 'longtask') {
          recordPerformanceEvent({
            op: 'ui_thread',
            phase: 'long_task',
            traceId: createTraceId('lt'),
            durationMs: Math.round(entry.duration * 100) / 100,
            timestamp: new Date().toISOString(),
            metrics: {
              startTime: Math.round(entry.startTime),
              attribution: entry.name || 'task',
            },
          })
        }
      }
    })
    longTaskObserver.observe({ entryTypes: ['longtask'] })
  } catch {}
}

function teardownLongTaskObserver() {
  if (longTaskObserver) {
    try {
      longTaskObserver.disconnect()
    } catch {}
    longTaskObserver = null
  }
}

if (isPerformanceEnabled) {
  setupLifecycleFlushListeners()
  setupLongTaskObserver()
}
