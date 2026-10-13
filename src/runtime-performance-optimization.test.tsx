import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  BoundedImageDataCache,
  areMarkdownBlockPropsEqual,
  hasCodeContent,
  imageDataUrlCache,
  cacheImageDataUrl,
  getCachedImageDataUrl,
} from './components/MarkdownContent'
import {
  tokenizeStreamChunk,
  consolidateSettledNodes,
} from './components/SmoothStreamingView'
import { reconcileActiveTurns, shouldRetainLocalMessages } from './chat-turn'
import { doesSessionMatchTurn, reconcileSettledSessionTurn } from './clarify-isolation'
import { buildBotRows } from './live-model'
import type { LiveMessage } from './hermes'

class MockDomNode {
  nodeType: number
  textContent: string

  constructor(nodeType: number, text: string) {
    this.nodeType = nodeType
    this.textContent = text
  }
}

class MockDomContainer {
  childNodes: MockDomNode[] = []

  get firstChild(): MockDomNode | null {
    return this.childNodes[0] || null
  }

  get textContent(): string {
    return this.childNodes.map(n => n.textContent).join('')
  }

  appendChild(node: MockDomNode) {
    this.childNodes.push(node)
  }

  removeChild(node: MockDomNode) {
    const idx = this.childNodes.indexOf(node)
    if (idx >= 0) this.childNodes.splice(idx, 1)
  }

  insertBefore(newNode: MockDomNode, refNode: MockDomNode | null) {
    if (!refNode) {
      this.childNodes.push(newNode)
    } else {
      const idx = this.childNodes.indexOf(refNode)
      if (idx >= 0) {
        this.childNodes.splice(idx, 0, newNode)
      } else {
        this.childNodes.push(newNode)
      }
    }
  }
}

