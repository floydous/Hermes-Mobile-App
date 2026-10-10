import type { LiveProfile, LiveSession } from './hermes'
import type { ClarifyRequest } from './components/ClarifyCard'
import type { ActiveBotTurn } from './chat-turn'

const titleize = (value?: string | null) =>
  (value || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => (part[0] ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ') || 'Bot'

/**
 * Determines whether a given session is the canonical 1-on-1 bot chat for a profile.
 * Canonical chats are either drafts ('draft:profileName'), titled 'Bot Chat',
 * match the bot's display name, or match the profile's canonical_session id / resolved_id.
 * Ad-hoc sessions from the Sessions tab return false.
 */
export function isSessionCanonical(
  session: { id?: string; profile?: string; title?: string } | null | undefined,
  profiles: LiveProfile[],
  adhocSessionIds?: Set<string>
): boolean {
  if (!session) return false
  if (session.id && adhocSessionIds?.has(session.id)) return false
  if (session.id?.startsWith('draft:')) return true
  if (session.title === 'Bot Chat') return true
  const profName = session.profile || ''
  const profile = profiles.find(p => p.name === profName)
  if (profile) {
    if (profile.canonical_session) {
      if (session.id && session.id === profile.canonical_session.id) return true
      if (session.id && profile.canonical_session.resolved_id && session.id === profile.canonical_session.resolved_id) return true
    }
    if (session.title && (session.title === profile.display_name || session.title === profile.name || session.title === titleize(profile.name))) {
      return true
    }
  } else if (profName) {
    if (session.title && (session.title === profName || session.title === titleize(profName))) {
      return true
    }
  }
  return false
}

/**
 * Checks whether an in-flight turn belongs to the canonical 1-on-1 bot chat for turnProfile.
 * Ad-hoc sessions from the Sessions tab are NEVER canonical.
 */
export function isTurnCanonicalForProfile(
  turnSessionId: string,
  turnProfile: string,
  profiles: LiveProfile[],
  resolvedIdGetter?: (id: string) => string,
  adhocSessionIds?: Set<string>
): boolean {
  if (!turnSessionId || !turnProfile) return false
  if (adhocSessionIds?.has(turnSessionId)) return false
  if (turnSessionId === `draft:${turnProfile}`) return true
  if (turnSessionId.startsWith(`dispatched:${turnProfile}`)) return true

  const profile = profiles.find(p => p.name === turnProfile)
  if (profile?.canonical_session) {
    const cId = profile.canonical_session.id
    const rId = profile.canonical_session.resolved_id
    if (cId && turnSessionId === cId) return true
    if (rId && turnSessionId === rId) return true
    if (resolvedIdGetter) {
      const resolved = resolvedIdGetter(turnSessionId)
      if (cId && resolved === cId) return true
      if (rId && resolved === rId) return true
    }
  }
  return false
}

/**
 * Checks whether an active view (session) matches the session running a turn.
 * Ensures turns and clarify requests from one session do not leak into another,
 * even when both sessions belong to the same profile (e.g. 'default' or 'researcher').
 */
export function doesSessionMatchTurn(
  session: LiveSession | null | undefined,
  turnSessionId: string,
  turnProfile: string,
  profiles: LiveProfile[],
  resolvedIdGetter?: (id: string) => string,
  adhocSessionIds?: Set<string>
): boolean {
  if (!session) return false
  // 1. Exact session ID match
  if (session.id === turnSessionId) return true
  // 2. Resolved alias / tip ID match
  if (resolvedIdGetter) {
    if (resolvedIdGetter(turnSessionId) === session.id) return true
    if (resolvedIdGetter(session.id) === turnSessionId) return true
  }
  // 3. Canonical bot chat match: both the open session AND the turn must be canonical for the same profile
  const sessionIsCanonical = isSessionCanonical(session, profiles, adhocSessionIds)
  const turnIsCanonical = isTurnCanonicalForProfile(turnSessionId, turnProfile, profiles, resolvedIdGetter, adhocSessionIds)
  if (sessionIsCanonical && turnIsCanonical && session.profile === turnProfile) return true

  return false
}

export interface ClarifyResolutionSources {
  session: LiveSession
  profiles: LiveProfile[]
  activeTurn?: ActiveBotTurn | null
  pendingClarifyBySession: Record<string, ClarifyRequest | undefined>
  pendingClarifyByProfile: Record<string, ClarifyRequest | undefined>
  getPersistedClarify: (sessionId: string, profile?: string | null, isCanonical?: boolean) => ClarifyRequest | null
  adhocSessionIds?: Set<string>
}

/**
 * Resolves the clarify request that strictly belongs to the current session.
 * For ad-hoc sessions, this ONLY resolves if the clarify was issued for this exact sessionId.
 * For canonical bot chats, this resolves clarify requests for that bot's canonical session.
 */
export function resolveMatchingClarify({
  session,
  profiles,
  activeTurn,
  pendingClarifyBySession,
  pendingClarifyByProfile,
  getPersistedClarify,
  adhocSessionIds,
}: ClarifyResolutionSources): ClarifyRequest | null {
  const isCanonical = isSessionCanonical(session, profiles, adhocSessionIds)

  if (isCanonical) {
    const fromTurn = (activeTurn?.pendingClarify && activeTurn.pendingClarify.questions?.length > 0)
      ? activeTurn.pendingClarify
      : null
    return (
      fromTurn ||
      pendingClarifyBySession[session.id] ||
      pendingClarifyByProfile[session.profile] ||
      getPersistedClarify(session.id, session.profile, true)
    )
  }

  // Ad-hoc session: strictly isolate by session.id
  const fromTurn = (activeTurn?.pendingClarify && activeTurn.pendingClarify.sessionId === session.id && activeTurn.pendingClarify.questions?.length > 0)
    ? activeTurn.pendingClarify
    : null
  return fromTurn || pendingClarifyBySession[session.id] || getPersistedClarify(session.id, null, false)
}

export function getPersistedClarify(
  sessionId: string,
  profile?: string | null,
  isCanonical = false
): ClarifyRequest | null {
  if (typeof localStorage === 'undefined') return null
  try {
    if (sessionId) {
      const rawBySession = localStorage.getItem(`hermes-pending-clarify:${sessionId}`)
      if (rawBySession) return JSON.parse(rawBySession) as ClarifyRequest
    }
    if (profile && isCanonical) {
      const rawByProfile = localStorage.getItem(`hermes-pending-clarify:profile:${profile}`)
      if (rawByProfile) return JSON.parse(rawByProfile) as ClarifyRequest
      // Fallback to legacy un-prefixed key
      const rawLegacy = localStorage.getItem(`hermes-pending-clarify:${profile}`)
      if (rawLegacy) return JSON.parse(rawLegacy) as ClarifyRequest
    }
  } catch {}
  return null
}

export function persistClarify(
  req: ClarifyRequest,
  profile?: string | null,
  isCanonical = false
) {
  if (typeof localStorage === 'undefined') return
  try {
    const str = JSON.stringify(req)
    if (req.sessionId) {
      localStorage.setItem(`hermes-pending-clarify:${req.sessionId}`, str)
    }
    if (profile && isCanonical) {
      localStorage.setItem(`hermes-pending-clarify:profile:${profile}`, str)
      // Keep legacy key in sync for backwards compatibility
      localStorage.setItem(`hermes-pending-clarify:${profile}`, str)
    }
  } catch {}
}

export function clearPersistedClarify(
  sessionId?: string,
  profile?: string | null
) {
  if (typeof localStorage === 'undefined') return
  try {
    if (sessionId) {
      localStorage.removeItem(`hermes-pending-clarify:${sessionId}`)
    }
    if (profile) {
      localStorage.removeItem(`hermes-pending-clarify:profile:${profile}`)
      // Also clean up legacy un-prefixed keys so old state doesn't resurrect
      localStorage.removeItem(`hermes-pending-clarify:${profile}`)
    }
  } catch {}
}
