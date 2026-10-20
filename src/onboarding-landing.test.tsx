import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { normalizeTheme, DEV_FORCE_LANDING_PAGE } from './App'
import {
  isLoopbackAddress,
  normalizeGatewayUrl,
  validateAndNormalizeGatewayUrl,
  OnboardingLanding,
} from './components/OnboardingLanding'
import { ArtificialSun } from './components/ArtificialSun'
import { decideOnboardingBootstrapState } from './connection-state'

describe('Onboarding Landing URL utilities', () => {
  it('correctly identifies loopback addresses across IPv4, IPv6 and localhost variants', () => {
    expect(isLoopbackAddress('http://localhost:9119')).toBe(true)
    expect(isLoopbackAddress('localhost:9119')).toBe(true)
    expect(isLoopbackAddress('localhost.')).toBe(true)
    expect(isLoopbackAddress('http://127.0.0.1:9119')).toBe(true)
    expect(isLoopbackAddress('127.0.0.1:9119')).toBe(true)
    expect(isLoopbackAddress('http://127.0.1.1:9119')).toBe(true)
    expect(isLoopbackAddress('127.10.20.30:9119')).toBe(true)
    expect(isLoopbackAddress('http://[::1]:9119')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('[::1]')).toBe(true)
  })

  it('allows valid remote, local, and Tailscale addresses', () => {
    expect(isLoopbackAddress('http://100.117.86.67:9119')).toBe(false)
    expect(isLoopbackAddress('100.117.86.67:9119')).toBe(false)
    expect(isLoopbackAddress('https://hermes.tailnet.ts.net')).toBe(false)
    expect(isLoopbackAddress('http://192.168.1.150:9119')).toBe(false)
    expect(isLoopbackAddress('http://10.0.0.130:9119')).toBe(false)
    expect(isLoopbackAddress('')).toBe(false)
  })

  it('normalizes valid gateway URLs cleanly', () => {
    expect(normalizeGatewayUrl('  100.117.86.67:9119/  ')).toBe('http://100.117.86.67:9119')
    expect(normalizeGatewayUrl('https://hermes.ts.net/')).toBe('https://hermes.ts.net')
    expect(normalizeGatewayUrl('http://10.0.0.130:9119')).toBe('http://10.0.0.130:9119')
    expect(normalizeGatewayUrl('')).toBe('')
  })

  it('rejects unsupported schemes, embedded credentials, and invalid ports', () => {
    expect(validateAndNormalizeGatewayUrl('ftp://100.1.2.3:9119').error).toContain('Only http:// and https://')
    expect(validateAndNormalizeGatewayUrl('http://user:pass@100.1.2.3:9119').error).toContain('Please enter credentials in the username/password fields')
    expect(validateAndNormalizeGatewayUrl('http://100.1.2.3:99999').error).toBeDefined()
    expect(validateAndNormalizeGatewayUrl('').error).toContain('cannot be empty')
  })
})

