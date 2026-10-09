import { invoke } from '@tauri-apps/api/core'

import { HermesGatewayClient, type GatewayEvent } from './gateway'
import type { RosterProfile } from './live-model'

export type LiveProfile = RosterProfile
export type LiveSession = { id: string; title: string; preview: string; profile: string; source?: string; model?: string; unread?: boolean; unread_count?: number; message_count?: number; last_active?: number }
export type LiveUsage = { model?: string; input?: number; output?: number; reasoning?: number; prompt?: number; completion?: number; total?: number; calls?: number; avg_tps?: number; avg_latency_s?: number }
export type LiveMessage = { id: number; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; tool_name?: string | null; tool_status?: 'running' | 'done' | 'failed'; duration_s?: number; reasoning?: string | null; timestamp?: number; token_count?: number | null; usage?: LiveUsage }
export type ModelProvider = { name: string; slug: string; models?: string[]; featured_models?: string[]; authenticated?: boolean }
export type ModelOptions = { model?: string; provider?: string; providers?: ModelProvider[] }
export type SlashCompletion = { text: string; display?: string; meta?: string; kind?: 'skill' | 'command' }
export type SlashCompletionResult = { items?: SlashCompletion[]; replace_from?: number }
export type Capability = { name: string; description?: string; label?: string; tool_count?: number; enabled: boolean }
export type ProfileDetails = {
  name: string
  description?: string
  soul?: string
  model?: { provider?: string; default?: string }
  skills?: Capability[]
  toolsets?: Capability[]
}
export type SkillSearchResult = { name: string; description?: string }
export type CronJob = {
  job_id: string
  id?: string
  name?: string
  prompt?: string
  prompt_preview?: string
  schedule?: string
  enabled?: boolean
  state?: string
  next_run_at?: string
  last_run_at?: string
  last_status?: string
  last_error?: string
  deliver?: string
  model?: string
  provider?: string
  profile?: string
}
export type CronList = { jobs?: CronJob[]; scoped?: string }
export type CronRun = { id: string; title?: string; preview?: string; last_active?: number; started_at?: number }
export type CronDeliveryTarget = { id: string; name: string; home_target_set: boolean }
export type AutomationBlueprintField = { name: string; type: 'enum' | 'text' | 'time' | 'weekdays'; label: string; default: string | null; options: string[]; optional: boolean; help: string }
export type AutomationBlueprint = { key: string; title: string; description: string; category: string; tags: string[]; fields: AutomationBlueprintField[] }
type Snapshot = { sessions: { sessions: LiveSession[] } }

export function buildCanonicalSessionParams(profile: string): Record<string, unknown> {
  return {
    profile,
    title: 'Bot Chat',
    hidden: true,
    follow_profile_config: true,
  }
}

export const localHermes = 'http://127.0.0.1:9119'
let activeHermes = (typeof localStorage !== 'undefined' && localStorage.getItem('hermes-mobile-active-endpoint')) || localHermes
export function setActiveHermesEndpoint(endpoint: string) { activeHermes = endpoint.replace(/\/$/, '') }
export function getActiveHermesEndpoint(): string { return activeHermes }

const gateways = new Map<string, HermesGatewayClient>()
const resolvedSessions = new Map<string, string>()

export function getResolvedSessionId(sessionId: string, baseUrl = activeHermes): string {
  const normBase = (baseUrl || activeHermes).replace(/\/$/, '')
  return resolvedSessions.get(`${normBase}:${sessionId}`) || sessionId
}

function gateway(baseUrl = activeHermes) {
  let client = gateways.get(baseUrl)
  if (!client) {
    client = new HermesGatewayClient(() => invoke<string>('hermes_ws_url', { baseUrl }))
    gateways.set(baseUrl, client)
  }
  return client
}

export function onGatewayGlobalEvent(listener?: (event: GatewayEvent) => void, baseUrl = activeHermes): () => void {
  const client = gateway(baseUrl)
  client.setEventListener(listener)
  return () => client.setEventListener(undefined)
}

export async function rpcCall<T>(method: string, params: Record<string, unknown> = {}, baseUrl = activeHermes): Promise<T> {
  return gateway(baseUrl).call<T>(method, params)
}

