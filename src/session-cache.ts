import type { LiveMessage, LiveProfile, LiveSession } from './hermes'
import { isPerformanceDiagnosticsEnabled, recordPerformanceEvent } from './remote-logger'

export function parseCachedSessionIndex(rawIndex: string | null): string[] {
  if (!rawIndex) return []
  try {
    const parsed = JSON.parse(rawIndex)
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    }
  } catch {}
  return []
}

export function parseLastReadTimestamp(rawVal: string | null): number | null {
  if (!rawVal) return null
  const num = Number(rawVal)
  return Number.isFinite(num) && num > 0 ? num : null
}

export function areProfilesShallowEqual(a: LiveProfile[], b: LiveProfile[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i]
    const p2 = b[i]
    if (
      p1.name !== p2.name ||
      p1.display_name !== p2.display_name ||
      p1.model !== p2.model ||
      p1.canonical_session?.id !== p2.canonical_session?.id ||
      p1.canonical_session?.resolved_id !== p2.canonical_session?.resolved_id ||
      p1.last_session?.id !== p2.last_session?.id
    ) {
      return false
    }
  }
  return true
}

export function areSessionsShallowEqual(a: LiveSession[], b: LiveSession[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const s1 = a[i]
    const s2 = b[i]
    if (
      s1.id !== s2.id ||
      s1.title !== s2.title ||
      s1.preview !== s2.preview ||
      s1.profile !== s2.profile ||
      s1.model !== s2.model ||
      s1.last_active !== s2.last_active ||
      s1.message_count !== s2.message_count ||
      s1.unread !== s2.unread ||
      s1.unread_count !== s2.unread_count
    ) {
      return false
    }
  }
  return true
}

function isUsageEqual(a?: LiveMessage['usage'], b?: LiveMessage['usage']): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.total === b.total &&
    a.prompt === b.prompt &&
    a.completion === b.completion &&
    a.input === b.input &&
    a.output === b.output &&
    a.reasoning === b.reasoning &&
    a.calls === b.calls &&
    a.model === b.model &&
    a.avg_tps === b.avg_tps &&
    a.avg_latency_s === b.avg_latency_s
  )
}

function isSingleMessageEqual(a: LiveMessage, b: LiveMessage): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.role !== b.role || a.content !== b.content) return false
  if (a.display_content !== b.display_content || a.display_kind !== b.display_kind) return false
  if (a.tool_name !== b.tool_name || a.tool_status !== b.tool_status) return false
  if (a.timestamp !== b.timestamp || a.row_id !== b.row_id || a.local !== b.local) return false
  if (a.duration_s !== b.duration_s || a.reasoning !== b.reasoning || a.token_count !== b.token_count) return false
  if (!isUsageEqual(a.usage, b.usage)) return false
  return true
}

/**
 * Deep-by-value comparison of two message lists.
 * Returns true if both arrays have the same length and identical message IDs, roles, contents,
 * tool status, metadata, and full LiveUsage structures,
 * allowing avoidance of redundant disk serialization and React re-renders.
 */
export function areMessageListsEqual(
  a: LiveMessage[] | undefined | null,
  b: LiveMessage[] | undefined | null
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  if (a.length === 0) return true

  // Fast check: inspect last message first (most likely to change in chat)
  if (!isSingleMessageEqual(a[a.length - 1], b[b.length - 1])) {
    return false
  }

  // Fast check: inspect first message
  if (!isSingleMessageEqual(a[0], b[0])) {
    return false
  }

  // Compare all remaining messages
  for (let i = 0; i < a.length; i++) {
    if (!isSingleMessageEqual(a[i], b[i])) {
      return false
    }
  }

  return true
}

export const areMessageListsShallowEqual = areMessageListsEqual

