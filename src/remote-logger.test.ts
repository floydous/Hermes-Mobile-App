import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPerformanceBuffer,
  createTraceId,
  exportBufferedPerformanceEvents,
  finishPerformanceTrace,
  flushPerformanceEvents,
  flushStringLogs,
  isPerformanceDiagnosticsEnabled,
  recordPerformanceEvent,
  recordTracePhase,
  remoteLog,
  resolveLogServerUrl,
  setPerformanceAuthToken,
  setPerformanceDiagnosticsEnabled,
  setPerformanceLogHost,
  setRemoteLoggerEndpoint,
  startPerformanceTrace,
} from './remote-logger'

describe('Remote Performance Diagnostics & Logger', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    globalThis.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => { store[key] = val },
      removeItem: (key: string) => { delete store[key] },
      clear: () => { for (const k in store) delete store[k] },
      key: () => null,
      length: 0,
    } as any

    clearPerformanceBuffer()
    setPerformanceDiagnosticsEnabled(false)
    setPerformanceAuthToken(null)
    setPerformanceLogHost(null)
    vi.restoreAllMocks()
  })

  afterEach(() => {
    clearPerformanceBuffer()
    setPerformanceDiagnosticsEnabled(false)
  })

  it('is disabled by default and produces zero buffered records', () => {
    expect(isPerformanceDiagnosticsEnabled()).toBe(false)

    const traceId = startPerformanceTrace('session_open')
    recordTracePhase(traceId, 'cache_hydrate', { isCachedHit: true })
    finishPerformanceTrace(traceId, 'settle')
    recordPerformanceEvent({
      op: 'storage',
      phase: 'write',
      traceId: 'tr_test',
      durationMs: 12.5,
      timestamp: new Date().toISOString(),
    })

    const buffered = exportBufferedPerformanceEvents()
    expect(buffered).toHaveLength(0)
  })

  it('records structured traces with monotonic durations and correlation IDs when enabled', () => {
    setPerformanceDiagnosticsEnabled(true)
    expect(isPerformanceDiagnosticsEnabled()).toBe(true)

    const traceId = 'tr_custom_123'
    startPerformanceTrace('session_open', traceId)

    recordTracePhase(traceId, 'cache_hydrate', { cachedCount: 42 })
    recordTracePhase(traceId, 'network_load', { loadedCount: 50 })
    finishPerformanceTrace(traceId, 'settle', { totalCount: 50 })

    const buffered = exportBufferedPerformanceEvents()
    expect(buffered.length).toBe(3)

    expect(buffered[0]).toMatchObject({
      op: 'session_open',
      phase: 'cache_hydrate',
      traceId: 'tr_custom_123',
      metrics: { cachedCount: 42 },
    })
    expect(typeof buffered[0].durationMs).toBe('number')
    expect(buffered[0].durationMs).toBeGreaterThanOrEqual(0)
    expect(typeof buffered[0].timestamp).toBe('string')

    expect(buffered[1]).toMatchObject({
      op: 'session_open',
      phase: 'network_load',
      traceId: 'tr_custom_123',
      metrics: { loadedCount: 50 },
    })

    expect(buffered[2]).toMatchObject({
      op: 'session_open',
      phase: 'settle',
      traceId: 'tr_custom_123',
      metrics: expect.objectContaining({
        totalCount: 50,
      }),
    })
    expect(buffered[2].metrics?.totalDurationMs).toBeDefined()
  })

  it('bounds memory queue to MAX_QUEUE_SIZE and emits dropped record counter on overflow', async () => {
    setPerformanceDiagnosticsEnabled(true)

    for (let i = 0; i < 300; i++) {
      recordPerformanceEvent({
        op: 'test_op',
        phase: `phase_${i}`,
        traceId: `tr_${i}`,
        durationMs: i,
        timestamp: new Date().toISOString(),
      })
    }

    const buffered = exportBufferedPerformanceEvents()
    expect(buffered.length).toBe(250) // capped at MAX_QUEUE_SIZE = 250
    expect(buffered[0].phase).toBe('phase_50')
    expect(buffered[buffered.length - 1].phase).toBe('phase_299')

    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = fetchMock

    await flushPerformanceEvents()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const bodyLines = fetchMock.mock.calls[0][1].body.split('\n')
    const firstSent = JSON.parse(bodyLines[0])
    expect(firstSent.op).toBe('perf_logger')
    expect(firstSent.phase).toBe('dropped_records')
    expect(firstSent.metrics.droppedCount).toBe(50)
  })

  it('recursively scrubs sensitive fields such as prompt, password, and tokens from metrics', () => {
    setPerformanceDiagnosticsEnabled(true)

    recordPerformanceEvent({
      op: 'prompt_submit',
      phase: 'input_handler',
      traceId: 'tr_secure_1',
      durationMs: 1.5,
      timestamp: new Date().toISOString(),
      metrics: {
        promptText: 'Very sensitive user message',
        userPassword: 'secretpassword123',
        authToken: 'sk-1234567890',
        safeMetric: 42,
        safeStatus: 'ok',
      },
    })

    const buffered = exportBufferedPerformanceEvents()
    expect(buffered.length).toBe(1)
    const metrics = buffered[0].metrics as any

    // Sensitive values must NOT appear in metrics
    expect(metrics.promptText).toBeUndefined()
    expect(metrics.userPassword).toBeUndefined()
    expect(metrics.authToken).toBeUndefined()

    // Length-only metadata is allowed for diagnostics
    expect(metrics.promptTextLength).toBe('Very sensitive user message'.length)
    expect(metrics.userPasswordLength).toBe('secretpassword123'.length)
    expect(metrics.authTokenLength).toBe('sk-1234567890'.length)

    // Safe metrics remain preserved
    expect(metrics.safeMetric).toBe(42)
    expect(metrics.safeStatus).toBe('ok')
  })

  it('retains batch in queue on network failure without dropping newer events', async () => {
    setPerformanceDiagnosticsEnabled(true)

    const fetchMock = vi.fn().mockRejectedValue(new Error('Network offline'))
    globalThis.fetch = fetchMock

    recordPerformanceEvent({
      op: 'op_initial',
      phase: 'phase_1',
      traceId: 'tr_fail',
      durationMs: 10,
      timestamp: new Date().toISOString(),
    })

    // Attempt flush that fails
    await flushPerformanceEvents()

    // Add a new event while retaining the failed batch
    recordPerformanceEvent({
      op: 'op_subsequent',
      phase: 'phase_2',
      traceId: 'tr_new',
      durationMs: 20,
      timestamp: new Date().toISOString(),
    })

    const buffered = exportBufferedPerformanceEvents()
    expect(buffered.length).toBe(2)
    expect(buffered[0].op).toBe('op_initial')
    expect(buffered[1].op).toBe('op_subsequent')
  })

  it('uses navigator.sendBeacon during unload when available', async () => {
    setPerformanceDiagnosticsEnabled(true)
    const sendBeaconMock = vi.fn().mockReturnValue(true)
    Object.defineProperty(globalThis, 'navigator', {
      value: { sendBeacon: sendBeaconMock },
      configurable: true,
      writable: true,
    })

    recordPerformanceEvent({
      op: 'page_exit',
      phase: 'unload',
      traceId: 'tr_exit',
      durationMs: 0.5,
      timestamp: new Date().toISOString(),
    })

    await flushPerformanceEvents(true)

    expect(sendBeaconMock).toHaveBeenCalledTimes(1)
    expect(sendBeaconMock.mock.calls[0][0]).toBe('http://100.117.86.67:8765/')
  })

  it('resolves a single authoritative URL and prevents duplicate requests', () => {
    setPerformanceLogHost('10.0.0.130')
    expect(resolveLogServerUrl()).toBe('http://10.0.0.130:8765/')

    setPerformanceLogHost(null)
    expect(resolveLogServerUrl()).toBe('http://100.117.86.67:8765/')

    // Connecting to remote gateway at 10.0.0.130 must not redirect debug logger away from PC
    setRemoteLoggerEndpoint('http://10.0.0.130:9119')
    expect(resolveLogServerUrl()).toBe('http://100.117.86.67:8765/')
  })

  it('batches string logs asynchronously and does not invoke fetch when disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = fetchMock

    setPerformanceDiagnosticsEnabled(false)
    remoteLog('DEBUG', 'Gesture', 'Touch started')
    remoteLog('DEBUG', 'Gesture', 'Touch moved')

    await flushStringLogs()
    expect(fetchMock).not.toHaveBeenCalled()

    setPerformanceDiagnosticsEnabled(true)
    remoteLog('DEBUG', 'Gesture', 'Touch started')
    remoteLog('DEBUG', 'Gesture', 'Touch moved')
    remoteLog('DEBUG', 'Gesture', 'Touch ended')

    await flushStringLogs()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = fetchMock.mock.calls[0][1].body as string
    expect(body).toContain('[DEBUG][Gesture] Touch started')
    expect(body).toContain('[DEBUG][Gesture] Touch moved')
    expect(body).toContain('[DEBUG][Gesture] Touch ended')
    expect(body.split('\n')).toHaveLength(3)
  })
})
