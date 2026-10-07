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
        valid[key] = turn
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

  for (const session of activeSessions) {
    const sid = session.session_key || session.id
    if (endedSessionIds?.has(sid) || endedSessionIds?.has(session.id)) continue
    const profile = sessionToProfileMap[sid] || sessionToProfileMap[session.id]
    if (!profile) continue

    if (isSessionStatusWorking(session.status)) {
      activeProfilesFromGateway.add(profile)
      const existing = next[profile]
      if (!existing) {
        next[profile] = {
          profile,
          status: session.status === 'working' ? 'tool' : 'thinking',
          statusText: session.status === 'working' ? 'Working…' : 'Thinking…',
          streamingText: '',
          toolActivities: [],
          userMessage: { id: 0, role: 'user', content: '' },
          startedAt: session.started_at ? session.started_at * 1000 : now,
        }
      }
    }
  }

  // If the gateway returned active sessions, any turn currently stored whose profile
  // is known to the gateway and reported idle should be cleared.
  for (const session of activeSessions) {
    const sid = session.session_key || session.id
    const profile = sessionToProfileMap[sid] || sessionToProfileMap[session.id]
    if (profile && !isSessionStatusWorking(session.status) && !activeProfilesFromGateway.has(profile)) {
      delete next[profile]
    }
  }

  return next
}