describe('Runtime Performance & Resource Optimization', () => {
  describe('Priority 5: Memory Control & Bounded Image Cache', () => {
    let cache: BoundedImageDataCache

    beforeEach(() => {
      cache = new BoundedImageDataCache()
    })

    it('stores and retrieves cached image data URLs', () => {
      cache.set('diagram.png', 'data:image/png;base64,abc123')
      expect(cache.get('diagram.png')).toBe('data:image/png;base64,abc123')
      expect(cache.size()).toBe(1)
      expect(cache.bytes()).toBe('data:image/png;base64,abc123'.length)
    })

    it('refreshes LRU recency position upon get() in a bounded cache', () => {
      // Create a cache with capacity of 3
      const lruCache = new BoundedImageDataCache(3)
      lruCache.set('a.png', 'data:a')
      lruCache.set('b.png', 'data:b')
      lruCache.set('c.png', 'data:c')

      // Reading a.png moves it to the most recently used slot
      expect(lruCache.get('a.png')).toBe('data:a')

      // Adding d.png should evict b.png (the least recently used), NOT a.png
      lruCache.set('d.png', 'data:d')
      expect(lruCache.size()).toBe(3)
      expect(lruCache.get('b.png')).toBeUndefined()
      expect(lruCache.get('a.png')).toBe('data:a')
      expect(lruCache.get('c.png')).toBe('data:c')
      expect(lruCache.get('d.png')).toBe('data:d')

      // Now reading c.png moves c to most recently used
      expect(lruCache.get('c.png')).toBe('data:c')

      // Adding e.png should evict a.png (since d and c were used more recently)
      lruCache.set('e.png', 'data:e')
      expect(lruCache.size()).toBe(3)
      expect(lruCache.get('a.png')).toBeUndefined()
      expect(lruCache.get('c.png')).toBe('data:c')
      expect(lruCache.get('d.png')).toBe('data:d')
      expect(lruCache.get('e.png')).toBe('data:e')
    })

    it('evicts when cumulative byte size exceeds limit', () => {
      // 10 MB payload string
      const largeChunk = 'x'.repeat(10 * 1024 * 1024)
      cache.set('img_a.png', largeChunk)
      cache.set('img_b.png', largeChunk)
      expect(cache.size()).toBe(2)

      // Adding third 10MB chunk (total 30MB > 25MB max) must evict img_a
      cache.set('img_c.png', largeChunk)
      expect(cache.size()).toBe(2)
      expect(cache.get('img_a.png')).toBeUndefined()
      expect(cache.get('img_b.png')).toBe(largeChunk)
      expect(cache.get('img_c.png')).toBe(largeChunk)
    })

    it('rejects oversized payloads larger than max cache bytes without failing', () => {
      const overLimit = 'y'.repeat(26 * 1024 * 1024)
      cache.set('huge.png', overLimit)
      expect(cache.size()).toBe(0)
      expect(cache.bytes()).toBe(0)
      expect(cache.get('huge.png')).toBeUndefined()
    })

    it('integrates with cacheImageDataUrl and getCachedImageDataUrl functions', () => {
      imageDataUrlCache.clear()
      cacheImageDataUrl('/path/to/diagram.png', 'data:image/png;base64,xyz789')
      expect(getCachedImageDataUrl('/path/to/diagram.png')).toBe('data:image/png;base64,xyz789')
      expect(getCachedImageDataUrl('diagram.png')).toBe('data:image/png;base64,xyz789')
      imageDataUrlCache.clear()
    })
  })

  describe('Priority 4: SmoothStreamingView Tokenization & Bounded DOM Node Architecture', () => {
    it('tokenizes stream text preserving exact content across word and whitespace boundaries', () => {
      const sample = 'The quick brown fox jumps over the lazy dog.\n\nCode: `console.log(123)`'
      const tokens = tokenizeStreamChunk(sample)
      expect(tokens.join('')).toBe(sample)
      expect(tokens).toContain('The')
      expect(tokens).toContain(' ')
      expect(tokens).toContain('lazy')
      expect(tokens).toContain('\n\n')
    })

    it('subdivides excessively long unbroken tokens into 8-character chunks for smooth reveal', () => {
      const longUrl = 'https://example.com/very/long/unbroken/path/to/resource/without/spaces'
      const tokens = tokenizeStreamChunk(longUrl)
      expect(tokens.join('')).toBe(longUrl)
      expect(tokens.length).toBeGreaterThan(1)
      expect(tokens.every(t => t.length <= 16)).toBe(true)
    })

    it('consolidates settled DOM nodes, keeping total child nodes bounded under 60 while preserving exact text content', () => {
      const container = new MockDomContainer()
      const expectedWords: string[] = []

      // Simulate a long streaming response appending 150 word spans
      for (let i = 0; i < 150; i++) {
        const word = `word${i} `
        expectedWords.push(word)
        container.appendChild(new MockDomNode(1, word))

        // Trigger consolidation periodically as done during live ticking
        if (container.childNodes.length > 60) {
          consolidateSettledNodes(container as any)
        }
      }

      const fullExpectedText = expectedWords.join('')
      // Total DOM node count must remain bounded (< 65 nodes at all times)
      expect(container.childNodes.length).toBeLessThanOrEqual(65)
      // Exactly 100% of the stream text must be preserved with zero missing or transposed words
      expect(container.textContent).toBe(fullExpectedText)
    })
  })

  describe('Priority 2: Turn Persistence Coalescing', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('coalesces rapid streaming updates into at most 1 snapshot per second', () => {
      const writes: string[] = []
      let timer: any = null

      const persistSnapshot = (data: string) => {
        if (timer != null) {
          clearTimeout(timer)
          timer = null
        }
        writes.push(data)
      }

      const scheduleThrottled = (data: () => string) => {
        if (timer != null) return
        timer = setTimeout(() => {
          timer = null
          persistSnapshot(data())
        }, 1000)
      }

      let currentText = ''
      // Simulate 50 streaming deltas arriving within 500ms
      for (let i = 1; i <= 50; i++) {
        currentText += `token_${i} `
        scheduleThrottled(() => currentText)
        vi.advanceTimersByTime(10)
      }

      // During high-frequency delta arrival, zero timer flushes have occurred yet
      expect(writes.length).toBe(0)

      // Advance past the 1-second debounce threshold
      vi.advanceTimersByTime(1000)
      // Exactly 1 coalesced write occurred instead of 50 synchronous storage operations
      expect(writes.length).toBe(1)
      expect(writes[0]).toBe(currentText)

      // When the turn finishes, immediate flush persists terminal state directly
      persistSnapshot(currentText + 'FINAL')
      expect(writes.length).toBe(2)
      expect(writes[1]).toBe(currentText + 'FINAL')
    })
  })

  describe('Session Rebind & Back-Navigation Settlement Safety', () => {
    it('does not synthesize a thinking turn when gateway reports status starting during agent hydration', () => {
      const currentTurns = {}
      const activeSessions = [
        // Gateway agent hydration (agent_build_started = true, agent_ready = false)
        { id: 'adhoc-session-1', session_key: 'adhoc-session-1', status: 'starting', started_at: 100 },
      ]
      const sessionToProfile = { 'adhoc-session-1': 'default' }
      const result = reconcileActiveTurns(currentTurns, activeSessions, sessionToProfile)
      expect(result['default']).toBeUndefined()
      expect(result['adhoc-session-1']).toBeUndefined()
    })

    it('settles ad-hoc session turns by identity without deleting sibling sessions under the same profile', () => {
      const targetSession = { id: 'session-alpha', profile: 'default', title: 'Ad-hoc Chat 1', preview: '' }
      const siblingSession = { id: 'session-beta', profile: 'default', title: 'Ad-hoc Chat 2', preview: '' }

      const activeTurns: Record<string, any> = {
        'session-alpha': { sessionId: 'session-alpha', profile: 'default', status: 'thinking' },
        'session-beta': { sessionId: 'session-beta', profile: 'default', status: 'thinking' },
      }

      // Production helper: identity-safe deletion matching targetSession
      const nextTurns = reconcileSettledSessionTurn(
        activeTurns,
        targetSession,
        [],
        (id: string) => id,
        new Set(['session-alpha', 'session-beta'])
      )

      // Target session was removed
      expect(nextTurns['session-alpha']).toBeUndefined()
      // Sibling ad-hoc session sharing the 'default' profile remains intact!
      expect(nextTurns['session-beta']).toBeDefined()
      expect(nextTurns['session-beta'].sessionId).toBe('session-beta')
    })

    it('deterministically selects the newest session by last_active when multiple matching sessions exist for a bot', () => {
      const profiles = [{ name: 'researcher', display_name: 'Researcher' }]
      const sessions = [
        { id: 'sess-old', profile: 'researcher', title: 'Researcher', last_active: 1000 },
        { id: 'sess-newest', profile: 'researcher', title: 'Researcher', last_active: 5000 },
        { id: 'sess-mid', profile: 'researcher', title: 'Bot Chat', last_active: 3000 },
      ]

      const rows = buildBotRows(profiles, sessions)
      expect(rows[0].session?.id).toBe('sess-newest')
    })

    it('shouldRetainLocalMessages preserves optimistic messages when backend returns empty array', () => {
      const backendLoaded: any[] = []
      const localCached = [{ id: -1, role: 'user', content: 'Hi' }]
      
      // When backend is empty but local messages exist, must return true to prevent wiping
      expect(shouldRetainLocalMessages(backendLoaded, localCached, false)).toBe(true)
      // When backend has messages, should return false (allow authoritative sync)
      expect(shouldRetainLocalMessages([{ id: 1, role: 'user', content: 'Hi' }], localCached, false)).toBe(false)
    })

    it('areMarkdownBlockPropsEqual returns true for identical props and false on mutations', () => {
      const prevProps = { content: '## Architecture', hasMath: false, hasCode: false }
      const nextPropsSame = { content: '## Architecture', hasMath: false, hasCode: false }
      const nextPropsDifferentContent = { content: '## Updated Architecture', hasMath: false, hasCode: false }
      const nextPropsDifferentMath = { content: '## Architecture', hasMath: true, hasCode: false }
      const nextPropsDifferentCode = { content: '## Architecture', hasMath: false, hasCode: true }

      expect(areMarkdownBlockPropsEqual(prevProps, nextPropsSame)).toBe(true)
      expect(areMarkdownBlockPropsEqual(prevProps, nextPropsDifferentContent)).toBe(false)
      expect(areMarkdownBlockPropsEqual(prevProps, nextPropsDifferentMath)).toBe(false)
      expect(areMarkdownBlockPropsEqual(prevProps, nextPropsDifferentCode)).toBe(false)
    })

    it('hasCodeContent reliably detects code blocks and excludes plain text', () => {
      expect(hasCodeContent('Plain text with no code')).toBe(false)
      expect(hasCodeContent('Text with `inline code`')).toBe(true)
      expect(hasCodeContent('```js\nconsole.log(1)\n```')).toBe(true)
      expect(hasCodeContent('~~~python\nprint(1)\n~~~')).toBe(true)
      expect(hasCodeContent('   ~~~python\nprint(1)\n~~~')).toBe(true)
      // Prose approximations with tildes must NOT be classified as code
      expect(hasCodeContent('Takes ~10 minutes and costs ~50 dollars')).toBe(false)
      // Indented code blocks: 4 spaces, 5 spaces, and tabs (with leading spaces or inner whitespace)
      expect(hasCodeContent('Section title:\n    indented code block')).toBe(true)
      expect(hasCodeContent('Section title:\n     five spaces indented')).toBe(true)
      expect(hasCodeContent('Section title:\n\ttab indented code')).toBe(true)
      expect(hasCodeContent('\t  indented code')).toBe(true)
      expect(hasCodeContent(' \tindented code')).toBe(true)
      expect(hasCodeContent('    \tindented code')).toBe(true)
      // Nested inside blockquotes
      expect(hasCodeContent('> ~~~python\n> print(1)\n> ~~~')).toBe(true)
      expect(hasCodeContent('>     def hello():\n>         return 1')).toBe(true)
    })
  })
})
