import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * How long the page transition runs. Kept in sync with `--duration-page`
 * in transitions.css.
 */
export const PAGE_SLIDE_DURATION_MS = 300

export const PAGE_EXIT_STATE = 'is-page-exiting'

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Runs the shared page exit animation before a pushed page is torn down.
 *
 * A page that is unmounted the instant it is asked to close disappears
 * without animating, so the transition would only ever show the incoming
 * page sliding in and never the outgoing page sliding away. This hook
 * keeps the page mounted for the length of the animation and calls
 * `onClosed` once it has finished.
 */
export function usePageExit(onClosed: () => void) {
  const [isExiting, setIsExiting] = useState(false)
  const timerRef = useRef<number | null>(null)
  const onClosedRef = useRef(onClosed)
  onClosedRef.current = onClosed

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const requestClose = useCallback(() => {
    if (timerRef.current !== null) return
    if (prefersReducedMotion()) {
      onClosedRef.current()
      return
    }
    setIsExiting(true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setIsExiting(false)
      onClosedRef.current()
    }, PAGE_SLIDE_DURATION_MS)
  }, [])

  return { isExiting, requestClose }
}

/**
 * Hosts a pushed page in a fixed overlay so it can travel across the
 * viewport without the page underneath reflowing.
 *
 * The host is the element that animates; the page inside it must not
 * animate on its own, or the two motions fight.
 */
export function PageHost({
  state,
  zIndex,
  className,
  children,
}: {
  state?: string
  zIndex: number
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`page-host${state ? ` ${state}` : ''}${className ? ` ${className}` : ''}`}
      style={{ zIndex }}
    >
      {children}
    </div>
  )
}
