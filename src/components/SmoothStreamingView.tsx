import { useEffect, useRef } from 'react'

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
    if (!container || queueRef.current.length === 0) return

    const remaining = queueRef.current.splice(0)
    remaining.forEach(char => {
      const span = document.createElement('span')
      span.textContent = char
      span.style.display = 'inline'
      span.style.opacity = '1'
      container.appendChild(span)
    })
  }

  const tick = () => {
    const container = containerRef.current
    if (!container || queueRef.current.length === 0) {
      isTickingRef.current = false
      tickerTimerRef.current = null
      return
    }

    isTickingRef.current = true

    // Dynamically scale batch size if a large packet burst arrives so the stream stays fluid
    const remainingCount = queueRef.current.length
    const batchSize = remainingCount > 100 ? 5 : remainingCount > 40 ? 3 : remainingCount > 15 ? 2 : 1
    const chars = queueRef.current.splice(0, batchSize)

    chars.forEach(char => {
      const span = document.createElement('span')
      span.textContent = char
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
    const charArray = Array.from(newChars)
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    if (prefersReducedMotion) {
      charArray.forEach(char => {
        const span = document.createElement('span')
        span.textContent = char
        span.style.display = 'inline'
        span.style.opacity = '1'
        container.appendChild(span)
      })
      return
    }

    // Queue new characters in FIFO order — DOM nodes are only appended as each character appears,
    // guaranteeing the bubble height only expands in real-time as text physically renders
    queueRef.current.push(...charArray)

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
