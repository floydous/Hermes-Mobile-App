import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, ExternalLink, GitBranch, Globe2, Heart, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Smartphone, Wifi, Trash2, Send } from 'lucide-react'

import HermesAgentAppIcon from '../assets/hermes-agent-app-icon.png'
import { errorMessage, supportsBasicAuth } from '../connection-state'
import { useEdgeSwipeBack } from '../edge-swipe'
import { nativeSignIn, passwordSignIn, probeHermesGateway } from '../hermes'
import {
  clearPerformanceBuffer,
  createTraceId,
  exportBufferedPerformanceEvents,
  flushPerformanceEvents,
  isPerformanceDiagnosticsEnabled,
  recordPerformanceEvent,
  setPerformanceAuthToken,
  setPerformanceDiagnosticsEnabled,
  setPerformanceLogHost,
} from '../remote-logger'

const HermesMobileLogo = HermesAgentAppIcon

// Duration of the push/pop page transition. Kept in one place so the
// JavaScript timers and the CSS transition stay in sync.
const NAV_DURATION_MS = 300

/**
 * Reports whether a scroll container has been scrolled away from the top.
 *
 * The top fade is only meaningful once content is actually travelling under
 * the header. Applying it unconditionally fades the first row of a page that
 * has not been scrolled at all, which just looks washed out.
 *
 * A callback ref is used because the sub-page's scroller mounts
 * conditionally: an effect that reads `ref.current` runs before the element
 * exists and never re-runs.
 */
function useScrolledPastTop(): { scrolled: boolean; ref: (el: HTMLDivElement | null) => void } {
  const [scrolled, setScrolled] = useState(false)
  const [el, setEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!el) return
    const onScroll = () => setScrolled(el.scrollTop > 1)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [el])

  const ref = useCallback((node: HTMLDivElement | null) => { setEl(node) }, [])
  return { scrolled, ref }
}

type Theme = 'dark' | 'light' | 'grey'
type Page = 'root' | 'pairing' | 'about' | 'appearance' | 'diagnostics'

type Props = {
  profiles: number
  sessions: number
  connected: boolean
  endpoint?: string
  theme: Theme
  setTheme: (theme: Theme) => void
  uiScale?: number
  setUiScale?: (scale: number) => void
  close: () => void
  refresh: () => Promise<unknown>
  onPairingBusy: (busy: boolean) => void
  onPaired: (endpoint: string) => Promise<void>
}

const themes: Array<{ id: Theme; label: string; description: string }> = [
  { id: 'light', label: 'White', description: 'Clean white canvas & daylight contrast' },
  { id: 'grey', label: 'Grey', description: 'Refined charcoal & graphite monochrome' },
  { id: 'dark', label: 'Black / OLED Dark', description: 'Deep obsidian & OLED true black' },
]

const external = (href: string) => ({ href, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); void invoke('open_external_url', { url: href }).catch(() => window.open(href, '_blank', 'noopener,noreferrer')) } })

function Header({
  title,
  subtitle,
  back,
  compact = false,
}: {
  title: string
  subtitle: string
  back: () => void
  compact?: boolean
}) {
  return (
    <header className={`panel-head connection-head${compact ? ' compact' : ''}`}>
      <button
        className="back-button"
        onClick={back}
        aria-label="Back"
      >
        <ChevronLeft size={22} />
      </button>
      {!compact && (
        <div className="connection-head-titles">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      )}
    </header>
  )
}

function AboutHermesMobile({ back }: { back: () => void }) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  return <main ref={shellRef} className="app panel about-screen">
    <Header title="" subtitle="" back={back} compact/>
    <section className="about-hero">
      <div className="about-logo-card"><img src={HermesMobileLogo} alt="Hermes Mobile logo"/></div>
      <h1>Hermes Mobile</h1>
      <p className="about-meta">A companion for Hermes Desktop <i aria-hidden="true">|</i> Version 0.1.1</p>
      <span>Control your Hermes workspace from wherever you are.</span>
    </section>

    <section className="settings-group">
      <div className="settings-group-body">
        <a className="settings-cell" {...external('https://stestein.com/')}>
          <span className="settings-cell-label">Creator — SteStein.com</span>
          <ExternalLink size={16} className="settings-chevron" aria-hidden="true"/>
        </a>
      </div>
    </section>

    <section className="about-story">
      <p>I fell in love with Hermes after using the new Bot capabilities, and started building the mobile client I wanted: a polished, host-first companion for controlling your Hermes Bots from your phone.</p>
      <p>Your computer &amp; hermes setup still remains the authority for your agents, credentials, approvals, tools, sessions, and files. Hermes Mobile is the mission-control surface in your pocket, similar to Grok Bot! Hope you enjoy it as much as I do.</p>
    </section>

    <p className="about-footer">An independent community project, unaffiliated with Nous Research or Hermes Agent. Built with appreciation for the Hermes community.</p>
  </main>
}

