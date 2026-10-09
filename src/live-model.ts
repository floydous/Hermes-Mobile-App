export type ActivitySession = { id: string; resolved_id?: string; preview?: string; last_active?: number; message_count?: number; title?: string }
export type RosterProfile = {
  name: string
  display_name?: string
  model?: string
  provider?: string
  description?: string
  has_avatar?: boolean
  ui_meta?: { 'hermes-bots'?: { color?: string; image?: string | null; imageKind?: string; shape?: string } }
  canonical_session?: ActivitySession | null
  last_session?: ActivitySession | null
}
export type BotRow = { profile: RosterProfile; session: ActivitySession | null }

export function resolveCanonicalSessionId(session: ActivitySession): string {
  return session.resolved_id || session.id
}

export function buildBotRows(
  profiles: RosterProfile[],
  sessions?: Array<{ id: string; profile: string; preview?: string; last_active?: number; title?: string; resolved_id?: string }>
): BotRow[] {
  return profiles
    .map(profile => {
      let activeSession = profile.canonical_session || null
      if (sessions && Array.isArray(sessions) && activeSession) {
        const canonicalId = resolveCanonicalSessionId(activeSession)
        // Match the canonical Bot Chat row strictly (by lineage tip, session id, or title "Bot Chat")
        // Unrelated sessions (e.g. cron runs, scratchpads) must never displace the canonical Bot Chat
        const updated = sessions.find(s =>
          s.id === canonicalId ||
          s.id === activeSession?.id ||
          (s.profile === profile.name && s.title === 'Bot Chat')
        )
        if (updated) {
          activeSession = {
            ...activeSession,
            id: updated.id,
            resolved_id: updated.resolved_id || undefined,
            preview: updated.preview || activeSession.preview,
            last_active: updated.last_active || activeSession.last_active,
          }
        }
      } else if (!activeSession && sessions && Array.isArray(sessions)) {
        const fallback = sessions.find(s => s.profile === profile.name && s.title === 'Bot Chat')
        if (fallback) activeSession = fallback
      }
      return { profile, session: activeSession }
    })
    .sort((a, b) => (b.session?.last_active || 0) - (a.session?.last_active || 0))
}

export function cleanPreviewSnippet(preview?: string | null): string {
  if (!preview) return ''
  const trimmed = preview.trim()
  const match = trimmed.match(/^Message from (?:🤖\s*([^\n(@:]+?)(?:\s*\(@([A-Za-z0-9_.-]+)\))?|([^\n(@:]+?)\s*\(@([A-Za-z0-9_.-]+)\)):\s*([\s\S]*)$/i)
  if (match) {
    const handle = match[2] || match[4] || match[1] || match[3] || 'agent'
    const body = match[5].trim()
    return `@${handle}: ${body}`
  }
  return trimmed
}