export async function probeHermesGateway(baseUrl: string): Promise<{ version?: string; auth_required?: boolean; auth_flows?: string[]; auth_providers?: unknown[]; [key: string]: unknown }> {
  const raw = await invoke<string>('hermes_connection_probe', { baseUrl })
  return JSON.parse(raw) as { version?: string; auth_required?: boolean; auth_flows?: string[]; auth_providers?: unknown[]; [key: string]: unknown }
}

export async function savedHermesEndpoint(): Promise<string | null> {
  return invoke<string | null>('hermes_saved_endpoint')
}

export async function passwordSignIn(baseUrl: string, username: string, password: string): Promise<void> {
  await invoke('hermes_password_sign_in', { baseUrl, username, password })
  setActiveHermesEndpoint(baseUrl)
}

export async function nativeSignIn(baseUrl: string): Promise<void> {
  await invoke('hermes_native_sign_in', { baseUrl })
  setActiveHermesEndpoint(baseUrl)
}

export type LiveActiveSession = {
  id: string
  session_key?: string
  status: string
  title?: string
  preview?: string
  model?: string
  last_active?: number
  started_at?: number
}

export async function loadActiveSessions(baseUrl = activeHermes): Promise<LiveActiveSession[] | null> {
  try {
    const res = await rpcCall<{ sessions: LiveActiveSession[] }>('session.active_list', {}, baseUrl)
    return res.sessions || []
  } catch {
    return null
  }
}

export async function loadSnapshot(baseUrl = activeHermes): Promise<{ profiles: LiveProfile[]; sessions: LiveSession[] }> {
  // On Android the secure credential backend is native. Sequence the native
  // REST read before minting the WebSocket ticket to avoid concurrent keyring
  // reads during the first authenticated handoff.
  const raw = await invoke<string>('hermes_snapshot', { baseUrl })
  const roster = await rpcCall<{ profiles: LiveProfile[] }>('profiles.list', { include_sessions: true }, baseUrl)
  const snapshot = JSON.parse(raw) as Snapshot
  return { profiles: roster.profiles, sessions: snapshot.sessions.sessions }
}

export async function createProfile(input: { name: string; description: string; soul: string; model?: string; provider?: string; shape?: string; color?: string; title?: string }, baseUrl = activeHermes): Promise<void> {
  await rpcCall('profiles.create', {
    name: input.name,
    description: input.description,
    soul: input.soul,
    model: input.model || '',
    provider: input.provider || '',
    mirror_credentials: true,
    share_auth: true,
    clone_all: false,
    no_skills: false,
  }, baseUrl)

  if (input.shape) {
    await rpcCall('profiles.configure', {
      name: input.name,
      ui_meta: {
        'hermes-bots': {
          shape: input.shape,
          ...(input.color ? { color: input.color } : {}),
          imageKind: 'shape',
          title: input.title || '',
          custom: true,
        },
      },
    }, baseUrl)
  }

  // Hermes Desktop births a Bot's canonical hidden conversation immediately
  // after creating the profile. Without this step the roster refresh has no
  // Bot Chat to resolve and the user lands back on the inbox instead of the
  // new conversation.
  const client = gateway(baseUrl)
  const created = await client.call<{ session_id?: string; stored_session_id?: string }>('session.create', buildCanonicalSessionParams(input.name))
  if (created.session_id) {
    await client.call('session.title', { session_id: created.session_id, title: 'Bot Chat' })
  }
}

export type CreateSessionOptions = {
  hidden?: boolean
  canonical?: boolean
}