const STORAGE_PREFIX = 'hermes-msgs-v1:'
export const MAX_CACHED_SESSIONS = 35
export const MAX_MESSAGES_PER_CACHED_SESSION = 80

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
  PENDING_PERSISTENCE_WRITES.delete(sessionId)
  try {
    const perfStart = isPerformanceDiagnosticsEnabled() && typeof performance !== 'undefined' ? performance.now() : 0
    // Cache up to 80 latest messages per session for instant deep scrollback restoration
    const compactMessages = messages.length > MAX_MESSAGES_PER_CACHED_SESSION ? messages.slice(messages.length - MAX_MESSAGES_PER_CACHED_SESSION) : messages
    const serialized = JSON.stringify(compactMessages)

    try {
      localStorage.setItem(`${STORAGE_PREFIX}${sessionId}`, serialized)
    } catch {
      // QuotaExceededError recovery: evict oldest half of cached sessions to free space
      try {
        const indexKey = `${STORAGE_PREFIX}__index__`
        const rawIndex = localStorage.getItem(indexKey)
        let index: string[] = rawIndex ? JSON.parse(rawIndex) : []
        if (index.length > 2) {
          const evictCount = Math.ceil(index.length / 2)
          const toEvict = index.slice(-evictCount)
          index = index.slice(0, -evictCount)
          for (const oldId of toEvict) {
            localStorage.removeItem(`${STORAGE_PREFIX}${oldId}`)
          }
          localStorage.setItem(indexKey, JSON.stringify(index))
          localStorage.setItem(`${STORAGE_PREFIX}${sessionId}`, serialized)
        }
      } catch {}
    }

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

    if (perfStart > 0) {
      const dur = performance.now() - perfStart
      recordPerformanceEvent({
        op: 'storage',
        phase: 'write_messages',
        traceId: sessionId,
        durationMs: Math.round(dur * 100) / 100,
        timestamp: new Date().toISOString(),
        metrics: {
          messageCount: compactMessages.length,
          payloadBytes: serialized.length,
        },
      })
    }
  } catch {}
}

const PENDING_PERSISTENCE_WRITES = new Map<string, LiveMessage[]>()
let persistenceSchedulerId: any = null

/**
 * Coalesces and defers session persistence to idle time so large JSON serialization
 * and SQLite disk writes never collide with React rendering or user touch gestures.
 */
export function scheduleDeferredSessionPersistence(
  sessionIds: string | string[],
  messages: LiveMessage[]
): void {
  if (!sessionIds || !Array.isArray(messages) || messages.length === 0) return
  const ids = Array.isArray(sessionIds) ? sessionIds : [sessionIds]
  for (const id of ids) {
    if (id) PENDING_PERSISTENCE_WRITES.set(id, messages)
  }

  if (persistenceSchedulerId != null) return

  const flush = () => {
    persistenceSchedulerId = null
    const entries = Array.from(PENDING_PERSISTENCE_WRITES.entries())
    PENDING_PERSISTENCE_WRITES.clear()
    for (const [sid, msgs] of entries) {
      setCachedSessionMessages(sid, msgs)
    }
  }

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    persistenceSchedulerId = (window as any).requestIdleCallback(flush, { timeout: 1000 })
  } else {
    persistenceSchedulerId = globalThis.setTimeout(flush, 250)
  }
}

/**
 * Immediately flushes any pending deferred session persistence writes (e.g. before unload).
 */
export function flushDeferredSessionPersistence(): void {
  if (persistenceSchedulerId != null) {
    if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
      (window as any).cancelIdleCallback(persistenceSchedulerId)
    } else {
      globalThis.clearTimeout(persistenceSchedulerId)
    }
    persistenceSchedulerId = null
  }
  const entries = Array.from(PENDING_PERSISTENCE_WRITES.entries())
  PENDING_PERSISTENCE_WRITES.clear()
  for (const [sid, msgs] of entries) {
    setCachedSessionMessages(sid, msgs)
  }
}

/**
 * Removes cached messages for a specific session.
 */
export function removeCachedSessionMessages(sessionId: string): void {
  if (typeof window === 'undefined' || !window.localStorage || !sessionId) return
  PENDING_PERSISTENCE_WRITES.delete(sessionId)
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
          .replace(/\[System:\s*(?:The|Your)?\s*previous\s+(?:response|tool\s+call)\s+was\s+(?:cut\s*off|truncated)[\s\S]*?\]/gi, '')
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

  // 1. Check in-memory cached transcript (0ms, zero disk I/O)
  if (cachedMessages && cachedMessages.length > 0 && isCacheFresh(cachedMessages)) {
    const text = getLatestFromList(cachedMessages)
    if (text) return text
  }

  // 2. Direct fallback to server-provided preview (0ms, zero disk I/O)
  return (fallbackPreview || '').trim()
}

/**
 * Detects synthetic continuation / cutoff nudge scaffolding from the backend
 * (e.g. [System: The previous response was cut off by a network error...]).
 */
export function isContinuationNudge(content: string): boolean {
  if (!content) return false
  const trimmed = content.trim()
  return (
    trimmed.startsWith('[System:') &&
    /previous\s+(?:response|tool\s+call(?:\s*\([^)]*\))?)\s+was\s+(?:cut\s*off|truncated|too\s+large)/i.test(trimmed) &&
    trimmed.endsWith(']')
  )
}

