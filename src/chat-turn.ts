export type ChatSessionIdentity = { id: string; profile: string }

export type ToolActivity = {
  id: string
  name: string
  status: 'running' | 'done' | 'failed'
  duration_s?: number
  summary?: string
}

export type ActiveBotTurn = {
  sessionId?: string
  profile: string
  status: 'thinking' | 'streaming' | 'tool' | 'waiting'
  statusText: string
  streamingText: string
  toolActivities: ToolActivity[]
  userMessage: { id: number; role: 'user' | 'assistant' | 'tool' | 'system'; content: string }
  startedAt: number
  needsInput?: boolean
  pendingClarify?: any
  /** True only for turns rebuilt from localStorage after an app restart. */
  restored?: boolean
}

/** Rejects events and completions from a turn that no longer owns the visible chat. */
export function isActiveChatTurn(turnId: number, currentTurnId: number, expected: ChatSessionIdentity, current: ChatSessionIdentity | null): boolean {
  return turnId === currentTurnId && current?.id === expected.id && current.profile === expected.profile
}

export function isSessionStatusWorking(status: string): boolean {
  const norm = (status || '').trim().toLowerCase()
  return norm === 'working' || norm === 'starting' || norm === 'waiting'
}

export class InFlightSubmissionTracker {
  private counts = new Map<string, number>()

  start(key: string): void {
    this.counts.set(key, (this.counts.get(key) || 0) + 1)
  }

  end(key: string): void {
    const cur = this.counts.get(key) || 0
    if (cur <= 1) this.counts.delete(key)
    else this.counts.set(key, cur - 1)
  }

  has(key: string): boolean {
    return this.counts.has(key)
  }

  toSet(): Set<string> {
    return new Set(this.counts.keys())
  }
}

/**
 * Resolves the target profile name from a delegation tool invocation.
 * Returns null if the tool is not a delegation call or if no profile matches.
 */
export function resolveDelegationTargetProfile(
  toolName: string,
  params: Record<string, unknown> | undefined,
  profiles: Array<{ name: string; display_name?: string }>
): string | null {
  if (!toolName || !(toolName === 'message_agent' || toolName === 'delegate_task' || toolName.includes('bot_mode_dm'))) {
    return null
  }
  const rawTarget = typeof params?.target === 'string' ? params.target : (typeof params?.to === 'string' ? params.to : '')
  if (!rawTarget) return null
  const cleanTarget = rawTarget.trim().replace(/^@/, '').toLowerCase()
  const matched = profiles.find(p =>
    p.name.toLowerCase() === cleanTarget ||
    p.display_name?.toLowerCase() === cleanTarget ||
    cleanTarget.includes(p.name.toLowerCase())
  )
  return matched ? matched.name : null
}

/**
 * Resolves the profile that sent a bot-to-bot delegation message.
 *
 * Hermes attributes these as `Message from 🤖 <friendly name> (@<handle>):`.
 * The primary Bot's handle is always `hermes` while its canonical profile name
 * is `default`, and `display_name` is only set once the user renames it — so a
 * handle/name match alone never resolves the default profile, and the avatar
 * falls back to an initials square.
 */
export function resolveDelegationSenderProfile<T extends { name: string; display_name?: string }>(
  handle: string,
  senderName: string,
  profiles: T[] | undefined,
): T | undefined {
  const list = profiles || []
  const isName = (candidate: string | undefined, value: string) => Boolean(candidate) && candidate!.trim().toLowerCase() === value
  const wantedHandle = handle.trim().toLowerCase()
  const wantedName = senderName.trim().toLowerCase()
  return list.find(profile => isName(profile.name, wantedHandle) || isName(profile.display_name, wantedHandle))
    ?? list.find(profile => isName(profile.name, wantedName) || isName(profile.display_name, wantedName))
    ?? (wantedHandle === 'hermes' || wantedName === 'hermes'
      ? list.find(profile => isName(profile.name, 'default') || isName(profile.display_name, 'default'))
      : undefined)
}

/**
 * Determines whether an in-flight optimistic user message is already represented
 * in the cached transcript, avoiding duplicate prompt flashes upon chat re-entry.
 */