export async function createSession(
  profile = 'default',
  title = 'New chat',
  optionsOrBaseUrl?: CreateSessionOptions | string,
  baseUrl?: string
): Promise<LiveSession> {
  const options = typeof optionsOrBaseUrl === 'object' && optionsOrBaseUrl !== null ? optionsOrBaseUrl : undefined
  const effectiveBaseUrl = typeof optionsOrBaseUrl === 'string' ? optionsOrBaseUrl : baseUrl || activeHermes
  const isCanonical = options?.canonical || title === 'Bot Chat'
  const isHidden = options?.hidden ?? isCanonical
  const sessionTitle = isCanonical ? 'Bot Chat' : title
  const client = gateway(effectiveBaseUrl)
  const created = await client.call<{ session_id?: string; stored_session_id?: string; id?: string }>('session.create', {
    profile,
    title: sessionTitle,
    hidden: isHidden,
    follow_profile_config: true,
  })
  const canonicalId = created.stored_session_id || created.session_id || created.id || ''
  if (!canonicalId) {
    throw new Error('Failed to create session: gateway returned no session id')
  }
  if (created.session_id) {
    resolvedSessions.set(`${effectiveBaseUrl}:${canonicalId}`, created.session_id)
    resolvedSessions.set(`${effectiveBaseUrl}:${created.session_id}`, created.session_id)
  }
  return {
    id: canonicalId,
    title: sessionTitle,
    preview: '',
    profile,
    last_active: Date.now(),
  }
}

export async function loadMessages(sessionId: string, profile: string, baseUrl = activeHermes): Promise<LiveMessage[]> {
  const safeProfile = profile || 'default'
  let lastErr: unknown

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await invoke<string>('hermes_session_messages', { baseUrl, sessionId, profile: safeProfile })
      const parsed = JSON.parse(raw) as { messages?: LiveMessage[] }
      const messages = Array.isArray(parsed?.messages) ? parsed.messages : []
      return messages.map(msg => ({
        ...msg,
        content: typeof msg.content === 'string' ? msg.content : msg.content == null ? '' : String(msg.content),
      }))
    } catch (err) {
      lastErr = err
      const message = String(err)
      if (/404|not found|not_found/i.test(message)) {
        return []
      }
      // If it's a momentary SQLite database lock or gateway busy response, wait briefly and retry
      if (attempt < 2) {
        await new Promise(resolve => window.setTimeout(resolve, 250 * (attempt + 1)))
      }
    }
  }

  throw lastErr
}

export async function transcribeAudio(profile: string, dataUrl: string, mimeType: string, baseUrl = activeHermes): Promise<string> {
  const raw = await invoke<string>('hermes_transcribe', { baseUrl, profile, dataUrl, mimeType })
  const result = JSON.parse(raw) as { text?: string; transcript?: string }
  return result.text || result.transcript || ''
}

export async function fetchRemoteMedia(path: string, baseUrl = activeHermes): Promise<string> {
  const normBase = (baseUrl || activeHermes).replace(/\/$/, '')
  try {
    if (typeof window !== 'undefined' && (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke) {
      return await invoke<string>('hermes_fetch_media', { baseUrl: normBase, path })
    }
  } catch {}

  try {
    const res = await fetch(`${normBase}/api/media?path=${encodeURIComponent(path)}`, {
      credentials: 'include',
    })
    if (res.ok) {
      const data = await res.json() as { data_url?: string }
      if (data.data_url) return data.data_url
    }
  } catch {}

  try {
    const res2 = await fetch(`${normBase}/api/fs/read-data-url?path=${encodeURIComponent(path)}`, {
      credentials: 'include',
    })
    if (res2.ok) {
      const data2 = await res2.json() as { dataUrl?: string; data_url?: string }
      if (data2.dataUrl || data2.data_url) return data2.dataUrl || data2.data_url!
    }
  } catch {}

  throw new Error(`Could not load media: ${path}`)
}

export async function updateSessionTitle(sessionId: string, title: string, baseUrl = activeHermes): Promise<void> {
  const normBase = (baseUrl || activeHermes).replace(/\/$/, '')
  const resolved = resolvedSessions.get(`${normBase}:${sessionId}`) || sessionId
  await gateway(normBase).call('session.title', { session_id: resolved, title })
}

export async function loadModelOptions(profile: string, baseUrl = activeHermes): Promise<ModelOptions> {
  const raw = await invoke<string>('hermes_model_options', { baseUrl, profile })
  return JSON.parse(raw) as ModelOptions
}

export async function loadProfileAvatar(profile: string, baseUrl = activeHermes): Promise<string | null> {
  const result = await rpcCall<{ found?: boolean; data?: string }>('profiles.get_asset', { name: profile, asset: 'avatar' }, baseUrl)
  return result.found && result.data ? result.data : null
}

export async function loadProfileDetails(profile: string, baseUrl = activeHermes): Promise<ProfileDetails> {
  return rpcCall<ProfileDetails>('profiles.describe', { name: profile }, baseUrl)
}

export async function attachFile(sessionId: string, profile: string, input: { name: string; dataUrl: string; path?: string }, baseUrl = activeHermes): Promise<{ name: string; refText: string }> {
  const resolved = resolvedSessions.get(`${baseUrl}:${sessionId}`) || await gateway(baseUrl).resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolved)
  const result = await gateway(baseUrl).attachFile(resolved, { name: input.name, data_url: input.dataUrl, path: input.path })
  if (result.attached !== true || !result.ref_text) throw new Error(`Hermes could not attach “${input.name}”.`)
  return { name: result.name || input.name, refText: result.ref_text }
}

