/**
 * Browser Bridge for Hermes Mobile
 *
 * Enables running Hermes Mobile directly in standard web browsers (desktop Chrome/Firefox/Safari
 * or mobile browsers during `pnpm dev` / `pnpm tauri dev`) without crashing on missing native Tauri
 * internals (e.g. `Cannot read properties of undefined ('metadata')`).
 *
 * Translates Tauri IPC `invoke` calls into native browser `fetch` and `WebSocket` connections,
 * supporting PKCE password sign-in, token persistence in localStorage, session history, and
 * gateway streaming directly from the browser.
 */

export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window as unknown as { isTauri?: boolean }).isTauri
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function getBrowserStoredToken(origin: string): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(`hermes-browser-token:${origin.replace(/\/$/, '')}`)
  } catch {
    return null
  }
}

export function setBrowserStoredToken(origin: string, token: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(`hermes-browser-token:${origin.replace(/\/$/, '')}`, token)
  } catch {}
}

export function removeBrowserStoredToken(origin: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(`hermes-browser-token:${origin.replace(/\/$/, '')}`)
  } catch {}
}

function fillRandomBytes(buf: Uint8Array): void {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf)
    return
  }
  throw new Error(
    'Cryptographically secure random number generation (crypto.getRandomValues) is required but unavailable in this environment.'
  )
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

function sha256Sync(data: Uint8Array): Uint8Array {
  const words: number[] = []
  const asciiBitLength = data.length * 8

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  for (let i = 0; i < data.length; i++) {
    words[i >> 2] |= data[i] << ((3 - (i % 4)) * 8)
  }
  const wordsLength = Math.ceil((data.length + 9) / 64) * 16
  words[data.length >> 2] |= 0x80 << ((3 - (data.length % 4)) * 8)
  words[wordsLength - 1] = asciiBitLength

  for (let i = 0; i < wordsLength; i += 16) {
    const w = words.slice(i, i + 16)
    for (let x = 0; x < 16; x++) {
      if (!w[x]) w[x] = 0
    }
    let a = hash[0], b = hash[1], c = hash[2], d = hash[3]
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7]

    for (let j = 0; j < 64; j++) {
      if (j >= 16) {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3)
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10)
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
      }

      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + k[j] + (w[j] | 0)) | 0
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) | 0

      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }

    hash[0] = (hash[0] + a) | 0
    hash[1] = (hash[1] + b) | 0
    hash[2] = (hash[2] + c) | 0
    hash[3] = (hash[3] + d) | 0
    hash[4] = (hash[4] + e) | 0
    hash[5] = (hash[5] + f) | 0
    hash[6] = (hash[6] + g) | 0
    hash[7] = (hash[7] + h) | 0
  }

  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (hash[i] >>> 24) & 0xff
    out[i * 4 + 1] = (hash[i] >>> 16) & 0xff
    out[i * 4 + 2] = (hash[i] >>> 8) & 0xff
    out[i * 4 + 3] = hash[i] & 0xff
  }
  return out
}

async function sha256Digest(data: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const buffer = await crypto.subtle.digest('SHA-256', data as unknown as ArrayBuffer)
      return new Uint8Array(buffer)
    } catch {}
  }
  return sha256Sync(data)
}

function isDevEnvironment(): boolean {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return true
  if (typeof window !== 'undefined' && window.location) {
    return (
      window.location.port === '1420' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    )
  }
  return false
}

async function smartFetch(targetUrl: string, init?: RequestInit): Promise<Response> {
  const signal = init?.signal || (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined)
  const mergedInit = signal ? { ...init, signal } : init

  // Try direct fetch first; if CORS / Private Network Access fails in browser dev mode, use Vite dev proxy
  try {
    return mergedInit ? await fetch(targetUrl, mergedInit) : await fetch(targetUrl)
  } catch (err) {
    if (isDevEnvironment()) {
      const proxyTarget = `/__hermes_proxy?url=${encodeURIComponent(targetUrl)}`
      return mergedInit ? await fetch(proxyTarget, mergedInit) : await fetch(proxyTarget)
    }
    throw err
  }
}

function getAuthHeaders(origin: string): HeadersInit {
  const token = getBrowserStoredToken(origin)
  if (token) {
    return { Authorization: `Bearer ${token}` }
  }
  return {}
}

