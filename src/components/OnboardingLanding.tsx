import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  ExternalLink,
  HelpCircle,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  Moon,
  Server,
  Sparkles,
  Sun,
  Terminal,
} from 'lucide-react'
import HermesHostIcon from '../assets/hermes-agent-icon-transparent.svg'
import HermesHeroDark from '../assets/hermes-hero-dark.webp'
import HermesHeroLight from '../assets/hermes-hero-light.webp'
import HermesHeroGrey from '../assets/hermes-hero-grey.webp'
import HermesFooterDark from '../assets/hermes-footer-dark.webp'
import HermesFooterLight from '../assets/hermes-footer-light.webp'
import HermesFooterGrey from '../assets/hermes-footer-grey.webp'
import { ArtificialSun } from './ArtificialSun'
import { errorMessage, supportsBasicAuth } from '../connection-state'
import { nativeSignIn, passwordSignIn, probeHermesGateway } from '../hermes'
import '../onboarding.css'

export type Theme = 'light' | 'grey' | 'dark'
export type OnboardingStep = 'welcome' | 'choice' | 'remote' | 'termux'

export interface OnboardingLandingProps {
  onPaired: (endpoint: string) => Promise<void>
  onSkip?: () => void
  theme: Theme
  setTheme: (theme: Theme) => void
  initialStep?: OnboardingStep
}

export function isLoopbackAddress(urlStr: string): boolean {
  const trimmed = urlStr.trim()
  if (!trimmed) return false
  if (trimmed === '::1' || trimmed === '[::1]' || trimmed === 'localhost' || trimmed === 'localhost.') return true
  try {
    let target = trimmed.includes('://') ? trimmed : `http://${trimmed}`
    if (target.startsWith('http://::1') && !target.startsWith('http://[::1]')) {
      target = target.replace('http://::1', 'http://[::1]')
    }
    const parsed = new URL(target)
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host === '::1') return true
    const parts = host.split('.')
    if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
      const first = Number(parts[0])
      if (first === 127) return true
    }
    return false
  } catch {
    return false
  }
}

export function validateAndNormalizeGatewayUrl(raw: string): { url: string; error?: string } {
  const trimmed = raw.trim().replace(/\/$/, '')
  if (!trimmed) {
    return { url: '', error: 'Gateway address cannot be empty.' }
  }

  let target = trimmed
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    target = `http://${trimmed}`
  }

  try {
    const parsed = new URL(target)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: '', error: 'Only http:// and https:// URLs are supported.' }
    }
    if (parsed.username || parsed.password) {
      return { url: '', error: 'Please enter credentials in the username/password fields, not in the URL.' }
    }
    if (!parsed.hostname) {
      return { url: '', error: 'URL must contain a valid host name or IP address.' }
    }
    if (parsed.port) {
      const portNum = Number(parsed.port)
      if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
        return { url: '', error: 'Port must be between 1 and 65535.' }
      }
    }
    return { url: parsed.origin + parsed.pathname.replace(/\/$/, '') }
  } catch {
    return { url: '', error: 'Please enter a valid URL (e.g. http://100.x.y.z:9119).' }
  }
}

export function normalizeGatewayUrl(raw: string): string {
  const res = validateAndNormalizeGatewayUrl(raw)
  return res.url
}

const TERMUX_INSTALL_CMD = 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'

