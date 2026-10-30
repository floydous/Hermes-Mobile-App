import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  ChevronLeft,
  Copy,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react'

import { NewTaskSheet } from './NewTaskSheet'
import {
  getActiveHermesEndpoint,
  loadCronJob,
  loadCronJobs,
  triggerCronJob,
  updateCronPrompt,
  updateCronJob,
  type CronJob,
  type LiveProfile,
} from '../hermes'
import { useEdgeSwipeBack } from '../edge-swipe'
import { MENU_CLOSE_MS, PageHost, PAGE_EXIT_STATE, usePageExit } from '../page-transition'

type Props = {
  profiles: LiveProfile[]
  back?: () => void
  createOpen?: boolean
  setCreateOpen?: (open: boolean) => void
  query?: string
  baseUrl?: string
  active?: boolean
  style?: React.CSSProperties
}
const jobTitle = (job: CronJob) => (job.name || 'Untitled task').replace(/^\[bot:[^\]]+\]\s*/i, '')
const stateOf = (job: CronJob) => job.state === 'paused' || job.enabled === false ? 'paused' : job.state === 'running' ? 'running' : job.last_error ? 'error' : 'scheduled'
const dateLabel = (value?: number | string) => { if (!value) return '—'; const date = new Date(typeof value === 'number' ? value * 1000 : value); return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

/** "Today, 6:03 PM" / "Tomorrow, 12:00 AM" for nearby runs, the full date otherwise. */
export function runLabel(value?: number | string, now = new Date()): string {
  if (!value) return '—'
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  if (Number.isNaN(date.valueOf())) return String(value)
  const dayStart = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).valueOf()
  const days = Math.round((dayStart(date) - dayStart(now)) / 86_400_000)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Tomorrow, ${time}`
  if (days === -1) return `Yesterday, ${time}`
  return dateLabel(value)
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const everyMinutes = (minutes: number) =>
  minutes % 1440 === 0 ? (minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`)
    : minutes % 60 === 0 ? (minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`)
      : minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`

/**
 * The cadence of a schedule in words ("Every day", "Weekdays", "Every 15 minutes").
 * The time of day is left out on purpose: cron runs in the host's timezone, which
 * need not be the phone's, so the real local time comes from the next-run timestamp.
 * Anything this does not recognise is shown as written.
 */
export function describeSchedule(schedule?: string): string {
  const raw = (schedule || '').trim()
  if (!raw) return 'No schedule'
  const interval = /^every\s+(\d+)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?)$/i.exec(raw)
  if (interval) {
    const amount = Number(interval[1])
    const unit = interval[2][0].toLowerCase()
    return amount > 0 ? everyMinutes(unit === 'd' ? amount * 1440 : unit === 'h' ? amount * 60 : amount) : raw
  }
  const fields = raw.split(/\s+/)
  if (fields.length !== 5) return raw
  const [minute, hour, dayOfMonth, month, weekday] = fields
  if (dayOfMonth !== '*' || month !== '*') return raw
  const minuteStep = /^\*\/(\d+)$/.exec(minute)
  if (minuteStep && hour === '*' && weekday === '*') return everyMinutes(Number(minuteStep[1]))
  if (!/^\d+$/.test(minute)) return raw
  const hourStep = /^\*\/(\d+)$/.exec(hour)
  if (hour === '*' && weekday === '*') return 'Every hour'
  if (hourStep && weekday === '*') return everyMinutes(Number(hourStep[1]) * 60)
  if (!/^\d+$/.test(hour)) return raw
  if (weekday === '*') return 'Every day'
  if (weekday === '1-5') return 'Weekdays'
  if (weekday === '0,6' || weekday === '6,0') return 'Weekends'
  if (/^[0-7]$/.test(weekday)) return `Every ${WEEKDAYS[Number(weekday) % 7]}`
  return raw
}

