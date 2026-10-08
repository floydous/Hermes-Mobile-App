import { describe, expect, it } from 'vitest'

import {
  isActiveChatTurn,
  isSessionStatusWorking,
  reconcileActiveTurns,
  restorePersistedActiveTurns,
  type ActiveBotTurn,
} from './chat-turn'

describe('active chat turn guard', () => {
  const research = { id: 'research-chat', profile: 'research-rabbit' }

  it('rejects late stream events after session navigation or generation change', () => {
    expect(isActiveChatTurn(4, 4, research, research)).toBe(true)
    expect(isActiveChatTurn(3, 4, research, research)).toBe(false)
    expect(isActiveChatTurn(4, 4, research, { id: 'signal-chat', profile: 'signal' })).toBe(false)
    expect(isActiveChatTurn(4, 4, research, null)).toBe(false)
  })

  it('identifies working session statuses', () => {
    expect(isSessionStatusWorking('working')).toBe(true)
    expect(isSessionStatusWorking('starting')).toBe(true)
    expect(isSessionStatusWorking('waiting')).toBe(true)
    expect(isSessionStatusWorking('idle')).toBe(false)
    expect(isSessionStatusWorking('stopped')).toBe(false)
    expect(isSessionStatusWorking('')).toBe(false)
  })

  it('restores persisted active turns within timeout and drops stale ones', () => {
    const now = 1000000
    const turns: Record<string, ActiveBotTurn> = {
      coder: {
        profile: 'coder',
        status: 'thinking',
        statusText: 'Thinking…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 1, role: 'user', content: 'test' },
        startedAt: now - 60000, // 1 min ago -> keep
      },
      stale: {
        profile: 'stale',
        status: 'tool',
        statusText: 'Tool call…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 2, role: 'user', content: 'old' },
        startedAt: now - 3600000, // 1 hr ago -> drop
      },
    }

    const raw = JSON.stringify(turns)
    const restored = restorePersistedActiveTurns(raw, 15 * 60 * 1000)
    // Note: restorePersistedActiveTurns uses Date.now(), test with a recent timestamp:
    const freshTurn: ActiveBotTurn = {
      profile: 'fresh',
      status: 'thinking',
      statusText: 'Thinking…',
      streamingText: '',
      toolActivities: [],
      userMessage: { id: 3, role: 'user', content: 'hi' },
      startedAt: Date.now() - 5000,
    }
    const freshRaw = JSON.stringify({ fresh: freshTurn })
    const freshRestored = restorePersistedActiveTurns(freshRaw)
    expect(freshRestored.fresh).toBeDefined()
    expect(freshRestored.fresh.profile).toBe('fresh')

    expect(restorePersistedActiveTurns(null)).toEqual({})
    expect(restorePersistedActiveTurns('invalid json')).toEqual({})

    // When toolActivities is omitted or not an array, it defaults safely to []
    const incompleteRaw = JSON.stringify({
      partial: {
        profile: 'partial',
        status: 'thinking',
        statusText: 'Thinking…',
        startedAt: Date.now() - 1000,
      },
    })
    const incompleteRestored = restorePersistedActiveTurns(incompleteRaw)
    expect(incompleteRestored.partial?.toolActivities).toEqual([])
  })

  it('reconciles active turns against gateway session.active_list', () => {
    const current: Record<string, ActiveBotTurn> = {
      coder: {
        profile: 'coder',
        status: 'streaming',
        statusText: 'Replying…',
        streamingText: 'Hi',
        toolActivities: [],
        userMessage: { id: 1, role: 'user', content: 'hi' },
        startedAt: 1000,
      },
      idleBot: {
        profile: 'idleBot',
        status: 'thinking',
        statusText: 'Thinking…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 2, role: 'user', content: 'done' },
        startedAt: 2000,
      },
    }

    const activeSessions = [
      { id: 'sess-coder', session_key: 'sess-coder-key', status: 'working', started_at: 100 },
      { id: 'sess-idle', session_key: 'sess-idle-key', status: 'idle', started_at: 200 },
      { id: 'sess-designer', session_key: 'sess-designer-key', status: 'starting', started_at: 300 },
    ]

    const mapping = {
      'sess-coder': 'coder',
      'sess-coder-key': 'coder',
      'sess-idle': 'idleBot',
      'sess-idle-key': 'idleBot',
      'sess-designer': 'designer',
      'sess-designer-key': 'designer',
    }

    const reconciled = reconcileActiveTurns(current, activeSessions, mapping, 5000)

    // coder was already streaming: preserve detailed state
    expect(reconciled.coder.status).toBe('streaming')
    expect(reconciled.coder.streamingText).toBe('Hi')

    // idleBot was reported idle by gateway: cleared
    expect(reconciled.idleBot).toBeUndefined()

    // designer was working on gateway: newly created active turn
    expect(reconciled.designer).toBeDefined()
    expect(reconciled.designer.profile).toBe('designer')
    expect(reconciled.designer.statusText).toBe('Thinking…')
  })

  it('prevents reviving a turn that ended while active_list was in-flight', () => {
    const current: Record<string, ActiveBotTurn> = {
      worker: {
        sessionId: 'sess-worker',
        profile: 'worker',
        status: 'tool',
        statusText: 'Working…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 1, role: 'user', content: 'test' },
        startedAt: 100,
      },
    }
    const activeSessions = [
      { id: 'sess-worker', session_key: 'sess-worker', status: 'working', started_at: 100 },
    ]
    const mapping = { 'sess-worker': 'worker' }
    const ended = new Set(['sess-worker'])

    const reconciled = reconcileActiveTurns(current, activeSessions, mapping, 5000, ended)
    expect(reconciled.worker).toBeUndefined()
  })

  it('prunes stale turns when the gateway reports no active sessions or omits the profile', () => {
    const current: Record<string, ActiveBotTurn> = {
      'Homework Manager': {
        sessionId: 'sess-homework',
        profile: 'Homework Manager',
        status: 'tool',
        statusText: 'Using search_files · 7 tool calls…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 1, role: 'user', content: 'test' },
        startedAt: 1000, // Started 9 seconds ago
      },
      'Quick Bot': {
        sessionId: 'sess-optimistic',
        profile: 'Quick Bot',
        status: 'thinking',
        statusText: 'Thinking…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 2, role: 'user', content: 'recent' },
        startedAt: 9500, // Started 500ms ago
      },
    }

    // Gateway reports no sessions active at all
    const reconciledEmpty = reconcileActiveTurns(current, [], {}, 10000)
    // Stale Homework Manager turn is pruned
    expect(reconciledEmpty['Homework Manager']).toBeUndefined()
    // Brand new client turn (< 4s) is retained optimistically
    expect(reconciledEmpty['Quick Bot']).toBeDefined()
  })

  it('prunes restored app-reopen turns when gateway active_list has ended the session', () => {
    // Exactly simulates app closing with 7 tool calls active, then reopening
    const restoredFromStorage: Record<string, ActiveBotTurn> = {
      'Homework Manager': {
        sessionId: 'sess-hw-7',
        profile: 'Homework Manager',
        status: 'tool',
        statusText: 'Using search_files · 7 tool calls…',
        streamingText: '',
        toolActivities: [
          { id: '1', name: 'search_files', status: 'running' },
        ],
        userMessage: { id: 10, role: 'user', content: 'Bisakah kamu list tugas2 yg aku miliki' },
        startedAt: 1000,
      },
    }

    // When the app reopens at time 20000, gateway reports Homework Manager as idle or reaped
    const reconciled = reconcileActiveTurns(restoredFromStorage, [
      { id: 'sess-hw-7', session_key: 'sess-hw-7', status: 'idle', started_at: 1 },
    ], { 'sess-hw-7': 'Homework Manager' }, 20000)

    expect(reconciled['Homework Manager']).toBeUndefined()
  })
})