export async function completeSlash(sessionId: string, profile: string, text: string, baseUrl = activeHermes): Promise<SlashCompletionResult> {
  const resolved = resolvedSessions.get(`${baseUrl}:${sessionId}`) || await gateway(baseUrl).resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolved)
  return gateway(baseUrl).call<SlashCompletionResult>('complete.slash', { session_id: resolved, profile, text })
}

export async function setProfileDescription(profile: string, description: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ ok?: boolean; applied?: { description?: boolean } }>('profiles.configure', { name: profile, description }, baseUrl)
  if (result.ok === false || result.applied?.description === false) throw new Error('Hermes could not save this Bot’s description.')
}

export function capabilityUpdatePayload(skills: Capability[], toolsets: Capability[]): { disabled_skills: string[]; enabled_toolsets: string[] } {
  const enabledToolsets = toolsets.filter(item => item.enabled).map(item => item.name)
  if (toolsets.length && enabledToolsets.length === 0) throw new Error('Select at least one toolset. Hermes uses an empty selection to restore its default tools.')
  return {
    disabled_skills: skills.filter(item => !item.enabled).map(item => item.name),
    enabled_toolsets: enabledToolsets.length === toolsets.length ? [] : enabledToolsets,
  }
}

export async function setProfileCapabilities(profile: string, skills: Capability[], toolsets: Capability[], baseUrl = activeHermes): Promise<void> {
  const payload = capabilityUpdatePayload(skills, toolsets)
  const result = await rpcCall<{ ok?: boolean; applied?: { skills?: boolean; toolsets?: boolean } }>('profiles.configure', {
    name: profile,
    ...payload,
  }, baseUrl)
  if (result.ok === false || result.applied?.skills === false || result.applied?.toolsets === false) throw new Error('Hermes could not update this Bot’s capabilities.')
}

export async function searchHubSkills(profile: string, query: string, baseUrl = activeHermes): Promise<SkillSearchResult[]> {
  const result = await rpcCall<{ results?: SkillSearchResult[] }>('skills.manage', { action: 'search', profile, query }, baseUrl)
  return Array.isArray(result.results) ? result.results : []
}

export async function installHubSkill(profile: string, name: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ installed?: boolean }>('skills.manage', { action: 'install', profile, query: name }, baseUrl)
  if (result.installed !== true) throw new Error(`Hermes could not install “${name}”.`)
}

const cronText = (value: unknown): string | undefined => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined
const cronScheduleText = (job: Record<string, unknown>): string | undefined => {
  const explicit = cronText(job.schedule_display)
  if (explicit) return explicit
  const schedule = job.schedule
  if (schedule && typeof schedule === 'object') {
    const fields = schedule as Record<string, unknown>
    return cronText(fields.display) || cronText(fields.expr)
  }
  return cronText(schedule)
}

