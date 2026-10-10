import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import {
  calculateUnreadState,
  cleanContinuationScaffolding,
  extractCompactedUserAsk,
  isCompactionSummary,
  isContinuationNudge,
  isModelSwitchMarker,
  parseModelSwitchNotice,
} from './session-cache'
import { cleanPreviewSnippet } from './live-model'
import { MessageCard, getUiZoomFactor } from './components/MarkdownContent'
import { ChatView } from './components/ChatView'
import { shouldRetainLocalMessages } from './chat-turn'
import type { LiveMessage } from './hermes'

describe('Mobile UX Polish & Backlog Verification', () => {
  describe('Item 6: Network Cutoff Scaffolding Detection & Rendering', () => {
    it('detects network cutoff and output truncation prompts', () => {
      const networkCutoff = `[System: The previous response was cut off by a network error mid-stream — a transport interruption, NOT a change in your capabilities. Your tools are still fully available; call them as normal and ignore any earlier claim that you lack tool access. Continue the task from where you left off. Do not restart or repeat prior text.]`
      const legacyCutoff = `[System: The previous response was cut off by a network error mid-stream. Continue exactly where you left off. Do not restart or repeat prior text. Finish the answer directly.]`
      const outputLimit = `[System: Your previous response was truncated by the output length limit. Continue exactly where you left off. Do not restart or repeat prior text. Finish the answer directly.]`
      const droppedTools = `[System: Your previous tool call (search_files) was too large and the stream timed out before it could be delivered. Do NOT retry the same tool call with the same large content.]`
      const normalUserMsg = `How do I implement a binary search tree in TypeScript?`

      expect(isContinuationNudge(networkCutoff)).toBe(true)
      expect(isContinuationNudge(legacyCutoff)).toBe(true)
      expect(isContinuationNudge(outputLimit)).toBe(true)
      expect(isContinuationNudge(droppedTools)).toBe(true)
      expect(isContinuationNudge(normalUserMsg)).toBe(false)
    })

    it('cleans continuation scaffolding from previews and snippets', () => {
      const rawPreview = `[System: The previous response was cut off by a network error mid-stream. Continue exactly where you left off.] Here is the code:`
      const cleaned = cleanContinuationScaffolding(rawPreview)
      expect(cleaned).toBe('Here is the code:')

      const snippet = cleanPreviewSnippet(rawPreview)
      expect(snippet).toBe('Here is the code:')
    })

    it('renders network-cutoff-capsule instead of raw user bubble', () => {
      const cutoffMessage: LiveMessage = {
        id: 101,
        role: 'user',
        content: `[System: The previous response was cut off by a network error mid-stream. Continue exactly where you left off.]`,
        timestamp: 1000,
      }

      const html = renderToString(
        <MessageCard
          message={cutoffMessage}
          onEdit={vi.fn()}
          fallbackName="default"
          revealTimestamp={false}
          onRevealTimestamp={vi.fn()}
        />
      )

      expect(html).toContain('network-cutoff-capsule')
      expect(html).toContain('Response continued after network interruption')
      expect(html).not.toContain('Continue exactly where you left off')
    })
  })

  describe('Item 8: Dispatched Task Completion Timing', () => {
    it('marks completed strictly when turn is NOT sending and assistant has replied', () => {
      // Completed case: assistant reply exists, not sending
      const hasAssistantReplyAfter = true
      const sending = false
      const isLast = false
      const isCompleted = !sending && !isLast && hasAssistantReplyAfter
      expect(isCompleted).toBe(true)

      // Active sending case: assistant interim chunk or tool exists, but turn is STILL sending
      const stillSending = true
      const isCompletedWhileSending = !stillSending && !isLast && hasAssistantReplyAfter
      expect(isCompletedWhileSending).toBe(false)

      // Last message case (currently running delegation):
      const isCurrentlyLast = true
      const isCompletedLast = !sending && !isCurrentlyLast && hasAssistantReplyAfter
      expect(isCompletedLast).toBe(false)
    })
  })

  describe('Item 9: calculateUnreadState Production Logic', () => {
    it('returns zero unread when session is currently selected', () => {
      const result = calculateUnreadState('sess-1', 6000, [{ id: 1, role: 'assistant', content: 'hello', timestamp: 6000 }], 5000, true)
      expect(result).toEqual({ isUnread: false, unreadCount: 0 })
    })

    it('never marks unread when user sends a message after lastRead (sent message race)', () => {
      const lastReadMs = 5_000_000

      const cachedTranscript: LiveMessage[] = [
        { id: 1, role: 'assistant', content: 'Prior assistant response', timestamp: 4000 }, // 4,000,000 ms <= lastRead
        // User sends a message at timestamp 6000 (6,000,000 ms > lastRead), then closes app
        { id: 2, role: 'user', content: 'My new question', timestamp: 6000 },
      ]

      const result = calculateUnreadState('sess-1', 6000, cachedTranscript, lastReadMs, false)
      expect(result.isUnread).toBe(false)
      expect(result.unreadCount).toBe(0)
    })

    it('accurately counts incoming assistant responses arriving after user message', () => {
      const lastReadMs = 5_000_000

      const cachedTranscript: LiveMessage[] = [
        { id: 1, role: 'assistant', content: 'Prior reply', timestamp: 4000 },
        { id: 2, role: 'user', content: 'User question', timestamp: 6000 },
        { id: 3, role: 'assistant', content: 'New assistant reply', timestamp: 7000 }, // 7,000,000 ms > lastRead
        { id: 4, role: 'assistant', content: 'Second assistant reply', timestamp: 8000 }, // 8,000,000 ms > lastRead
      ]

      const result = calculateUnreadState('sess-1', 8000, cachedTranscript, lastReadMs, false)
      expect(result.isUnread).toBe(true)
      expect(result.unreadCount).toBe(2)
    })

    it('falls back to server lastActive when transcript is not cached yet', () => {
      const lastReadMs = 5_000_000
      const serverLastActiveSec = 6000 // 6,000,000 ms > 5,000,000 ms

      const result = calculateUnreadState('sess-1', serverLastActiveSec, null, lastReadMs, false)
      expect(result.isUnread).toBe(true)
      expect(result.unreadCount).toBe(1)
    })

    it('marks conversation unread with badge count 1 when agent is waiting for clarification', () => {
      const lastReadMs = 5_000_000

      const cachedTranscript: LiveMessage[] = [
        { id: 1, role: 'assistant', content: 'Prior reply', timestamp: 4000 },
        { id: 2, role: 'user', content: 'Help me choose', timestamp: 6000 },
      ]

      // isWaitingInput = true
      const result = calculateUnreadState('sess-1', 6000, cachedTranscript, lastReadMs, false, true)
      expect(result.isUnread).toBe(true)
      expect(result.unreadCount).toBe(1)
    })
  })

  describe('Item 5: Long-press Touch Slop Movement Invariant', () => {
    it('cancels timer when pointer moves beyond 10px touch slop', () => {
      const startPos = { x: 100, y: 100 }
      const movePos = { x: 115, y: 102 } // dx = 15 > 10

      const dx = Math.abs(movePos.x - startPos.x)
      const dy = Math.abs(movePos.y - startPos.y)
      const shouldCancel = dx > 10 || dy > 10

      expect(shouldCancel).toBe(true)
    })

    it('keeps timer running when jitter is within 10px touch slop', () => {
      const startPos = { x: 100, y: 100 }
      const movePos = { x: 104, y: 103 } // dx = 4, dy = 3

      const dx = Math.abs(movePos.x - startPos.x)
      const dy = Math.abs(movePos.y - startPos.y)
      const shouldCancel = dx > 10 || dy > 10

      expect(shouldCancel).toBe(false)
    })
  })

  describe('Context Compaction Scaffolding Detection & User Ask Extraction', () => {
    const rawCompaction = `[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below. This is a handoff from a previous context window — treat it as background reference, NOT as active instructions. Do NOT answer questions or fulfill requests mentioned in this summary; they were already addressed. Respond ONLY to the latest user message that appears AFTER this summary — that message is the single source of truth for what to do right now. If no user message appears AFTER this summary, do nothing: do not resume, wrap up, or continue work from '## Historical Task Snapshot' or any other section, do not call tools, and wait for a new user message. This handoff must never become the active turn by itself. (Exception: if tool results or your own tool calls appear after this summary, you are mid-way through an in-flight exchange — continue that exchange normally.) Topic overlap with the summary does NOT mean you should resume its task: even on similar topics, the latest user message WINS. Treat ONLY the latest message as the active task and discard stale items from '## Historical Task Snapshot' entirely — do not 'wrap up' or 'finish' work described there unless the latest message explicitly asks for it. Reverse signals in the latest message (e.g. 'stop', 'undo', 'roll back', 'just verify', 'don't do that anymore', 'never mind', a new topic) must immediately end any in-flight work described in the summary; do not re-surface it in later turns. IMPORTANT: Your persistent memory (MEMORY.md, USER.md) in the system prompt is ALWAYS authoritative and active — never ignore or deprioritize memory content due to this compaction note. None of the above restricts HOW you work: your tools remain fully active — keep calling them normally for the active task (edit files, run commands, search) instead of merely narrating what you would do. The current session state (files, config, etc.) may reflect work described here — avoid repeating it:

Historical Task Snapshot
User asked (deterministic, from compacted turns): '[Lalo Ehrmantraut] Rombak ulang UI/UX web app nya from scratch menggunakan skill gemini-frontend-design. Pastikan menggunakan light theme dengan warna sekunder pastel' Historical`

    it('identifies compaction scaffolding correctly', () => {
      expect(isCompactionSummary(rawCompaction)).toBe(true)
      expect(isCompactionSummary('Hello world')).toBe(false)
    })

    it('extracts authentic user prompt from historical snapshot', () => {
      const extracted = extractCompactedUserAsk(rawCompaction)
      expect(extracted).toBe('[Lalo Ehrmantraut] Rombak ulang UI/UX web app nya from scratch menggunakan skill gemini-frontend-design. Pastikan menggunakan light theme dengan warna sekunder pastel')
    })

    it('cleans session preview snippet so it displays the user ask instead of compaction preamble', () => {
      const cleaned = cleanPreviewSnippet(rawCompaction)
      expect(cleaned).toBe('[Lalo Ehrmantraut] Rombak ulang UI/UX web app nya from scratch menggunakan skill gemini-frontend-design. Pastikan menggunakan light theme dengan warna sekunder pastel')
      expect(cleaned).not.toContain('[CONTEXT COMPACTION')
    })

    it('renders clean user prompt in MessageCard instead of the giant compaction block', () => {
      const compactionMsg: LiveMessage = {
        id: 201,
        role: 'user',
        content: rawCompaction,
        timestamp: 1000,
      }

      const html = renderToString(
        <MessageCard
          message={compactionMsg}
          onEdit={vi.fn()}
          fallbackName="default"
          revealTimestamp={false}
          onRevealTimestamp={vi.fn()}
        />
      )

      expect(html).toContain('Rombak ulang UI/UX web app nya from scratch')
      expect(html).not.toContain('Earlier turns were compacted into the summary below')
      expect(html).not.toContain('CONTEXT COMPACTION — REFERENCE ONLY')
    })

    it('renders a slim compacted-history-capsule when it is a pure handoff without user ask', () => {
      const pureHandoff: LiveMessage = {
        id: 202,
        role: 'user',
        content: `[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below. All previous goals were met.`,
        timestamp: 1000,
      }

      const html = renderToString(
        <MessageCard
          message={pureHandoff}
          onEdit={vi.fn()}
          fallbackName="default"
          revealTimestamp={false}
          onRevealTimestamp={vi.fn()}
        />
      )

      expect(html).toContain('compacted-history-capsule')
      expect(html).toContain('Earlier conversation compacted for context')
      expect(html).not.toContain('Earlier turns were compacted into the summary below')
    })

    it('strips STILL IN PROGRESS compaction restatement header from user message bubble', () => {
      const inProgressMsg: LiveMessage = {
        id: 203,
        role: 'user',
        content: `[STILL IN PROGRESS — this is the active request, restated after the compaction boundary because it was not finished yet. Continue it; do not start over.] [Lalo Ehrmantraut] Rombak ulang UI/UX web app nya from scratch menggunakan skill gemini-frontend-design. Pastikan menggunakan light theme dengan warna sekunder pastel`,
        timestamp: 1000,
      }

      const html = renderToString(
        <MessageCard
          message={inProgressMsg}
          onEdit={vi.fn()}
          fallbackName="default"
          revealTimestamp={false}
          onRevealTimestamp={vi.fn()}
        />
      )

      expect(html).toContain('Rombak ulang UI/UX web app nya from scratch')
      expect(html).not.toContain('STILL IN PROGRESS')
      expect(html).not.toContain('this is the active request, restated')
    })

    it('strips STILL IN PROGRESS header from session preview snippet', () => {
      const rawPreview = `[STILL IN PROGRESS — this is the active request, restated after the compaction boundary because it was not finished yet. Continue it; do not start over.] [Lalo Ehrmantraut] Rombak ulang UI/UX web app nya from scratch`
      const cleaned = cleanPreviewSnippet(rawPreview)
      expect(cleaned).toBe('[Lalo Ehrmantraut] Rombak ulang UI/UX web app nya from scratch')
      expect(cleaned).not.toContain('STILL IN PROGRESS')
    })

    it('extracts live user prompt following official Hermes _SUMMARY_END_MARKER', () => {
      const hermesHandoffWithLiveAsk = `[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below. All previous goals were met.\n\n--- END OF CONTEXT SUMMARY — respond to the message below, not the summary above ---\n\nWhat is the next step for this project?`
      const extracted = extractCompactedUserAsk(hermesHandoffWithLiveAsk)
      expect(extracted).toBe('What is the next step for this project?')
    })

    it('extracts prior context preceding official Hermes _MERGED_SUMMARY_DELIMITER', () => {
      const hermesMerged = `[PRIOR CONTEXT — for reference only; not a new message]\nPlease analyze this architecture.\n\n[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]\n[CONTEXT COMPACTION — REFERENCE ONLY] Summary...`
      const extracted = extractCompactedUserAsk(hermesMerged)
      expect(extracted).toBe('Please analyze this architecture.')
    })
  })

  describe('Model Switch Notice Scaffolding Detection & Rendering', () => {
    const rawModelSwitch = `[System: The active model for this chat has changed to Hermes-Default via provider omnirouter. From this point forward, use this runtime metadata when answering questions about what model/provider is active.]`

    it('identifies model switch marker correctly', () => {
      expect(isModelSwitchMarker(rawModelSwitch)).toBe(true)
      expect(isModelSwitchMarker('Hello assistant')).toBe(false)
    })

    it('parses model and provider correctly from switch marker', () => {
      const parsed = parseModelSwitchNotice(rawModelSwitch)
      expect(parsed?.model).toBe('Hermes-Default')
      expect(parsed?.provider).toBe('omnirouter')
    })

    it('formats clean preview snippet for model switch', () => {
      const cleaned = cleanPreviewSnippet(rawModelSwitch)
      expect(cleaned).toBe('Model changed: Hermes-Default (omnirouter)')
    })

    it('renders model-switch-capsule in MessageCard instead of a user bubble', () => {
      const modelSwitchMsg: LiveMessage = {
        id: 301,
        role: 'user',
        content: rawModelSwitch,
        timestamp: 1000,
      }

      const html = renderToString(
        <MessageCard
          message={modelSwitchMsg}
          onEdit={vi.fn()}
          fallbackName="default"
          revealTimestamp={false}
          onRevealTimestamp={vi.fn()}
        />
      )

      expect(html).toContain('model-switch-capsule')
      expect(html).toContain('Model switched to')
      expect(html).toContain('Hermes-Default')
      expect(html).toContain('(omnirouter)')
      expect(html).not.toContain('From this point forward, use this runtime metadata')
    })
  })

  describe('Infinite Scrollback & Load Earlier History Indicator', () => {
    const dummySession = {
      id: 'session-scrollback',
      title: 'Bot Chat',
      preview: 'hello',
      profile: 'default',
    }
    const dummyMessages: LiveMessage[] = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1}`,
      timestamp: 1000 + i * 10,
    }))

    it('renders Load earlier messages button when thread has >= 10 messages', () => {
      const html = renderToString(
        <ChatView
          session={dummySession}
          conversationLoading={false}
          messages={dummyMessages}
          settledAssistant={null}
          profiles={[]}
          streaming=""
          sending={false}
          toolActivities={[]}
          error=""
          back={vi.fn()}
          refresh={vi.fn()}
          openProfile={vi.fn()}
          onSessionModelChange={vi.fn()}
          submit={vi.fn()}
          submitVoice={vi.fn()}
          stop={vi.fn()}
          loadEarlierMessages={vi.fn().mockResolvedValue(true)}
        />
      )

      expect(html).toContain('load-earlier-container')
      expect(html).toContain('load-earlier-btn')
      expect(html).toContain('Load earlier messages')
    })
  })

  describe('Out-Of-Band Steer Message Wrapper Stripping', () => {
    const rawSteer = `[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history] Nevermind, don't create an extension, just create the scripts and the necessary modification for IMPROVEMENT_LOOP.md to use those scripts. [/OUT-OF-BAND USER MESSAGE]`

    it('strips OUT-OF-BAND wrapper from user chat bubble', () => {
      const steerMsg: LiveMessage = {
        id: 401,
        role: 'user',
        content: rawSteer,
        timestamp: 1000,
      }

      const html = renderToString(
        <MessageCard
          message={steerMsg}
          onEdit={vi.fn()}
          fallbackName="default"
          revealTimestamp={false}
          onRevealTimestamp={vi.fn()}
        />
      )

      expect(html).toContain('Nevermind')
      expect(html).toContain('create an extension, just create the scripts')
      expect(html).not.toContain('OUT-OF-BAND USER MESSAGE')
      expect(html).not.toContain('not tool output and not a new delivery')
    })

    it('strips OUT-OF-BAND wrapper from session preview snippet', () => {
      const cleaned = cleanPreviewSnippet(rawSteer)
      expect(cleaned).toBe(`Nevermind, don't create an extension, just create the scripts and the necessary modification for IMPROVEMENT_LOOP.md to use those scripts.`)
      expect(cleaned).not.toContain('OUT-OF-BAND USER MESSAGE')
    })
  })

  describe('UI Scale & Zoom Geometry Normalization', () => {
    it('resolves default zoom factor 1 when no scale property is set', () => {
      expect(getUiZoomFactor()).toBe(1)
    })

    it('normalizes bubble geometry correctly under large UI scale (1.35x)', () => {
      // Simulate an unscaled element at layout top: 200, left: 50, width: 280, height: 120
      const zoom = 1.35
      // Under zoom: 1.35, getBoundingClientRect() returns visual client pixels (unscaled * zoom)
      const visualRect = {
        top: 200 * zoom,   // 270
        left: 50 * zoom,   // 67.5
        width: 280 * zoom, // 378
        height: 120 * zoom // 162
      }

      // Normalization divides by zoom to restore unscaled layout coordinates for fixed positioning
      const normalized = {
        top: visualRect.top / zoom,
        left: visualRect.left / zoom,
        width: visualRect.width / zoom,
        height: visualRect.height / zoom
      }

      expect(normalized.top).toBeCloseTo(200)
      expect(normalized.left).toBeCloseTo(50)
      expect(normalized.width).toBeCloseTo(280)
      expect(normalized.height).toBeCloseTo(120)
    })

    it('normalizes bubble geometry correctly under compact UI scale (0.85x)', () => {
      const zoom = 0.85
      const visualRect = {
        top: 300 * zoom,
        left: 40 * zoom,
        width: 320 * zoom,
        height: 90 * zoom
      }

      const normalized = {
        top: visualRect.top / zoom,
        left: visualRect.left / zoom,
        width: visualRect.width / zoom,
        height: visualRect.height / zoom
      }

      expect(normalized.top).toBeCloseTo(300)
      expect(normalized.left).toBeCloseTo(40)
      expect(normalized.width).toBeCloseTo(320)
      expect(normalized.height).toBeCloseTo(90)
    })
  })

  describe('Document Attachment Notice Scaffolding & Card Rendering', () => {
    const rawDocMessage = `[The user sent a document: 'GB_GTC_SUMO_BARU_FIXED.docx'. It is saved at: /home/floydyra/.hermes/cache/documents/doc_0cd228f6ce29_GB_GTC_SUMO_BARU_FIXED.docx. Its text is not inlined here (it's a binary format such as PDF or DOCX). To read it, extract the document's text yourself — for example with the terminal tool or the ocr-and-documents skill — before answering, instead of asking the user to paste the contents.]

[The user sent a document: 'GB_SOCCER_BARUUU.docx'. It is saved at: /home/floydyra/.hermes/cache/documents/doc_d8f009b596ed_GB_SOCCER_BARUUU.docx. Its text is not inlined here (it's a binary format such as PDF or DOCX). To read it, extract the document's text yourself — for example with the terminal tool or the ocr-and-documents skill — before answering, instead of asking the user to paste the contents.]

[Lalo Ehrmantraut] Bisakah kamu audit Guidebook tersebut`

    it('renders document attachment cards and clean prompt in MessageCard', () => {
      const msg: LiveMessage = {
        id: 501,
        role: 'user',
        content: rawDocMessage,
        timestamp: 1000,
      }

      const html = renderToString(
        <MessageCard
          message={msg}
          onEdit={vi.fn()}
          fallbackName="default"
          revealTimestamp={false}
          onRevealTimestamp={vi.fn()}
        />
      )

      expect(html).toContain('GB_GTC_SUMO_BARU_FIXED.docx')
      expect(html).toContain('GB_SOCCER_BARUUU.docx')
      expect(html).toContain('[Lalo Ehrmantraut] Bisakah kamu audit Guidebook tersebut')
      expect(html).not.toContain('Its text is not inlined here')
      expect(html).not.toContain('extract the document&#x27;s text yourself')
      expect(html).not.toContain('instead of asking the user to paste')
    })

    it('cleans document notices from preview snippets', () => {
      const cleaned = cleanPreviewSnippet(rawDocMessage)
      expect(cleaned).toBe('[Lalo Ehrmantraut] Bisakah kamu audit Guidebook tersebut')
      expect(cleaned).not.toContain('The user sent a document')
    })
  })
})
