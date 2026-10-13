import { useEffect, useRef } from 'react'

export function tokenizeStreamChunk(text: string): string[] {
  const rawTokens = text.match(/\S+|\s+/g) || []
  const result: string[] = []
  for (const tok of rawTokens) {
    if (tok.length > 16 && !/^\s+$/.test(tok)) {
      for (let i = 0; i < tok.length; i += 8) {
        result.push(tok.slice(i, i + 8))
      }
    } else {
      result.push(tok)
    }
  }
  return result
}

export function consolidateSettledNodes(container: HTMLDivElement | any, targetCount = 30) {
  if (!container || !container.childNodes || container.childNodes.length <= 60) return
  let settledText = ''
  const limit = Math.min(targetCount, container.childNodes.length - 20)

  for (let i = 0; i < limit; i++) {
    const node = container.childNodes[0]
    if (!node) break
    settledText += node.textContent || ''
    container.removeChild(node)
  }

  if (settledText) {
    const first = container.firstChild
    if (first && first.nodeType === 3 /* Node.TEXT_NODE */) {
      first.textContent = settledText + (first.textContent || '')
    } else {
      const doc = typeof document !== 'undefined' ? document : null
      const textNode = doc ? doc.createTextNode(settledText) : { nodeType: 3, textContent: settledText }
      container.insertBefore(textNode, first)
    }
  }
}

export function SmoothStreamingView({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lastIndexRef = useRef(0)
  const queueRef = useRef<string[]>([])
  const tickerTimerRef = useRef<number | null>(null)
  const isTickingRef = useRef(false)

  const flushQueueImmediately = () => {
    if (tickerTimerRef.current != null) {
      window.clearTimeout(tickerTimerRef.current)
      tickerTimerRef.current = null
    }
    isTickingRef.current = false
    const container = containerRef.current
    if (!container) return

    const remaining = queueRef.current.splice(0)
    if (remaining.length > 0) {
      const remainingText = remaining.join('')
      container.appendChild(document.createTextNode(remainingText))
    }
  }

  const tick = () => {
    const container = containerRef.current
    if (!container || queueRef.current.length === 0) {
      isTickingRef.current = false
      tickerTimerRef.current = null
      return
    }

    isTickingRef.current = true

    // Batch tokens dynamically if a large packet burst arrives so the stream stays fluid
    const remainingCount = queueRef.current.length
    const batchSize = remainingCount > 80 ? 6 : remainingCount > 30 ? 3 : remainingCount > 10 ? 2 : 1
    const tokens = queueRef.current.splice(0, batchSize)

    tokens.forEach(tok => {
      const span = document.createElement('span')
      span.textContent = tok
      span.style.display = 'inline'
      span.style.opacity = '0'
      span.style.willChange = 'opacity'
      container.appendChild(span)

      // Smoothly ease opacity from 0% to 100% on entry
      requestAnimationFrame(() => {
        span.style.transition = 'opacity 280ms cubic-bezier(0.16, 1, 0.3, 1)'
        span.style.opacity = '1'
      })
    })

    // Consolidate older spans whose opacity has settled to keep the DOM element count bounded (<60 nodes)
    consolidateSettledNodes(container)

    tickerTimerRef.current = window.setTimeout(tick, 10)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // If text was cleared or rewound to a shorter length (new turn)
    if (!text || text.length < lastIndexRef.current) {
      flushQueueImmediately()
      container.innerHTML = ''
      lastIndexRef.current = 0
      queueRef.current = []
      if (!text) return
    }

    const newChars = text.slice(lastIndexRef.current)
    if (!newChars) return

    lastIndexRef.current = text.length
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    if (prefersReducedMotion) {
      container.appendChild(document.createTextNode(newChars))
      return
    }

    // Queue new tokens in FIFO order — DOM nodes are only appended as each token appears,
    // guaranteeing the bubble height only expands in real-time as text physically renders
    const tokens = tokenizeStreamChunk(newChars)
    queueRef.current.push(...tokens)

    if (!isTickingRef.current) {
      tick()
    }
  }, [text])

  // On unmount: drain any remaining characters so nothing is clipped
  useEffect(() => {
    return () => {
      flushQueueImmediately()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="markdown-body smooth-streaming-container"
      role="status"
      aria-live="polite"
    />
  )
}