export function isOptimisticUserMessageAlreadyCached(
  cached: Array<{ id: number | string; role: string; content: string }> | undefined,
  userMessage: { id: number | string; role: string; content: string } | undefined
): boolean {
  if (!cached || !userMessage || cached.length === 0) return false
  if (cached.some(m => m.id === userMessage.id)) return true
  const lastCached = cached[cached.length - 1]
  return Boolean(
    lastCached &&
    lastCached.role === 'user' &&
    lastCached.content.trim() === userMessage.content.trim()
  )
}

/**
 * Determines whether local optimistic messages must be protected from being
 * overwritten by an empty `[]` response during an active or recent backend turn.
 */
export function shouldRetainLocalMessages(
  incomingLoaded: Array<{ id: number | string; role: string; content: string }>,
  existingCached: Array<{ id: number | string; role: string; content: string }>,
  isTurnActive: boolean
): boolean {
  if (incomingLoaded.length > 0) return false
  return existingCached.length > 0 || isTurnActive
}

export function restorePersistedActiveTurns(raw: string | null, maxAgeMs = 15 * 60 * 1000): Record<string, ActiveBotTurn> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, ActiveBotTurn>
    if (!parsed || typeof parsed !== 'object') return {}
    const now = Date.now()
    const valid: Record<string, ActiveBotTurn> = {}
    for (const [key, turn] of Object.entries(parsed)) {
      if (
        turn &&
        typeof turn.profile === 'string' &&
        typeof turn.startedAt === 'number' &&
        now - turn.startedAt < maxAgeMs
      ) {
        valid[key] = {
          ...turn,
          restored: true,
          toolActivities: Array.isArray(turn.toolActivities) ? turn.toolActivities : [],
          streamingText: typeof turn.streamingText === 'string' ? turn.streamingText : '',
          statusText: typeof turn.statusText === 'string' ? turn.statusText : 'Working…',
        }
      }
    }
    return valid
  } catch {
    return {}
  }
}

/**
 * Determines whether a specific active turn has genuinely completed according to
 * the conversation transcript.
 *
 * A turn is NOT considered settled merely because an older assistant response exists
 * in SQLite from a prior turn. It is only settled if:
 * 1. The turn's specific userMessage has been answered by an assistant message appearing AFTER it.
 * 2. Or, if no userMessage is tracked (e.g. background/delegated turn), the transcript ends with an
 *    assistant message whose timestamp is >= the turn's startedAt timestamp.
 * 3. Or, for turns restored from local storage across app restarts, the transcript already contains
 *    a completed assistant response.
 *
 * In-flight client turns and actively running gateway tasks are NEVER considered settled.
 */
export function isTurnSettledByTranscript(
  turn: ActiveBotTurn | undefined,
  transcript: Array<{ role: string; timestamp?: number | string; id?: number | string; content?: string }> | undefined,
  isInFlight = false
): boolean {
  if (!turn) return false
  if (isInFlight) return false
  if (turn.status === 'waiting' || turn.needsInput === true || Boolean(turn.pendingClarify)) {
    return false
  }
  if (!transcript || transcript.length === 0) return false

  const last = transcript[transcript.length - 1]
  if (last.role !== 'assistant') return false

  // If a specific userMessage was dispatched with this turn:
  if (turn.userMessage && turn.userMessage.content?.trim()) {
    let userMsgIdx = -1
    for (let i = transcript.length - 1; i >= 0; i--) {
      const m = transcript[i]
      if (
        m.id === turn.userMessage.id ||
        (m.role === 'user' && typeof m.content === 'string' && m.content.trim() === turn.userMessage.content.trim())
      ) {
        userMsgIdx = i
        break
      }
    }
    if (userMsgIdx >= 0) {
      return transcript.slice(userMsgIdx + 1).some(m => m.role === 'assistant')
    }
    return false
  }

  // If no userMessage is tracked (e.g. background delegated task):
  // Check whether the final assistant message timestamp is >= turn.startedAt
  // Normalizes both to whole seconds to handle SQLite integer second timestamp precision
  if (turn.startedAt && last.timestamp != null) {
    const rawTime = typeof last.timestamp === 'number'
      ? last.timestamp
      : Number(new Date(last.timestamp).getTime())
    const lastTimeSec = rawTime > 1e11 ? Math.floor(rawTime / 1000) : Math.floor(rawTime)
    const turnStartSec = Math.floor(turn.startedAt / 1000)
    if (!Number.isNaN(lastTimeSec)) {
      return lastTimeSec >= turnStartSec
    }
  }

  // If restored from storage across app restarts without a newer timestamp
  return Boolean(turn.restored)
}