export function reconcileTaskJobs(serverJobs: CronJob[], optimisticJobs: ReadonlyMap<string, CronJob>): { jobs: CronJob[]; pending: Map<string, CronJob> } {
  const merged = new Map(serverJobs.map(job => [job.job_id, job]))
  const pending = new Map<string, CronJob>()
  optimisticJobs.forEach((desired, jobId) => {
    const observed = merged.get(jobId)
    if (!observed || stateOf(observed) !== stateOf(desired)) {
      merged.set(jobId, desired)
      pending.set(jobId, desired)
    }
  })
  return { jobs: [...merged.values()], pending }
}

type TaskFilter = 'all' | 'running' | 'scheduled'

export function deriveTaskSections(jobs: CronJob[], filter: TaskFilter) {
  const allRunning = jobs.filter(job => stateOf(job) === 'running')
  const allScheduled = jobs.filter(job => stateOf(job) === 'scheduled')
  // Keep paused/error jobs visible beside Scheduled work so their only action,
  // Resume, is never hidden by the very filter that exposed the task before pause.
  const attention = jobs.filter(job => !['running', 'scheduled'].includes(stateOf(job)))
  return {
    running: filter === 'scheduled' ? [] : allRunning,
    scheduled: filter === 'running' ? [] : allScheduled,
    attention: filter === 'running' ? [] : attention,
  }
}

function getTasksStorageKey(endpoint?: string): string {
  const clean = (endpoint || getActiveHermesEndpoint()).replace(/[^a-zA-Z0-9]/g, '_')
  return `hermes-tasks-v1:${clean}`
}

function loadPersistedTaskJobs(endpoint?: string): CronJob[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(getTasksStorageKey(endpoint))
      if (raw) {
        const parsed = JSON.parse(raw) as CronJob[]
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    }
  } catch {}
  return []
}

let cachedTaskJobs: CronJob[] = loadPersistedTaskJobs()
let hasLoadedTaskJobsOnce = cachedTaskJobs.length > 0

let inFlightTasksPromise: Promise<CronJob[]> | null = null
let lastTaskFetchTime = 0
let lastTaskFetchEndpoint = ''
export const TASK_FETCH_COOLDOWN_MS = 15_000

export function resetTaskFetchCooldown() {
  lastTaskFetchTime = 0
  lastTaskFetchEndpoint = ''
  inFlightTasksPromise = null
}

export async function fetchAllCronJobs(
  baseUrl?: string,
  profiles: LiveProfile[] = [],
  force = false
): Promise<CronJob[]> {
  const effectiveBaseUrl = baseUrl || getActiveHermesEndpoint()
  const now = Date.now()

  if (
    !force &&
    effectiveBaseUrl === lastTaskFetchEndpoint &&
    now - lastTaskFetchTime < TASK_FETCH_COOLDOWN_MS &&
    cachedTaskJobs.length > 0
  ) {
    return cachedTaskJobs
  }

  if (inFlightTasksPromise) {
    return inFlightTasksPromise
  }

  inFlightTasksPromise = (async () => {
    try {
      // 1. Load system jobs
      const systemJobs = await loadCronJobs(undefined, effectiveBaseUrl)

      // 2. Also query any active profile scopes in case the gateway isolates per-bot stores
      const scopes = profiles.map(p => p.name).filter(Boolean)
      const scopeResults = scopes.length
        ? await Promise.allSettled(scopes.map(s => loadCronJobs(s, effectiveBaseUrl)))
        : []
      const additionalJobs = scopeResults
        .filter((r): r is PromiseFulfilledResult<CronJob[]> => r.status === 'fulfilled')
        .flatMap(r => r.value)

      const jobMap = new Map<string, CronJob>()
      for (const job of [...systemJobs, ...additionalJobs]) {
        if (job?.job_id) jobMap.set(job.job_id, job)
      }
      const allJobs = Array.from(jobMap.values())
      lastTaskFetchTime = Date.now()
      lastTaskFetchEndpoint = effectiveBaseUrl

      if (allJobs.length > 0 || systemJobs.length === 0) {
        cachedTaskJobs = allJobs
        hasLoadedTaskJobsOnce = true
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem(getTasksStorageKey(effectiveBaseUrl), JSON.stringify(allJobs))
          }
        } catch {}
      }
      return allJobs
    } finally {
      inFlightTasksPromise = null
    }
  })()

  return inFlightTasksPromise
}

