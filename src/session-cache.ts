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
