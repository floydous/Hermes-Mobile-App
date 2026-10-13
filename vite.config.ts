import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
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