export async function browserPasswordSignIn(
  baseUrl: string,
  username: string,
  password: string
): Promise<void> {
  const origin = baseUrl.replace(/\/$/, '')
  const randomVerifier = new Uint8Array(32)
  fillRandomBytes(randomVerifier)
  const verifier = base64UrlEncode(randomVerifier)

  const digest = await sha256Digest(new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(digest)

  const randomState = new Uint8Array(24)
  fillRandomBytes(randomState)
  const state = base64UrlEncode(randomState)

  const redirectUri = 'http://127.0.0.1:1/callback'
  const authorizeUrl = `${origin}/auth/native/authorize?provider=basic&code_challenge=${challenge}&code_challenge_method=S256&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${state}`

  // 1. Authorize GET
  const authRes = await smartFetch(authorizeUrl, { credentials: 'include' })
  if (!authRes.ok) {
    throw new Error(`Hermes could not start secure sign-in (HTTP ${authRes.status})`)
  }

  // 2. Password Login POST
  const loginRes = await smartFetch(`${origin}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      provider: 'basic',
      username,
      password,
    }),
  })
  if (!loginRes.ok) {
    const errorJson = await loginRes.json().catch(() => ({}))
    throw new Error(
      errorJson.detail || `Hermes sign-in failed (HTTP ${loginRes.status})`
    )
  }
  const loginData = (await loginRes.json()) as { next?: string }
  if (!loginData.next) {
    throw new Error('Hermes password sign-in returned no authorization code.')
  }

  const parsedNext = new URL(loginData.next)
  if (parsedNext.searchParams.get('state') !== state) {
    throw new Error('Secure sign-in state check failed.')
  }
  const code = parsedNext.searchParams.get('code')
  if (!code) {
    throw new Error('Hermes password sign-in returned no authorization code.')
  }

  // 3. Token exchange POST
  const tokenRes = await smartFetch(`${origin}/auth/native/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier }),
  })
  if (!tokenRes.ok) {
    throw new Error(`Hermes token exchange failed (HTTP ${tokenRes.status})`)
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string }
  if (!tokenData.access_token) {
    throw new Error('Hermes returned no access token.')
  }

  setBrowserStoredToken(origin, tokenData.access_token)
}

