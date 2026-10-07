import { describe, expect, it } from 'vitest'

import { deriveTaskSections, reconcileTaskJobs } from './components/TasksView'
import { normalizeCronJob, type CronJob } from './hermes'

const job = (patch: Partial<CronJob> = {}): CronJob => ({ job_id: 'watchdog', name: 'Watchdog', enabled: true, state: 'scheduled', ...patch })

describe('live Tasks reconciliation', () => {
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
})