export function OnboardingLanding({
  onPaired,
  onSkip,
  theme,
  setTheme,
  initialStep = 'welcome',
}: OnboardingLandingProps) {
  const [step, setStep] = useState<OnboardingStep>(initialStep)
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')

  // Connection form state
  const [gatewayUrl, setGatewayUrl] = useState('')
  const [phase, setPhase] = useState<'idle' | 'probing' | 'verified' | 'signing-in'>('idle')
  const [verifiedEndpoint, setVerifiedEndpoint] = useState<string | null>(null)
  const [gatewayVersion, setGatewayVersion] = useState<string | null>(null)
  const [passwordAuth, setPasswordAuth] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [showTailscaleGuide, setShowTailscaleGuide] = useState(false)
  const [copiedTermux, setCopiedTermux] = useState(false)

  const probeEpochRef = useRef(0)
  const probeAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      probeEpochRef.current++
      if (probeAbortRef.current) {
        probeAbortRef.current.abort()
        probeAbortRef.current = null
      }
    }
  }, [])

  // Listen to hardware or browser back events
  useEffect(() => {
    const handlePopState = () => {
      if (step === 'remote' || step === 'termux') {
        probeEpochRef.current++
        setPhase('idle')
        setResult(null)
        setStep('choice')
      } else if (step === 'choice') {
        setStep('welcome')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [step])

  useEffect(() => {
    if (step !== 'welcome') return
    let isMounted = true

    const sendDiagnostics = () => {
      if (!isMounted) return
      try {
        const candidateUrls = [
          'http://100.117.86.67:8765/log',
          'http://192.168.100.37:8765/log',
        ]
        const topWordEl = document.querySelector('.onboarding-bg-word-top .onboarding-bg-title-word') as HTMLElement | null
        const bottomWordEl = document.querySelector('.onboarding-bg-word-bottom .onboarding-bg-title-word') as HTMLElement | null
        const heroWrapEl = document.querySelector('.onboarding-hero-figure-wrap') as HTMLElement | null
        const heroFigEl = document.querySelector('.onboarding-hero-figure.is-active') as HTMLElement | null
        const screenEl = document.querySelector('.onboarding-screen') as HTMLElement | null
        const stageEl = document.querySelector('.onboarding-welcome-stage') as HTMLElement | null

        const docEl = document.documentElement
        const rootComputed = window.getComputedStyle(docEl)

        const topRect = topWordEl?.getBoundingClientRect()
        const bottomRect = bottomWordEl?.getBoundingClientRect()
        const heroWrapRect = heroWrapEl?.getBoundingClientRect()
        const heroFigRect = heroFigEl?.getBoundingClientRect()
        const screenRect = screenEl?.getBoundingClientRect()
        const stageRect = stageEl?.getBoundingClientRect()

        const topStyle = topWordEl ? window.getComputedStyle(topWordEl) : null
        const bottomStyle = bottomWordEl ? window.getComputedStyle(bottomWordEl) : null

        const fontCheck = {
          rulesGothicCondensed: document.fonts?.check('16px "Rules Gothic Condensed"'),
          rulesGothicCompressed: document.fonts?.check('16px "Rules Gothic Compressed"'),
          rulesVariable: document.fonts?.check('16px "Rules Variable"'),
        }

        const payload = [
          `=== ONBOARDING DIAGNOSTICS (${new Date().toISOString()}) ===`,
          `Viewport: innerWidth=${window.innerWidth}, innerHeight=${window.innerHeight}, dpr=${window.devicePixelRatio}`,
          `Screen: availWidth=${window.screen.availWidth}, availHeight=${window.screen.availHeight}, width=${window.screen.width}, height=${window.screen.height}`,
          `Zoom & Scale: document.documentElement.style.zoom="${docEl.style.zoom}", --ui-scale="${rootComputed.getPropertyValue('--ui-scale')}"`,
          `Font Load Status: ${JSON.stringify(fontCheck)}`,
          `Screen Rect: ${JSON.stringify(screenRect)}`,
          `Welcome Stage Rect: ${JSON.stringify(stageRect)}`,
          `Hero Wrap Rect: ${JSON.stringify(heroWrapRect)}`,
          `Hero Figure Rect: ${JSON.stringify(heroFigRect)}`,
          `HERMES Element:`,
          `  - Bounding Rect: left=${topRect?.left.toFixed(1)}, right=${topRect?.right.toFixed(1)}, width=${topRect?.width.toFixed(1)}, height=${topRect?.height.toFixed(1)}`,
          `  - Margins: leftEmpty=${topRect?.left.toFixed(1)}px (${((topRect?.left ?? 0) / window.innerWidth * 100).toFixed(1)}%), rightEmpty=${((window.innerWidth - (topRect?.right ?? 0))).toFixed(1)}px (${(((window.innerWidth - (topRect?.right ?? 0))) / window.innerWidth * 100).toFixed(1)}%)`,
          `  - Computed: fontSize="${topStyle?.fontSize}", fontFamily="${topStyle?.fontFamily}", lineHeight="${topStyle?.lineHeight}", letterSpacing="${topStyle?.letterSpacing}"`,
          `AGENT Element:`,
          `  - Bounding Rect: left=${bottomRect?.left.toFixed(1)}, right=${bottomRect?.right.toFixed(1)}, width=${bottomRect?.width.toFixed(1)}, height=${bottomRect?.height.toFixed(1)}`,
          `  - Margins: leftEmpty=${bottomRect?.left.toFixed(1)}px (${((bottomRect?.left ?? 0) / window.innerWidth * 100).toFixed(1)}%), rightEmpty=${((window.innerWidth - (bottomRect?.right ?? 0))).toFixed(1)}px (${(((window.innerWidth - (bottomRect?.right ?? 0))) / window.innerWidth * 100).toFixed(1)}%)`,
          `  - Computed: fontSize="${bottomStyle?.fontSize}", fontFamily="${bottomStyle?.fontFamily}", lineHeight="${bottomStyle?.lineHeight}", letterSpacing="${bottomStyle?.letterSpacing}"`,
          `============================================================`,
        ].join('\n')

        for (const targetUrl of candidateUrls) {
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
          const timer = controller ? setTimeout(() => controller.abort(), 3500) : null
          fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: payload,
            signal: controller ? controller.signal : undefined,
          })
            .then(res => {
              if (res.ok) console.log(`[Diagnostics] Sent successfully to ${targetUrl}`)
            })
            .catch(() => {})
            .finally(() => {
              if (timer) clearTimeout(timer)
            })
        }
      } catch {}
    }

    const timer1 = setTimeout(sendDiagnostics, 300)
    const timer2 = setTimeout(sendDiagnostics, 1200)
    if (document.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          if (isMounted) sendDiagnostics()
        })
        .catch(() => {})
    }

    return () => {
      isMounted = false
      clearTimeout(timer1)
      clearTimeout(timer2)
    }
  }, [step, theme])

  const cycleTheme = () => {
    const themes: Theme[] = ['light', 'grey', 'dark']
    const next = themes[(themes.indexOf(theme) + 1) % themes.length]
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = next
    }
    setTheme(next)
  }

  const handleCancelProbe = () => {
    probeEpochRef.current++
    if (probeAbortRef.current) {
      probeAbortRef.current.abort()
      probeAbortRef.current = null
    }
    setPhase('idle')
    setResult({
      tone: 'error',
      text: 'Connection test cancelled.',
    })
  }

  const navigateTo = (nextStep: OnboardingStep, dir: 'forward' | 'backward' = 'forward') => {
    probeEpochRef.current++
    if (probeAbortRef.current) {
      probeAbortRef.current.abort()
      probeAbortRef.current = null
    }
    setPhase('idle')
    setResult(null)
    setPassword('')
    setDirection(dir)
    setStep(nextStep)
  }

  const handleBack = () => {
    if (phase === 'probing') {
      handleCancelProbe()
    }
    if (step === 'remote' || step === 'termux') {
      navigateTo('choice', 'backward')
    } else if (step === 'choice') {
      navigateTo('welcome', 'backward')
    }
  }

  const handleTestConnection = async (targetOverride?: string) => {
    const rawToTest = targetOverride || gatewayUrl
    const validation = validateAndNormalizeGatewayUrl(rawToTest)
    if (validation.error || !validation.url) {
      setResult({
        tone: 'error',
        text: validation.error || 'Please enter your Hermes gateway address first.',
      })
      return
    }

    const normalized = validation.url
    const isLoopback = isLoopbackAddress(normalized)

    // Check if the user entered the web app dev server's own port
    if (typeof window !== 'undefined' && window.location) {
      try {
        const parsed = new URL(normalized)
        if (parsed.port === (window.location.port || '1420') && (parsed.hostname === window.location.hostname || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
          setResult({
            tone: 'error',
            text: `Port ${window.location.port || '1420'} is this web app’s dev server. Hermes Agent Gateway typically runs on port 9119 (e.g. http://${parsed.hostname}:9119).`,
          })
          return
        }
      } catch {}
    }

    // Only warn about loopback in remote gateway mode; Termux mode legitimately runs on the phone
    if (step === 'remote' && isLoopback) {
      setResult({
        tone: 'error',
        text: '127.0.0.1 or localhost points to this phone, not your computer. Use your computer’s Tailscale IP or network hostname.',
      })
      return
    }

    const currentEpoch = ++probeEpochRef.current
    if (probeAbortRef.current) {
      probeAbortRef.current.abort()
    }
    const controller = new AbortController()
    probeAbortRef.current = controller

    setPhase('probing')
    setResult(null)
    setVerifiedEndpoint(null)
    setPasswordAuth(false)
    setPassword('')

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = window.setTimeout(() => {
        reject(
          new Error(
            `Connection to ${normalized} timed out after 5s. Make sure Hermes Gateway is running and reachable.`
          )
        )
      }, 5000)

      controller.signal.addEventListener('abort', () => {
        window.clearTimeout(timer)
        reject(new Error('Connection test cancelled.'))
      })
    })

    try {
      const statusPromise = probeHermesGateway(normalized)
      const status = await Promise.race([statusPromise, timeoutPromise])
      if (!mountedRef.current || currentEpoch !== probeEpochRef.current) return

      probeAbortRef.current = null
      const authRequired = status.auth_required === true
      const basicAuthSupported = supportsBasicAuth(status.auth_providers)

      setVerifiedEndpoint(normalized)
      setGatewayVersion(status.version || '0.21.5')
      setPasswordAuth(authRequired && basicAuthSupported)
      setPhase('verified')

      if (authRequired) {
        setResult(null)
      } else {
        setResult({
          tone: 'success',
          text: `Hermes gateway is reachable and ready to connect.`,
        })
      }
    } catch (err) {
      probeAbortRef.current = null
      if (mountedRef.current && currentEpoch === probeEpochRef.current) {
        setPhase('idle')
        const fallbackMsg =
          step === 'termux'
            ? 'No Hermes gateway responded on this phone. Ensure Hermes is running in Termux via `hermes gateway`.'
            : 'Could not reach this Hermes gateway. Ensure your computer is running Hermes and Tailscale is connected.'
        setResult({
          tone: 'error',
          text: errorMessage(err, fallbackMsg),
        })
      }
    }
  }

  const handleCompleteSignIn = async () => {
    if (!verifiedEndpoint) return

    setPhase('signing-in')
    setResult(null)

    try {
      if (passwordAuth) {
        await passwordSignIn(verifiedEndpoint, username.trim(), password)
      } else {
        await nativeSignIn(verifiedEndpoint)
      }

      await new Promise(r => window.setTimeout(r, 150))
      setPassword('')
      await onPaired(verifiedEndpoint)
    } catch (err) {
      setPassword('')
      setPhase('verified')
      setResult({
        tone: 'error',
        text: errorMessage(err, 'Sign-in failed. Please verify your credentials and try again.'),
      })
    }
  }

  const handleResetEndpoint = () => {
    probeEpochRef.current++
    setPhase('idle')
    setVerifiedEndpoint(null)
    setPasswordAuth(false)
    setPassword('')
    setResult(null)
  }

  const handleCopyTermuxCommand = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(TERMUX_INSTALL_CMD)
        setCopiedTermux(true)
        window.setTimeout(() => {
          if (mountedRef.current) setCopiedTermux(false)
        }, 2000)
      }
    } catch {}
  }

  return (
    <main className="onboarding-screen" data-theme={theme}>
      {/* Scenic distant footer anchored full-bleed to the true screen bottom across all onboarding pages */}
      <div className="onboarding-scenic-footer" aria-hidden="true">
        <img
          src={HermesFooterLight}
          alt=""
          width={1200}
          height={675}
          className={`onboarding-footer-img ${theme === 'light' ? 'is-active' : ''}`}
        />
        <img
          src={HermesFooterGrey}
          alt=""
          width={1200}
          height={675}
          className={`onboarding-footer-img ${theme === 'grey' ? 'is-active' : ''}`}
        />
        <img
          src={HermesFooterDark}
          alt=""
          width={1200}
          height={675}
          className={`onboarding-footer-img ${theme === 'dark' ? 'is-active' : ''}`}
        />
      </div>

      <header className="onboarding-header">
        <ArtificialSun theme={theme} setTheme={setTheme} onCycle={cycleTheme} />
      </header>

      {/* STEP 1: WELCOME SCREEN */}
      {step === 'welcome' && (
        <section key="welcome" className={`onboarding-body onboarding-welcome-stage step-slide-${direction}`}>
          <div className="onboarding-hero-composition">
            {/* 3D Hero sculpture figure with tightly locked background typography */}
            <div className="onboarding-hero-figure-wrap" aria-hidden="true">
              {/* Sits tightly behind the top of the sculpture, partially covered by head & wings */}
              <div className="onboarding-bg-word-top">
                <span className="onboarding-bg-title-word">HERMES</span>
              </div>

              {/* Sits tightly behind the bottom of the sculpture, partially covered by lower torso */}
              <div className="onboarding-bg-word-bottom">
                <span className="onboarding-bg-title-word">AGENT</span>
              </div>

              <img
                src={HermesHeroLight}
                alt="Hermes Agent"
                className={`onboarding-hero-figure is-light ${theme === 'light' ? 'is-active' : ''}`}
                width={720}
                height={540}
              />
              <img
                src={HermesHeroGrey}
                alt="Hermes Agent"
                className={`onboarding-hero-figure is-grey ${theme === 'grey' ? 'is-active' : ''}`}
                width={720}
                height={540}
              />
              <img
                src={HermesHeroDark}
                alt="Hermes Agent"
                className={`onboarding-hero-figure is-dark ${theme === 'dark' ? 'is-active' : ''}`}
                width={720}
                height={540}
              />
            </div>

            {/* Slogan positioned just right below the "AGENT" text */}
            <p className="onboarding-welcome-slogan">The Agent That Grows With You.</p>
          </div>

          <div className="onboarding-actions">
            <button
              type="button"
              className="onboarding-btn primary"
              onClick={() => navigateTo('choice')}
            >
              <span>Continue</span>
              <ArrowRight size={17} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: SETUP CHOICE */}
      {step === 'choice' && (
        <section key="choice" className={`onboarding-body onboarding-choice-stage step-slide-${direction}`}>
          <div className="onboarding-title-group">
            <h1 className="onboarding-step-heading">Where is your agent running?</h1>
            <p className="onboarding-step-subhead">
              Choose whether to connect to a host on another machine or run locally on this phone.
            </p>
          </div>

          <div className="onboarding-selector-list">
            <button
              type="button"
              className="onboarding-selector-row"
              onClick={() => {
                setGatewayUrl('')
                navigateTo('remote')
              }}
            >
              <div className="onboarding-selector-icon">
                <Laptop size={22} />
              </div>
              <div className="onboarding-selector-text">
                <span className="onboarding-selector-title">Computer or Server</span>
                <span className="onboarding-selector-desc">Connect to Hermes on your PC over Tailscale, Wi-Fi, or HTTPS.</span>
              </div>
              <span className="onboarding-selector-arrow" aria-hidden="true">›</span>
            </button>

            <button
              type="button"
              className="onboarding-selector-row"
              onClick={() => {
                setGatewayUrl('http://127.0.0.1:9119')
                navigateTo('termux')
              }}
            >
              <div className="onboarding-selector-icon">
                <Terminal size={22} />
              </div>
              <div className="onboarding-selector-text">
                <span className="onboarding-selector-title">Locally on this Phone</span>
                <span className="onboarding-selector-desc">Run the full Hermes CLI engine inside Android's Termux environment.</span>
              </div>
              <span className="onboarding-selector-arrow" aria-hidden="true">›</span>
            </button>
          </div>

          <div className="onboarding-actions">
            <button
              type="button"
              className="onboarding-link-btn"
              onClick={handleBack}
            >
              Back
            </button>
          </div>
        </section>
      )}

      {/* STEP 3A: REMOTE GATEWAY */}
      {step === 'remote' && (
        <section key="remote" className={`onboarding-body onboarding-remote-stage step-slide-${direction}`}>
          <div className="onboarding-title-group">
            <h1 className="onboarding-step-heading">Connect to host</h1>
            <p className="onboarding-step-subhead">
              Enter the Tailscale IP or network address of your PC running Hermes.
            </p>
          </div>

          <div className="onboarding-form">
            {/* Morphing address header: transforms into plain "Gateway <host_addr>" text row without any box wrapper */}
            {(phase === 'verified' || phase === 'signing-in') && passwordAuth ? (
              <div
                className="onboarding-locked-gateway-row"
                onClick={handleResetEndpoint}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') handleResetEndpoint()
                }}
                title="Tap to change gateway address"
              >
                <span className="onboarding-locked-label">Gateway</span>
                <span className="onboarding-locked-host">
                  {(verifiedEndpoint || gatewayUrl).replace(/^https?:\/\//, '')}
                </span>
              </div>
            ) : (
              <div className="onboarding-field">
                <label htmlFor="gateway-url-input" className="onboarding-label">
                  Gateway address
                </label>
                <div className="onboarding-input-wrap">
                  <input
                    id="gateway-url-input"
                    className="onboarding-input"
                    type="text"
                    value={gatewayUrl}
                    onChange={e => {
                      if (phase === 'probing') handleCancelProbe()
                      setGatewayUrl(e.target.value)
                      if (phase !== 'idle') handleResetEndpoint()
                    }}
                    placeholder="http://100.x.y.z:9119"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>

                {/* Inline, clickable Tailscale assistance right where URL is entered */}
                <button
                  type="button"
                  className="onboarding-inline-help-trigger"
                  onClick={() => setShowTailscaleGuide(!showTailscaleGuide)}
                  aria-expanded={showTailscaleGuide}
                >
                  <HelpCircle size={14} className="onboarding-inline-help-icon" />
                  <span>How to connect via Tailscale</span>
                  {showTailscaleGuide ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {showTailscaleGuide && (
                  <div className="onboarding-inline-help-box">
                    <ol>
                      <li>
                        <b>Install Tailscale</b> on your computer and this phone, logged into the same account.
                      </li>
                      <li>
                        <b>Find your PC’s Tailscale IP</b> in the Tailscale app (starts with <code>100.</code>).
                      </li>
                      <li>
                        <b>Start Hermes Gateway</b> on your PC and enter <code>http://100.x.y.z:9119</code> above.
                      </li>
                    </ol>
                  </div>
                )}

                {gatewayUrl.includes(':1420') && (
                  <div className="onboarding-warning" role="alert">
                    Port 1420 is this web app’s dev server. Hermes Agent Gateway typically runs on port 9119 (e.g. <code>http://100.x.y.z:9119</code>).
                  </div>
                )}
                {isLoopbackAddress(gatewayUrl) && (
                  <div className="onboarding-warning" role="alert">
                    127.0.0.1 or localhost points to this phone, not your computer. If Hermes is running in Termux, use the Termux setup option instead.
                  </div>
                )}
              </div>
            )}

            {/* Extra username & password inputs sliding smoothly right below the address */}
            <div className={`onboarding-credentials-collapse ${(phase === 'verified' || phase === 'signing-in') && passwordAuth ? 'is-open' : ''}`}>
              <div className="onboarding-credentials-inner">
                <div className="onboarding-credential-group">
                  <div className="onboarding-credential-row">
                    <label htmlFor="gateway-username" className="onboarding-credential-label">
                      Username
                    </label>
                    <input
                      id="gateway-username"
                      className="onboarding-credential-input"
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="Enter username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      spellCheck={false}
                    />
                  </div>

                  <div className="onboarding-credential-row">
                    <label htmlFor="gateway-password" className="onboarding-credential-label">
                      Password
                    </label>
                    <input
                      id="gateway-password"
                      className="onboarding-credential-input"
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter password"
                      autoComplete="current-password"
                    />
                  </div>
                </div>
              </div>
            </div>

            {result && (
              <div
                className={`onboarding-feedback ${result.tone}`}
                role={result.tone === 'error' ? 'alert' : 'status'}
                aria-live="polite"
              >
                {result.text}
              </div>
            )}

            <div className="onboarding-actions">
              {phase === 'probing' ? (
                <button
                  type="button"
                  className="onboarding-btn secondary onboarding-btn-cancel"
                  onClick={handleCancelProbe}
                  aria-label="Cancel connection test"
                >
                  <LoaderCircle className="onboarding-spinner" size={17} />
                  <span>Testing… Tap to cancel</span>
                </button>
              ) : phase === 'idle' ? (
                <button
                  type="button"
                  className="onboarding-btn primary"
                  disabled={!gatewayUrl.trim()}
                  onClick={() => handleTestConnection()}
                >
                  <Server size={17} />
                  <span>Test connection</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="onboarding-btn primary"
                  disabled={
                    phase === 'signing-in' ||
                    (passwordAuth && (!username.trim() || !password))
                  }
                  onClick={handleCompleteSignIn}
                >
                  {phase === 'signing-in' ? (
                    <>
                      <LoaderCircle className="onboarding-spinner" size={18} />
                      <span>Authenticating…</span>
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={17} />
                      <span>{passwordAuth ? 'Sign in & connect' : 'Connect'}</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                className="onboarding-link-btn"
                onClick={handleBack}
              >
                Back
              </button>
            </div>
          </div>
        </section>
      )}

      {/* STEP 3B: TERMUX LOCAL SETUP (DOCUMENTATION ONLY) */}
      {step === 'termux' && (
        <section key="termux" className={`onboarding-body onboarding-termux-stage step-slide-${direction}`}>
          <div className="onboarding-title-group">
            <h1 className="onboarding-step-heading">Hermes in Termux</h1>
            <p className="onboarding-step-subhead">
              Run the full agent locally inside Android's Linux environment.
            </p>
          </div>

          <div className="onboarding-termux-docs">
            <div className="onboarding-code-block">
              <div className="onboarding-code-header">
                <span className="onboarding-code-label">INSTALL COMMAND</span>
                <button
                  type="button"
                  className="onboarding-code-copy"
                  onClick={handleCopyTermuxCommand}
                  aria-label="Copy install command"
                >
                  {copiedTermux ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copiedTermux ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="onboarding-code-body">
                <span className="onboarding-code-prompt" aria-hidden="true">$</span>
                <code>{TERMUX_INSTALL_CMD}</code>
              </div>
            </div>

            <ol className="onboarding-termux-steps">
              <li>
                <span className="onboarding-step-idx">1</span>
                <div className="onboarding-step-text">
                  Install <b>Termux</b> from F-Droid, launch it, and run the install script above.
                </div>
              </li>
              <li>
                <span className="onboarding-step-idx">2</span>
                <div className="onboarding-step-text">
                  Run <code>hermes setup</code> to configure your model provider and API keys.
                </div>
              </li>
              <li>
                <span className="onboarding-step-idx">3</span>
                <div className="onboarding-step-text">
                  Start your local gateway server with <code>hermes gateway</code>.
                </div>
              </li>
              <li>
                <span className="onboarding-step-idx">4</span>
                <div className="onboarding-step-text">
                  Once started, connect Hermes Mobile to <code>http://127.0.0.1:9119</code>.
                </div>
              </li>
            </ol>
          </div>

          <div className="onboarding-actions">
            <button
              type="button"
              className="onboarding-link-btn"
              onClick={handleBack}
            >
              Back
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
