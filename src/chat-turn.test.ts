import { describe, expect, it } from 'vitest'

import {
  InFlightSubmissionTracker,
  isActiveChatTurn,
  isBotRowWorking,
  isOptimisticUserMessageAlreadyCached,
  isSessionRowWorking,
  isSessionStatusWorking,
  isTurnSettledByTranscript,
  reconcileActiveTurns,
  resolveDelegationSenderProfile,
  resolveDelegationTargetProfile,
  restorePersistedActiveTurns,
  shouldShowWorkingIndicator,
  shouldRetainLocalMessages,
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

  it('preserves client turns actively in-flight regardless of 4s threshold', () => {
    const current: Record<string, ActiveBotTurn> = {
      'InFlightBot': {
        sessionId: 'sess-active-submission',
        profile: 'InFlightBot',
        status: 'thinking',
        statusText: 'Thinking…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 10, role: 'user', content: 'test prompt' },
        startedAt: 1000,
      },
    }

    // After 10 seconds (well past the 4000ms threshold), gateway hasn't reported it yet
    const inFlightSet = new Set<string>(['InFlightBot'])
    const reconciled = reconcileActiveTurns(current, [], {}, 15000, undefined, inFlightSet)

    // Because it is in the active client submission pipeline, it must NOT be pruned!
    expect(reconciled['InFlightBot']).toBeDefined()
    expect(reconciled['InFlightBot'].statusText).toBe('Thinking…')
  })

  it('safely handles reference-counted overlapping client submissions with InFlightSubmissionTracker', () => {
    const tracker = new InFlightSubmissionTracker()

    // Two submissions launched for the same profile
    tracker.start('BotA')
    tracker.start('BotA')
    expect(tracker.has('BotA')).toBe(true)

    // First submission finishes -> tracker still has BotA!
    tracker.end('BotA')
    expect(tracker.has('BotA')).toBe(true)

    const current: Record<string, ActiveBotTurn> = {
      'BotA': {
        profile: 'BotA',
        status: 'thinking',
        statusText: 'Thinking…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 1, role: 'user', content: 'test' },
        startedAt: 1000,
      },
    }
    const reconciled = reconcileActiveTurns(current, [], {}, 10000, undefined, tracker.toSet())
    expect(reconciled['BotA']).toBeDefined()

    // Second submission finishes -> properly cleared
    tracker.end('BotA')
    expect(tracker.has('BotA')).toBe(false)
  })

  it('does not prune active turns if inFlightClientProfiles is set even when an idle session is reported', () => {
    const current: Record<string, ActiveBotTurn> = {
      researcher: {
        sessionId: 'sess-researcher-active',
        profile: 'researcher',
        status: 'tool',
        statusText: 'Working…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 1, role: 'user', content: 'test' },
        startedAt: 1000,
      },
    }
    // Gateway reports an older session as idle
    const activeSessions = [
      { id: 'sess-researcher-old', session_key: 'key-old', status: 'idle', started_at: 500 },
    ]
    const mapping = {
      'sess-researcher-old': 'researcher',
      'key-old': 'researcher',
    }
    const inFlight = new Set(['researcher'])

    const reconciled = reconcileActiveTurns(current, activeSessions, mapping, 10000, undefined, inFlight)
    expect(reconciled.researcher).toBeDefined()
    expect(reconciled.researcher.status).toBe('tool')
  })

  it('preserves working status when one session is idle and another is actively working', () => {
    const current: Record<string, ActiveBotTurn> = {
      researcher: {
        sessionId: 'sess-researcher-active',
        profile: 'researcher',
        status: 'tool',
        statusText: 'Working…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 1, role: 'user', content: 'test' },
        startedAt: 1000,
      },
    }
    const activeSessions = [
      { id: 'sess-researcher-old', session_key: 'key-old', status: 'idle', started_at: 500 },
      { id: 'sess-researcher-active', session_key: 'key-active', status: 'working', started_at: 1000 },
    ]
    const mapping = {
      'sess-researcher-old': 'researcher',
      'key-old': 'researcher',
      'sess-researcher-active': 'researcher',
      'key-active': 'researcher',
    }

    const reconciled = reconcileActiveTurns(current, activeSessions, mapping, 10000)
    expect(reconciled.researcher).toBeDefined()
    expect(reconciled.researcher.status).toBe('tool')
    expect(reconciled.researcher.statusText).toBe('Working…')
    expect(reconciled.researcher.sessionId).toBe('sess-researcher-active')

    // Once in-flight tracking ends and all sessions are idle, it must be cleanly pruned
    const idleOnlySessions = [
      { id: 'sess-researcher-old', session_key: 'key-old', status: 'idle', started_at: 500 },
      { id: 'sess-researcher-active', session_key: 'key-active', status: 'idle', started_at: 1000 },
    ]
    const pruned = reconcileActiveTurns(reconciled, idleOnlySessions, mapping, 20000)
    expect(pruned.researcher).toBeUndefined()
  })

  it('resolves multi-agent delegation target profiles correctly', () => {
    const profiles = [
      { name: 'homework-manager', display_name: 'Homework Manager' },
      { name: 'researcher', display_name: 'Dr. Research' },
    ]

    // Matches exact handle
    expect(resolveDelegationTargetProfile('message_agent', { target: 'homework-manager' }, profiles)).toBe('homework-manager')
    // Matches with leading @
    expect(resolveDelegationTargetProfile('message_agent', { target: '@homework-manager' }, profiles)).toBe('homework-manager')
    // Matches by display_name
    expect(resolveDelegationTargetProfile('message_agent', { target: 'Homework Manager' }, profiles)).toBe('homework-manager')
    // Matches delegate_task tool
    expect(resolveDelegationTargetProfile('delegate_task', { target: 'researcher' }, profiles)).toBe('researcher')
    // Returns null for unknown target
    expect(resolveDelegationTargetProfile('message_agent', { target: 'unknown-bot' }, profiles)).toBeNull()
    // Returns null for unrelated tools
    expect(resolveDelegationTargetProfile('search_files', { target: 'homework-manager' }, profiles)).toBeNull()
    // Returns null for missing target
    expect(resolveDelegationTargetProfile('message_agent', {}, profiles)).toBeNull()
  })

  it('resolves the default profile from its @hermes delegation handle', () => {
    // The primary Bot is always @hermes, but its canonical profile name is
    // `default` and it carries no display_name until the user renames it.
    const profiles = [
      { name: 'default' },
      { name: 'homework-manager', display_name: 'Homework Manager' },
    ]

    expect(resolveDelegationSenderProfile('hermes', 'hermes', profiles)?.name).toBe('default')
    expect(resolveDelegationSenderProfile('Hermes', 'Hermes', profiles)?.name).toBe('default')
  })

  it('resolves delegation sender profiles by handle, display name, then profile name', () => {
    const profiles = [
      { name: 'default' },
      { name: 'homework-manager', display_name: 'Homework Manager' },
    ]

    // Exact handle match
    expect(resolveDelegationSenderProfile('homework-manager', 'Homework Manager', profiles)?.name).toBe('homework-manager')
    // Display-name fallback when the handle does not match a profile name
    expect(resolveDelegationSenderProfile('Homework Manager', 'Homework Manager', profiles)?.name).toBe('homework-manager')
    // Renamed default profile resolves through display_name without the alias
    expect(resolveDelegationSenderProfile('Maia', 'Maia', [{ name: 'default', display_name: 'Maia' }])?.name).toBe('default')
    // Unknown sender stays unresolved so the caller falls back to initials
    expect(resolveDelegationSenderProfile('ghost', 'Ghost', profiles)).toBeUndefined()
    // Missing roster never throws
    expect(resolveDelegationSenderProfile('hermes', 'hermes', undefined)).toBeUndefined()
  })

  it('shows the working indicator for a live turn whose cached transcript already settled', () => {
    // Regression: opening a chat suppressed the typing animation because the
    // roster pip never consulted the cache and the chat did.
    const liveTurn = {
      sessionId: 's1', profile: 'homework-manager', status: 'tool' as const,
      statusText: 'Working on task from @hermes…', streamingText: '', toolActivities: [],
      userMessage: { id: -1, role: 'user' as const, content: '' }, startedAt: Date.now(),
    }

    expect(shouldShowWorkingIndicator(liveTurn, true)).toBe(true)
    expect(shouldShowWorkingIndicator(liveTurn, false)).toBe(true)
    expect(shouldShowWorkingIndicator(undefined, true)).toBe(false)
    expect(shouldShowWorkingIndicator(undefined, false)).toBe(false)
  })

  it('suppresses only a restored turn whose transcript already settled', () => {
    const restoredSettled = {
      sessionId: 's1', profile: 'homework-manager', status: 'tool' as const,
      statusText: 'Working…', streamingText: '', toolActivities: [],
      userMessage: { id: -1, role: 'user' as const, content: '' }, startedAt: Date.now(),
      restored: true,
    }

    // The turn finished while the app was closed — its own transcript proves it.
    expect(shouldShowWorkingIndicator(restoredSettled, true)).toBe(false)
    // Still genuinely running, or nothing cached to judge by — keep showing.
    expect(shouldShowWorkingIndicator(restoredSettled, false)).toBe(true)
  })

  it('accurately identifies whether an active turn has settled via isTurnSettledByTranscript', () => {
    const turnWithPrompt: ActiveBotTurn = {
      sessionId: 'sess-1',
      profile: 'homework-manager',
      status: 'tool',
      statusText: 'Working…',
      streamingText: '',
      toolActivities: [],
      userMessage: { id: -100, role: 'user', content: 'Help with math' },
      startedAt: 10000,
    }

    // 1. Older transcript ending with assistant response from prior turn does NOT settle the new turn
    const oldTranscriptEndingWithAssistant = [
      { id: 1, role: 'user', content: 'Earlier chat' },
      { id: 2, role: 'assistant', content: 'Earlier answer', timestamp: 5000 },
    ]
    expect(isTurnSettledByTranscript(turnWithPrompt, oldTranscriptEndingWithAssistant)).toBe(false)

    // 2. Transcript where new prompt is pending (no assistant response after it) does NOT settle
    const pendingTranscript = [
      { id: 1, role: 'user', content: 'Earlier chat' },
      { id: 2, role: 'assistant', content: 'Earlier answer' },
      { id: -100, role: 'user', content: 'Help with math' },
    ]
    expect(isTurnSettledByTranscript(turnWithPrompt, pendingTranscript)).toBe(false)

    // 3. Transcript where new prompt is followed by assistant response DOES settle
    const completedTranscript = [
      { id: 1, role: 'user', content: 'Earlier chat' },
      { id: 2, role: 'assistant', content: 'Earlier answer' },
      { id: -100, role: 'user', content: 'Help with math' },
      { id: 3, role: 'assistant', content: 'Here is math help' },
    ]
    expect(isTurnSettledByTranscript(turnWithPrompt, completedTranscript)).toBe(true)

    // 4. Repeated identical prompt: ensures the LAST occurrence is evaluated, not old history
    const repeatedPromptTranscript = [
      { id: 1, role: 'user', content: 'Help with math' },
      { id: 2, role: 'assistant', content: 'Old math answer' },
      { id: -100, role: 'user', content: 'Help with math' },
    ]
    expect(isTurnSettledByTranscript(turnWithPrompt, repeatedPromptTranscript)).toBe(false)

    // 5. Delegated/background turn with empty userMessage: evaluated by timestamp >= startedAt
    const delegatedTurn: ActiveBotTurn = {
      sessionId: 'sess-delegated',
      profile: 'homework-manager',
      status: 'tool',
      statusText: 'Working on task…',
      streamingText: '',
      toolActivities: [],
      userMessage: { id: -101, role: 'user', content: '' },
      startedAt: 20000, // 20s in ms
    }
    // Assistant message from 10s earlier (epoch seconds: 10): NOT settled
    const delegatedTranscriptOld = [
      { id: 1, role: 'assistant', content: 'Old result', timestamp: 10 },
    ]
    expect(isTurnSettledByTranscript(delegatedTurn, delegatedTranscriptOld)).toBe(false)

    // Assistant message from 25s (epoch seconds: 25): settled!
    const delegatedTranscriptNew = [
      { id: 1, role: 'assistant', content: 'New result', timestamp: 25 },
    ]
    expect(isTurnSettledByTranscript(delegatedTurn, delegatedTranscriptNew)).toBe(true)

    // 5b. Same-second precision: startedAt is 20500ms (second 20 + 500ms),
    // and SQLite timestamp has whole-second precision (integer second 20).
    // Normalization ensures it is recognized as completed in the same second.
    const delegatedTurnSubsecond: ActiveBotTurn = {
      sessionId: 'sess-delegated-subsecond',
      profile: 'homework-manager',
      status: 'tool',
      statusText: 'Working on task…',
      streamingText: '',
      toolActivities: [],
      userMessage: { id: -102, role: 'user', content: '' },
      startedAt: 20500,
    }
    const sameSecondTranscript = [
      { id: 1, role: 'assistant', content: 'Same-second answer', timestamp: 20 },
    ]
    expect(isTurnSettledByTranscript(delegatedTurnSubsecond, sameSecondTranscript)).toBe(true)

    // Prior second (19s) is NOT settled:
    const priorSecondTranscript = [
      { id: 1, role: 'assistant', content: 'Prior-second answer', timestamp: 19 },
    ]
    expect(isTurnSettledByTranscript(delegatedTurnSubsecond, priorSecondTranscript)).toBe(false)

    // 6. In-flight turns are never settled
    expect(isTurnSettledByTranscript(turnWithPrompt, completedTranscript, true)).toBe(false)

    // 7. Undefined or empty
    expect(isTurnSettledByTranscript(undefined, completedTranscript)).toBe(false)
    expect(isTurnSettledByTranscript(turnWithPrompt, [])).toBe(false)

    // 8. Server-assigned positive IDs: optimistic userMessage id is negative (-999),
    // but SQLite persisted messages have positive IDs (10, 11, 12).
    // Content fallback matches the latest user turn, not old history.
    const optimisticTurnNegativeId: ActiveBotTurn = {
      sessionId: 'sess-persisted',
      profile: 'default',
      status: 'tool',
      statusText: 'Working…',
      streamingText: '',
      toolActivities: [],
      userMessage: { id: -999, role: 'user', content: 'Repeated query' },
      startedAt: 100000,
    }
    // Transcript has historical turn 1 (persisted ids 10 & 11), followed by new turn 2 (persisted id 12)
    const persistedTranscriptWithHistoricalRepeat = [
      { id: 10, role: 'user', content: 'Repeated query', timestamp: 80 },
      { id: 11, role: 'assistant', content: 'First answer', timestamp: 85 },
      { id: 12, role: 'user', content: 'Repeated query', timestamp: 100 },
    ]
    // The latest occurrence (id: 12) has NO assistant reply after it -> NOT settled!
    expect(isTurnSettledByTranscript(optimisticTurnNegativeId, persistedTranscriptWithHistoricalRepeat)).toBe(false)

    // Once SQLite receives the second assistant reply (id: 13) -> settled!
    const persistedTranscriptSettled = [
      ...persistedTranscriptWithHistoricalRepeat,
      { id: 13, role: 'assistant', content: 'Second answer', timestamp: 105 },
    ]
    expect(isTurnSettledByTranscript(optimisticTurnNegativeId, persistedTranscriptSettled)).toBe(true)
  })

  it('marks turns rebuilt from storage as restored', () => {
    const raw = JSON.stringify({
      'homework-manager': {
        sessionId: 's1', profile: 'homework-manager', status: 'tool',
        statusText: 'Working…', streamingText: '', toolActivities: [],
        userMessage: { id: -1, role: 'user', content: '' }, startedAt: Date.now(),
      },
      'stale-bot': {
        sessionId: 's2', profile: 'stale-bot', status: 'tool',
        statusText: 'Working…', streamingText: '', toolActivities: [],
        userMessage: { id: -2, role: 'user', content: '' }, startedAt: Date.now() - 60 * 60 * 1000,
      },
    })

    const restored = restorePersistedActiveTurns(raw)
    expect(restored['homework-manager'].restored).toBe(true)
    // Beyond the 15-minute window it is dropped entirely
    expect(restored['stale-bot']).toBeUndefined()
  })

  it('detects already-cached optimistic user messages to prevent duplicate prompt flashes', () => {    const optimisticMsg = { id: -12345, role: 'user', content: 'Can you compare OpenScience and OpenResearch?' }

    // Case 1: Exact ID match in cache
    expect(isOptimisticUserMessageAlreadyCached([optimisticMsg], optimisticMsg)).toBe(true)

    // Case 2: Content matches the tail (last) message in cache
    const cachedWithSameTail = [
      { id: 1, role: 'user', content: 'hello' },
      { id: 2, role: 'assistant', content: 'hi' },
      { id: -99999, role: 'user', content: 'Can you compare OpenScience and OpenResearch?' },
    ]
    expect(isOptimisticUserMessageAlreadyCached(cachedWithSameTail, optimisticMsg)).toBe(true)

    // Case 3: Earlier historical message had identical prompt, but was followed by assistant answer
    const cachedWithHistoricalIdentical = [
      { id: 1, role: 'user', content: 'Can you compare OpenScience and OpenResearch?' },
      { id: 2, role: 'assistant', content: 'Here is the comparison from earlier today.' },
    ]
    // Tail is assistant, so this is a NEW distinct turn with repeated prompt: MUST NOT falsely deduplicate!
    expect(isOptimisticUserMessageAlreadyCached(cachedWithHistoricalIdentical, optimisticMsg)).toBe(false)

    // Case 4: Completely different prompt text
    const cachedDifferent = [
      { id: 1, role: 'user', content: 'Different question' },
    ]
    expect(isOptimisticUserMessageAlreadyCached(cachedDifferent, optimisticMsg)).toBe(false)

    // Case 5: Empty cache
    expect(isOptimisticUserMessageAlreadyCached([], optimisticMsg)).toBe(false)
    expect(isOptimisticUserMessageAlreadyCached(undefined, optimisticMsg)).toBe(false)

    // Case 6: Consecutive identical user prompts (turn 1 followed by turn 2 with same text)
    const cachedTurn1Only = [
      { id: -1, role: 'user', content: 'Same question' },
    ]
    const turn2Message = { id: -2, role: 'user', content: 'Same question' }
    // When turn 2 is cached, it is recognized by its unique submission ID
    const cachedBothTurns = [
      { id: -1, role: 'user', content: 'Same question' },
      { id: -2, role: 'user', content: 'Same question' },
    ]
    expect(isOptimisticUserMessageAlreadyCached(cachedBothTurns, turn2Message)).toBe(true)
  })

  it('exercises full lifecycle transition: turn survives idle gateway snapshot while in-flight, then clears on completion', () => {
    const tracker = new InFlightSubmissionTracker()
    const mapping = {
      'sess-researcher-active': 'researcher',
      'key-active': 'researcher',
    }

    // Step 1: Turn begins on client
    tracker.start('researcher')
    const initialTurn: Record<string, ActiveBotTurn> = {
      researcher: {
        sessionId: 'sess-researcher-active',
        profile: 'researcher',
        status: 'tool',
        statusText: 'Working…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: -1, role: 'user', content: 'Compare research' },
        startedAt: 1000,
      },
    }

    // Step 2: Gateway reports idle snapshot during tool execution
    const idleGateway = [
      { id: 'sess-researcher-active', session_key: 'key-active', status: 'idle', started_at: 1000 },
    ]
    const surviving = reconcileActiveTurns(initialTurn, idleGateway, mapping, 8000, undefined, tracker.toSet())
    expect(surviving.researcher).toBeDefined()
    expect(surviving.researcher.sessionId).toBe('sess-researcher-active')
    expect(surviving.researcher.status).toBe('tool')

    // Step 3: Turn completes on client, ended set is recorded
    tracker.end('researcher')
    const ended = new Set(['sess-researcher-active', 'researcher'])

    // Step 4: Subsequent reconciliation tick prunes the completed turn
    const finalized = reconcileActiveTurns(surviving, idleGateway, mapping, 12000, ended, tracker.toSet())
    expect(finalized.researcher).toBeUndefined()

    // Step 5: A subsequent new turn for the same profile starts cleanly without interference
    tracker.start('researcher')
    const nextTurn: Record<string, ActiveBotTurn> = {
      researcher: {
        sessionId: 'sess-researcher-2',
        profile: 'researcher',
        status: 'thinking',
        statusText: 'Thinking…',
        streamingText: '',
        toolActivities: [],
        userMessage: { id: -2, role: 'user', content: 'Next question' },
        startedAt: 15000,
      },
    }
    const freshReconciled = reconcileActiveTurns(nextTurn, [], mapping, 15000, undefined, tracker.toSet())
    expect(freshReconciled.researcher).toBeDefined()
    expect(freshReconciled.researcher.sessionId).toBe('sess-researcher-2')
  })

  it('determines whether to retain local messages during backend race conditions via shouldRetainLocalMessages', () => {
    const localMsgs = [{ id: 1, role: 'user', content: 'hello' }]

    // Backend returns empty [] while turn is active: MUST retain local messages!
    expect(shouldRetainLocalMessages([], localMsgs, true)).toBe(true)

    // Backend returns empty [] when local messages exist even if turn not marked active: MUST retain!
    expect(shouldRetainLocalMessages([], localMsgs, false)).toBe(true)

    // Backend returns empty [] and cache is empty: do not retain (true empty state)
    expect(shouldRetainLocalMessages([], [], false)).toBe(false)

    // Backend returns populated messages: MUST NOT retain local only; accept loaded!
    const backendMsgs = [
      { id: 1, role: 'user', content: 'hello' },
      { id: 2, role: 'assistant', content: 'world' },
    ]
    expect(shouldRetainLocalMessages(backendMsgs, localMsgs, false)).toBe(false)
  })

  it('isBotRowWorking only lights up the bot on the Bots page for canonical, draft, or dispatched sessions', () => {
    const canonicalSession = { id: 'canonical-coder-id', resolved_id: 'canonical-coder-id' }
    const customTurn: ActiveBotTurn = {
      sessionId: 'session-custom-tasks',
      profile: 'coder',
      status: 'thinking',
      statusText: 'Thinking…',
      streamingText: '',
      toolActivities: [],
      userMessage: { id: 1, role: 'user', content: 'Do tasks' },
      startedAt: 1000,
    }

    // Turn in a custom Sessions-tab session: bot on Bots page must NOT be working!
    const activeTurnsWithCustom: Record<string, ActiveBotTurn> = {
      coder: customTurn,
    }
    expect(isBotRowWorking('coder', canonicalSession, activeTurnsWithCustom)).toBeUndefined()

    // Turn in canonical session: bot on Bots page MUST be working!
    const canonicalTurn: ActiveBotTurn = {
      ...customTurn,
      sessionId: 'canonical-coder-id',
    }
    const activeTurnsWithCanonical: Record<string, ActiveBotTurn> = {
      coder: canonicalTurn,
    }
    expect(isBotRowWorking('coder', canonicalSession, activeTurnsWithCanonical)).toBeDefined()
    expect(isBotRowWorking('coder', canonicalSession, activeTurnsWithCanonical)?.sessionId).toBe('canonical-coder-id')

    // Turn in draft session: bot on Bots page MUST be working!
    const draftTurn: ActiveBotTurn = {
      ...customTurn,
      sessionId: 'draft:coder',
    }
    expect(isBotRowWorking('coder', canonicalSession, { coder: draftTurn })).toBeDefined()

    // Dispatched delegation: bot on Bots page MUST be working!
    const dispatchedTurn: ActiveBotTurn = {
      ...customTurn,
      sessionId: 'dispatched:coder',
    }
    expect(isBotRowWorking('coder', canonicalSession, { coder: dispatchedTurn })).toBeDefined()

    // Waiting turn on canonical session: MUST light up bot with needsInput!
    const waitingTurn: ActiveBotTurn = {
      ...customTurn,
      sessionId: 'canonical-coder-id',
      status: 'waiting',
      statusText: 'Needs your input…',
      needsInput: true,
    }
    const workingBot = isBotRowWorking('coder', canonicalSession, { coder: waitingTurn })
    expect(workingBot).toBeDefined()
    expect(workingBot?.status).toBe('waiting')
    expect(workingBot?.needsInput).toBe(true)

    // Waiting turn requiring human input: MUST light up bot with needsInput!
    const waitingCustomTurn: ActiveBotTurn = {
      ...customTurn,
      sessionId: 'session-custom-tasks',
      status: 'waiting',
      statusText: 'Needs your input…',
      needsInput: true,
    }
    expect(isBotRowWorking('coder', canonicalSession, { coder: waitingCustomTurn })).toBeDefined()
  })

  it('isSessionRowWorking only lights up the exact session matching sessionId, never sibling sessions', () => {
    const customTurn: ActiveBotTurn = {
      sessionId: 'session-custom-tasks',
      profile: 'coder',
      status: 'thinking',
      statusText: 'Thinking…',
      streamingText: '',
      toolActivities: [],
      userMessage: { id: 1, role: 'user', content: 'Do tasks' },
      startedAt: 1000,
    }
    const turns: Record<string, ActiveBotTurn> = {
      'session-custom-tasks': customTurn,
      coder: customTurn,
    }

    // Matching session on Sessions page: is working!
    expect(isSessionRowWorking('session-custom-tasks', 'coder', turns)).toBeDefined()

    // Sibling session with same profile: is NOT working!
    expect(isSessionRowWorking('session-other-tasks', 'coder', turns)).toBeUndefined()

    // Canonical session on Sessions page: is NOT working!
    expect(isSessionRowWorking('canonical-coder-id', 'coder', turns)).toBeUndefined()

    // Waiting turn on custom session: lights up on that session with status 'waiting'
    const waitingTurn: ActiveBotTurn = {
      ...customTurn,
      status: 'waiting',
      statusText: 'Needs your input…',
      needsInput: true,
    }
    const waitingSession = isSessionRowWorking('session-custom-tasks', 'coder', { 'session-custom-tasks': waitingTurn })
    expect(waitingSession).toBeDefined()
    expect(waitingSession?.status).toBe('waiting')
    expect(waitingSession?.needsInput).toBe(true)

    // But sibling session STILL does not light up!
    expect(isSessionRowWorking('session-other-tasks', 'coder', { 'session-custom-tasks': waitingTurn })).toBeUndefined()
  })

  it('reconcileActiveTurns never prunes a turn that is waiting for human input', () => {
    const waitingTurn: Record<string, ActiveBotTurn> = {
      coder: {
        sessionId: 'sess-waiting-test',
        profile: 'coder',
        status: 'waiting',
        statusText: 'Needs your input…',
        needsInput: true,
        streamingText: '',
        toolActivities: [],
        userMessage: { id: 1, role: 'user', content: 'Run query' },
        startedAt: 1000,
      },
    }

    // 10 seconds later, gateway returns empty active list: MUST NOT prune waiting turn!
    const reconciled = reconcileActiveTurns(waitingTurn, [], {}, 11000)
    expect(reconciled.coder).toBeDefined()
    expect(reconciled.coder.status).toBe('waiting')
    expect(reconciled.coder.needsInput).toBe(true)
  })
})

