import { describe, expect, it, beforeEach } from 'vitest'
import {
  deduplicateConsecutiveMessages,
  getCachedSessionMessages,
  isHumanChatSession,
  removeCachedSessionMessages,
  resolveLatestSessionPreview,
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

  it('bounds cached messages to latest 250 items per session', () => {
    const msgs: LiveMessage[] = Array.from({ length: 300 }, (_, i) => ({
      id: i + 1,
      role: 'user',
      content: `msg-${i + 1}`,
    }))

    setCachedSessionMessages('long-session', msgs)
    const cached = getCachedSessionMessages('long-session')
    expect(cached).toHaveLength(250)
    expect(cached?.[0].content).toBe('msg-51')
    expect(cached?.[249].content).toBe('msg-300')
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

  it('identifies human chat sessions vs automated task and cron runs via isHumanChatSession', () => {
    // Human sessions: should return true
    expect(isHumanChatSession({ id: 's1', title: 'Normal conversation', profile: 'default' })).toBe(true)
    expect(isHumanChatSession({ id: 's2', title: 'Research on quantum physics', profile: 'researcher' })).toBe(true)
    expect(isHumanChatSession({ id: 's3', title: 'New chat', profile: 'homework-manager' })).toBe(true)

    // Cron job sessions by source: should return false
    expect(isHumanChatSession({ id: 'c1', title: 'Daily summary', source: 'cron' })).toBe(false)
    expect(isHumanChatSession({ id: 'c2', title: 'Nightly backup', source: 'CRON' })).toBe(false)
    expect(isHumanChatSession({ id: 't1', title: 'Task run', source: 'task' })).toBe(false)
    expect(isHumanChatSession({ id: 'k1', title: 'Board automation', source: 'kanban' })).toBe(false)
    expect(isHumanChatSession({ id: 'o1', title: 'One shot execution', source: 'oneshot' })).toBe(false)

    // Cron and task sessions identified by title prefixes: should return false
    expect(isHumanChatSession({ id: 'x1', title: 'Cron: Morning Briefing' })).toBe(false)
    expect(isHumanChatSession({ id: 'x2', title: '[cron] System healthcheck' })).toBe(false)
    expect(isHumanChatSession({ id: 'x3', title: 'Task: Data sync' })).toBe(false)
    expect(isHumanChatSession({ id: 'x4', title: '[task] Database vacuum' })).toBe(false)
    expect(isHumanChatSession({ id: 'x5', title: 'Daily cron job' })).toBe(false)
    expect(isHumanChatSession({ id: 'x6', title: 'Scheduled Task: Weekly review' })).toBe(false)

    // ID prefixes: should return false
    expect(isHumanChatSession({ id: 'cron:12345', title: 'Untitled' })).toBe(false)
    expect(isHumanChatSession({ id: 'task:job_88', title: 'Run' })).toBe(false)

    // Canonical Bot Chat sessions: should return false (they belong to Bots tab, not Sessions)
    expect(isHumanChatSession({ id: 'b1', title: 'Bot Chat', profile: 'homework-manager' })).toBe(false)
    expect(isHumanChatSession({ id: 'b2', title: 'bot chat', profile: 'default' })).toBe(false)

    // Canonical session IDs in canonicalSessionIds set: should return false
    const canonicalSet = new Set(['canonical-hm-42', 'canonical-def-1'])
    expect(isHumanChatSession({ id: 'canonical-hm-42', title: 'Custom Title', profile: 'homework-manager' }, canonicalSet)).toBe(false)
    expect(isHumanChatSession({ id: 'other-session', title: 'Custom Title', profile: 'homework-manager' }, canonicalSet)).toBe(true)
  })

  it('resolves the true most recent message preview instead of the initial prompt', () => {
    const historicalMessages: LiveMessage[] = [
      { id: 1, role: 'user', content: 'Initial opening prompt from days ago' },
      { id: 2, role: 'assistant', content: 'Initial reply' },
      { id: 3, role: 'user', content: 'Follow-up question' },
      { id: 4, role: 'assistant', content: 'Proses pengiriman ke @hermes telah selesai (status settled).' },
    ]

    // Case 1: In-memory cached messages provide the true latest message
    const preview1 = resolveLatestSessionPreview(
      'sess-hm',
      'Initial opening prompt from days ago',
      historicalMessages
    )
    expect(preview1).toBe('Proses pengiriman ke @hermes telah selesai (status settled).')

    // Case 2: Persistent localStorage cache provides the true latest message
    setCachedSessionMessages('sess-persisted', historicalMessages)
    const preview2 = resolveLatestSessionPreview(
      'sess-persisted',
      'Initial opening prompt from days ago'
    )
    expect(preview2).toBe('Proses pengiriman ke @hermes telah selesai (status settled).')

    // Case 3: Empty cache falls back to server preview
    const preview3 = resolveLatestSessionPreview(
      'sess-empty',
      'Fallback server preview'
    )
    expect(preview3).toBe('Fallback server preview')

    // Case 4: Recent user prompt followed by assistant reply correctly resolves the assistant reply
    const recentTurnMessages: LiveMessage[] = [
      { id: 1, role: 'user', content: 'Oke' },
      { id: 2, role: 'assistant', content: 'Siap! Kapan pun kamu butuh bantuan, langsung panggil saja. Selamat beraktivitas!' },
    ]
    setCachedSessionMessages('sess-default', recentTurnMessages)
    const preview4 = resolveLatestSessionPreview(
      'sess-default',
      'Oke'
    )
    expect(preview4).toBe('Siap! Kapan pun kamu butuh bantuan, langsung panggil saja. Selamat beraktivitas!')

    // Case 5: Stale cache fallback when server has significantly newer activity (>30s)
    const oldMessages: LiveMessage[] = [
      { id: 1, role: 'assistant', content: 'Ancient reply', timestamp: 100 },
    ]
    setCachedSessionMessages('sess-ancient', oldMessages)
    const preview5 = resolveLatestSessionPreview(
      'sess-ancient',
      'Remote turn from another client',
      oldMessages,
      999999 // Server last_active is far newer than 100 + 30s
    )
    expect(preview5).toBe('Remote turn from another client')

    // Case 6: Within 30-second boundary (25s difference) -> considered fresh
    const freshMessages: LiveMessage[] = [
      { id: 10, role: 'assistant', content: 'Fresh answer', timestamp: 100 },
    ]
    setCachedSessionMessages('sess-fresh', freshMessages)
    const preview6 = resolveLatestSessionPreview(
      'sess-fresh',
      'Old opening prompt',
      freshMessages,
      125 // 125s - 100s = 25s <= 30s
    )
    expect(preview6).toBe('Fresh answer')

    // Case 7: Past 30-second boundary (35s difference) -> considered stale, uses server fallback
    const preview7 = resolveLatestSessionPreview(
      'sess-fresh',
      'Remote update from server',
      freshMessages,
      135 // 135s - 100s = 35s > 30s
    )
    expect(preview7).toBe('Remote update from server')

    // Case 8: Missing message timestamp (optimistic client turn) -> considered fresh
    const optimisticMessages: LiveMessage[] = [
      { id: -99, role: 'assistant', content: 'Optimistic reply without timestamp' },
    ]
    setCachedSessionMessages('sess-opt', optimisticMessages)
    const preview8 = resolveLatestSessionPreview(
      'sess-opt',
      'Old prompt',
      optimisticMessages,
      Math.floor(Date.now() / 1000)
    )
    expect(preview8).toBe('Optimistic reply without timestamp')
  })

  it('deduplicateConsecutiveMessages collapses identical adjacent assistant messages and preserves rich metadata', () => {
    const duplicated: LiveMessage[] = [
      { id: 1, role: 'user', content: 'hello' },
      // First copy has usage but negative optimistic ID and no timestamp:
      { id: -99, role: 'assistant', content: 'I am here', usage: { total: 150 } },
      // Second copy has authoritative positive SQLite ID and timestamp:
      { id: 42, role: 'assistant', content: 'I am here', timestamp: 1720000 },
      { id: 3, role: 'user', content: 'cool' },
      { id: 4, role: 'assistant', content: 'glad it works' },
    ]

    const deduped = deduplicateConsecutiveMessages(duplicated)
    expect(deduped).toHaveLength(4)
    expect(deduped.map(m => m.id)).toEqual([1, 42, 3, 4])
    // Verify merged metadata survived
    expect(deduped[1].timestamp).toBe(1720000)
    expect(deduped[1].usage).toEqual({ total: 150 })
  })
})
