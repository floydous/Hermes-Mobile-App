import type { LiveMessage } from './hermes'

const STORAGE_PREFIX = 'hermes-msgs-v1:'
const MAX_CACHED_SESSIONS = 15

/**
 * Loads cached session messages from localStorage for instant 0ms restoration.
 */
export function getCachedSessionMessages(sessionId: string): LiveMessage[] | null {
  if (typeof window === 'undefined' || !window.localStorage || !sessionId) return null
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${sessionId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LiveMessage[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
    }
  } catch {}
  return null
}

/**
 * Saves messages for a session to localStorage and maintains cache size bounds.
 */
export function setCachedSessionMessages(sessionId: string, messages: LiveMessage[]): void {
  if (typeof window === 'undefined' || !window.localStorage || !sessionId) return
  if (!Array.isArray(messages) || messages.length === 0) return
  try {
    // Only cache the latest 60 messages per session to keep storage compact
    const compactMessages = messages.length > 60 ? messages.slice(messages.length - 60) : messages
    localStorage.setItem(`${STORAGE_PREFIX}${sessionId}`, JSON.stringify(compactMessages))

    // Manage index of cached session keys
    const indexKey = `${STORAGE_PREFIX}__index__`
    const rawIndex = localStorage.getItem(indexKey)
    let index: string[] = rawIndex ? JSON.parse(rawIndex) : []
    index = [sessionId, ...index.filter(id => id !== sessionId)]
    if (index.length > MAX_CACHED_SESSIONS) {
      const evicted = index.slice(MAX_CACHED_SESSIONS)
      index = index.slice(0, MAX_CACHED_SESSIONS)
      for (const oldId of evicted) {
        localStorage.removeItem(`${STORAGE_PREFIX}${oldId}`)
      }
    }
    localStorage.setItem(indexKey, JSON.stringify(index))
  } catch {}
}

/**
 * Removes cached messages for a specific session.
 */
export function removeCachedSessionMessages(sessionId: string): void {
  if (typeof window === 'undefined' || !window.localStorage || !sessionId) return
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${sessionId}`)
    const indexKey = `${STORAGE_PREFIX}__index__`
    const rawIndex = localStorage.getItem(indexKey)
    if (rawIndex) {
      const index: string[] = JSON.parse(rawIndex)
      localStorage.setItem(indexKey, JSON.stringify(index.filter(id => id !== sessionId)))
    }
  } catch {}
}

/**
 * Determines whether a session row represents an interactive human conversation
 * rather than an automated background run (cron jobs, scheduled tasks, kanban, etc.).
 */
export function isHumanChatSession(
  session: {
    title?: string
    source?: string
    id?: string
    profile?: string
  },
  canonicalSessionIds?: Set<string>
): boolean {
  if (!session) return false

  // Canonical Bot Chats belong strictly to the "Bots" tab, not the "Sessions" tab
  const title = (session.title || '').trim().toLowerCase()
  if (title === 'bot chat') {
    return false
  }

  if (session.id && canonicalSessionIds?.has(session.id)) {
    return false
  }

  const src = (session.source || '').trim().toLowerCase()
  if (src === 'cron' || src === 'task' || src === 'kanban' || src === 'tool' || src === 'oneshot' || src === 'subagent') {
    return false
  }

  if (
    title.startsWith('cron:') ||
    title.startsWith('[cron]') ||
    title.startsWith('cron -') ||
    title.startsWith('cron_') ||
    title.startsWith('task:') ||
    title.startsWith('[task]') ||
    title.startsWith('scheduled task:') ||
    title.includes('cron job') ||
    title.includes('scheduled task')
  ) {
    return false
  }

  const id = (session.id || '').trim().toLowerCase()
  if (id.startsWith('cron:') || id.startsWith('task:')) {
    return false
  }

  return true
}

/**
 * Resolves the true most recent message preview for a session.
 *
 * Hermes backend's SQL query projects `preview` as the FIRST user message (LIMIT 1).
 * In a mobile messaging app, the preview below a contact/bot must reflect the LATEST message
 * in the conversation, not the opening prompt from days or weeks ago.
 */
export function resolveLatestSessionPreview(
  sessionId?: string | null,
  fallbackPreview?: string | null,
  cachedMessages?: Array<{ content?: string; role?: string; timestamp?: number }>,
  serverLastActive?: number | null
): string {
  const getLatestFromList = (msgs: Array<{ content?: string; role?: string; timestamp?: number }>): string | null => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg && msg.role !== 'system' && msg.role !== 'tool' && typeof msg.content === 'string') {
        const text = msg.content
          .replace(/\n*--- (?:Attached Context|Context Warnings) ---\n[\s\S]*$/, '')
          .replace(/(?:--\s*)?\[IMPORTANT:\s*Background process\s+[\s\S]*?\]/gi, '')
          .trim()
        if (text) return text
      }
    }
    return null
  }

  const isCacheFresh = (msgs: Array<{ content?: string; role?: string; timestamp?: number }>): boolean => {
    if (!serverLastActive) return true
    const srvTime = serverLastActive > 1e11 ? serverLastActive : serverLastActive * 1000
    const lastMsg = msgs[msgs.length - 1]
    const lastTime = lastMsg?.timestamp
      ? (lastMsg.timestamp > 1e11 ? lastMsg.timestamp : lastMsg.timestamp * 1000)
      : Date.now()
    // Stale only if the server has activity more than 30s newer than our newest message
    return (srvTime - lastTime) <= 30000
  }

  // 1. Check in-memory cached transcript
  if (cachedMessages && cachedMessages.length > 0 && isCacheFresh(cachedMessages)) {
    const text = getLatestFromList(cachedMessages)
    if (text) return text
  }

  // 2. Check persistent localStorage transcript
  if (sessionId) {
    const persisted = getCachedSessionMessages(sessionId)
    if (persisted && persisted.length > 0 && isCacheFresh(persisted)) {
      const text = getLatestFromList(persisted)
      if (text) return text
    }
  }

  // 3. Fallback to server-provided preview if no fresh transcript is cached yet
  return (fallbackPreview || '').trim()
}
