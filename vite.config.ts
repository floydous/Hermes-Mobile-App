import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST

function hermesDevProxy(): Plugin {
  return {
    name: 'hermes-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/__hermes_proxy', async (req, res) => {
        const reqUrl = new URL(req.url || '', 'http://127.0.0.1:1420')
        const targetUrl = reqUrl.searchParams.get('url')
        if (!targetUrl) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Missing target url parameter' }))
          return
        }

        let parsed: URL
        try {
          parsed = new URL(targetUrl)
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Invalid target url' }))
          return
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Disallowed protocol for dev proxy' }))
          return
        }

        const hostname = parsed.hostname.toLowerCase()
        if (
          hostname === '169.254.169.254' ||
          hostname === 'metadata.google.internal' ||
          hostname.endsWith('.internal')
        ) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Prohibited metadata destination' }))
          return
        }

        try {
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            const lower = k.toLowerCase()
            if (
              lower !== 'host' &&
              lower !== 'origin' &&
              lower !== 'referer' &&
              lower !== 'connection' &&
              lower !== 'content-length' &&
              v
            ) {
              headers.set(k, Array.isArray(v) ? v.join(', ') : v)
            }
          }

          const isBodyMethod = req.method !== 'GET' && req.method !== 'HEAD'
          let body: Buffer | undefined
          if (isBodyMethod) {
            const chunks: Buffer[] = []
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
            }
            body = Buffer.concat(chunks)
          }

          const fetchOptions: RequestInit & { duplex?: string } = {
            method: req.method,
            headers,
            body,
            duplex: isBodyMethod ? 'half' : undefined,
            signal: AbortSignal.timeout(5000),
            redirect: 'manual',
          }

          const targetRes = await fetch(targetUrl, fetchOptions)

          res.statusCode = targetRes.status
          res.statusMessage = targetRes.statusText

          for (const [k, v] of targetRes.headers.entries()) {
            if (k.toLowerCase() !== 'transfer-encoding') {
              res.setHeader(k, v)
            }
          }
          res.setHeader('Access-Control-Allow-Origin', '*')

          const data = await targetRes.arrayBuffer()
          res.end(Buffer.from(data))
        } catch (err: unknown) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: `Dev proxy could not reach ${targetUrl}: ${err instanceof Error ? err.message : String(err)}`,
            })
          )
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), hermesDevProxy()],
  server: {
    host: host || '0.0.0.0',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const p = id.replaceAll('\\', '/')
          if (!p.includes('/node_modules/')) return

          if (
            p.includes('/react/') ||
            p.includes('/react-dom/') ||
            p.includes('/scheduler/')
          ) {
            return 'react-vendor'
          }

          if (
            p.includes('/katex') ||
            p.includes('/highlight.js') ||
            p.includes('/lowlight') ||
            p.includes('/react-markdown') ||
            p.includes('/remark-') ||
            p.includes('/rehype-') ||
            p.includes('/micromark') ||
            p.includes('/unist-') ||
            p.includes('/vfile') ||
            p.includes('/unified')
          ) {
            return 'markdown-vendor'
          }

          if (p.includes('/lucide-react/')) {
            return 'icons-vendor'
          }
        },
      },
    },
  },
})