export async function browserInvoke(
  cmd: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const baseUrl = ((args.baseUrl as string) || '').replace(/\/$/, '')

  switch (cmd) {
    case 'hermes_saved_endpoint': {
      if (typeof localStorage === 'undefined') return null
      return localStorage.getItem('hermes-mobile-active-endpoint') || null
    }

    case 'hermes_connection_probe': {
      let res: Response
      try {
        res = await smartFetch(`${baseUrl}/api/status`)
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        if (errorMsg.includes('aborted') || errorMsg.includes('timeout')) {
          throw new Error(
            `Connection to ${baseUrl} timed out. Ensure Hermes Gateway is running and reachable on this port.`
          )
        }
        throw new Error(
          `Could not connect to ${baseUrl}. Make sure the Hermes Gateway is running and reachable.`
        )
      }
      if (!res.ok) {
        throw new Error(`Gateway returned HTTP ${res.status}: ${res.statusText}`)
      }
      const text = await res.text()
      const trimmed = text.trim()
      if (trimmed.startsWith('<') || res.headers?.get?.('content-type')?.includes('text/html')) {
        throw new Error(
          'The address returned a web page (HTML) instead of the Hermes gateway API. Check that you entered your Hermes Gateway port (typically :9119, not the web app port :1420).'
        )
      }
      return text
    }

    case 'hermes_password_sign_in': {
      const username = (args.username as string) || ''
      const password = (args.password as string) || ''
      await browserPasswordSignIn(baseUrl, username, password)
      return undefined
    }

    case 'hermes_native_sign_in': {
      // In browser mode, native PKCE popup redirect requires a local callback server.
      // Inform the developer/user to sign in with username/password instead.
      throw new Error(
        'Native device browser sign-in is managed by Android/iOS. Use gateway username and password in browser mode.'
      )
    }

    case 'hermes_ws_url': {
      const url = new URL(baseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.pathname = '/api/ws'

      const token = getBrowserStoredToken(baseUrl)
      if (token) {
        try {
          const ticketUrl = new URL('/api/auth/ws-ticket', baseUrl)
          const ticketRes = await smartFetch(ticketUrl.toString(), {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          })
          if (ticketRes.ok) {
            const ticketJson = (await ticketRes.json()) as { ticket?: string }
            if (ticketJson.ticket) {
              url.searchParams.set('ticket', ticketJson.ticket)
              return url.toString()
            }
          }
        } catch {}
        url.searchParams.set('token', token)
        return url.toString()
      }

      return url.toString()
    }

    case 'hermes_snapshot': {
      const url = `${baseUrl}/api/profiles/sessions?limit=100&offset=0&min_messages=1&archived=exclude&order=recent&profile=all&exclude_sources=cron,kanban,tool,oneshot`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      const sessions = await res.json()
      return JSON.stringify({ sessions })
    }

    case 'hermes_session_messages': {
      const sid = encodeURIComponent(String(args.sessionId || ''))
      const offset = Number(args.offset || 0)
      const limit = Number(args.limit || 100)
      const url = `${baseUrl}/api/sessions/${sid}/messages?offset=${offset}&limit=${limit}`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_model_options': {
      const profile = encodeURIComponent(String(args.profile || ''))
      const url = `${baseUrl}/api/profiles/models?profile=${profile}`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_cron_jobs': {
      const profile = encodeURIComponent(String(args.profile || 'all'))
      const url = `${baseUrl}/api/cron/jobs?profile=${profile}`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_cron_job': {
      const jobId = encodeURIComponent(String(args.jobId || ''))
      const profile = encodeURIComponent(String(args.profile || ''))
      const url = `${baseUrl}/api/cron/jobs/${jobId}?profile=${profile}`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_cron_runs': {
      const jobId = encodeURIComponent(String(args.jobId || ''))
      const profile = encodeURIComponent(String(args.profile || ''))
      const url = `${baseUrl}/api/cron/jobs/${jobId}/runs?profile=${profile}`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_trigger_cron': {
      const jobId = encodeURIComponent(String(args.jobId || ''))
      const profile = encodeURIComponent(String(args.profile || ''))
      const url = `${baseUrl}/api/cron/jobs/${jobId}/run?profile=${profile}`
      const res = await smartFetch(url, {
        method: 'POST',
        headers: getAuthHeaders(baseUrl),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_cron_blueprints': {
      const url = `${baseUrl}/api/cron/blueprints`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_cron_delivery_targets': {
      const url = `${baseUrl}/api/cron/delivery-targets`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_create_cron': {
      const url = `${baseUrl}/api/cron/jobs`
      const res = await smartFetch(url, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(baseUrl),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args.body || {}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_instantiate_cron_blueprint': {
      const url = `${baseUrl}/api/cron/blueprints/instantiate`
      const res = await smartFetch(url, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(baseUrl),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args.body || {}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_update_cron_prompt': {
      const jobId = encodeURIComponent(String(args.jobId || ''))
      const profile = encodeURIComponent(String(args.profile || ''))
      const prompt = String(args.prompt || '')
      const url = `${baseUrl}/api/cron/jobs/${jobId}/prompt`
      const res = await smartFetch(url, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(baseUrl),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, profile }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'hermes_delete_session': {
      const sid = encodeURIComponent(String(args.sessionId || ''))
      const profile = args.profile ? encodeURIComponent(String(args.profile)) : ''
      const url = `${baseUrl}/api/sessions/${sid}${profile ? `?profile=${profile}` : ''}`
      const res = await smartFetch(url, {
        method: 'DELETE',
        headers: getAuthHeaders(baseUrl),
      })
      if (!res.ok && res.status !== 404) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      return undefined
    }

    case 'hermes_fetch_media': {
      const path = encodeURIComponent(String(args.path || ''))
      const url = `${baseUrl}/api/media?path=${path}`
      const res = await smartFetch(url, { headers: getAuthHeaders(baseUrl) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      return await res.text()
    }

    case 'open_external_url': {
      const url = String(args.url || '')
      if (typeof window !== 'undefined' && url) {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
      return undefined
    }

    case 'plugin:event|listen': {
      return Math.floor(Math.random() * 100000)
    }
    case 'plugin:event|unlisten': {
      return null
    }

    default: {
      // Unhandled plugin commands return safe null
      return null
    }
  }
}

export function initBrowserBridge(): void {
  if (typeof window === 'undefined') return

  // Do not override native Tauri if running inside a genuine Tauri WebView
  if (isTauriEnvironment()) return

  const win = window as unknown as {
    __TAURI_INTERNALS__?: {
      metadata?: {
        currentWindow: { label: string }
        currentWebview: { windowLabel: string; label: string }
      }
      invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
      convertFileSrc?: (filePath: string, protocol?: string) => string
    }
    __TAURI_EVENT_PLUGIN_INTERNALS__?: Record<string, unknown>
  }

  if (!win.__TAURI_INTERNALS__) {
    win.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
      invoke: browserInvoke,
      convertFileSrc: (filePath: string) => filePath,
    }
  } else if (!win.__TAURI_INTERNALS__.metadata) {
    win.__TAURI_INTERNALS__.metadata = {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    }
  }

  if (!win.__TAURI_EVENT_PLUGIN_INTERNALS__) {
    win.__TAURI_EVENT_PLUGIN_INTERNALS__ = {}
  }
}
