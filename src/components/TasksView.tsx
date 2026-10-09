import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
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
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [internalCreateOpen, setInternalCreateOpen] = useState(false)
  const isCreateOpen = propCreateOpen !== undefined ? propCreateOpen : internalCreateOpen
  const setIsCreateOpen = propSetCreateOpen || setInternalCreateOpen
  const [deleteCandidate, setDeleteCandidate] = useState<CronJob | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [pullRefreshing, setPullRefreshing] = useState(false)
  const scrollRef = useRef<HTMLElement | null>(null)
  const pullStartRef = useRef<number | null>(null)
  useEdgeSwipeBack(scrollRef, back || (() => {}), Boolean(back) && !selected && !isCreateOpen && active)
  const optimisticJobsRef = useRef(new Map<string, CronJob>())
  const scopeKey = profiles.map(profile => profile.name).sort().join('|')

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
  const pullRefresh = async () => {
    setPullRefreshing(true)
    try { await refresh(false, true) } finally { setPullRefreshing(false) }
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
    if (!active) return
    void refresh(cachedTaskJobs.length > 0, false)
    const timer = window.setInterval(() => void refresh(true, true), 20_000)
    return () => window.clearInterval(timer)
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
  const { running, scheduled, attention } = useMemo(() => deriveTaskSections(filteredJobs, filter), [filteredJobs, filter])
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
  if (selected) {
    return active ? (
      <TaskDetail job={selected} busy={busy} back={() => setSelected(null)} onRefresh={() => refresh(true, true)} onToggle={toggle} onTrigger={trigger} onDelete={() => setDeleteCandidate(selected)} baseUrl={effectiveBaseUrl}/>
    ) : null
  }
  if (isCreateOpen) {
    return active ? (
      <NewTaskSheet profiles={profiles} baseUrl={effectiveBaseUrl} onClose={() => setIsCreateOpen(false)} onCreated={() => refresh(true, true)}/>
    ) : null
  }
  const showRunning = running.length > 0
  const showScheduled = scheduled.length > 0
  const showOther = attention.length > 0
  const visibleCount = running.length + scheduled.length + attention.length
  const runningCount = filteredJobs.filter(job => stateOf(job) === 'running').length
  const scheduledCount = filteredJobs.filter(job => stateOf(job) === 'scheduled').length
  const pullActive = pullDistance > 8 || pullRefreshing
  return (
    <div
      className="tasks-sheet tasks-scroll"
      style={{ display: active ? undefined : 'none', ...style }}
      ref={scrollRef as any}
      onTouchStart={event => { if (scrollRef.current?.scrollTop === 0) pullStartRef.current = event.touches[0].clientY }}
      onTouchMove={event => { if (pullStartRef.current == null || scrollRef.current?.scrollTop !== 0) return; const distance = Math.min(76, Math.max(0, event.touches[0].clientY - pullStartRef.current)); if (distance > 0) event.preventDefault(); setPullDistance(distance) }}
      onTouchEnd={() => { const shouldRefresh = pullDistance >= 56; pullStartRef.current = null; setPullDistance(0); if (shouldRefresh) void pullRefresh() }}
    >
    {pullActive && (
      <div
        className="pull-floating-overlay"
        style={{
          transform: `translate3d(-50%, ${pullRefreshing ? 20 : Math.min(28, pullDistance * 0.45)}px, 0)`,
          opacity: pullRefreshing ? 1 : Math.min(1, pullDistance / 24),
        }}
        aria-live="polite"
      >
        <div
          className={`pull-floating-indicator ${pullRefreshing ? 'refreshing' : ''} ${pullDistance >= 56 ? 'ready' : ''}`}
          style={!pullRefreshing ? {
            transform: `rotate(${Math.min(360, (pullDistance / 56) * 360)}deg)`,
          } : undefined}
        >
          <RefreshCw size={15} className={pullRefreshing ? 'pull-refresh-spinner' : ''} />
        </div>
      </div>
    )}

    <section className="tasks-intro">
      <h1>Tasks</h1>
      <p>Schedule and monitor your automations.</p>
    </section>

    <section className="tasks-overview-stats" aria-label="Task summary">
      <div><span>ALL TASKS</span><b>{filteredJobs.length}</b></div>
      <div><span>RUNNING</span><b>{runningCount}</b></div>
      <div><span>SCHEDULED</span><b>{scheduledCount}</b></div>
    </section>

    {error && <p className="management-error">{error}</p>}
    {!filteredJobs.length && loading ? (
      <div className="tasks-loading-skeleton" aria-label="Loading tasks">
        <div className="task-card-skeleton" />
        <div className="task-card-skeleton" />
        <div className="task-card-skeleton" />
      </div>
    ) : !filteredJobs.length ? (
      <section className="tasks-empty">
        <CalendarClock size={24}/>
        <b>No scheduled tasks</b>
        <p>Automations you create will appear here.</p>
        <button className="task-outline-pill" onClick={() => setIsCreateOpen(true)}>
          <Plus size={14}/> Create a task
        </button>
      </section>
    ) : (
      <>
        <nav className="tasks-filters" aria-label="Filter tasks">
          {(['all', 'running', 'scheduled'] as const).map(value => {
            const count = value === 'all' ? filteredJobs.length : value === 'running' ? runningCount : scheduledCount
            const label = value === 'all' ? 'All' : value === 'running' ? 'Running' : 'Scheduled'
            return <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>
          })}
        </nav>
        <div className="tasks-list-heading"><span>{filter === 'all' ? 'YOUR TASKS' : filter === 'scheduled' ? 'SCHEDULED & PAUSED' : 'RUNNING TASKS'}</span><small>{visibleCount} {visibleCount === 1 ? 'task' : 'tasks'}</small></div>
        {visibleCount === 0 ? (
          <section className="tasks-empty tasks-filter-empty">
            <CalendarClock size={22}/>
            <b>No {filter} tasks</b>
            <p>Try another filter to see your automations.</p>
            <button className="task-outline-pill" onClick={() => setFilter('all')}>Show all tasks</button>
          </section>
        ) : (
          <div className="tasks-list-container">
            {showRunning && <TaskSection id="running-tasks" label="RUNNING NOW" jobs={running} busy={busy} onOpen={openTask} onToggle={toggle} onTrigger={trigger} onDelete={setDeleteCandidate}/>}
            {showScheduled && <TaskSection id="scheduled-tasks" label="SCHEDULED" jobs={scheduled} busy={busy} onOpen={openTask} onToggle={toggle} onTrigger={trigger} onDelete={setDeleteCandidate}/>}
            {showOther && <TaskSection label="PAUSED & ATTENTION" jobs={attention} busy={busy} onOpen={openTask} onToggle={toggle} onTrigger={trigger} onDelete={setDeleteCandidate}/>}
          </div>
        )}
      </>
    )}
    {deleteCandidate && <DeleteTaskModal job={deleteCandidate} deleting={busy === `${deleteCandidate.job_id}:remove`} onCancel={() => setDeleteCandidate(null)} onConfirm={() => void remove(deleteCandidate)}/>}
  </div>
  )
}

