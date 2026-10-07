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
  loadCronJob,
  loadCronJobs,
  triggerCronJob,
  updateCronPrompt,
  updateCronJob,
  type CronJob,
  type LiveProfile,
} from '../hermes'
import { useEdgeSwipeBack } from '../edge-swipe'

type Props = { profiles: LiveProfile[]; back?: () => void; createOpen?: boolean; setCreateOpen?: (open: boolean) => void; query?: string }
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

let cachedTaskJobs: CronJob[] = []
let hasLoadedTaskJobsOnce = false

export function TasksView({ back, profiles, createOpen: propCreateOpen, setCreateOpen: propSetCreateOpen, query = '' }: Props) {
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
  useEdgeSwipeBack(scrollRef, back || (() => {}), Boolean(back) && !selected && !isCreateOpen)
  const optimisticJobsRef = useRef(new Map<string, CronJob>())
  const scopeKey = profiles.map(profile => profile.name).sort().join('|')
  const refresh = async (silent = cachedTaskJobs.length > 0) => {
    if (!silent) setLoading(true)
    setError('')
    const scopes = profiles.map(profile => profile.name)
    const results = await Promise.allSettled((scopes.length ? scopes : [undefined]).map(scope => loadCronJobs(scope)))
    const successful = results.filter((result): result is PromiseFulfilledResult<CronJob[]> => result.status === 'fulfilled')
    const failures = results.filter(result => result.status === 'rejected')
    if (successful.length) {
      const serverJobs = successful.flatMap(result => result.value)
      const reconciled = reconcileTaskJobs(serverJobs, optimisticJobsRef.current)
      optimisticJobsRef.current = reconciled.pending
      cachedTaskJobs = reconciled.jobs
      hasLoadedTaskJobsOnce = true
      setJobs(reconciled.jobs)
      setSelected(current => current ? (reconciled.jobs.find(job => job.job_id === current.job_id) || current) : null)
      if (failures.length) setError('Some Bot task lists could not refresh; showing the last confirmed state for those tasks.')
    } else if (!jobs.length && failures.length) {
      setError('Could not load Hermes scheduled tasks.')
    }
    setLoading(false)
  }
  const pullRefresh = async () => {
    setPullRefreshing(true)
    try { await refresh(false) } finally { setPullRefreshing(false) }
  }
  useEffect(() => {
    const onMobileBack = (event: Event) => {
      if (selected) { event.preventDefault(); setSelected(null) }
      else if (isCreateOpen) { event.preventDefault(); setIsCreateOpen(false) }
      else if (back) { event.preventDefault(); back() }
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    return () => window.removeEventListener('hermes-mobile-back', onMobileBack)
  }, [selected, isCreateOpen, back])
  useEffect(() => {
    void refresh(cachedTaskJobs.length > 0)
    const timer = window.setInterval(() => void refresh(true), 20_000)
    return () => window.clearInterval(timer)
  }, [scopeKey])
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
    try { await updateCronJob(job.job_id, action, job.profile); await refresh() }
    catch (reason) { optimisticJobsRef.current.delete(job.job_id); setJobs(current => current.map(item => item.job_id === job.job_id ? job : item)); setSelected(current => current?.job_id === job.job_id ? job : current); setError(reason instanceof Error ? reason.message : `Could not ${action} this task.`) }
    finally { setBusy('') }
  }
  const trigger = async (job: CronJob) => { setBusy(`${job.job_id}:trigger`); setError(''); try { await triggerCronJob(job.job_id, job.profile); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Hermes could not trigger this task.') } finally { setBusy('') } }
  const remove = async (job: CronJob) => {
    setBusy(`${job.job_id}:remove`); setError('')
    try {
      await updateCronJob(job.job_id, 'remove', job.profile)
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
    try { setSelected(await loadCronJob(job.job_id, job.profile)) }
    catch { /* Keep the list payload visible; the full prompt remains available when the gateway supports the detail route. */ }
  }
  if (selected) return <TaskDetail job={selected} busy={busy} back={() => setSelected(null)} onRefresh={refresh} onToggle={toggle} onTrigger={trigger} onDelete={() => setDeleteCandidate(selected)}/>
  if (isCreateOpen) return <NewTaskSheet profiles={profiles} onClose={() => setIsCreateOpen(false)} onCreated={refresh}/>
  const showRunning = running.length > 0
  const showScheduled = scheduled.length > 0
  const showOther = attention.length > 0
  const visibleCount = running.length + scheduled.length + attention.length
  const runningCount = filteredJobs.filter(job => stateOf(job) === 'running').length
  const scheduledCount = filteredJobs.filter(job => stateOf(job) === 'scheduled').length
  const pullActive = pullDistance > 8 || pullRefreshing
  return <div className="tasks-sheet tasks-scroll" ref={scrollRef as any} onTouchStart={event => { if (scrollRef.current?.scrollTop === 0) pullStartRef.current = event.touches[0].clientY }} onTouchMove={event => { if (pullStartRef.current == null || scrollRef.current?.scrollTop !== 0) return; const distance = Math.min(76, Math.max(0, event.touches[0].clientY - pullStartRef.current)); if (distance > 0) event.preventDefault(); setPullDistance(distance) }} onTouchEnd={() => { const shouldRefresh = pullDistance >= 56; pullStartRef.current = null; setPullDistance(0); if (shouldRefresh) void pullRefresh() }}>
    {pullActive && <div className="pull-refresh-cue" style={{ height: `${pullRefreshing ? 46 : pullDistance}px` }}><RefreshCw size={15} className={pullRefreshing ? 'pull-refresh-spinner' : ''}/><span>{pullRefreshing ? 'Refreshing…' : pullDistance >= 56 ? 'Release to refresh' : 'Pull to refresh'}</span></div>}

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
}: {
  job: CronJob
  busy: string
  back: () => void
  onRefresh: () => Promise<void>
  onToggle: (job: CronJob) => Promise<void>
  onTrigger: (job: CronJob) => Promise<void>
  onDelete: () => void
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
      await updateCronPrompt(job.job_id, promptDraft, job.profile)
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
        <button className="ios-back-button" onClick={back} aria-label="Back to Tasks">
          <ChevronLeft size={21} />
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
              disabled={!job.prompt || savingPrompt}
              onClick={() => setEditPromptOpen(true)}
            >
              <Pencil size={12} />
              <span>Edit</span>
            </button>
          </div>
        </div>
        <div className="ios-group-card ios-prompt-card">
          <pre className="ios-prompt-text">
            {job.prompt || job.prompt_preview || 'No prompt provided.'}
          </pre>
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