export function normalizeCronJob(job: Partial<CronJob> | Record<string, unknown>, profile = ''): CronJob {
  const raw = job as Record<string, unknown>
  const jobId = String(raw.job_id || raw.id || '').trim()
  if (!jobId) throw new Error('Hermes returned task details without a job ID.')
  return {
    job_id: jobId,
    ...(cronText(raw.id) ? { id: cronText(raw.id) } : {}),
    ...(cronText(raw.name) ? { name: cronText(raw.name) } : {}),
    ...(cronText(raw.prompt) ? { prompt: cronText(raw.prompt) } : {}),
    ...(cronText(raw.prompt_preview) ? { prompt_preview: cronText(raw.prompt_preview) } : {}),
    ...(cronScheduleText(raw) ? { schedule: cronScheduleText(raw) } : {}),
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(cronText(raw.state) ? { state: cronText(raw.state) } : {}),
    ...(cronText(raw.next_run_at) ? { next_run_at: cronText(raw.next_run_at) } : {}),
    ...(cronText(raw.last_run_at) ? { last_run_at: cronText(raw.last_run_at) } : {}),
    ...(cronText(raw.last_status) ? { last_status: cronText(raw.last_status) } : {}),
    ...(cronText(raw.last_error) ? { last_error: cronText(raw.last_error) } : {}),
    ...(cronText(raw.deliver) ? { deliver: cronText(raw.deliver) } : {}),
    ...(cronText(raw.model) ? { model: cronText(raw.model) } : {}),
    ...(cronText(raw.provider) ? { provider: cronText(raw.provider) } : {}),
    ...(profile || cronText(raw.profile) ? { profile: profile || cronText(raw.profile) } : {}),
  }
}

export async function loadCronJobs(profile?: string, baseUrl = activeHermes): Promise<CronJob[]> {
  const targetBaseUrl = baseUrl || activeHermes
  // 1. Try native authenticated REST endpoint first (/api/cron/jobs?profile=...)
  try {
    const raw = await invoke<string>('hermes_cron_jobs', { baseUrl: targetBaseUrl, profile: profile || 'all' })
    const parsed = JSON.parse(raw) as unknown
    const rawJobs = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { jobs?: unknown[] }).jobs))
        ? (parsed as { jobs: unknown[] }).jobs
        : []
    return (rawJobs as unknown[])
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && ((item as Record<string, unknown>).job_id || (item as Record<string, unknown>).id)))
      .map(job => normalizeCronJob(job, profile || ''))
  } catch {
    // 2. Fall back to WebSocket RPC (cron.manage)
    try {
      const result = await rpcCall<CronList>('cron.manage', { action: 'list', include_disabled: true, ...(profile && profile !== 'all' ? { profile } : {}) }, targetBaseUrl)
      const rawJobs = Array.isArray(result.jobs) ? result.jobs : []
      return (rawJobs as unknown[])
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && ((item as Record<string, unknown>).job_id || (item as Record<string, unknown>).id)))
        .map(job => normalizeCronJob(job, (typeof result.scoped === 'string' ? result.scoped : '') || profile || ''))
    } catch {
      return []
    }
  }
}

export async function loadCronJob(jobId: string, profile = '', baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_cron_job', { baseUrl, jobId, profile })
  return normalizeCronJob(JSON.parse(raw) as Partial<CronJob>, profile)
}

export async function loadCronRuns(jobId: string, profile = '', baseUrl = activeHermes): Promise<CronRun[]> {
  const raw = await invoke<string>('hermes_cron_runs', { baseUrl, jobId, profile })
  const result = JSON.parse(raw) as { runs?: CronRun[] }
  return Array.isArray(result.runs) ? result.runs : []
}

export async function triggerCronJob(jobId: string, profile = '', baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_trigger_cron', { baseUrl, jobId, profile })
  return JSON.parse(raw) as CronJob
}

export async function loadCronBlueprints(baseUrl = activeHermes): Promise<AutomationBlueprint[]> {
  const raw = await invoke<string>('hermes_cron_blueprints', { baseUrl })
  const result = JSON.parse(raw) as { blueprints?: AutomationBlueprint[] }
  return Array.isArray(result.blueprints) ? result.blueprints : []
}

