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
  status: 'thinking' | 'streaming' | 'tool'
  statusText: string
  streamingText: string
  toolActivities: ToolActivity[]
  userMessage: { id: number; role: 'user' | 'assistant' | 'tool' | 'system'; content: string }
  startedAt: number
}

/** Rejects events and completions from a turn that no longer owns the visible chat. */
export function isActiveChatTurn(turnId: number, currentTurnId: number, expected: ChatSessionIdentity, current: ChatSessionIdentity | null): boolean {
  return turnId === currentTurnId && current?.id === expected.id && current.profile === expected.profile
}

export function isSessionStatusWorking(status: string): boolean {
  const norm = (status || '').trim().toLowerCase()
  return norm === 'working' || norm === 'starting' || norm === 'waiting'
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

export function reconcileActiveTurns(
  currentTurns: Record<string, ActiveBotTurn>,
  activeSessions: Array<{ id: string; session_key?: string; status: string; started_at?: number }>,
  sessionToProfileMap: Record<string, string>,
  now = Date.now(),
  endedSessionIds?: Set<string>
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
      if (!existing) {
        next[profile] = {
          sessionId: sid,
          profile,
          status: session.status === 'working' ? 'tool' : 'thinking',
          statusText: session.status === 'working' ? 'Working…' : 'Thinking…',
          streamingText: '',
          toolActivities: [],
          userMessage: { id: 0, role: 'user', content: '' },
          startedAt: session.started_at ? session.started_at * 1000 : now,
        }
      }
    } else {
      explicitlyIdleProfiles.add(profile)
    }
  }

  // Any turn in currentTurns that is NOT confirmed as working on the gateway must be cleared,
  // unless it was initiated in this client session within the last 4 seconds (optimistic spin-up).
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
    const isExplicitlyIdle = explicitlyIdleProfiles.has(profile) || explicitlyIdleProfiles.has(key)
    const isGatewayWorking = activeProfilesFromGateway.has(profile) || activeProfilesFromGateway.has(key)
    const isVeryRecentClientTurn = turn.startedAt && (now - turn.startedAt < 4000)

    if (isEnded || isExplicitlyIdle || (!isGatewayWorking && !isVeryRecentClientTurn)) {
      delete next[key]
    }
  }

  return next
}