export function cleanContinuationScaffolding(text: string): string {
  if (!text) return ''
  return text
    .replace(/\[The user sent a (?:text )?document:\s*['"][^'"]+['"]\.\s*(?:It is saved at|The file is also saved at):[\s\S]*?\]/gi, '')
    .replace(/\[System:\s*(?:The|Your)?\s*previous\s+(?:response|tool\s+call(?:\s*\([^)]*\))?)\s+was\s+(?:cut\s*off|truncated|too\s+large)[\s\S]*?\]/gi, '')
    .replace(/\[STILL IN PROGRESS\s*[—–-]\s*this is the active request[\s\S]*?do not start over\.?\]/gi, '')
    .replace(/\[PRIOR CONTEXT\s*[—–-]\s*for reference only;?\s*not a new message\.?\]/gi, '')
    .replace(/\[OUT-OF-BAND USER MESSAGE\s*[—–-]\s*a direct message from the user[\s\S]*?conversation history\]/gi, '')
    .replace(/\[\/OUT-OF-BAND USER MESSAGE\]/gi, '')
    .trim()
}

/**
 * Detects synthetic model switch markers injected by Hermes Gateway mid-conversation
 * (e.g. [System: The active model for this chat has changed to ... via provider ...]).
 */
export function isModelSwitchMarker(content: string): boolean {
  if (!content) return false
  const trimmed = content.trim()
  return (
    trimmed.startsWith('[System: The active model for this chat has changed to') ||
    trimmed.startsWith('[System: The model for this session was set to') ||
    /\[System:\s*The (?:active )?model for this (?:chat|session) (?:has changed|was set) to/i.test(trimmed)
  )
}

export function parseModelSwitchNotice(content: string): { model: string; provider?: string } | null {
  if (!content) return null
  const trimmed = content.trim()
  const match = trimmed.match(/\[System:\s*The (?:active )?model for this (?:chat|session) (?:has changed|was set) to\s+([^\s\]]+)(?:\s+via provider\s+([^\s\].]+))?/i)
  if (!match) return null
  return {
    model: match[1],
    provider: match[2]?.replace(/[.]$/, '').trim(),
  }
}

/**
 * Detects synthetic context compaction / conversation summary scaffolding from the backend
 * (e.g. [CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted...).
 */
export function isCompactionSummary(content: string): boolean {
  if (!content) return false
  const trimmed = content.trim()
  return (
    trimmed.startsWith('[CONTEXT COMPACTION') ||
    trimmed.startsWith('[CONTEXT SUMMARY]:') ||
    /\[CONTEXT COMPACTION\s*[—–-]\s*REFERENCE ONLY\]/i.test(trimmed)
  )
}

/**
 * Extracts the authentic user prompt embedded in a context compaction carrier,
 * or returns null if it is a pure handoff summary with no user ask.
 */