function PairingSettings({ back, onPaired, onPairingBusy, initialEndpoint }: { back: () => void; onPaired: (endpoint: string) => Promise<void>; onPairingBusy: (busy: boolean) => void; initialEndpoint?: string }) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  const [gatewayUrl, setGatewayUrl] = useState(initialEndpoint || '')
  const [checking, setChecking] = useState(false)
  const [verifiedEndpoint, setVerifiedEndpoint] = useState<string | null>(null)
  const [passwordAuth, setPasswordAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const probeEpochRef = useRef(0)
  const testGateway = async () => {
    const value = gatewayUrl.trim().replace(/\/$/, '')
    if (!value) { setResult({ tone: 'error', text: 'Enter your Windows PC’s Tailscale or HTTPS gateway URL first.' }); return }
    const probeEpoch = ++probeEpochRef.current
    setChecking(true); setResult(null); setVerifiedEndpoint(null); setPasswordAuth(false); setPassword('')
    try {
      const status = await probeHermesGateway(value)
      if (probeEpoch !== probeEpochRef.current) return
      const host = new URL(value).hostname.toLowerCase()
      const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
      if (!loopback && status.auth_required !== true) {
        setResult({ tone: 'error', text: 'This remote gateway is reachable but does not require authentication. Secure remote pairing requires an authenticated Hermes gateway.' })
        return
      }
      const supportsPassword = supportsBasicAuth(status.auth_providers)
      setPasswordAuth(supportsPassword)
      const pkce = status.auth_flows?.includes('native_pkce') ? ' Secure device sign-in is available.' : ''
      if (!status.auth_flows?.includes('native_pkce')) throw new Error('This Hermes gateway does not advertise secure native phone sign-in.')
      setVerifiedEndpoint(value)
      setResult({ tone: 'success', text: `Hermes ${status.version || 'gateway'} is reachable. Authentication is required.${pkce}` })
    } catch (error) {
      if (probeEpoch === probeEpochRef.current) setResult({ tone: 'error', text: errorMessage(error, 'Could not reach this Hermes gateway.') })
    } finally { if (probeEpoch === probeEpochRef.current) setChecking(false) }
  }
  const completeSignIn = async () => {
    if (!verifiedEndpoint) return
    onPairingBusy(true)
    setSigningIn(true); setResult(null)
    try {
      if (passwordAuth) await passwordSignIn(verifiedEndpoint, username.trim(), password)
      else await nativeSignIn(verifiedEndpoint)
      // Yield after the Android native credential write before opening the next
      // native bridge call. This avoids concurrent Keystore access on resume.
      await new Promise(resolve => window.setTimeout(resolve, 150))
      setPassword('')
      await onPaired(verifiedEndpoint)
      back()
    } catch (error) { setResult({ tone: 'error', text: errorMessage(error, 'Secure Hermes sign-in failed.') }) }
    finally { setPassword(''); setSigningIn(false); onPairingBusy(false) }
  }
  const copyChecklist = async () => {
    try {
      await navigator.clipboard.writeText('Hermes Mobile Android pairing\n1. Join the Windows PC and Android phone to the same Tailscale tailnet.\n2. Start an authenticated Hermes gateway on the Windows PC.\n3. On Android, enter the PC’s Tailscale HTTPS/HTTP gateway URL — never 127.0.0.1.\n4. Verify reachability, then authenticate with the gateway’s supported session token or OAuth flow.\n5. Keep port 9119 private; do not expose it directly to the public internet.')
      setCopied(true); window.setTimeout(() => setCopied(false), 1800)
    } catch { setResult({ tone: 'error', text: 'Clipboard access is unavailable. You can still follow the checklist below.' }) }
  }
  return <main ref={shellRef} className="app panel pairing-screen">
    <Header title="Security & pairing" subtitle="Private access for your mobile device" back={back}/>

    <section className="settings-group">
      <p className="settings-group-header">Recommended</p>
      <div className="settings-group-body settings-hero-cell">
        <div className="settings-hero-icon"><ShieldCheck size={22}/></div>
        <div className="settings-cell-stack">
          <span className="settings-cell-label">Pair over Tailscale</span>
          <span className="settings-cell-detail">Keep your Hermes gateway private. Your phone joins your Tailnet instead of exposing port 9119 to the public internet.</span>
        </div>
      </div>
    </section>

    <section className="settings-group">
      <p className="settings-group-header">Verify your Windows gateway</p>
      <div className="settings-group-body settings-field-group">
        <label className="settings-field">
          <span className="settings-field-label">Gateway URL</span>
          <input value={gatewayUrl} onChange={event => { setGatewayUrl(event.target.value); probeEpochRef.current += 1; setVerifiedEndpoint(null); setPasswordAuth(false); setPassword('') }} placeholder="https://your-pc.tailnet.ts.net:9119" inputMode="url" autoCapitalize="none" autoCorrect="off"/>
        </label>
      </div>

      <div className="settings-button-row">
        <button className="settings-button" disabled={checking || signingIn} aria-busy={checking} onClick={() => void testGateway()}>{checking ? <><LoaderCircle className="pairing-spinner" size={16}/> Checking gateway…</> : <><Wifi size={16}/> Test gateway</>}</button>
      </div>

      {verifiedEndpoint && passwordAuth && <div className="settings-group-body settings-field-group settings-credentials">
        <label className="settings-field">
          <span className="settings-field-label">Username</span>
          <input value={username} onChange={event => setUsername(event.target.value)} placeholder="Hermes gateway username" autoCapitalize="none" autoCorrect="off" autoComplete="username"/>
        </label>
        <label className="settings-field">
          <span className="settings-field-label">Password</span>
          <input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Hermes gateway password" autoComplete="current-password"/>
        </label>
        <p className="settings-group-footnote">Used once to obtain a revocable Hermes credential. The password itself is not saved.</p>
      </div>}

      {verifiedEndpoint && <div className="settings-button-row">
        <button className="settings-button settings-button-primary" disabled={signingIn || (passwordAuth && (!username.trim() || !password))} aria-busy={signingIn} onClick={() => void completeSignIn()}>{signingIn ? <><LoaderCircle className="pairing-spinner" size={16}/> Signing in and connecting…</> : <>{passwordAuth ? 'Sign in & connect' : 'Continue to secure sign-in'}</>}</button>
      </div>}

      {result && <p className={`settings-status ${result.tone === 'success' ? 'is-good' : 'is-bad'}`}>{result.tone === 'success' ? <CheckCircle2 size={15}/> : <LockKeyhole size={15}/>}<span>{result.text}</span></p>}

      <p className="settings-group-footnote">Never enter <code>127.0.0.1</code> or <code>localhost</code> on your phone—those point back to the phone itself.</p>
    </section>

    <section className="settings-group">
      <p className="settings-group-header">Pair a phone</p>
      <div className="settings-group-body">
        <div className="settings-cell settings-cell-static settings-step-cell">
          <Smartphone size={18} className="settings-step-icon" aria-hidden="true"/>
          <span className="settings-cell-stack">
            <span className="settings-cell-label">Join the same Tailnet</span>
            <span className="settings-cell-detail">Install Tailscale on Windows and Android, then sign into the same account.</span>
          </span>
        </div>
        <div className="settings-cell settings-cell-static settings-step-cell">
          <Wifi size={18} className="settings-step-icon" aria-hidden="true"/>
          <span className="settings-cell-stack">
            <span className="settings-cell-label">Run a reachable Hermes gateway</span>
            <span className="settings-cell-detail">Use a Tailscale hostname or authenticated HTTPS URL. Keep direct public port exposure off.</span>
          </span>
        </div>
        <div className="settings-cell settings-cell-static settings-step-cell">
          <LockKeyhole size={18} className="settings-step-icon" aria-hidden="true"/>
          <span className="settings-cell-stack">
            <span className="settings-cell-label">Authenticate inside Hermes Mobile</span>
            <span className="settings-cell-detail">Enter the gateway username and password once. Mobile exchanges them for revocable Hermes tokens and keeps those tokens in Android secure storage.</span>
          </span>
        </div>
      </div>
    </section>

    <section className="settings-group">
      <div className="settings-group-body">
        <button className="settings-cell" onClick={() => void copyChecklist()}>
          <span className="settings-cell-label">{copied ? 'Setup checklist copied' : 'Copy setup checklist'}</span>
          {copied ? <CheckCircle2 size={18} className="settings-check" aria-hidden="true"/> : <Copy size={17} className="settings-chevron" aria-hidden="true"/>}
        </button>
        <a className="settings-cell" {...external('https://hermes-agent.nousresearch.com/docs/user-guide/multi-connection-desktop')}>
          <span className="settings-cell-label">Gateway connection guide</span>
          <ExternalLink size={16} className="settings-chevron" aria-hidden="true"/>
        </a>
      </div>
    </section>

    <p className="settings-group-footnote settings-disclosure">Hermes Mobile verifies reachability first, exchanges your gateway credentials for revocable Hermes tokens inside the native app, stores tokens in OS-backed secure storage, and marks the host connected only after REST and WebSocket verification.</p>
  </main>
}