export async function loadCronDeliveryTargets(baseUrl = activeHermes): Promise<CronDeliveryTarget[]> {
  const raw = await invoke<string>('hermes_cron_delivery_targets', { baseUrl })
  const result = JSON.parse(raw) as { targets?: CronDeliveryTarget[] }
  return Array.isArray(result.targets) ? result.targets : []
}

export async function createCronJob(profile: string, body: { name?: string; prompt: string; schedule: string; deliver?: string; model?: string; provider?: string }, baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_create_cron', { baseUrl, profile, body })
  return JSON.parse(raw) as CronJob
}

export async function instantiateCronBlueprint(profile: string, blueprint: string, values: Record<string, string>, baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_instantiate_cron_blueprint', { baseUrl, profile, body: { blueprint, values } })
  return JSON.parse(raw) as CronJob
}

export async function updateCronPrompt(jobId: string, prompt: string, profile = '', baseUrl = activeHermes): Promise<CronJob> {
  const raw = await invoke<string>('hermes_update_cron_prompt', { baseUrl, jobId, profile, prompt })
  return JSON.parse(raw) as CronJob
}

export async function updateCronJob(jobId: string, action: 'pause' | 'resume' | 'remove', profile?: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ ok?: boolean }>('cron.manage', { action, name: jobId, ...(profile ? { profile } : {}) }, baseUrl)
  if (result.ok === false) throw new Error(`Hermes could not ${action} this scheduled task.`)
}

export async function setProfileSoul(profile: string, soul: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ ok?: boolean; applied?: { soul?: boolean } }>('profiles.configure', { name: profile, soul }, baseUrl)
  if (result.ok === false || result.applied?.soul === false) throw new Error('Hermes could not save this Bot’s SOUL.md.')
}

export async function setProfileModel(profile: string, provider: string, model: string, baseUrl = activeHermes): Promise<void> {
  const result = await rpcCall<{ ok?: boolean; confirm_required?: boolean; confirm_message?: string }>('profiles.configure', { name: profile, provider, model }, baseUrl)
  if (result.confirm_required) throw new Error(result.confirm_message || 'This model requires confirmation in Hermes Desktop before it can become the Bot default.')
  if (result.ok === false) throw new Error('Hermes could not update the Bot default model.')
}

export async function setSessionModel(sessionId: string, profile: string, provider: string, model: string, baseUrl = activeHermes): Promise<void> {
  const resolved = resolvedSessions.get(`${baseUrl}:${sessionId}`) || await gateway(baseUrl).resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolved)
  await gateway(baseUrl).setSessionModel(resolved, provider, model)
}

export async function setSessionReasoning(sessionId: string, profile: string, effort: string, baseUrl = activeHermes): Promise<void> {
  const resolved = resolvedSessions.get(`${baseUrl}:${sessionId}`) || await gateway(baseUrl).resumeSession(sessionId, profile)
  resolvedSessions.set(`${baseUrl}:${sessionId}`, resolved)
  await gateway(baseUrl).setSessionReasoning(resolved, effort)
}

export async function connectAndSubmit(
  sessionId: string,
  profile: string,
  text: string,
  onEvent: (type: string, payload: Record<string, unknown>, event?: GatewayEvent) => void,
  baseUrl = activeHermes,
  options?: { truncateMessageId?: number },
): Promise<{ sessionId: string }> {
  const normBase = (baseUrl || activeHermes).replace(/\/$/, '')
  const client = gateway(normBase)
  let resolvedSessionId = resolvedSessions.get(`${normBase}:${sessionId}`)

  if (!resolvedSessionId) {
    if (sessionId.startsWith('draft:')) {
      const fresh = await createSession(profile, 'Bot Chat', { canonical: true, hidden: true }, normBase)
      resolvedSessionId = resolvedSessions.get(`${normBase}:${fresh.id}`) || fresh.id
    } else {
      try {
        resolvedSessionId = await client.resumeSession(sessionId, profile)
      } catch (err) {
        const msg = String(err)
        if (/4007|not found|not_found/i.test(msg)) {
          // If the session was deleted or unpersisted in DB, auto-recover by minting a fresh session
          const fresh = await createSession(profile, 'Bot Chat', { canonical: true, hidden: true }, normBase)
          resolvedSessionId = resolvedSessions.get(`${normBase}:${fresh.id}`) || fresh.id
        } else {
          throw err
        }
      }
    }
  }

  resolvedSessions.set(`${normBase}:${sessionId}`, resolvedSessionId)
  resolvedSessions.set(`${normBase}:${resolvedSessionId}`, resolvedSessionId)
  await client.submitPrompt(resolvedSessionId, text, event => onEvent(event.type, event.payload, event), options)
  return { sessionId: resolvedSessionId }
}

