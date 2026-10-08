import { describe, expect, it, beforeEach } from 'vitest'
import {
  getCachedSessionMessages,
  removeCachedSessionMessages,
  setCachedSessionMessages,
} from './session-cache'
import type { LiveMessage } from './hermes'

describe('session-cache message caching and eviction', () => {
  const store = new Map<string, string>()
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => { store.set(key, String(val)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }

  beforeEach(() => {
    store.clear()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).localStorage = mockStorage
  })

  it('stores and retrieves cached session messages', () => {
    const msgs: LiveMessage[] = [
      { id: 1, role: 'user', content: 'hello' },
      { id: 2, role: 'assistant', content: 'hi there' },
    ]

    setCachedSessionMessages('session-1', msgs)
    const cached = getCachedSessionMessages('session-1')
    expect(cached).toEqual(msgs)
  })

  it('returns null for nonexistent or empty sessions', () => {
    expect(getCachedSessionMessages('missing')).toBeNull()
    setCachedSessionMessages('empty', [])
    expect(getCachedSessionMessages('empty')).toBeNull()
  })

  it('removes cached session messages', () => {
    const msgs: LiveMessage[] = [{ id: 1, role: 'user', content: 'test' }]
    setCachedSessionMessages('session-to-del', msgs)
    expect(getCachedSessionMessages('session-to-del')).toEqual(msgs)

    removeCachedSessionMessages('session-to-del')
    expect(getCachedSessionMessages('session-to-del')).toBeNull()
  })

  it('bounds cached messages to latest 60 items per session', () => {
    const msgs: LiveMessage[] = Array.from({ length: 80 }, (_, i) => ({
      id: i + 1,
      role: 'user',
      content: `msg-${i + 1}`,
    }))

    setCachedSessionMessages('long-session', msgs)
    const cached = getCachedSessionMessages('long-session')
    expect(cached).toHaveLength(60)
    expect(cached?.[0].content).toBe('msg-21')
    expect(cached?.[59].content).toBe('msg-80')
  })

  it('evicts oldest sessions when exceeding MAX_CACHED_SESSIONS', () => {
    for (let i = 1; i <= 17; i++) {
      setCachedSessionMessages(`session-${i}`, [{ id: i, role: 'user', content: `text-${i}` }])
    }

    // Sessions 1 and 2 should have been evicted (limit is 15)
    expect(getCachedSessionMessages('session-1')).toBeNull()
    expect(getCachedSessionMessages('session-2')).toBeNull()
    // Recent sessions should still be cached
    expect(getCachedSessionMessages('session-17')).toHaveLength(1)
    expect(getCachedSessionMessages('session-16')).toHaveLength(1)
  })
})
