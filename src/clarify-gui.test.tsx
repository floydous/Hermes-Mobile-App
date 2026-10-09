import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ClarifyCard, ClarifyHistoryCard, type ClarifyRequest } from './components/ClarifyCard'
import { reconcileActiveTurns, isTurnSettledByTranscript } from './chat-turn'
import { executeTurnSubmissionPipeline } from './session-title'

describe('Clarify GUI and Waiting Turn Indication', () => {
  const sampleRequest: ClarifyRequest = {
    requestId: 'srq-clarify-99',
    sessionId: 'session-dev-1',
    questions: [
      {
        qid: 'q_db',
        question: 'Which database should we configure for the API?',
        choices: ['PostgreSQL', 'SQLite', 'MongoDB'],
        multi_select: false,
      },
    ],
  }

  it('renders interactive ClarifyCard with questions, step indicator, and choices', () => {
    const html = renderToString(
      <ClarifyCard
        request={sampleRequest}
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
      />
    )

    expect(html).toContain('Clarification')
    expect(html).toContain('1 of 1')
    expect(html).toContain('Which database should we configure for the API?')
    expect(html).toContain('PostgreSQL')
    expect(html).toContain('SQLite')
    expect(html).toContain('MongoDB')
    expect(html).toContain('Other / Custom…')
    expect(html).toContain('Confirm')
    expect(html).toContain('Skip')
  })

  it('renders multi-choice badge when multi_select is true', () => {
    const multiRequest: ClarifyRequest = {
      requestId: 'srq-clarify-100',
      sessionId: 'session-dev-1',
      questions: [
        {
          qid: 'q_features',
          question: 'Select additional modules to install',
          choices: ['Auth', 'Logging', 'Metrics'],
          multi_select: true,
        },
      ],
    }

    const html = renderToString(
      <ClarifyCard
        request={multiRequest}
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
      />
    )

    expect(html).toContain('Select multiple')
    expect(html).toContain('Auth')
    expect(html).toContain('Logging')
  })

  it('renders open-ended text input when choices are omitted', () => {
    const openRequest: ClarifyRequest = {
      requestId: 'srq-clarify-101',
      sessionId: 'session-dev-1',
      questions: [
        {
          qid: 'q_name',
          question: 'What name would you like to give to this project?',
          choices: null,
          multi_select: false,
        },
      ],
    }

    const html = renderToString(
      <ClarifyCard
        request={openRequest}
        onSubmit={vi.fn()}
        onSkip={vi.fn()}
      />
    )

    expect(html).toContain('Type your response…')
  })

  it('renders historical ClarifyHistoryCard collapsed by default with clean decision summary', () => {
    const html = renderToString(
      <ClarifyHistoryCard
        outcome="submitted"
        responses={[
          {
            question: 'Which framework?',
            choices_offered: ['React', 'Vue'],
            status: 'answered',
            user_response: 'React',
          },
          {
            question: 'Include demo data?',
            status: 'skipped',
            user_response: null,
          },
        ]}
      />
    )

    expect(html).toContain('Clarification')
    expect(html).toContain('2 decisions')
    expect(html).toContain('aria-expanded="false"')
  })

  it('renders single-question historical ClarifyHistoryCard with immediate answer preview in secondary color', () => {
    const html = renderToString(
      <ClarifyHistoryCard
        outcome="submitted"
        responses={[
          {
            question: 'Select database',
            choices_offered: ['SQLite', 'PostgreSQL'],
            status: 'answered',
            user_response: 'SQLite',
          },
        ]}
      />
    )

    expect(html).toContain('Clarification')
    expect(html).toContain('SQLite')
    expect(html).toContain('aria-expanded="false"')
  })

  it('reconciles waiting gateway status to needsInput and Needs your input statusText', () => {
    const activeSessions = [
      {
        id: 'session-waiting-1',
        session_key: 'session-waiting-1',
        status: 'waiting',
        started_at: 1000,
      },
    ]
    const mapping = { 'session-waiting-1': 'coder' }

    const turns = reconcileActiveTurns({}, activeSessions, mapping, 2000)
    expect(turns.coder).toBeDefined()
    expect(turns.coder.status).toBe('waiting')
    expect(turns.coder.needsInput).toBe(true)
    expect(turns.coder.statusText).toBe('Needs your input…')

    // Gateway transition: user answered or agent resumed -> status becomes 'working'
    const workingSessions = [
      {
        id: 'session-waiting-1',
        session_key: 'session-waiting-1',
        status: 'working',
        started_at: 1000,
      },
    ]
    const updatedTurns = reconcileActiveTurns(turns, workingSessions, mapping, 3000)
    expect(updatedTurns.coder.status).toBe('tool')
    expect(updatedTurns.coder.needsInput).toBe(false)
    expect(updatedTurns.coder.statusText).toBe('Working…')
  })

  it('triggers onClarifyRequest when executeTurnSubmissionPipeline receives request.clarify', async () => {
    let capturedRequestId = ''
    let capturedQuestions: any[] = []

    const mockConnectAndSubmit = vi.fn(async (sid, prof, text, onEvent) => {
      onEvent('request.clarify', {
        requestId: 'srq-test-555',
        questions: [{ qid: 'q1', question: 'Confirm deploy?' }],
      })
      onEvent('message.complete', { text: 'Done' })
      return { sessionId: sid }
    })

    await executeTurnSubmissionPipeline({
      turnSessionId: 'sess-test',
      turnProfile: 'coder',
      prompt: 'deploy',
      activeEndpoint: 'http://127.0.0.1:9119',
      connectAndSubmitFn: mockConnectAndSubmit,
      onDelta: () => {},
      onComplete: () => {},
      onToolStart: () => {},
      onToolComplete: () => {},
      onClarifyRequest: (reqId, qs) => {
        capturedRequestId = reqId
        capturedQuestions = qs
      },
      onTitleUpdate: () => {},
      onSessionsUpdate: () => {},
      onSelectedIdUpdate: () => {},
      onError: () => {},
    })

    expect(capturedRequestId).toBe('srq-test-555')
    expect(capturedQuestions).toHaveLength(1)
    expect(capturedQuestions[0].question).toBe('Confirm deploy?')
  })

  it('isTurnSettledByTranscript never settles turns that are waiting for user input or have pending clarify', () => {
    const base = {
      profile: 'coder',
      statusText: 'Working…',
      userMessage: { id: 1, role: 'user' as const, content: 'Do you need input?' },
      streamingText: '',
      toolActivities: [],
      startedAt: 1000,
    }
    const transcript = [
      { id: 1, role: 'user', content: 'Do you need input?' },
      { id: 2, role: 'assistant', content: 'Prior reply from previous turn' },
    ]

    // Isolated check 1: status === 'waiting'
    expect(isTurnSettledByTranscript({ ...base, status: 'waiting' as const }, transcript, false)).toBe(false)

    // Isolated check 2: needsInput === true
    expect(isTurnSettledByTranscript({ ...base, status: 'tool' as const, needsInput: true }, transcript, false)).toBe(false)

    // Isolated check 3: pendingClarify is populated
    expect(isTurnSettledByTranscript({
      ...base,
      status: 'thinking' as const,
      pendingClarify: { requestId: 'srq-1', sessionId: 's-1', questions: [] },
    }, transcript, false)).toBe(false)
  })
})