export function extractCompactedUserAsk(content: string): string | null {
  if (!content) return null
  const trimmed = content.trim()
  if (!isCompactionSummary(trimmed)) return null

  const stripCompactionHeaders = (s: string) => s
    .replace(/^\s*\[STILL IN PROGRESS\s*[—–-]\s*this is the active request[\s\S]*?do not start over\.?\]\s*/i, '')
    .replace(/^\s*\[PRIOR CONTEXT\s*[—–-]\s*for reference only;?\s*not a new message\.?\]\s*/i, '')
    .trim()

  // 1. Official Hermes Summary End Marker: live user ask follows the boundary
  if (trimmed.includes('--- END OF CONTEXT SUMMARY')) {
    const parts = trimmed.split(/---\s*END OF CONTEXT SUMMARY[^\n]*---/i)
    if (parts.length > 1 && parts[1].trim()) {
      const liveAsk = stripCompactionHeaders(parts[1].trim())
      if (liveAsk) return liveAsk
    }
  }

  // 2. Official Hermes Merged Prior Context: user context precedes the delimiter
  if (trimmed.includes('[END OF PRIOR CONTEXT')) {
    const parts = trimmed.split(/\[END OF PRIOR CONTEXT[^\n]*\]/i)
    if (parts.length > 0 && parts[0].trim()) {
      const liveAsk = stripCompactionHeaders(parts[0].trim())
      if (liveAsk) return liveAsk
    }
  }

  // 3. In-flight task restatement header embedded directly in content
  if (/\[STILL IN PROGRESS\s*[—–-]\s*this is the active request/i.test(trimmed)) {
    const parts = trimmed.split(/\[STILL IN PROGRESS\s*[—–-]\s*this is the active request[\s\S]*?do not start over\.?\]/i)
    if (parts.length > 1 && parts[1].trim()) {
      const restated = stripCompactionHeaders(parts[1].trim())
      if (restated) return restated
    }
  }

  // 4. Other custom delimiter formats
  const delimiterMatch = trimmed.match(/(?:---\s*NEW TURN\s*---|<!--\s*handoff\s*-->|=== END SUMMARY ===)\s*([\s\S]+)$/i)
  if (delimiterMatch && delimiterMatch[1].trim()) {
    return stripCompactionHeaders(delimiterMatch[1].trim())
  }

  // 5. Deterministic Historical Task Snapshot ("User asked: '...'")
  const askMatch = trimmed.match(/User asked(?:\s*\([^)]*\))?:\s*['"]([\s\S]*?)['"](?:\s*Historical|\s*\n|$)/i)
  if (askMatch && askMatch[1].trim()) {
    return stripCompactionHeaders(askMatch[1].trim())
  }

  // 6. Fallback unquoted line after 'User asked:'
  const askFallback = trimmed.match(/User asked(?:\s*\([^)]*\))?:\s*([^\n]+)/i)
  if (askFallback && askFallback[1].trim()) {
    const raw = askFallback[1].trim()
    const unquoted = raw.replace(/^['"`]|['"`]$/g, '').trim()
    if (unquoted) return stripCompactionHeaders(unquoted)
  }

  return null
}

/**
 * Calculates whether a session is unread and the exact numeric unread count.
 * Prevents the sent message race condition: user messages (role: 'user') NEVER
 * increment unread badges. Only incoming assistant responses arriving after
 * lastRead mark a conversation as unread.
 */
export function calculateUnreadState(
  sessionId: string,
  rawLastActive: number | undefined,
  cachedMessages: LiveMessage[] | null | undefined,
  lastReadTimestamp: number,
  isSelected: boolean,
  isWaitingInput = false
): { isUnread: boolean; unreadCount: number } {
  if (isSelected || !sessionId) {
    return { isUnread: false, unreadCount: 0 }
  }

  // If the agent is actively waiting for human input (e.g. clarify request), mark as unread
  if (isWaitingInput) {
    return { isUnread: true, unreadCount: 1 }
  }

  const lastActiveMs = rawLastActive
    ? (rawLastActive > 1e11 ? rawLastActive : rawLastActive * 1000)
    : 0

  let assistantUnreadCount = 0
  if (Array.isArray(cachedMessages) && cachedMessages.length > 0) {
    assistantUnreadCount = cachedMessages.filter(m => {
      if (!m || m.role !== 'assistant') return false
      const msgTime = m.timestamp
        ? (m.timestamp > 1e11 ? m.timestamp : m.timestamp * 1000)
        : 0
      return msgTime > lastReadTimestamp
    }).length

    const isUnread = assistantUnreadCount > 0
    return { isUnread, unreadCount: assistantUnreadCount }
  }

  // If messages are not cached in memory yet, rely on server lastActive timestamp
  const isUnread = lastActiveMs > 0 && lastActiveMs > lastReadTimestamp
  return { isUnread, unreadCount: isUnread ? 1 : 0 }
}

/**
 * Collapses consecutive identical assistant messages to prevent duplicate rendering in chat,
 * preserving authoritative timestamps, positive SQLite message IDs, and usage statistics.
 */
export function deduplicateConsecutiveMessages(messages: LiveMessage[]): LiveMessage[] {
  if (!Array.isArray(messages) || messages.length <= 1) return messages
  const result: LiveMessage[] = []
  for (const msg of messages) {
    const prev = result[result.length - 1]
    if (prev && prev.role === 'assistant' && msg.role === 'assistant' && prev.content === msg.content) {
      // Merge rich metadata from both copies (authoritative SQLite ID, timestamp, token usage)
      result[result.length - 1] = {
        ...prev,
        ...msg,
        id: (prev.id > 0 ? prev.id : msg.id > 0 ? msg.id : prev.id),
        timestamp: prev.timestamp || msg.timestamp,
        usage: prev.usage || msg.usage,
      }
      continue
    }
    // Also deduplicate consecutive tool messages with identical content (e.g. clarify tool output)
    if (prev && prev.role === 'tool' && msg.role === 'tool' && (prev.tool_name === msg.tool_name || (prev as any).name === (msg as any).name) && prev.content === msg.content) {
      result[result.length - 1] = {
        ...prev,
        ...msg,
        id: (prev.id > 0 ? prev.id : msg.id > 0 ? msg.id : prev.id),
        timestamp: prev.timestamp || msg.timestamp,
      }
      continue
    }
    result.push(msg)
  }
  return result
}