function TaskSection({ id, label, jobs, busy, onOpen, onToggle, onTrigger, onDelete }: { id?: string; label: string; jobs: CronJob[]; busy: string; onOpen: (job: CronJob) => void; onToggle: (job: CronJob) => void; onTrigger: (job: CronJob) => void; onDelete: (job: CronJob) => void }) {
  if (!jobs.length) return null
  return <section className="task-section" id={id}><div className="task-section-head"><span>{label}</span><small>{jobs.length}</small></div>{jobs.map(job => <TaskCard busy={busy} job={job} key={job.job_id} onOpen={onOpen} onToggle={onToggle} onTrigger={onTrigger} onDelete={onDelete}/>)}</section>
}
function TaskCard({ busy, job, onOpen, onToggle, onTrigger, onDelete }: { busy: string; job: CronJob; onOpen: (job: CronJob) => void; onToggle: (job: CronJob) => void; onTrigger: (job: CronJob) => void; onDelete: (job: CronJob) => void }) {
  const state = stateOf(job)
  const paused = state === 'paused'
  const title = jobTitle(job)
  const nextRun = paused ? 'Paused' : state === 'running' ? 'In progress' : `Next ${dateLabel(job.next_run_at)}`

  return <article className="task-card">
    <button className="task-card-summary" onClick={() => onOpen(job)} aria-label={`Open ${title} details`}>
      <i className={`task-item-dot ${state}`} aria-hidden="true" />
      <span className="task-item-copy">
        <span className="task-item-title-line">
          <span className="task-title-text">{title}</span>
          <span className={`task-status-label ${state}`}>{state}</span>
        </span>
        <span className="task-item-meta"><span>{job.schedule || 'No schedule'}</span><span aria-hidden="true">·</span><span>{nextRun}</span></span>
      </span>
      <ChevronRight className="task-item-chevron" size={16} aria-hidden="true" />
    </button>
    <div className="task-card-actions">
      <button className="task-icon-action" disabled={busy === `${job.job_id}:toggle`} onClick={() => void onToggle(job)} aria-label={`${paused ? 'Resume' : 'Pause'} ${title}`} title={paused ? 'Resume task' : 'Pause task'}>{paused ? <Play size={15}/> : <Pause size={15}/>}</button>
      <button className="task-icon-action" disabled={paused || busy === `${job.job_id}:trigger`} onClick={() => void onTrigger(job)} aria-label={`Trigger ${title}`} title={busy === `${job.job_id}:trigger` ? 'Running task' : 'Run now'}><Zap size={15}/></button>
      <button className="task-icon-action delete" disabled={Boolean(busy)} onClick={() => onDelete(job)} aria-label={`Delete ${title}`} title="Delete task"><Trash2 size={15}/></button>
    </div>
  </article>
}
function TaskMetadata({ job }: { job: CronJob }) { const paused = stateOf(job) === 'paused'; return <dl><div><dt>Schedule</dt><dd>{job.schedule || '—'}</dd></div><div><dt>Next</dt><dd>{paused ? 'Paused' : dateLabel(job.next_run_at)}</dd></div><div><dt>Last</dt><dd>{dateLabel(job.last_run_at)}</dd></div>{job.deliver && <div><dt>Deliver</dt><dd>{job.deliver}</dd></div>}{job.model && <div><dt>Model</dt><dd>{job.model}</dd></div>}</dl> }
function DeleteTaskModal({ job, deleting, onCancel, onConfirm }: { job: CronJob; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="task-modal-backdrop" role="presentation" onMouseDown={event => { if (!deleting && event.target === event.currentTarget) onCancel() }}><section className="task-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" aria-describedby="delete-task-message"><Trash2 size={22}/><h2 id="delete-task-title">Delete scheduled task?</h2><p id="delete-task-message">Delete “{jobTitle(job)}”? This will remove its schedule and prevent future runs.</p><footer><button disabled={deleting} onClick={onCancel}>Keep task</button><button className="delete" disabled={deleting} onClick={onConfirm}><Trash2 size={15}/>{deleting ? 'Deleting…' : 'Delete task'}</button></footer></section></div>
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
  const [editPromptOpen, setEditPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState(job.prompt || job.prompt_preview || '')
  const [savingPrompt, setSavingPrompt] = useState(false)

  const state = stateOf(job)
  const paused = state === 'paused'
  const isRunning = state === 'running'
  const triggering = busy === `${job.job_id}:trigger`
  const toggling = busy === `${job.job_id}:toggle`

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

  const toggle = async () => {
    setError('')
    try {
      await onToggle(job)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Hermes could not update this task.')
    }
  }

  const copyPrompt = async () => {
    const text = job.prompt || job.prompt_preview || ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
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
    ? dateLabel(job.next_run_at)
    : 'None'

  const lastTriggered = job.last_run_at ? dateLabel(job.last_run_at) : 'Never'

  return (
    <main ref={shellRef} className="app task-detail">
      {/* iOS Top Nav Header */}
      <header className="ios-task-header">
        <button className="ios-nav-back" onClick={back} aria-label="Back to tasks">
          <ChevronLeft size={18} />
          <span>Tasks</span>
        </button>
        <span className="ios-nav-title">Task Details</span>
        <button className="ios-nav-action" onClick={() => void onRefresh()} aria-label="Refresh task">
          <RefreshCw size={17} />
        </button>
      </header>

      {/* iOS Clean Title Header */}
      <section className="ios-task-hero">
        <h1 className="ios-task-title">{jobTitle(job)}</h1>
        <div className="ios-task-meta-line">
          <span className={`ios-status-pill ${state}`}>
            <span className="ios-status-dot" />
            <span>{state.charAt(0).toUpperCase() + state.slice(1)}</span>
          </span>
          {job.profile && <span className="ios-task-bot-label">Bot: {job.profile}</span>}
        </div>
      </section>

      {/* iOS Dual Action Buttons */}
      <section className="ios-task-actions">
        <button
          type="button"
          className="ios-action-primary"
          disabled={triggering}
          onClick={() => void trigger()}
        >
          <Zap size={16} />
          <span>{triggering ? 'Running…' : 'Trigger now'}</span>
        </button>
        <button
          type="button"
          className="ios-action-secondary"
          disabled={toggling}
          onClick={() => void toggle()}
        >
          {paused ? (
            <>
              <Play size={15} />
              <span>Resume</span>
            </>
          ) : (
            <>
              <Pause size={15} />
              <span>Pause</span>
            </>
          )}
        </button>
      </section>

      {error && <p className="management-error">{error}</p>}

      {/* Inset Group: Timing */}
      <section className="ios-inset-group">
        <div className="ios-group-header">TIMING</div>
        <div className="ios-group-card">
          <div className="ios-group-row">
            <span className="ios-row-label">Schedule</span>
            <span className="ios-row-value monospace">{job.schedule || 'None'}</span>
          </div>
          <div className="ios-group-row">
            <span className="ios-row-label">Next Run</span>
            <span className="ios-row-value">{nextRun}</span>
          </div>
          <div className="ios-group-row">
            <span className="ios-row-label">Last Triggered</span>
            <span className="ios-row-value">{lastTriggered}</span>
          </div>
        </div>
      </section>

      {/* Inset Group: Configuration */}
      {(job.profile || job.model || job.deliver) && (
        <section className="ios-inset-group">
          <div className="ios-group-header">CONFIGURATION</div>
          <div className="ios-group-card">
            {job.profile && (
              <div className="ios-group-row">
                <span className="ios-row-label">Target Bot</span>
                <span className="ios-row-value">{job.profile}</span>
              </div>
            )}
            {job.model && (
              <div className="ios-group-row">
                <span className="ios-row-label">Model</span>
                <span className="ios-row-value monospace">{job.model}</span>
              </div>
            )}
            {job.deliver && (
              <div className="ios-group-row">
                <span className="ios-row-label">Delivery</span>
                <span className="ios-row-value">{job.deliver}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Inset Group: Instructions / Prompt */}
      <section className="ios-inset-group">
        <div className="ios-group-header-with-actions">
          <span className="ios-group-header">INSTRUCTIONS</span>
          <div className="ios-prompt-actions">
            <button
              type="button"
              className="ios-prompt-btn"
              onClick={copyPrompt}
              disabled={!job.prompt && !job.prompt_preview}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              className="ios-prompt-btn"
              disabled={savingPrompt}
              onClick={() => setEditPromptOpen(true)}
            >
              <Pencil size={12} />
              <span>{job.prompt || job.prompt_preview ? 'Edit' : 'Add'}</span>
            </button>
          </div>
        </div>
        <div className="ios-group-card ios-prompt-card">
          {job.prompt || job.prompt_preview ? (
            <pre className="ios-prompt-text">
              {job.prompt || job.prompt_preview}
            </pre>
          ) : (
            <div className="ios-prompt-empty">
              <span>No custom instructions configured. This task executes its configured script or automated delivery target.</span>
            </div>
          )}
        </div>
      </section>

      {/* Inset Group: Delete Task */}
      <section className="ios-inset-group ios-danger-group">
        <div className="ios-group-card">
          <button
            type="button"
            className="ios-delete-button"
            onClick={onDelete}
          >
            <span>Delete Task</span>
          </button>
        </div>
      </section>

      {/* Prompt Edit Modal */}
      {editPromptOpen && (
        <div
          className="task-modal-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setEditPromptOpen(false)
          }}
        >
          <section className="task-prompt-modal" role="dialog" aria-modal="true" aria-label="Edit task prompt">
            <header>
              <b>Edit prompt</b>
              <button onClick={() => setEditPromptOpen(false)} aria-label="Close prompt editor">
                <X size={18} />
              </button>
            </header>
            <textarea
              autoFocus
              value={promptDraft}
              onChange={event => setPromptDraft(event.target.value)}
            />
            <footer>
              <button
                onClick={() => {
                  setPromptDraft(job.prompt || job.prompt_preview || '')
                  setEditPromptOpen(false)
                }}
              >
                Cancel
              </button>
              <button
                className="save"
                disabled={savingPrompt || !promptDraft.trim()}
                onClick={() => void savePrompt()}
              >
                {savingPrompt ? 'Saving…' : 'Save prompt'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  )
}