function AppearanceSettings({
  back,
  theme,
  setTheme,
  uiScale,
  setUiScale,
}: {
  back: () => void
  theme: Theme
  setTheme: (theme: Theme) => void
  uiScale: number
  setUiScale: (scale: number) => void
}) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)

  const scalePercent = Math.round(uiScale * 100)
  const isDefault = Math.abs(uiScale - 1.15) < 0.02

  return (
    <main ref={shellRef} className="app panel appearance-screen">
      <Header title="Appearance" subtitle="Theme & Text Size" back={back}/>

      <section className="settings-group">
        <p className="settings-group-header">Theme</p>
        <div className="settings-group-body">
          {themes.map(item => {
            const isSelected = item.id === theme
            return (
              <button
                key={item.id}
                type="button"
                className={`settings-cell settings-theme-cell ${isSelected ? 'is-selected' : ''}`}
                onClick={() => setTheme(item.id)}
              >
                <span className={`theme-swatch theme-${item.id}`}/>
                <span className="settings-cell-stack">
                  <span className="settings-cell-label">{item.label}</span>
                  <span className="settings-cell-detail">{item.description}</span>
                </span>
                {isSelected && <Check size={19} className="settings-check" aria-hidden="true"/>}
              </button>
            )
          })}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-group-header-row">
          <p className="settings-group-header">Text &amp; display size</p>
          <span className="settings-group-value">{scalePercent}%</span>
        </div>

        <div className="settings-group-body settings-scale-body">
          <div className="scale-slider-row">
            <span className="scale-glyph small" aria-hidden="true">A</span>
            <input
              type="range"
              min="0.85"
              max="1.25"
              step="0.05"
              value={uiScale}
              onChange={e => setUiScale(parseFloat(e.target.value))}
              aria-label="Text and interface size"
              className="scale-range-slider"
            />
            <span className="scale-glyph large" aria-hidden="true">A</span>
          </div>

          <div className="scale-quick-presets">
            {[
              { label: 'Compact', val: 0.85 },
              { label: 'Normal', val: 1.0 },
              { label: 'Large', val: 1.15 },
              { label: 'X-Large', val: 1.25 },
            ].map(preset => (
              <button
                key={preset.label}
                type="button"
                className={`scale-preset-pill ${Math.abs(uiScale - preset.val) < 0.02 ? 'active' : ''}`}
                onClick={() => setUiScale(preset.val)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <p className="settings-group-footnote">
          {isDefault
            ? 'Text and interface elements scale together across chats, tabs, and tasks.'
            : 'Text and interface elements scale together. Reset to return to the default size.'}
        </p>

        <div className="settings-preview" aria-hidden="true">
          <span className="settings-preview-sender">Hermes Agent</span>
          <p>Text and interface elements scale smoothly across chats, tabs, and tasks.</p>
        </div>
      </section>
    </main>
  )
}

function DiagnosticsSettings({ back }: { back: () => void }) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  const [enabled, setEnabled] = useState(() => isPerformanceDiagnosticsEnabled())
  const [host, setHost] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('hermes_perf_debug_host') || '100.117.86.67' : '100.117.86.67'))
  const [token, setToken] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('hermes_perf_debug_token') || '' : ''))
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [bufferCount, setBufferCount] = useState(() => exportBufferedPerformanceEvents().length)

  const toggleEnabled = (val: boolean) => {
    setEnabled(val)
    setPerformanceDiagnosticsEnabled(val)
    setBufferCount(exportBufferedPerformanceEvents().length)
  }

  const updateHost = (val: string) => {
    setHost(val)
    setPerformanceLogHost(val.trim() || null)
  }

  const updateToken = (val: string) => {
    setToken(val)
    setPerformanceAuthToken(val.trim() || null)
  }

  const sendTestBatch = async () => {
    setTestStatus('Sending test record…')
    recordPerformanceEvent({
      op: 'diagnostics_test',
      phase: 'manual_ping',
      traceId: createTraceId('diag'),
      durationMs: 1.23,
      timestamp: new Date().toISOString(),
      metrics: { manual: true },
    })
    setBufferCount(exportBufferedPerformanceEvents().length)
    try {
      await flushPerformanceEvents()
      setTestStatus('Sent successfully to debug server!')
      setBufferCount(exportBufferedPerformanceEvents().length)
      setTimeout(() => setTestStatus(null), 3000)
    } catch {
      setTestStatus('Failed to send (server unreachable)')
      setTimeout(() => setTestStatus(null), 3000)
    }
  }

  const exportJson = async () => {
    const data = exportBufferedPerformanceEvents()
    const str = JSON.stringify(data, null, 2)
    try {
      await navigator.clipboard.writeText(str)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const clearBuffer = () => {
    clearPerformanceBuffer()
    setBufferCount(0)
  }

  return (
    <main ref={shellRef} className="app panel appearance-screen">
      <Header title="Diagnostics" subtitle="Remote Performance Telemetry" back={back}/>

      <section className="settings-group">
        <p className="settings-group-header">Performance diagnostics</p>
        <div className="settings-group-body">
          <div className="settings-cell settings-cell-static">
            <span className="settings-cell-stack">
              <span className="settings-cell-label">Performance Diagnostics</span>
              <span className="settings-cell-detail">Batch interaction timings, render latency, and long tasks to the debug server.</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Performance Diagnostics"
              className={`settings-switch ${enabled ? 'is-on' : ''}`}
              onClick={() => toggleEnabled(!enabled)}
            >
              <span className="settings-switch-knob"/>
            </button>
          </div>
        </div>

        <div className="settings-group-body settings-field-group">
          <label className="settings-field">
            <span className="settings-field-label">Debug log server host</span>
            <input
              value={host}
              onChange={e => updateHost(e.target.value)}
              placeholder="100.117.86.67"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Debug auth token</span>
            <input
              type="password"
              value={token}
              onChange={e => updateToken(e.target.value)}
              placeholder="Optional"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>
        </div>
      </section>

      <section className="settings-group">
        <p className="settings-group-header">Actions</p>
        <div className="settings-group-body">
          <div className="settings-cell settings-cell-static">
            <span className="settings-cell-label">Buffered records in queue</span>
            <span className="settings-cell-value">{bufferCount}</span>
          </div>
        </div>

        <div className="settings-action-row">
          <button type="button" className="settings-action" disabled={!enabled} onClick={() => void sendTestBatch()}>
            <Send size={15}/> Test log batch
          </button>
          <button type="button" className="settings-action" onClick={() => void exportJson()}>
            <Copy size={15}/> {copied ? 'Copied' : 'Export JSON'}
          </button>
          <button type="button" className="settings-action" onClick={clearBuffer}>
            <Trash2 size={15}/> Clear
          </button>
        </div>

        {testStatus && (
          <p className={`settings-status ${testStatus.includes('success') ? 'is-good' : 'is-bad'}`}>{testStatus}</p>
        )}

        <p className="settings-group-footnote">
          Diagnostics run non-blocking and asynchronously over Tailscale port 8765. No prompt text or private messages are ever logged.
        </p>
      </section>
    </main>
  )
}

export function ConnectionSettings({ profiles, sessions, connected, endpoint, theme, setTheme, uiScale, setUiScale, close, refresh, onPairingBusy, onPaired }: Props) {
  const [page, setPage] = useState<Page>('root')
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle')
  const [isClosing, setIsClosing] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  // True while the page eases back to rest after a drag was released.
  const [isSettling, setIsSettling] = useState(false)

  // Horizontal navigation: the sub-page slides in from the right and back out
  // to the right. `navOffset` is the sub-page's translateX in CSS pixels.
  const [navOffset, setNavOffset] = useState(0)
  const [navAnimating, setNavAnimating] = useState(false)
  // While the finger is down the page must track it exactly, so the CSS
  // transition is suspended and the transform is driven by the gesture.
  const [navDragging, setNavDragging] = useState(false)

  const isClosingRef = useRef(false)
  isClosingRef.current = isClosing

  const sheetRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { scrolled: rootScrolled, ref: rootScrollRef } = useScrolledPastTop()
  const { scrolled: subScrolled, ref: subScrollRef } = useScrolledPastTop()
  // The sheet's drag handler reads the active scroller's scrollTop.
  const subScrollCallback = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node
    subScrollRef(node)
  }, [subScrollRef])
  const dragStartYRef = useRef(0)
  const dragYRef = useRef(0)
  const dragStartXRef = useRef(0)
  const dragStartTimeRef = useRef(0)
  const isTrackingRef = useRef(false)
  const isConfirmedDragRef = useRef(false)
  const closeTimerRef = useRef<number | null>(null)

  // Swipe-back gesture state.
  const swipeStartXRef = useRef(0)
  const swipeStartYRef = useRef(0)
  const swipeStartTimeRef = useRef(0)
  const swipeTrackingRef = useRef(false)
  const swipeIntentRef = useRef(false)
  const swipeOffsetRef = useRef(0)
  const navAnimatingRef = useRef(false)
  navAnimatingRef.current = navAnimating

  // Body scroll lock while settings overlay sheet is open & timer cleanup
  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return
    isClosingRef.current = true

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) {
      close()
      return
    }

    setIsClosing(true)
    // Must outlast the exit animation in CSS (0.26s), or the sheet is
    // unmounted mid-slide and vanishes 123px short of the bottom edge.
    closeTimerRef.current = window.setTimeout(() => {
      close()
    }, 280)
  }, [close])

  /* ---------------------------------------------------------------------
   * Horizontal page navigation with an iOS-style push / pop transition.
   *
   * Two layers live in the sheet: the root Settings page and the current
   * sub-page. One number drives both: `navOffset` is the sub-page's
   * translateX. The root page always sits one sheet-width behind it, so a
   * push (sub-page from +width to 0) and a pop (sub-page from 0 to +width)
   * are the same motion seen from opposite ends.
   * ------------------------------------------------------------------- */

  const prefersReducedMotion = useCallback(() => {
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  /*
   * The sheet's width in CSS pixels. `clientWidth` is used rather than
   * `getBoundingClientRect()` because the app scales with
   * `documentElement.style.zoom`: the rect is in visual pixels, while the
   * transform and the gesture deltas are both in CSS pixels.
   */
  const sheetWidth = useCallback(() => {
    const width = sheetRef.current?.clientWidth
    return width && width > 0 ? width : window.innerWidth
  }, [])

  // Navigate to a sub-page: the new page slides in from the right.
  const pushPage = useCallback((next: Page) => {
    if (navAnimatingRef.current) return
    if (prefersReducedMotion()) { setPage(next); return }
    const width = sheetWidth()
    setPage(next)
    setNavOffset(width)
    setNavAnimating(true)
    // Two frames so the browser commits the start position before the
    // transition is armed.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setNavOffset(0)
        window.setTimeout(() => setNavAnimating(false), NAV_DURATION_MS)
      })
    })
  }, [prefersReducedMotion, sheetWidth])

  // Return to the root page: the current page slides off to the right.
  const popPage = useCallback(() => {
    if (navAnimatingRef.current) return
    if (page === 'root') return
    if (prefersReducedMotion()) { setPage('root'); return }
    const width = sheetWidth()
    setNavOffset(width)
    setNavAnimating(true)
    window.setTimeout(() => {
      setPage('root')
      setNavOffset(0)
      setNavAnimating(false)
    }, NAV_DURATION_MS)
  }, [page, prefersReducedMotion, sheetWidth])
  // Android hardware back & Escape key handling
  useEffect(() => {
    const onMobileBack = (event: Event) => {
      event.preventDefault()
      if (page !== 'root') {
        popPage()
      } else {
        handleClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (page !== 'root') {
          popPage()
        } else {
          handleClose()
        }
      }
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('hermes-mobile-back', onMobileBack)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [page, handleClose, popPage])

  // Keep the modal modal: mark the app behind it inert so screen readers and
  // focus stay inside the sheet, and move focus in on open.
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (!appRoot) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const hadInert = appRoot.hasAttribute('inert')
    // `inert` removes the subtree from the focus order and the a11y tree.
    // `aria-hidden` covers engines without `inert` support.
    appRoot.setAttribute('inert', '')
    appRoot.setAttribute('aria-hidden', 'true')
    const sheet = sheetRef.current
    sheet?.querySelector<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus()
    return () => {
      if (!hadInert) appRoot.removeAttribute('inert')
      appRoot.removeAttribute('aria-hidden')
      previouslyFocused?.focus?.()
    }
  }, [])

  // Trap Tab inside the sheet while it is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const sheet = sheetRef.current
      if (!sheet) return
      const focusable = [...sheet.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.hasAttribute('disabled') && el.getClientRects().length > 0)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const syncNow = async () => {
    if (syncState === 'syncing') return
    setSyncState('syncing')
    try {
      const result = await refresh()
      setSyncState(result ? 'success' : 'error')
    } catch {
      setSyncState('error')
    }
  }



  // Interactive slide-down touch handlers (the sheet itself).
  // A sub-page covers the whole screen, so the sheet's drag-to-dismiss
  // does not apply there; the sub-page owns its own swipe-back gesture.
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || isClosingRef.current || page !== 'root') return
    const target = e.target as HTMLElement | null

    const touch = e.touches[0]
    dragStartYRef.current = touch.clientY
    dragStartXRef.current = touch.clientX
    dragStartTimeRef.current = Date.now()
    dragYRef.current = 0
    setIsSettling(false)

    const isBar = Boolean(target?.closest('.settings-drag-handle-bar'))

    isTrackingRef.current = true
    isConfirmedDragRef.current = isBar
    if (isBar) {
      setIsDragging(true)
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isTrackingRef.current || isClosingRef.current || e.touches.length !== 1) return
    const touch = e.touches[0]
    const deltaY = touch.clientY - dragStartYRef.current
    const deltaX = touch.clientX - dragStartXRef.current

    if (!isConfirmedDragRef.current) {
      const scrollTop = scrollContainerRef.current?.scrollTop ?? 0
      if (scrollTop > 0) {
        isTrackingRef.current = false
        return
      }

      if (deltaY > 8 && deltaY > Math.abs(deltaX) * 1.25) {
        isConfirmedDragRef.current = true
        setIsDragging(true)
      } else if (Math.abs(deltaX) > 10 || deltaY < -10) {
        isTrackingRef.current = false
        return
      }
    }

    if (isConfirmedDragRef.current) {
      if (deltaY > 0) {
        dragYRef.current = deltaY
        setDragY(deltaY)
      } else {
        dragYRef.current = deltaY * 0.15
        setDragY(deltaY * 0.15)
      }
    }
  }

  const handleTouchEnd = () => {
    if (!isTrackingRef.current) return
    isTrackingRef.current = false

    if (isConfirmedDragRef.current) {
      setIsDragging(false)
      // Read from the ref: React has not re-rendered yet, so the state value
      // is the one from the previous frame.
      const distance = dragYRef.current
      const duration = Math.max(1, Date.now() - dragStartTimeRef.current)
      const velocity = distance / duration

      if (distance > 110 || velocity > 0.4) {
        handleClose()
      } else {
        // Ease back to rest rather than snapping.
        setIsSettling(true)
        dragYRef.current = 0
        setDragY(0)
        window.setTimeout(() => setIsSettling(false), 280)
      }
    }

    isConfirmedDragRef.current = false
  }

  const handleTouchCancel = () => {
    isTrackingRef.current = false
    isConfirmedDragRef.current = false
    setIsDragging(false)
    dragYRef.current = 0
    setDragY(0)
  }

  /* ---------------------------------------------------------------------
   * Swipe-back gesture on a sub-page. A rightward horizontal drag pulls the
   * sub-page toward the right; releasing past the threshold (or with enough
   * velocity) pops back to the root Settings page.
   * ------------------------------------------------------------------- */

  const handleSubPageTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || isClosingRef.current || navAnimatingRef.current) return
    const touch = e.touches[0]
    swipeStartXRef.current = touch.clientX
    swipeStartYRef.current = touch.clientY
    swipeStartTimeRef.current = Date.now()
    swipeTrackingRef.current = true
    swipeIntentRef.current = false
    swipeOffsetRef.current = 0
  }

  const handleSubPageTouchMove = (e: React.TouchEvent) => {
    if (!swipeTrackingRef.current || isClosingRef.current || e.touches.length !== 1) return
    const touch = e.touches[0]
    // Touch coordinates are visual pixels; the transform is in CSS pixels.
    // The app scales with `documentElement.style.zoom`, so convert.
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1
    const deltaX = (touch.clientX - swipeStartXRef.current) / zoom
    const deltaY = (touch.clientY - swipeStartYRef.current) / zoom

    if (!swipeIntentRef.current) {
      const distance = Math.hypot(deltaX, deltaY)
      if (distance < 10) return
      // Only a distinctly horizontal rightward drag commits to swipe-back.
      // A vertical drag belongs to the page's own scrolling.
      if (deltaX > 0 && deltaX > Math.abs(deltaY) * 1.3) {
        swipeIntentRef.current = true
        setNavDragging(true)
      } else {
        swipeTrackingRef.current = false
        return
      }
    }

    // The page follows the finger, clamped to the sheet width.
    const width = sheetWidth()
    const offset = Math.min(width, Math.max(0, deltaX))
    swipeOffsetRef.current = offset
    setNavOffset(offset)
    if (e.cancelable) e.preventDefault()
  }

  const handleSubPageTouchEnd = () => {
    if (!swipeTrackingRef.current) return
    swipeTrackingRef.current = false

    if (!swipeIntentRef.current) {
      swipeOffsetRef.current = 0
      return
    }

    const width = sheetWidth()
    const duration = Math.max(1, Date.now() - swipeStartTimeRef.current)
    const velocity = swipeOffsetRef.current / duration
    const shouldPop = swipeOffsetRef.current > width * 0.32 || velocity > 0.45
    const settleDelay = prefersReducedMotion() ? 0 : NAV_DURATION_MS

    // The finger is up: re-arm the CSS transition so the page eases to rest.
    setNavDragging(false)
    setNavAnimating(true)

    if (shouldPop) {
      // Continue the slide out, then swap to the root page underneath.
      setNavOffset(width)
      window.setTimeout(() => {
        setPage('root')
        setNavOffset(0)
        setNavAnimating(false)
      }, settleDelay)
    } else {
      // Snap back to the sub-page.
      setNavOffset(0)
      window.setTimeout(() => setNavAnimating(false), settleDelay)
    }
    swipeIntentRef.current = false
    swipeOffsetRef.current = 0
  }

  const handleSubPageTouchCancel = () => {
    swipeTrackingRef.current = false
    if (swipeIntentRef.current) {
      // Abort the swipe and snap back to the sub-page.
      setNavDragging(false)
      setNavAnimating(true)
      setNavOffset(0)
      window.setTimeout(() => setNavAnimating(false), prefersReducedMotion() ? 0 : NAV_DURATION_MS)
    }
    swipeIntentRef.current = false
    swipeOffsetRef.current = 0
  }

  // Pointer events on the drag bar (desktop / mouse testing)
  const handleBarPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !e.isPrimary || e.button !== 0 || isClosingRef.current) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    dragStartYRef.current = e.clientY
    dragStartTimeRef.current = Date.now()
    dragYRef.current = 0
    setIsSettling(false)
    isTrackingRef.current = true
    isConfirmedDragRef.current = true
    setIsDragging(true)
  }

  const handleBarPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !isTrackingRef.current) return
    const deltaY = e.clientY - dragStartYRef.current
    if (deltaY > 0) {
      dragYRef.current = deltaY
      setDragY(deltaY)
    } else {
      dragYRef.current = deltaY * 0.15
      setDragY(deltaY * 0.15)
    }
  }

  const handleBarPointerCancel = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !isTrackingRef.current) return
    isTrackingRef.current = false
    isConfirmedDragRef.current = false
    setIsDragging(false)
    setDragY(0)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
  }

  const handleBarPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !isTrackingRef.current) return
    isTrackingRef.current = false
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}

    // Read the distance from a ref, not from state: React has not re-rendered
    // yet at this point, so the state value is the one from the last frame.
    const distance = dragYRef.current
    const duration = Math.max(1, Date.now() - dragStartTimeRef.current)
    const velocity = distance / duration
    if (distance > 110 || velocity > 0.4) {
      handleClose()
    } else {
      // Ease back to rest rather than snapping.
      setIsSettling(true)
      dragYRef.current = 0
      setDragY(0)
      window.setTimeout(() => setIsSettling(false), 280)
    }
  }

  const renderSubPage = () => {
    if (page === 'appearance') {
      return (
        <AppearanceSettings
          back={popPage}
          theme={theme}
          setTheme={setTheme}
          uiScale={uiScale ?? 1}
          setUiScale={setUiScale ?? (() => {})}
        />
      )
    }
    if (page === 'diagnostics') return <DiagnosticsSettings back={popPage} />
    if (page === 'about') return <AboutHermesMobile back={popPage} />
    if (page === 'pairing') {
      return (
        <PairingSettings
          back={popPage}
          onPaired={onPaired}
          onPairingBusy={onPairingBusy}
          initialEndpoint={endpoint}
        />
      )
    }
    return null
  }

  const renderRootPage = () => {
    const displayEndpoint = endpoint?.replace(/^https?:\/\//, '')
    return (
      <main className="app panel connection-screen">
        <section className={`connection-card ${connected ? 'connected' : 'unpaired'}`}>
          <span className="connection-endpoint">
            {displayEndpoint || (endpoint ? 'Saved host' : 'No host paired')}
          </span>

          <span className="connection-meta">
            <span className={`connection-state ${connected ? 'is-connected' : 'is-disconnected'}`}>
              <span className="connection-state-dot" aria-hidden="true" />
              {connected ? 'Connected' : 'Not connected'}
            </span>
            {connected && (
              <>
                <span className="connection-sep" aria-hidden="true">·</span>
                <span>{profiles} Bots</span>
                <span className="connection-sep" aria-hidden="true">·</span>
                <span>{sessions} Sessions</span>
              </>
            )}
          </span>

          <button
            className="primary connection-action"
            disabled={connected && syncState === 'syncing'}
            aria-busy={connected && syncState === 'syncing'}
            onClick={connected ? () => void syncNow() : endpoint ? () => void refresh() : () => pushPage('pairing')}
          >
            {connected ? (
              syncState === 'syncing'
                ? <><LoaderCircle className="connection-sync-spinner" size={15} /> Syncing…</>
                : syncState === 'success'
                ? <><CheckCircle2 size={15} /> Synced</>
                : <><RefreshCw size={15} /> Sync now</>
            ) : endpoint ? (
              <><RefreshCw size={15} /> Retry connection</>
            ) : (
              <>Set up pairing</>
            )}
          </button>

          {connected && syncState === 'error' && (
            <p className="connection-sync-result error" role="status">
              Sync could not complete. Check the host connection and try again.
            </p>
          )}
        </section>
        <section className="settings-group">
          <p className="settings-group-header">Preference</p>
          <div className="settings-group-body">
            <button className="settings-cell" onClick={() => pushPage('appearance')}>
              <span className="settings-cell-label">Appearance</span>
              <ChevronRight className="settings-chevron" size={16} aria-hidden="true"/>
            </button>
            <button className="settings-cell" onClick={() => pushPage('diagnostics')}>
              <span className="settings-cell-label">Diagnostics &amp; Performance</span>
              <ChevronRight className="settings-chevron" size={16} aria-hidden="true"/>
            </button>
            <button className="settings-cell" onClick={() => pushPage('pairing')}>
              <span className="settings-cell-stack">
                <span className="settings-cell-label">Security &amp; pairing</span>
                <span className={`settings-cell-detail${connected ? '' : ' is-alert'}`}>{connected ? 'Connected' : 'Disconnected'}</span>
              </span>
              <ChevronRight className="settings-chevron" size={16} aria-hidden="true"/>
            </button>
          </div>
        </section>

        <section className="settings-group">
          <p className="settings-group-header">Hermes Mobile</p>
          <div className="settings-group-body">
            <a className="settings-cell" {...external('https://github.com/CodeUpdaterBot/Hermes-Mobile-App')}>
              <GitBranch size={18} className="settings-step-icon" aria-hidden="true"/>
              <span className="settings-cell-stack">
                <span className="settings-cell-label">Hermes Mobile on GitHub</span>
                <span className="settings-cell-detail">Source, releases, and feedback</span>
              </span>
              <ExternalLink size={16} className="settings-chevron" aria-hidden="true"/>
            </a>
          </div>
        </section>

        <section className="settings-group">
          <p className="settings-group-header">Hermes Agent</p>
          <div className="settings-group-body">
            <a className="settings-cell" {...external('https://hermes-agent.nousresearch.com/')}>
              <Globe2 size={18} className="settings-step-icon" aria-hidden="true"/>
              <span className="settings-cell-stack">
                <span className="settings-cell-label">Hermes Agent</span>
                <span className="settings-cell-detail">Official website</span>
              </span>
              <ExternalLink size={16} className="settings-chevron" aria-hidden="true"/>
            </a>
            <a className="settings-cell" {...external('https://hermes-agent.nousresearch.com/docs/')}>
              <Globe2 size={18} className="settings-step-icon" aria-hidden="true"/>
              <span className="settings-cell-stack">
                <span className="settings-cell-label">Documentation</span>
                <span className="settings-cell-detail">Guides for hosts, gateways, and Bots</span>
              </span>
              <ExternalLink size={16} className="settings-chevron" aria-hidden="true"/>
            </a>
            <a className="settings-cell" {...external('https://github.com/NousResearch/hermes-agent')}>
              <GitBranch size={18} className="settings-step-icon" aria-hidden="true"/>
              <span className="settings-cell-stack">
                <span className="settings-cell-label">Hermes Agent on GitHub</span>
                <span className="settings-cell-detail">Open-source agent runtime</span>
              </span>
              <ExternalLink size={16} className="settings-chevron" aria-hidden="true"/>
            </a>
            <a className="settings-cell" {...external('https://discord.gg/NousResearch')}>
              <Heart size={18} className="settings-step-icon" aria-hidden="true"/>
              <span className="settings-cell-stack">
                <span className="settings-cell-label">Nous Research Discord</span>
                <span className="settings-cell-detail">Community and support</span>
              </span>
              <ExternalLink size={16} className="settings-chevron" aria-hidden="true"/>
            </a>
          </div>
        </section>

        <button className="settings-identity" onClick={() => pushPage('about')}>
          <img src={HermesMobileLogo} alt="" aria-hidden="true"/>
          <span className="settings-identity-name">Hermes Mobile</span>
          <span className="settings-identity-version">0.1.1</span>
        </button>

        <p className="fine">The host owns models, credentials, tools, memory, skills, and approvals. This client is the control surface.</p>
      </main>
    )
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`settings-modal-overlay ${isClosing ? 'is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Settings and host connection"
    >
      <div
        className="settings-modal-backdrop"
        style={{
          opacity: isDragging ? Math.max(0.1, 1 - (dragY / 300) * 0.8) : undefined,
        }}
        onClick={handleClose}
      />
      <div
        ref={sheetRef}
        className={`settings-modal-sheet ${isClosing ? 'is-closing' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        {/*
          Two stacked pages. The root Settings page sits one sheet-width
          behind the sub-page; both move together so a push and a pop read as
          the same slide seen from opposite ends.

          The stack carries the exit animation, so it moves the root AND the
          sub-page. On the wrapper it moved only the root, and the sub-page
          simply vanished when the overlay unmounted.
        */}
        <div
          className={`settings-page-stack ${isClosing ? 'is-closing' : ''}`}
          style={
            // The exit continues from where the user let go of the sheet.
            isClosing ? ({ '--settings-drag-offset': `${dragY}px` } as React.CSSProperties) : undefined
          }
        >
          <div className="settings-sheet-anim">
            <div
              className={`settings-page settings-page-root ${navAnimating && !navDragging ? 'is-transitioning' : ''} ${isDragging ? 'is-dragging' : ''} ${isSettling ? 'is-settling' : ''}`}
              style={{
                // Two motions on one element: the horizontal push/pop offset and
                // the vertical drag-to-dismiss. The root page carries both so the
                // sheet itself never moves or resizes.
                //
                // The root TRAILS the sub-page by exactly one page width, it is
                // not mirrored against it. Mirroring made the two pages
                // separate instead of moving as a pair, which opened a gap in
                // the middle of the screen and showed the app behind the
                // sheet. On a push the root also lurched backwards mid-slide
                // (-435px -> 0px) as it was reset to its end position.
                //
                // `100%` is the root's own width, i.e. the sheet width, so
                // this needs no layout read during render.
                //
                // The drag offset applies only while dragging. On a dismiss
                // the exit animation takes over on the page stack, which
                // carries both the root and the sub-page, and starts from
                // the drag offset so the sheet keeps sliding down from the
                // finger instead of jumping up to the top first.
                transform: [
                  page === 'root'
                    ? 'translateX(0)'
                    : `translateX(calc(${navOffset}px - 100%))`,
                  isDragging ? `translateY(${dragY}px)` : '',
                ].filter(Boolean).join(' '),
              }}
            >
              <div
                className="settings-drag-handle-bar"
                onPointerDown={handleBarPointerDown}
                onPointerMove={handleBarPointerMove}
                onPointerUp={handleBarPointerUp}
                onPointerCancel={handleBarPointerCancel}
                onLostPointerCapture={handleBarPointerCancel}
              >
                <div className="settings-drag-pill" aria-hidden="true" />
              </div>
              <div className={`settings-modal-scroll ${rootScrolled ? 'is-faded-top' : ''}`} ref={rootScrollRef}>{renderRootPage()}</div>
            </div>
          </div>

          {page !== 'root' && (
            <div
              className={`settings-page settings-page-sub ${navAnimating && !navDragging ? 'is-transitioning' : ''}`}
              style={{ transform: `translateX(${navOffset}px)` }}
              onTouchStart={handleSubPageTouchStart}
              onTouchMove={handleSubPageTouchMove}
              onTouchEnd={handleSubPageTouchEnd}
              onTouchCancel={handleSubPageTouchCancel}
            >
              <div className={`settings-modal-scroll ${subScrolled ? 'is-faded-top' : ''}`} ref={subScrollCallback}>{renderSubPage()}</div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