describe('OnboardingLanding Multi-Step Flow SSR markup', () => {
  const onPaired = vi.fn().mockResolvedValue(undefined)
  const onSkip = vi.fn()
  const setTheme = vi.fn()

  it('renders Step 1 (Welcome): hero figure and distant scenic footer with official slogan', () => {
    const html = renderToString(
      <OnboardingLanding
        theme="light"
        setTheme={setTheme}
        onPaired={onPaired}
        initialStep="welcome"
      />
    )

    expect(html).toContain('HERMES')
    expect(html).toContain('AGENT')
    expect(html).toContain('onboarding-bg-title-word')
    expect(html).toContain('The Agent That Grows With You.')
    expect(html).toContain('Continue')
    expect(html).toContain('onboarding-scenic-footer')
    expect(html).toContain('onboarding-hero-figure')

    // Header must have the centered artificial sun theme switcher (no brand/wordmark navbar)
    expect(html).toContain('onboarding-header')
    expect(html).toContain('artificial-sun-container')
    expect(html).toContain('artificial-sun-speedbump-svg')
    expect(html).toContain('is-tall-spike')
    expect(html).toContain('artificial-sun-greek-daycycle-icon')
    expect(html).toContain('greek-icon-helios')
    expect(html).not.toContain('onboarding-brand')
    expect(html).not.toContain('onboarding-wordmark')

    // Must NOT contain marketing slop or bullet lists
    expect(html).not.toContain('onboarding-statement-list')
    expect(html).not.toContain('onboarding-points')
    expect(html).not.toContain('100% Private')
    expect(html).not.toContain('Gateway address')
  })

  it('renders correct Greek daycycle emblem for each daytime theme phase', () => {
    // 1. Day / Light -> Helios
    const lightHtml = renderToString(
      <OnboardingLanding
        theme="light"
        setTheme={setTheme}
        onPaired={onPaired}
        initialStep="welcome"
      />
    )
    expect(lightHtml).toContain('greek-icon-helios is-active')
    expect(lightHtml).not.toContain('greek-icon-hesperus is-active')
    expect(lightHtml).not.toContain('greek-icon-selene is-active')

    // 2. Dusk / Grey -> Hesperus
    const greyHtml = renderToString(
      <OnboardingLanding
        theme="grey"
        setTheme={setTheme}
        onPaired={onPaired}
        initialStep="welcome"
      />
    )
    expect(greyHtml).toContain('greek-icon-hesperus is-active')
    expect(greyHtml).not.toContain('greek-icon-helios is-active')
    expect(greyHtml).not.toContain('greek-icon-selene is-active')

    // 3. Night / Dark -> Selene
    const darkHtml = renderToString(
      <OnboardingLanding
        theme="dark"
        setTheme={setTheme}
        onPaired={onPaired}
        initialStep="welcome"
      />
    )
    expect(darkHtml).toContain('greek-icon-selene is-active')
    expect(darkHtml).not.toContain('greek-icon-helios is-active')
    expect(darkHtml).not.toContain('greek-icon-hesperus is-active')
  })

  it('renders Step 2 (Choice): anchors heading at top and shows option list with hairline dividers', () => {
    const html = renderToString(
      <OnboardingLanding
        theme="light"
        setTheme={setTheme}
        onPaired={onPaired}
        initialStep="choice"
      />
    )

    expect(html).toContain('Where is your agent running?')
    expect(html).toContain('onboarding-choice-stage')
    expect(html).toContain('onboarding-selector-list')
    expect(html).toContain('Computer or Server')
    expect(html).toContain('Locally on this Phone')
    expect(html).toContain('onboarding-scenic-footer')
  })

  it('renders Step 3A (Remote): gateway URL address input, inline help trigger, and testing button', () => {
    const html = renderToString(
      <OnboardingLanding
        theme="light"
        setTheme={setTheme}
        onPaired={onPaired}
        onSkip={onSkip}
        initialStep="remote"
      />
    )

    expect(html).toContain('Connect to host')
    expect(html).toContain('onboarding-remote-stage')
    expect(html).toContain('Gateway address')
    expect(html).toContain('inputMode="url"')
    expect(html).toContain('onboarding-inline-help-trigger')
    expect(html).toContain('How to connect via Tailscale')
    expect(html).toContain('Test connection')
  })

  it('renders Step 3B (Termux): local terminal guide, curl command, and documentation steps without connect button or credentials', () => {
    const html = renderToString(
      <OnboardingLanding
        theme="light"
        setTheme={setTheme}
        onPaired={onPaired}
        onSkip={onSkip}
        initialStep="termux"
      />
    )

    expect(html).toContain('Hermes in Termux')
    expect(html).toContain('onboarding-code-block')
    expect(html).toContain('curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash')
    expect(html).toContain('hermes gateway')
    expect(html).toContain('onboarding-scenic-footer')
    expect(html).not.toContain('Connect to local gateway')
    expect(html).not.toContain('onboarding-credentials-section')
    expect(html).not.toContain('termux-password')
  })
})