/**
 * Decides whether opening a chat presents a working state.
 *
 * A live turn (local submit or a dispatched delegation) always shows: the roster
 * pip never consulted the cached transcript, so both surfaces must agree or the
 * animation vanishes the moment the chat opens. A turn restored from storage is
 * suppressed only when its own transcript already settled — that is how a turn
 * which finished while the app was closed is recognised.
 */
export function shouldShowWorkingIndicator(
  turn: ActiveBotTurn | undefined,
  isCachedTranscriptSettled: boolean,
): boolean {
  return Boolean(turn) && !(turn!.restored === true && isCachedTranscriptSettled)
}

export function reconcileActiveTurns(
  currentTurns: Record<string, ActiveBotTurn>,
  activeSessions: Array<{ id: string; session_key?: string; status: string; started_at?: number }>,
  sessionToProfileMap: Record<string, string>,
  now = Date.now(),
  endedSessionIds?: Set<string>,
  inFlightClientProfiles?: Set<string>
): Record<string, ActiveBotTurn> {
  const next: Record<string, ActiveBotTurn> = { ...currentTurns }
  const activeProfilesFromGateway = new Set<string>()
  const explicitlyIdleProfiles = new Set<string>()

  // Map session IDs present in currentTurns directly to profiles
  const turnSessionIdToProfile: Record<string, string> = {}
  for (const [prof, turn] of Object.entries(currentTurns)) {
    if (turn?.sessionId) {
      turnSessionIdToProfile[turn.sessionId] = turn.profile || prof
    }
  }

  for (const session of activeSessions) {
    const sid = session.session_key || session.id
    if (endedSessionIds?.has(sid) || endedSessionIds?.has(session.id)) continue
    const profile = sessionToProfileMap[sid] || sessionToProfileMap[session.id] || turnSessionIdToProfile[sid] || turnSessionIdToProfile[session.id]
    if (!profile) continue

    if (isSessionStatusWorking(session.status)) {
      activeProfilesFromGateway.add(profile)
      const existing = next[profile]
      const isGatewayWaiting = session.status === 'waiting'
      if (!existing) {
        next[profile] = {
          sessionId: sid,
          profile,
          status: isGatewayWaiting ? 'waiting' : session.status === 'working' ? 'tool' : 'thinking',
          statusText: isGatewayWaiting ? 'Needs your input…' : session.status === 'working' ? 'Working…' : 'Thinking…',
          needsInput: isGatewayWaiting,
          streamingText: '',
          toolActivities: [],
          userMessage: { id: 0, role: 'user', content: '' },
          startedAt: session.started_at ? session.started_at * 1000 : now,
        }
      } else if (isGatewayWaiting && existing.status !== 'waiting') {
        next[profile] = {
          ...existing,
          status: 'waiting',
          statusText: 'Needs your input…',
          needsInput: true,
        }
      } else if (!isGatewayWaiting && existing.status === 'waiting' && !existing.pendingClarify) {
        next[profile] = {
          ...existing,
          status: session.status === 'working' ? 'tool' : 'thinking',
          statusText: session.status === 'working' ? 'Working…' : 'Thinking…',
          needsInput: false,
        }
      }
    } else {
      explicitlyIdleProfiles.add(profile)
    }
  }

  // Any turn in currentTurns that is NOT confirmed as working on the gateway must be cleared,
  // unless it was initiated in this client session within the last 4 seconds (optimistic spin-up)
  // or is currently being actively executed by this client's streaming submission pipeline.
  for (const [key, turn] of Object.entries(next)) {
    const profile = turn?.profile || key
    if (!turn) {
      delete next[key]
      continue
    }
    const isEnded = Boolean(
      (turn.sessionId && (endedSessionIds?.has(turn.sessionId) || endedSessionIds?.has(profile))) ||
      endedSessionIds?.has(profile) ||
      endedSessionIds?.has(key)
    )
    const isGatewayWorking = activeProfilesFromGateway.has(profile) || activeProfilesFromGateway.has(key)
    const isVeryRecentClientTurn = Boolean(turn.startedAt && (now - turn.startedAt < 4000))
    const isInFlightClientTurn = Boolean(
      inFlightClientProfiles?.has(profile) ||
      inFlightClientProfiles?.has(key) ||
      (turn.sessionId && inFlightClientProfiles?.has(turn.sessionId))
    )
    const isExplicitlyIdle = (explicitlyIdleProfiles.has(profile) || explicitlyIdleProfiles.has(key)) && !isGatewayWorking && !isInFlightClientTurn
    const isTurnWaitingInput = turn.status === 'waiting' || turn.needsInput === true

    if (isEnded || (!isTurnWaitingInput && (isExplicitlyIdle || (!isGatewayWorking && !isVeryRecentClientTurn && !isInFlightClientTurn)))) {
      delete next[key]
    }
  }

  return next
}