export async function resumeSession(sessionId: string, profile?: string, baseUrl = activeHermes): Promise<string> {
  const normBase = (baseUrl || activeHermes).replace(/\/$/, '')
  const sid = await gateway(normBase).resumeSession(sessionId, profile)
  if (sid) {
    resolvedSessions.set(`${normBase}:${sessionId}`, sid)
    resolvedSessions.set(`${normBase}:${sid}`, sessionId)
  }
  return sid
}

export function respondClarify(
  requestId: string,
  answers: Record<string, string | null>,
  baseUrl = activeHermes
) {
  const normBase = (baseUrl || activeHermes).replace(/\/$/, '')
  gateway(normBase).respondToServerRequest(requestId, { answers })
}

export async function interruptSession(sessionId: string, baseUrl = activeHermes): Promise<void> {
  const normBase = (baseUrl || activeHermes).replace(/\/$/, '')
  await gateway(normBase).interruptSession(resolvedSessions.get(`${normBase}:${sessionId}`) || sessionId)
}

export type ClearSessionOptions = {
  canonical?: boolean
  title?: string
  additionalDeleteIds?: string[]
}

export async function clearSession(
  sessionId: string,
  profile = 'default',
  options?: ClearSessionOptions,
  baseUrl = activeHermes
): Promise<LiveSession> {
  const normBase = (baseUrl || activeHermes).replace(/\/$/, '')
  const client = gateway(normBase)
  const resolved = resolvedSessions.get(`${normBase}:${sessionId}`) || sessionId

  console.log('[Hermes Debug] clearSession starting for:', sessionId, 'resolved:', resolved, 'profile:', profile)

  try {
    await client.interruptSession(resolved)
  } catch {}

  try {
    await client.call('session.close', { session_id: resolved })
  } catch {}

  if (sessionId && sessionId !== resolved) {
    try {
      await client.call('session.close', { session_id: sessionId })
    } catch {}
  }

  // Small delay to let worker thread pop session from memory before SQLite delete
  await new Promise(r => setTimeout(r, 60))

  const deleteIds = new Set<string>([sessionId, resolved, ...(options?.additionalDeleteIds || [])].filter(Boolean))
  for (const targetId of deleteIds) {
    // 1. Try REST delete endpoint (which resolves aliases and deletes from SQLite SessionDB)
    try {
      await invoke('hermes_delete_session', { baseUrl: normBase, sessionId: targetId, profile })
      console.log('[Hermes Debug] REST hermes_delete_session succeeded for', targetId)
    } catch (err) {
      console.log('[Hermes Debug] REST hermes_delete_session error for', targetId, ':', err)
    }

    // 2. Also try JSON-RPC session.delete
    try {
      const delRes = await client.call('session.delete', { session_id: targetId, profile })
      console.log('[Hermes Debug] session.delete result for', targetId, ':', delRes)
    } catch (err) {
      console.log('[Hermes Debug] session.delete error for', targetId, ':', err)
    }
  }

  for (const targetId of deleteIds) {
    resolvedSessions.delete(`${normBase}:${targetId}`)
  }

  const isCanonical = options?.canonical ?? true
  const fresh = await createSession(
    profile,
    isCanonical ? 'Bot Chat' : (options?.title || 'New chat'),
    { canonical: isCanonical, hidden: isCanonical },
    normBase
  )
  if (isCanonical && fresh.id) {
    try {
      await client.call('session.title', { session_id: fresh.id, title: 'Bot Chat' })
    } catch {}
  }
  console.log('[Hermes Debug] clearSession created fresh session:', fresh.id, 'title:', fresh.title)
  return fresh
}