describe('Production decideOnboardingBootstrapState Helper', () => {
  it('requires onboarding on clean install without endpoint or dismissal', () => {
    const result = decideOnboardingBootstrapState(null, null, false)
    expect(result.needsOnboarding).toBe(true)
    expect(result.configuredEndpoint).toBeNull()
  })

  it('bypasses onboarding when native secure endpoint exists', () => {
    const result = decideOnboardingBootstrapState('http://100.117.86.67:9119', null, false)
    expect(result.needsOnboarding).toBe(false)
    expect(result.configuredEndpoint).toBe('http://100.117.86.67:9119')
    expect(result.endpointToActivate).toBe('http://100.117.86.67:9119')
  })

  it('bypasses onboarding when localStorage endpoint exists', () => {
    const result = decideOnboardingBootstrapState(null, 'http://10.0.0.130:9119', false)
    expect(result.needsOnboarding).toBe(false)
    expect(result.configuredEndpoint).toBe('http://10.0.0.130:9119')
    expect(result.endpointToActivate).toBe('http://10.0.0.130:9119')
  })

  it('bypasses onboarding when user previously chose to explore offline', () => {
    const result = decideOnboardingBootstrapState(null, null, true)
    expect(result.needsOnboarding).toBe(false)
    expect(result.endpointToActivate).toBe('http://127.0.0.1:9119')
  })

  it('treats whitespace-only endpoint values as unconfigured', () => {
    const result = decideOnboardingBootstrapState('   ', '\t\n', false)
    expect(result.needsOnboarding).toBe(true)
    expect(result.configuredEndpoint).toBeNull()
    expect(result.endpointToActivate).toBe('http://127.0.0.1:9119')
  })

  it('prefers native endpoint over local endpoint when both exist', () => {
    const result = decideOnboardingBootstrapState(
      'http://100.117.86.67:9119',
      'http://10.0.0.130:9119',
      false
    )
    expect(result.needsOnboarding).toBe(false)
    expect(result.configuredEndpoint).toBe('http://100.117.86.67:9119')
    expect(result.endpointToActivate).toBe('http://100.117.86.67:9119')
  })
})

describe('normalizeTheme Legacy Migration', () => {
  it('migrates legacy aurora preference to dark mode', () => {
    expect(normalizeTheme('aurora')).toBe('dark')
  })

  it('preserves valid supported themes', () => {
    expect(normalizeTheme('light')).toBe('light')
    expect(normalizeTheme('grey')).toBe('grey')
    expect(normalizeTheme('dark')).toBe('dark')
  })

  it('defaults to light theme for missing, null, or invalid values', () => {
    expect(normalizeTheme(null)).toBe('light')
    expect(normalizeTheme(undefined)).toBe('light')
    expect(normalizeTheme('')).toBe('light')
    expect(normalizeTheme('unknown-theme')).toBe('light')
  })
})

describe('ArtificialSun Ray Geometry & 360-degree Distribution', () => {
  it('renders all 360 degrees of rays without clipping or dead sectors', () => {
    const html = renderToString(<ArtificialSun theme="light" />)
    expect(html).toContain('artificial-sun-speedbump-svg')
    expect(html).toContain('artificial-sun-rotating-wheel')
    expect(html).toContain('cardinal-0-spike')
    expect(html).toContain('cardinal-90-spike')
    expect(html).toContain('cardinal-180-spike')
    expect(html).toContain('cardinal-270-spike')
    expect(html).toContain('artificial-sun-touch-target')
  })
})

describe('DEV_FORCE_LANDING_PAGE dev override guard', () => {
  it('must stay false so published builds never trap users on the onboarding screen', () => {
    expect(DEV_FORCE_LANDING_PAGE).toBe(false)
  })
})