/**
 * Determines whether a bot on the Bots roster should display an active working indicator.
 * Only returns true if an active turn belongs to this bot's canonical session,
 * a local draft session for this bot, or a dispatched delegation to this bot.
 * Unrelated sessions created in the Sessions tab will NOT trigger the bot's working state.
 */
export function isBotRowWorking(
  profileName: string,
  canonicalSession: { id?: string; resolved_id?: string } | null | undefined,
  activeTurns: Record<string, ActiveBotTurn | undefined>,
  adhocSessionIds?: Set<string>
): ActiveBotTurn | undefined {
  const canonicalIds = new Set<string>()
  if (canonicalSession?.id) canonicalIds.add(canonicalSession.id)
  if (canonicalSession?.resolved_id) canonicalIds.add(canonicalSession.resolved_id)

  const direct = activeTurns[profileName]
  if (direct) {
    const sid = direct.sessionId || ''
    const isExplicitAdhocSession = Boolean(adhocSessionIds && sid && adhocSessionIds.has(sid) && !canonicalIds.has(sid))
    if (!isExplicitAdhocSession) {
      if (direct.status === 'waiting' || direct.needsInput === true) {
        return direct
      }
      const isThisBotSession =
        canonicalIds.size === 0 ||
        (sid && canonicalIds.has(sid)) ||
        sid === `draft:${profileName}` ||
        sid.startsWith(`dispatched:${profileName}`)
      if (isThisBotSession) {
        return direct
      }
    }
  }

  for (const turn of Object.values(activeTurns)) {
    if (!turn) continue
    if (turn.profile === profileName) {
      const sid = turn.sessionId || ''
      const isExplicitAdhocSession = Boolean(adhocSessionIds && sid && adhocSessionIds.has(sid) && !canonicalIds.has(sid))
      if (!isExplicitAdhocSession) {
        if (turn.status === 'waiting' || turn.needsInput === true) {
          return turn
        }
        const isThisBotSession =
          canonicalIds.size === 0 ||
          (sid && canonicalIds.has(sid)) ||
          sid === `draft:${profileName}` ||
          sid.startsWith(`dispatched:${profileName}`)
        if (isThisBotSession) {
          return turn
        }
      }
    }
  }

  return undefined
}

/**
 * Determines whether a session row on the Sessions roster should display an active working indicator.
 * Only returns true if an active turn matches this exact session ID.
 */
export function isSessionRowWorking(
  sessionId: string,
  _sessionProfile: string,
  activeTurns: Record<string, ActiveBotTurn | undefined>
): ActiveBotTurn | undefined {
  const direct = activeTurns[sessionId]
  if (direct && direct.sessionId === sessionId) return direct

  for (const turn of Object.values(activeTurns)) {
    if (turn && turn.sessionId === sessionId) {
      return turn
    }
  }

  return undefined
}

