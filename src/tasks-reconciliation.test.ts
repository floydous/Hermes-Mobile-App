import { describe, expect, it, vi, beforeEach } from 'vitest'

import { deriveTaskSections, preloadTaskJobs, reconcileTaskJobs, resetTaskFetchCooldown } from './components/TasksView'
import { normalizeCronJob, type CronJob } from './hermes'
import * as hermesModule from './hermes'

const job = (patch: Partial<CronJob> = {}): CronJob => ({ job_id: 'watchdog', name: 'Watchdog', enabled: true, state: 'scheduled', ...patch })

describe('live Tasks reconciliation', () => {
  beforeEach(() => {
    resetTaskFetchCooldown()
  })
  it('keeps an optimistic paused job visible when the backend list briefly omits it', () => {
    const desired = job({ enabled: false, state: 'paused' })
    const result = reconcileTaskJobs([], new Map([[desired.job_id, desired]]))
    expect(result.jobs).toEqual([desired])
    expect(result.pending.get('watchdog')).toEqual(desired)
  })

  it('clears optimistic state after the backend confirms resume', () => {
    const desired = job({ enabled: true, state: 'scheduled' })
    const result = reconcileTaskJobs([desired], new Map([[desired.job_id, desired]]))
    expect(result.jobs).toEqual([desired])
    expect(result.pending.size).toBe(0)
  })

  it('keeps paused jobs visible with their Resume action in the Scheduled task view', () => {
    const paused = job({ enabled: false, state: 'paused' })
    const scheduled = job({ job_id: 'daily-report', name: 'Daily report' })
    const sections = deriveTaskSections([paused, scheduled], 'scheduled')
    expect(sections.scheduled).toEqual([scheduled])
    expect(sections.attention).toEqual([paused])
  })

  it('shows only running jobs in the Running filter', () => {
    const running = job({ job_id: 'active', state: 'running' })
    const paused = job({ job_id: 'paused', enabled: false, state: 'paused' })
    const sections = deriveTaskSections([running, paused], 'running')
    expect(sections.running).toEqual([running])
    expect(sections.scheduled).toEqual([])
    expect(sections.attention).toEqual([])
  })

  it('normalizes a full Dashboard job record with id into the task view contract', () => {
    const detail = normalizeCronJob({ id: 'airlocator-watchdog', prompt: 'Run the complete daily watchdog prompt.' }, 'airlocator')
    expect(detail).toMatchObject({ job_id: 'airlocator-watchdog', id: 'airlocator-watchdog', profile: 'airlocator', prompt: 'Run the complete daily watchdog prompt.' })
  })

  it('normalizes structured Dashboard schedule metadata before task-detail rendering', () => {
    const detail = normalizeCronJob({ id: '62ecc535b0f1', schedule: { kind: 'cron', expr: '0 10 * * *', display: 'every day at 10am' }, schedule_display: 'every day at 10am', prompt: 'Full watchdog prompt.' }, 'gaetan')
    expect(detail).toMatchObject({ job_id: '62ecc535b0f1', schedule: 'every day at 10am', prompt: 'Full watchdog prompt.', profile: 'gaetan' })
  })

  it('normalizes REST jobs with id, null job_id, and structured schedule', () => {
    const rawRestJob = {
      id: '5595cb883d87',
      job_id: null,
      name: 'agentic-news-digest',
      enabled: true,
      state: 'scheduled',
      profile: 'default',
      schedule: { kind: 'cron', expr: '0 23 * * *', display: '0 23 * * *' },
    }
    const normalized = normalizeCronJob(rawRestJob)
    expect(normalized).toMatchObject({
      job_id: '5595cb883d87',
      name: 'agentic-news-digest',
      enabled: true,
      state: 'scheduled',
      schedule: '0 23 * * *',
      profile: 'default',
    })
  })

  it('normalizes WebSocket cron.manage jobs with job_id and string schedule', () => {
    const rawWsJob = {
      job_id: 'f904f7562ed9',
      name: 'check-openrouter-free-models',
      enabled: true,
      state: 'scheduled',
      schedule: 'every 1440m',
    }
    const normalized = normalizeCronJob(rawWsJob, 'default')
    expect(normalized).toMatchObject({
      job_id: 'f904f7562ed9',
      name: 'check-openrouter-free-models',
      enabled: true,
      state: 'scheduled',
      schedule: 'every 1440m',
      profile: 'default',
    })
  })

  it('rejects a malformed Dashboard detail without an identifier', () => {
    expect(() => normalizeCronJob({ prompt: 'Broken' }, 'airlocator')).toThrow('without a job ID')
  })

  it('preloads tasks across system and profile scopes, scopes storage to endpoint, and dispatches event', async () => {
    const store = new Map<string, string>()
    const listeners = new Map<string, Set<(e: any) => void>>()
    const mockWindow = {
      addEventListener: (type: string, fn: any) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(fn)
      },
      removeEventListener: (type: string, fn: any) => {
        listeners.get(type)?.delete(fn)
      },
      dispatchEvent: (event: any) => {
        listeners.get(event.type)?.forEach(fn => fn(event))
        return true
      },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, String(v)) },
      },
    }
    const origWindow = (globalThis as any).window
    const origStorage = (globalThis as any).localStorage
    ;(globalThis as any).window = mockWindow
    ;(globalThis as any).localStorage = mockWindow.localStorage

    const eventSpy = vi.fn()
    mockWindow.addEventListener('hermes-tasks-preloaded', eventSpy)

    vi.spyOn(hermesModule, 'loadCronJobs').mockImplementation(async (profile?: string) => {
      if (profile === 'coder') {
        return [job({ job_id: 'coder-job', name: 'Lint code' })]
      }
      return [job({ job_id: 'sys-job', name: 'Daily sync' })]
    })

    const endpoint = 'http://10.0.0.130:9119'
    const profiles = [{ name: 'coder', display_name: 'Coder' }] as any

    const result = await preloadTaskJobs(endpoint, profiles)
    expect(result).toHaveLength(2)
    expect(result.map(j => j.job_id)).toContain('sys-job')
    expect(result.map(j => j.job_id)).toContain('coder-job')

    // Dispatches custom event for reactive update
    expect(eventSpy).toHaveBeenCalled()

    // Isolated key per endpoint
    expect(store.has('hermes-tasks-v1:http___10_0_0_130_9119')).toBe(true)

    mockWindow.removeEventListener('hermes-tasks-preloaded', eventSpy)
    ;(globalThis as any).window = origWindow
    ;(globalThis as any).localStorage = origStorage
    vi.restoreAllMocks()
  })

  it('safely handles throwing localStorage without unhandled error', async () => {
    const origStorage = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = {
      getItem: () => { throw new Error('SecurityError: Access Denied') },
      setItem: () => { throw new Error('QuotaExceededError') },
    }

    try {
      vi.spyOn(hermesModule, 'loadCronJobs').mockResolvedValue([job({ job_id: 'safe-job' })])
      const result = await preloadTaskJobs('http://test-server:9119')
      expect(result).toHaveLength(1)
      expect(result[0].job_id).toBe('safe-job')
    } finally {
      ;(globalThis as any).localStorage = origStorage
      vi.restoreAllMocks()
    }
  })

  it('deduplicates in-flight fetches concurrently and respects fetch cooldown with expiry', async () => {
    let callCount = 0
    let resolvePending: ((jobs: CronJob[]) => void) | null = null

    vi.spyOn(hermesModule, 'loadCronJobs').mockImplementation(async () => {
      callCount++
      return new Promise<CronJob[]>(resolve => {
        resolvePending = resolve
      })
    })

    const endpoint = 'http://cooldown-test:9119'

    // 1. Launch 3 concurrent fetches while the first is still pending
    const p1 = preloadTaskJobs(endpoint)
    const p2 = preloadTaskJobs(endpoint)
    const p3 = preloadTaskJobs(endpoint)

    // Verify only ONE backend network call was initiated across all 3 concurrent requests
    expect(callCount).toBe(1)

    // Resolve the in-flight promise
    resolvePending!([job({ job_id: 'cooldown-job' })])
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])

    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect(r3).toHaveLength(1)
    expect(callCount).toBe(1)

    // 2. Sequential call within 15-second cooldown returns cached results without calling network
    const rSeq = await preloadTaskJobs(endpoint)
    expect(rSeq).toHaveLength(1)
    expect(callCount).toBe(1)

    // 3. After cooldown expiry (+16 seconds), next call performs a fresh network fetch
    const realDateNow = Date.now
    Date.now = () => realDateNow() + 16_000
    try {
      const pExpired = preloadTaskJobs(endpoint)
      expect(callCount).toBe(2) // Initiated second fetch after expiry
      resolvePending!([job({ job_id: 'cooldown-job-refreshed' })])
      const rExpired = await pExpired
      expect(rExpired[0].job_id).toBe('cooldown-job-refreshed')
    } finally {
      Date.now = realDateNow
    }

    vi.restoreAllMocks()
  })
})
