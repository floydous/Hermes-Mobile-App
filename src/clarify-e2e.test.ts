import { describe, expect, it } from 'vitest'
import { isBotRowWorking, isSessionRowWorking, type ActiveBotTurn } from './chat-turn'
import { doesSessionMatchTurn, isSessionCanonical, resolveMatchingClarify } from './clarify-isolation'
import type { LiveMessage, LiveProfile, LiveSession } from './hermes'
import type { ClarifyRequest } from './components/ClarifyCard'

describe('Comprehensive End-to-End Clarify Flow and Cross-Session Isolation', () => {
  const profiles: LiveProfile[] = [
    {
      name: 'default',
      display_name: 'Default',
      canonical_session: {
        id: 'canonical-default-id',
        resolved_id: 'canonical-default-tip',
        title: 'Bot Chat',
        last_active: 1000,
      },
    },
    {
      name: 'homework',
      display_name: 'Homework Manager',
      canonical_session: {
        id: 'canonical-hw-id',
        title: 'Bot Chat',
        last_active: 1000,
      },
    },
  ]

  const botModeDefaultSession: LiveSession = {
    id: 'canonical-default-id',
    profile: 'default',
    title: 'Default', // in bot mode, title is the display name
    preview: '',
    last_active: 2000,
  }

  const adhocSession1: LiveSession = {
    id: 'adhoc-session-1',
    profile: 'default',
    title: 'Adhoc Chat 1',
    preview: '',
    last_active: 1900,
  }

  const adhocSession2: LiveSession = {
    id: 'adhoc-session-2',
    profile: 'default',
    title: 'Adhoc Chat 2',
    preview: '',
    last_active: 1800,
  }

  const clarifyRequest: ClarifyRequest = {
    requestId: 'srq-clarify-777',
    sessionId: 'canonical-default-id',
    questions: [
      {
        qid: 'q1',
        question: 'Which framework should we use?',
        choices: ['React', 'Vue', 'Svelte'],
        multi_select: false,
      },
    ],
  }

  const waitingClarifyTurn: ActiveBotTurn = {
    sessionId: 'canonical-default-id',
    profile: 'default',
    status: 'waiting',
    statusText: 'Needs your input…',
    needsInput: true,
    pendingClarify: clarifyRequest,
    streamingText: '',
    toolActivities: [{ id: 't1', name: 'clarify', status: 'running' }],
    userMessage: { id: 1, role: 'user', content: 'build an app' },
    startedAt: 1000,
  }

  const activeTurnsState: Record<string, ActiveBotTurn | undefined> = {
    default: waitingClarifyTurn,
  }

  const adhocSessionIds = new Set(['adhoc-session-1', 'adhoc-session-2'])

  it('Issue 2 Fix: "Using clarify" and waiting turns are isolated to canonical and never bleed into ad-hoc sessions', () => {
    // 1. Bots page: Default bot row must show working indicator
    const botRowStatus = isBotRowWorking('default', profiles[0].canonical_session, activeTurnsState, adhocSessionIds)
    expect(botRowStatus).toBeDefined()
    expect(botRowStatus?.status).toBe('waiting')
    expect(botRowStatus?.pendingClarify?.requestId).toBe('srq-clarify-777')

    // 2. Sessions page: Adhoc sessions under "default" profile must NOT show working indicator
    const session1Status = isSessionRowWorking('adhoc-session-1', 'default', activeTurnsState)
    expect(session1Status).toBeUndefined()

    const session2Status = isSessionRowWorking('adhoc-session-2', 'default', activeTurnsState)
    expect(session2Status).toBeUndefined()

    // 3. Clarify GUI resolution:
    // When viewing bot-mode Default session, ClarifyCard request IS resolved
    const clarifyForBot = resolveMatchingClarify({
      session: botModeDefaultSession,
      profiles,
      activeTurn: waitingClarifyTurn,
      pendingClarifyBySession: { 'canonical-default-id': clarifyRequest },
      pendingClarifyByProfile: { default: clarifyRequest },
      getPersistedClarify: () => null,
    })
    expect(clarifyForBot).toEqual(clarifyRequest)

    // When viewing ad-hoc session 1, ClarifyCard request is strictly NULL
    const clarifyForAdhoc1 = resolveMatchingClarify({
      session: adhocSession1,
      profiles,
      activeTurn: waitingClarifyTurn,
      pendingClarifyBySession: { 'canonical-default-id': clarifyRequest },
      pendingClarifyByProfile: { default: clarifyRequest },
      getPersistedClarify: () => null,
    })
    expect(clarifyForAdhoc1).toBeNull()

    // When viewing ad-hoc session 2, ClarifyCard request is strictly NULL
    const clarifyForAdhoc2 = resolveMatchingClarify({
      session: adhocSession2,
      profiles,
      activeTurn: waitingClarifyTurn,
      pendingClarifyBySession: { 'canonical-default-id': clarifyRequest },
      pendingClarifyByProfile: { default: clarifyRequest },
      getPersistedClarify: () => null,
    })
    expect(clarifyForAdhoc2).toBeNull()
  })

  it('Issue 3 Fix: After submitting answer, working status transitions to generating and remains active on main screen', () => {
    // Simulating turn transition immediately after submitting answers
    const generatingTurn: ActiveBotTurn = {
      sessionId: 'canonical-default-id',
      profile: 'default',
      status: 'thinking',
      statusText: 'Processing response…',
      needsInput: false,
      pendingClarify: null,
      streamingText: '',
      toolActivities: [{ id: 't1', name: 'clarify', status: 'done' }],
      userMessage: { id: 1, role: 'user', content: 'build an app' },
      startedAt: 1000,
    }

    const turnsAfterAnswer: Record<string, ActiveBotTurn | undefined> = {
      default: generatingTurn,
    }

    // Default bot row MUST show working indicator on main screen
    const botRow = isBotRowWorking('default', profiles[0].canonical_session, turnsAfterAnswer, adhocSessionIds)
    expect(botRow).toBeDefined()
    expect(botRow?.status).toBe('thinking')
    expect(botRow?.statusText).toBe('Processing response…')
    expect(botRow?.needsInput).toBe(false)
  })

  it('Issue 4 Fix: When restored across app restarts, clarify requests are verified and isolated', () => {
    // On app exit, activeTurns was saved with waitingClarifyTurn
    // When user enters chat session, resolveMatchingClarify delivers the clarify request
    const restoredClarify = resolveMatchingClarify({
      session: botModeDefaultSession,
      profiles,
      activeTurn: waitingClarifyTurn,
      pendingClarifyBySession: {},
      pendingClarifyByProfile: {},
      getPersistedClarify: (sid, prof, isCanonical) => {
        if (isCanonical && prof === 'default') return clarifyRequest
        return null
      },
    })
    expect(restoredClarify).toEqual(clarifyRequest)

    // Ad-hoc sessions must never receive it
    const adhocRestored = resolveMatchingClarify({
      session: adhocSession1,
      profiles,
      activeTurn: waitingClarifyTurn,
      pendingClarifyBySession: {},
      pendingClarifyByProfile: {},
      getPersistedClarify: (sid, prof, isCanonical) => {
        if (isCanonical && prof === 'default') return clarifyRequest
        return null
      },
    })
    expect(adhocRestored).toBeNull()
  })

  it('Step 3 & 4 Fix: Runtime session ID from resumeSession resolves to canonical session on message.complete', () => {
    // When gateway session.resume returns a runtime ID (e.g. "ac20c60c")
    const runtimeSessionId = 'ac20c60c'
    const resolutionMap: Record<string, string> = {
      'canonical-default-id': runtimeSessionId,
      [runtimeSessionId]: 'canonical-default-id',
    }
    const getter = (id: string) => resolutionMap[id] || id

    // 1. In chat view (selected = botModeDefaultSession with id 'canonical-default-id')
    // A completion event arriving with sid = 'ac20c60c' MUST match!
    const matchesCurrentChat = doesSessionMatchTurn(
      botModeDefaultSession,
      runtimeSessionId,
      'default',
      profiles,
      getter,
      adhocSessionIds
    )
    expect(matchesCurrentChat).toBe(true)

    // 2. An unrelated ad-hoc chat session must NOT match this runtime completion
    const matchesAdhocChat = doesSessionMatchTurn(
      adhocSession1,
      runtimeSessionId,
      'default',
      profiles,
      getter,
      adhocSessionIds
    )
    expect(matchesAdhocChat).toBe(false)
  })

  it('Step 4 Fix: deduplicateConsecutiveMessages deduplicates optimistic clarify tool message against authoritative SQLite reload', async () => {
    const optimisticToolMsg: LiveMessage = {
      id: -12345,
      role: 'tool',
      tool_name: 'clarify',
      content: JSON.stringify({ responses: [{ question: 'Q', user_response: 'Ans' }], outcome: 'answered' }),
      timestamp: 1000,
    }
    const authoritativeReloadMsg: LiveMessage = {
      id: 42,
      role: 'tool',
      tool_name: 'clarify',
      content: JSON.stringify({ responses: [{ question: 'Q', user_response: 'Ans' }], outcome: 'answered' }),
      timestamp: 1000,
    }

    const { deduplicateConsecutiveMessages } = await import('./session-cache')
    const combined = [optimisticToolMsg, authoritativeReloadMsg]
    const deduped = deduplicateConsecutiveMessages(combined)

    expect(deduped).toHaveLength(1)
    expect(deduped[0].id).toBe(42) // Authoritative positive SQLite ID preserved
  })
})
