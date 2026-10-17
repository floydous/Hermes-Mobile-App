import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  browserInvoke,
  getBrowserStoredToken,
  initBrowserBridge,
  isTauriEnvironment,
  removeBrowserStoredToken,
  setBrowserStoredToken,
} from './browser-bridge'

describe('Browser Bridge & Fallback IPC', () => {
  const store = new Map<string, string>()
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => { store.set(key, String(val)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
  }

  beforeEach(() => {
    store.clear()
    ;(globalThis as unknown as { window: unknown }).window = globalThis
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = mockStorage
    delete (globalThis as unknown as { isTauri?: boolean }).isTauri
    delete (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('detects browser environment vs genuine native Tauri environment', () => {
    expect(isTauriEnvironment()).toBe(false)
    expect(isTauri()).toBe(false)
    ;(globalThis as unknown as { isTauri: boolean }).isTauri = true
    expect(isTauriEnvironment()).toBe(true)
    expect(isTauri()).toBe(true)
  })

  it('initializes window.__TAURI_INTERNALS__.metadata while keeping isTauri() false', () => {
    initBrowserBridge()
    const internals = (globalThis as unknown as {
      __TAURI_INTERNALS__?: {
        metadata?: { currentWindow: { label: string }; currentWebview: { label: string } }
      }
    }).__TAURI_INTERNALS__

    expect(internals).toBeDefined()
    expect(internals?.metadata).toBeDefined()
    expect(internals?.metadata?.currentWindow.label).toBe('main')
    expect(internals?.metadata?.currentWebview.label).toBe('main')

    // Must NOT fool isTauri() into thinking this is native Tauri
    expect(isTauriEnvironment()).toBe(false)
    expect(isTauri()).toBe(false)
  })

  it('routes production @tauri-apps/api/core invoke() to browserInvoke in browser mode', async () => {
    initBrowserBridge()
    mockStorage.setItem('hermes-mobile-active-endpoint', 'http://10.0.0.130:9119')

    // Call the real invoke() exported by @tauri-apps/api/core
    const result = await invoke<string | null>('hermes_saved_endpoint')
    expect(result).toBe('http://10.0.0.130:9119')
  })

  it('manages browser stored tokens in localStorage by origin', () => {
    const origin = 'http://100.117.86.67:9119'
    expect(getBrowserStoredToken(origin)).toBeNull()

    setBrowserStoredToken(origin, 'test-access-token-123')
    expect(getBrowserStoredToken(origin)).toBe('test-access-token-123')

    removeBrowserStoredToken(origin)
    expect(getBrowserStoredToken(origin)).toBeNull()
  })

  it('handles hermes_saved_endpoint via localStorage', async () => {
    mockStorage.setItem('hermes-mobile-active-endpoint', 'http://10.0.0.130:9119')
    const saved = await browserInvoke('hermes_saved_endpoint')
    expect(saved).toBe('http://10.0.0.130:9119')
  })

  it('handles hermes_connection_probe via web fetch', async () => {
    const mockStatus = { version: '0.21.5', auth_required: true }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(mockStatus),
    }))

    const result = await browserInvoke('hermes_connection_probe', {
      baseUrl: 'http://100.117.86.67:9119',
    })

    expect(fetch).toHaveBeenCalledWith(
      'http://100.117.86.67:9119/api/status',
      expect.objectContaining({ signal: expect.any(Object) })
    )
    expect(result).toBe(JSON.stringify(mockStatus))
  })

  it('falls back to dev proxy when direct browser fetch fails (CORS / Private Network Access)', async () => {
    const mockStatus = { version: '0.21.5', auth_required: true, auth_providers: ['basic'] }

    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockStatus),
      })

    vi.stubGlobal('fetch', mockFetch)

    const result = await browserInvoke('hermes_connection_probe', {
      baseUrl: 'http://100.66.168.20:9119',
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'http://100.66.168.20:9119/api/status',
      expect.objectContaining({ signal: expect.any(Object) })
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/__hermes_proxy?url=' + encodeURIComponent('http://100.66.168.20:9119/api/status'),
      expect.objectContaining({ signal: expect.any(Object) })
    )
    expect(result).toBe(JSON.stringify(mockStatus))
  })

  it('throws descriptive error on failed hermes_connection_probe HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    }))

    await expect(
      browserInvoke('hermes_connection_probe', { baseUrl: 'http://100.117.86.67:9119' })
    ).rejects.toThrow('HTTP 502: Bad Gateway')
  })

  it('detects HTML response on hermes_connection_probe and gives clear diagnostic message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<!doctype html><html><head><title>Vite</title></head></html>',
    }))

    await expect(
      browserInvoke('hermes_connection_probe', { baseUrl: 'http://localhost:1420' })
    ).rejects.toThrow('The address returned a web page (HTML) instead of the Hermes gateway API')
  })

  it('constructs hermes_ws_url with ticket or token when available', async () => {
    const origin = 'http://10.0.0.130:9119'
    setBrowserStoredToken(origin, 'my-access-token')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: 'ws-ticket-abc' }),
    }))

    const wsUrl = await browserInvoke('hermes_ws_url', { baseUrl: origin })
    expect(wsUrl).toBe('ws://10.0.0.130:9119/api/ws?ticket=ws-ticket-abc')
  })

  it('opens external URL via window.open in browser mode', async () => {
    const openSpy = vi.fn().mockImplementation(() => null)
    ;(globalThis as unknown as { open: unknown }).open = openSpy
    await browserInvoke('open_external_url', { url: 'https://example.com' })
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  it('returns valid numeric event listener ID for plugin:event|listen', async () => {
    const listenerId = await browserInvoke('plugin:event|listen')
    expect(typeof listenerId).toBe('number')
  })

  it('performs password sign-in even when crypto.subtle is undefined (non-secure HTTP context)', async () => {
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        getRandomValues: (buf: Uint8Array) => originalCrypto.getRandomValues(buf),
        subtle: undefined,
      },
      configurable: true,
      writable: true,
    })

    const mockFetch = vi.fn()
      // 1. Authorize GET
      .mockResolvedValueOnce({ ok: true })
      // 2. Password Login POST
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const authorizeUrl = new URL(mockFetch.mock.calls[0][0])
        const state = authorizeUrl.searchParams.get('state')
        return {
          ok: true,
          json: async () => ({
            next: `http://127.0.0.1:1/callback?state=${state}&code=test-auth-code-123`,
          }),
        }
      })
      // 3. Token exchange POST
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'returned-access-token-xyz' }),
      })

    vi.stubGlobal('fetch', mockFetch)

    try {
      await browserInvoke('hermes_password_sign_in', {
        baseUrl: 'http://100.66.168.20:9119',
        username: 'brat',
        password: 'correct-password',
      })

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(getBrowserStoredToken('http://100.66.168.20:9119')).toBe('returned-access-token-xyz')
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true,
      })
    }
  })
})