export async function preloadTaskJobs(baseUrl?: string, profiles: LiveProfile[] = []): Promise<CronJob[]> {
  const effectiveBaseUrl = baseUrl || getActiveHermesEndpoint()
  try {
    const allJobs = await fetchAllCronJobs(effectiveBaseUrl, profiles, false)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hermes-tasks-preloaded', { detail: { endpoint: effectiveBaseUrl, jobs: allJobs } }))
    }
    return allJobs
  } catch {}
  return cachedTaskJobs
}

export function setupTaskPollingController({
  active,
  onRefresh,
  intervalMs = 20_000,
}: {
  active: boolean
  onRefresh: () => void | Promise<unknown>
  intervalMs?: number
}): () => void {
  if (!active) return () => {}
  void onRefresh()
  const timer = globalThis.setInterval(() => void onRefresh(), intervalMs)
  return () => globalThis.clearInterval(timer)
}

export function TasksView({
  back,
  profiles,
  createOpen: propCreateOpen,
  setCreateOpen: propSetCreateOpen,
  query = '',
  baseUrl,
  active = true,
  style,
}: Props) {
  const effectiveBaseUrl = baseUrl || getActiveHermesEndpoint()
  const [jobs, setJobs] = useState<CronJob[]>(() => cachedTaskJobs)
  const [selected, setSelected] = useState<CronJob | null>(null)
  const [loading, setLoading] = useState(() => !hasLoadedTaskJobsOnce)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [internalCreateOpen, setInternalCreateOpen] = useState(false)
  const isCreateOpen = propCreateOpen !== undefined ? propCreateOpen : internalCreateOpen
  const setIsCreateOpen = propSetCreateOpen || setInternalCreateOpen
  const [deleteCandidate, setDeleteCandidate] = useState<CronJob | null>(null)
  const scrollRef = useRef<HTMLElement | null>(null)
  useEdgeSwipeBack(scrollRef, back || (() => {}), Boolean(back) && !selected && !isCreateOpen && active)
  const optimisticJobsRef = useRef(new Map<string, CronJob>())
  const scopeKey = profiles.map(profile => profile.name).sort().join('|')

  // The task detail and the new-task sheet are pushed pages, so they slide
  // out to the right when they close rather than vanishing.
  const { isExiting: detailExiting, requestClose: closeDetail } = usePageExit(() => setSelected(null))
  const { isExiting: createExiting, requestClose: closeCreate } = usePageExit(() => {
    setIsCreateOpen(false)
    setInternalCreateOpen(false)
  })

  const refresh = async (silent = true, force = false) => {
    if (!silent && !cachedTaskJobs.length) setLoading(true)
    setError('')
    try {
      const serverJobs = await fetchAllCronJobs(effectiveBaseUrl, profiles, force)
      const reconciled = reconcileTaskJobs(serverJobs, optimisticJobsRef.current)
      optimisticJobsRef.current = reconciled.pending
      cachedTaskJobs = reconciled.jobs
      hasLoadedTaskJobsOnce = true
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(getTasksStorageKey(effectiveBaseUrl), JSON.stringify(reconciled.jobs))
        }
      } catch {}
      setJobs(reconciled.jobs)
      setSelected(current => current ? (reconciled.jobs.find(job => job.job_id === current.job_id) || current) : null)
    } catch {
      if (!jobs.length && !cachedTaskJobs.length) {
        setError('Could not load Hermes scheduled tasks.')
      }
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    const persisted = loadPersistedTaskJobs(effectiveBaseUrl)
    if (persisted.length > 0) {
      setJobs(persisted)
      setLoading(false)
    }
    const onPreload = (e: Event) => {
      const detail = (e as CustomEvent<{ endpoint: string; jobs: CronJob[] }>).detail
      if (detail && detail.endpoint === effectiveBaseUrl && Array.isArray(detail.jobs)) {
        setJobs(detail.jobs)
        setLoading(false)
      }
    }
    window.addEventListener('hermes-tasks-preloaded', onPreload)
    return () => window.removeEventListener('hermes-tasks-preloaded', onPreload)
  }, [effectiveBaseUrl])

  useEffect(() => {
    if (!active) return
    const onMobileBack = (event: Event) => {
      if (selected) { event.preventDefault(); setSelected(null) }
      else if (isCreateOpen) { event.preventDefault(); setIsCreateOpen(false) }
      else if (back) { event.preventDefault(); back() }
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    return () => window.removeEventListener('hermes-mobile-back', onMobileBack)
  }, [active, selected, isCreateOpen, back])

  useEffect(() => {
    return setupTaskPollingController({
      active,
      onRefresh: () => void refresh(cachedTaskJobs.length > 0, false),
      intervalMs: 20_000,
    })
  }, [active, scopeKey])
  const filteredJobs = useMemo(() => {
    if (!query.trim()) return jobs
    const q = query.trim().toLowerCase()
    return jobs.filter(job =>
      jobTitle(job).toLowerCase().includes(q) ||
      (job.schedule || '').toLowerCase().includes(q) ||
      (job.prompt || job.prompt_preview || '').toLowerCase().includes(q)
    )
  }, [jobs, query])
  const { running, scheduled, attention } = useMemo(() => deriveTaskSections(filteredJobs, 'all'), [filteredJobs])
  const toggle = async (job: CronJob) => {
    const action = stateOf(job) === 'paused' ? 'resume' : 'pause'
    const desired: CronJob = { ...job, enabled: action === 'resume', state: action === 'resume' ? 'scheduled' : 'paused' }
    optimisticJobsRef.current.set(job.job_id, desired)
    setJobs(current => current.map(item => item.job_id === job.job_id ? desired : item))
    setSelected(current => current?.job_id === job.job_id ? desired : current)
    setBusy(`${job.job_id}:toggle`); setError('')
    try { await updateCronJob(job.job_id, action, job.profile, effectiveBaseUrl); await refresh() }
    catch (reason) { optimisticJobsRef.current.delete(job.job_id); setJobs(current => current.map(item => item.job_id === job.job_id ? job : item)); setSelected(current => current?.job_id === job.job_id ? job : current); setError(reason instanceof Error ? reason.message : `Could not ${action} this task.`) }
    finally { setBusy('') }
  }
  const trigger = async (job: CronJob) => { setBusy(`${job.job_id}:trigger`); setError(''); try { await triggerCronJob(job.job_id, job.profile, effectiveBaseUrl); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Hermes could not trigger this task.') } finally { setBusy('') } }
  const remove = async (job: CronJob) => {
    setBusy(`${job.job_id}:remove`); setError('')
    try {
      await updateCronJob(job.job_id, 'remove', job.profile, effectiveBaseUrl)
      optimisticJobsRef.current.delete(job.job_id)
      setJobs(current => current.filter(item => item.job_id !== job.job_id))
      setSelected(current => current?.job_id === job.job_id ? null : current)
      setDeleteCandidate(null)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Hermes could not delete this task.')
    } finally { setBusy('') }
  }
  const openTask = async (job: CronJob) => {
    setSelected(job)
    try { setSelected(await loadCronJob(job.job_id, job.profile, effectiveBaseUrl)) }
    catch { /* Keep the list payload visible; the full prompt remains available when the gateway supports the detail route. */ }
  }
  const deleteAlert = deleteCandidate && <DeleteTaskModal job={deleteCandidate} deleting={busy === `${deleteCandidate.job_id}:remove`} onCancel={() => setDeleteCandidate(null)} onConfirm={() => void remove(deleteCandidate)}/>
  if (selected) {
    return active ? (
      <PageHost state={detailExiting ? PAGE_EXIT_STATE : undefined} zIndex={70}>
        <TaskDetail job={selected} busy={busy} back={closeDetail} onRefresh={() => refresh(true, true)} onToggle={toggle} onTrigger={trigger} onDelete={() => setDeleteCandidate(selected)} baseUrl={effectiveBaseUrl}/>
        {deleteAlert}
      </PageHost>
    ) : null
  }
  if (isCreateOpen) {
    return active ? (
      <PageHost state={createExiting ? PAGE_EXIT_STATE : undefined} zIndex={70}>
        <NewTaskSheet profiles={profiles} baseUrl={effectiveBaseUrl} onClose={closeCreate} onCreated={() => refresh(true, true)}/>
      </PageHost>
    ) : null
  }
  return (
    <div
      className="tasks-sheet tasks-scroll"
      style={{ display: active ? undefined : 'none', ...style }}
      ref={scrollRef as any}
    >
      <h1 className="tasks-large-title">Tasks</h1>
      {error && <p className="tasks-note error">{error}</p>}
      {!filteredJobs.length && loading ? (
        <section className="tasks-group" aria-label="Loading tasks">
          <div className="tasks-group-body">
            <div className="task-row-skeleton" />
            <div className="task-row-skeleton" />
            <div className="task-row-skeleton" />
          </div>
        </section>
      ) : !filteredJobs.length ? (
        <section className="tasks-unavailable">
          <CalendarClock size={46} strokeWidth={1.5}/>
          <b>{query.trim() ? 'No Results' : 'No Tasks'}</b>
          <p>{query.trim() ? 'No tasks match your search.' : 'Scheduled automations you create appear here.'}</p>
          {!query.trim() && <button onClick={() => setIsCreateOpen(true)}>New Task</button>}
        </section>
      ) : (
        <>
          <TaskGroup label="Running" jobs={running} busy={busy} onOpen={openTask} onToggle={toggle}/>
          <TaskGroup label="Scheduled" jobs={scheduled} busy={busy} onOpen={openTask} onToggle={toggle}/>
          <TaskGroup label={attention.some(job => stateOf(job) === 'error') ? 'Needs Attention' : 'Paused'} jobs={attention} busy={busy} onOpen={openTask} onToggle={toggle}/>
        </>
      )}
      {deleteAlert}
    </div>
  )
}

type RowActions = { busy: string; onOpen: (job: CronJob) => void; onToggle: (job: CronJob) => void }

function TaskGroup({ label, jobs, ...actions }: { label: string; jobs: CronJob[] } & RowActions) {
  if (!jobs.length) return null
  return <section className="tasks-group"><h2 className="tasks-group-header">{label}</h2><div className="tasks-group-body">{jobs.map(job => <TaskRow job={job} key={job.job_id} {...actions}/>)}</div></section>
}

// Laid out like a Clock › Alarms row: what and when on the left, on/off on the right.
function TaskRow({ job, busy, onOpen, onToggle }: { job: CronJob } & RowActions) {
  const state = stateOf(job)
  const title = jobTitle(job)
  const cadence = describeSchedule(job.schedule)
  const detail = state === 'running' ? 'Running now'
    : state === 'error' ? 'Last run failed'
      : state === 'paused' ? `${cadence} · Paused`
        : `${cadence} · ${runLabel(job.next_run_at)}`
  return <div className={`task-row ${state}`}>
    <button className="task-row-open" onClick={() => onOpen(job)} aria-label={`Open ${title}`}>
      <span className="task-row-title">{title}</span>
      <span className="task-row-detail">{state === 'running' && <i className="task-row-live" aria-hidden="true"/>}{detail}</span>
    </button>
    <TaskSwitch job={job} busy={busy} onToggle={onToggle}/>
  </div>
}

function TaskSwitch({ job, busy, onToggle }: { job: CronJob; busy: string; onToggle: (job: CronJob) => void }) {
  const enabled = stateOf(job) !== 'paused'
  return <label className="ios-switch">
    <input type="checkbox" role="switch" checked={enabled} disabled={busy === `${job.job_id}:toggle`} onChange={() => void onToggle(job)} aria-label={`${enabled ? 'Pause' : 'Resume'} ${jobTitle(job)}`}/>
    <span aria-hidden="true"/>
  </label>
}
function TaskMetadata({ job }: { job: CronJob }) { const paused = stateOf(job) === 'paused'; return <dl><div><dt>Schedule</dt><dd>{job.schedule || '—'}</dd></div><div><dt>Next</dt><dd>{paused ? 'Paused' : dateLabel(job.next_run_at)}</dd></div><div><dt>Last</dt><dd>{dateLabel(job.last_run_at)}</dd></div>{job.deliver && <div><dt>Deliver</dt><dd>{job.deliver}</dd></div>}{job.model && <div><dt>Model</dt><dd>{job.model}</dd></div>}</dl> }
function DeleteTaskModal({ job, deleting, onCancel, onConfirm }: { job: CronJob; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="task-modal-backdrop" role="presentation" onMouseDown={event => { if (!deleting && event.target === event.currentTarget) onCancel() }}>
    <section className="tasks-alert" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" aria-describedby="delete-task-message">
      <div className="tasks-alert-body">
        <h2 id="delete-task-title">Delete “{jobTitle(job)}”?</h2>
        <p id="delete-task-message">Its schedule is removed and it won’t run again.</p>
      </div>
      <footer>
        <button disabled={deleting} onClick={onCancel}>Cancel</button>
        <button className="destructive" disabled={deleting} onClick={onConfirm}>{deleting ? 'Deleting…' : 'Delete'}</button>
      </footer>
    </section>
  </div>
}
function TaskDetail({
  job,
  busy,
  back,
  onRefresh,
  onToggle,
  onTrigger,
  onDelete,
  baseUrl,
}: {
  job: CronJob
  busy: string
  back: () => void
  onRefresh: () => Promise<void>
  onToggle: (job: CronJob) => Promise<void>
  onTrigger: (job: CronJob) => Promise<void>
  onDelete: () => void
  baseUrl?: string
}) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { isExiting: menuClosing, requestClose: closeMenu } = usePageExit(() => setMenuOpen(false), MENU_CLOSE_MS)
  const [expanded, setExpanded] = useState(false)
  const [editPromptOpen, setEditPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState(job.prompt || job.prompt_preview || '')
  const [savingPrompt, setSavingPrompt] = useState(false)

  const state = stateOf(job)
  const paused = state === 'paused'
  const isRunning = state === 'running'
  const triggering = busy === `${job.job_id}:trigger`
  const promptText = job.prompt || job.prompt_preview || ''
  const cadence = describeSchedule(job.schedule)

  useEffect(() => {
    setPromptDraft(job.prompt || job.prompt_preview || '')
  }, [job.job_id, job.prompt, job.prompt_preview])

  const savePrompt = async () => {
    if (promptDraft === (job.prompt || job.prompt_preview || '')) {
      setEditPromptOpen(false)
      return
    }
    setSavingPrompt(true)
    setError('')
    try {
      await updateCronPrompt(job.job_id, promptDraft, job.profile, baseUrl)
      setEditPromptOpen(false)
      await onRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Hermes could not save this prompt.')
    } finally {
      setSavingPrompt(false)
    }
  }

  const trigger = async () => {
    setError('')
    try {
      await onTrigger(job)
      await onRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Hermes could not trigger this task.')
    }
  }

  const copyPrompt = async () => {
    if (!promptText) return
    try {
      await navigator.clipboard.writeText(promptText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // fallback
    }
  }

  const nextRun = paused
    ? 'Paused'
    : isRunning
    ? 'In progress'
    : job.next_run_at
    ? runLabel(job.next_run_at)
    : 'None'

  const lastTriggered = job.last_run_at ? runLabel(job.last_run_at) : 'Never'
  const statusWord = state === 'error' ? 'Failed' : state.charAt(0).toUpperCase() + state.slice(1)

  return (
    <main ref={shellRef} className="app task-detail">
      <header className="task-detail-nav">
        <button className="round-control" onClick={back} aria-label="Back to tasks"><ChevronLeft size={18}/></button>
        <div className="task-more">
          <button className="round-control" onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)} aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen}><MoreHorizontal size={17}/></button>
          {menuOpen && <>
            <button className="popover-scrim" aria-label="Close menu" onClick={closeMenu}/>
            <div className={`task-more-menu ${menuClosing ? 'is-closing' : ''}`} role="menu">
              <button role="menuitem" onClick={() => { closeMenu(); void onRefresh() }}><RefreshCw size={16}/><span>Refresh</span></button>
              <button role="menuitem" disabled={!promptText} onClick={() => { closeMenu(); void copyPrompt() }}><Copy size={16}/><span>Copy Instructions</span></button>
              <button role="menuitem" className="destructive" onClick={() => { closeMenu(); onDelete() }}><Trash2 size={16}/><span>Delete Task</span></button>
            </div>
          </>}
        </div>
      </header>

      <section className="task-detail-hero">
        <h1>{jobTitle(job)}</h1>
        <p><span className={`task-state ${state}`}>{statusWord}</span>{job.profile && <> · {job.profile}</>}</p>
      </section>

      {error && <p className="tasks-note error">{error}</p>}

      <section className="tasks-group">
        <div className="tasks-group-body">
          <div className="task-field"><span>Enabled</span><TaskSwitch job={job} busy={busy} onToggle={onToggle}/></div>
          <button className="task-field task-field-action" disabled={triggering} onClick={() => void trigger()}><Zap size={16}/><span>{triggering ? 'Running…' : 'Run Now'}</span></button>
        </div>
      </section>

      <section className="tasks-group">
        <h2 className="tasks-group-header">Schedule</h2>
        <div className="tasks-group-body">
          <div className="task-field"><span>Repeats</span><span>{cadence}</span></div>
          {job.schedule && cadence !== job.schedule && <div className="task-field"><span>Cron</span><span className="mono">{job.schedule}</span></div>}
          <div className="task-field"><span>Next Run</span><span>{nextRun}</span></div>
          <div className="task-field"><span>Last Run</span><span>{lastTriggered}</span></div>
        </div>
      </section>

      {(job.profile || job.model || job.deliver) && (
        <section className="tasks-group">
          <h2 className="tasks-group-header">Configuration</h2>
          <div className="tasks-group-body">
            {job.profile && <div className="task-field"><span>Bot</span><span>{job.profile}</span></div>}
            {job.model && <div className="task-field"><span>Model</span><span>{job.model}</span></div>}
            {job.deliver && <div className="task-field"><span>Delivery</span><span>{job.deliver}</span></div>}
          </div>
        </section>
      )}

      <section className="tasks-group">
        <div className="tasks-group-header-row">
          <h2 className="tasks-group-header">Instructions</h2>
          <button className="tasks-header-action" disabled={savingPrompt} onClick={() => setEditPromptOpen(true)}>{promptText ? 'Edit' : 'Add'}</button>
        </div>
        <div className="tasks-group-body">
          {promptText ? <>
            <p className={`task-instructions ${expanded ? '' : 'clamped'}`}>{promptText}</p>
            {promptText.length > 320 && <button className="task-field task-field-action" onClick={() => setExpanded(open => !open)}><span>{expanded ? 'Show Less' : 'Show More'}</span></button>}
          </> : <p className="task-instructions empty">No instructions. This task runs its configured script or delivery target.</p>}
        </div>
      </section>

      <section className="tasks-group">
        <div className="tasks-group-body">
          <button className="task-delete-row" onClick={onDelete}>Delete Task</button>
        </div>
      </section>

      {copied && <div className="tasks-toast" role="status">Copied</div>}

      {editPromptOpen && (
        <div
          className="task-modal-backdrop sheet"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setEditPromptOpen(false)
          }}
        >
          <section className="task-prompt-sheet" role="dialog" aria-modal="true" aria-label="Edit instructions">
            <header className="task-sheet-nav">
              <button
                onClick={() => {
                  setPromptDraft(promptText)
                  setEditPromptOpen(false)
                }}
              >
                Cancel
              </button>
              <b>Instructions</b>
              <button
                className="save"
                disabled={savingPrompt || !promptDraft.trim()}
                onClick={() => void savePrompt()}
              >
                {savingPrompt ? 'Saving…' : 'Save'}
              </button>
            </header>
            <textarea
              autoFocus
              value={promptDraft}
              onChange={event => setPromptDraft(event.target.value)}
            />
          </section>
        </div>
      )}
    </main>
  )
}
