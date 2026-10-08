import { memo, useEffect, useState, type ReactNode } from 'react'
import {
  Check,
  Copy,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Maximize2,
  X,
} from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

import type { LiveMessage, LiveProfile } from '../hermes'
import { fetchRemoteMedia } from '../hermes'
import { formatMessageTime, formatResponseStats } from '../message-stats'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])

const imageDataUrlCache = new Map<string, string>()

export function cacheImageDataUrl(nameOrPath: string, dataUrl: string) {
  if (!nameOrPath || !dataUrl) return
  const key = nameOrPath.trim().toLowerCase()
  imageDataUrlCache.set(key, dataUrl)
  const base = nameOrPath.split(/[/\\]/).filter(Boolean).pop()
  if (base) {
    imageDataUrlCache.set(base.trim().toLowerCase(), dataUrl)
  }
}

export function getCachedImageDataUrl(nameOrPath: string): string | undefined {
  if (!nameOrPath) return undefined
  const key = nameOrPath.trim().toLowerCase()
  const hit = imageDataUrlCache.get(key)
  if (hit) return hit
  const base = nameOrPath.split(/[/\\]/).filter(Boolean).pop()
  if (base) {
    return imageDataUrlCache.get(base.trim().toLowerCase())
  }
  return undefined
}

export function sanitizeDataUrl(url: string): string {
  const clean = (url || '').trim()
  if (!clean.startsWith('data:image/')) return clean
  const commaIdx = clean.indexOf(',')
  if (commaIdx === -1) return clean.replace(/\s+/g, '')
  const prefix = clean.slice(0, commaIdx + 1)
  const payload = clean.slice(commaIdx + 1).replace(/\s+/g, '')
  return `${prefix}${payload}`
}

export function isRemoteServerPath(path: string): boolean {
  const clean = (path || '').trim()
  if (!clean || clean.startsWith('data:') || clean.startsWith('blob:') || /^https?:\/\//i.test(clean)) {
    return false
  }
  if (
    clean.startsWith('/') ||
    clean.startsWith('~') ||
    clean.includes('.hermes') ||
    clean.includes('hermes/') ||
    clean.startsWith('./') ||
    clean.startsWith('../')
  ) {
    return true
  }
  if (/^[a-zA-Z]:[\\/]/.test(clean)) {
    return false
  }
  return true
}

export function isImagePath(rawPath: string): boolean {
  const clean = (rawPath || '').trim()
  if (clean.startsWith('data:image/')) return true
  const fileName = clean.split(/[/\\]/).filter(Boolean).pop() || clean
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : ''
  return IMAGE_EXTENSIONS.has(ext)
}

export function resolveImageSrc(pathOrUrl: string): string {
  const clean = (pathOrUrl || '').trim()
  if (!clean) return ''
  if (clean.startsWith('data:image/')) {
    return sanitizeDataUrl(clean)
  }
  if (clean.startsWith('data:') || clean.startsWith('blob:') || /^https?:\/\//i.test(clean)) {
    return clean
  }
  const cached = getCachedImageDataUrl(clean)
  if (cached) return cached

  // Remote server paths should not be treated as local asset.localhost paths
  if (isRemoteServerPath(clean)) {
    return ''
  }

  try {
    if (typeof window !== 'undefined' && (window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: unknown } }).__TAURI_INTERNALS__?.convertFileSrc) {
      return convertFileSrc(clean)
    }
  } catch {
    // fallback
  }
  return clean
}

export function stripAttachedContextScaffolding(text: string): string {
  if (!text) return ''
  return text.replace(/\n*--- (?:Attached Context|Context Warnings) ---\n[\s\S]*$/, '').trim()
}

type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'media'; path: string }
  | { type: 'attachment'; path: string }

function parseMessageSegments(text: string): MessageSegment[] {
  const cleaned = stripAttachedContextScaffolding(text)
  const lines = cleaned.split(/\r?\n/)
  const segments: MessageSegment[] = []
  let currentText: string[] = []
  let inCode = false

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      currentText.push(line)
      continue
    }
    if (!inCode) {
      const mediaMatch = line.trim().match(/^\[?MEDIA:\s*([^\s\]]+)\]?$/) || line.trim().match(/^MEDIA:\s*(.+)$/)
      const attachMatch = line.trim().match(/^Attached:\s*(.+)$/)
      const userImageMatch = line.trim().match(/^\[User attached image:\s*([^\]]+)\]$/)
      const userFileMatch = line.trim().match(/^\[User attached file:\s*([^\]]+)\]$/)
      const fileRefMatch = line.trim().match(/^@file:`([^`]+)`$/) || line.trim().match(/^📎\s*@file:`([^`]+)`$/)

      if (mediaMatch) {
        if (currentText.length) {
          segments.push({ type: 'text', content: currentText.join('\n') })
          currentText = []
        }
        segments.push({ type: 'media', path: mediaMatch[1].trim() })
        continue
      }
      if (attachMatch) {
        if (currentText.length) {
          segments.push({ type: 'text', content: currentText.join('\n') })
          currentText = []
        }
        segments.push({ type: 'attachment', path: attachMatch[1].trim() })
        continue
      }
      if (userImageMatch || userFileMatch) {
        const p = (userImageMatch || userFileMatch)![1].trim()
        if (currentText.length) {
          segments.push({ type: 'text', content: currentText.join('\n') })
          currentText = []
        }
        segments.push({ type: 'attachment', path: p })
        continue
      }
      if (fileRefMatch) {
        if (currentText.length) {
          segments.push({ type: 'text', content: currentText.join('\n') })
          currentText = []
        }
        segments.push({ type: 'attachment', path: fileRefMatch[1].trim() })
        continue
      }
    }
    currentText.push(line)
  }
  if (currentText.length) {
    segments.push({ type: 'text', content: currentText.join('\n') })
  }
  return segments
}

export function ImageLightbox({
  src,
  alt,
  rawPath,
  onClose,
}: {
  src: string
  alt?: string
  rawPath?: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const isData = src.startsWith('data:')
  const fileName = rawPath
    ? (rawPath.split(/[/\\]/).filter(Boolean).pop() || rawPath)
    : alt || (isData ? 'Image Preview' : src.split(/[/\\]/).filter(Boolean).pop() || 'Image Preview')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const copy = async () => {
    await navigator.clipboard.writeText(rawPath || src)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="image-lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="image-lightbox-panel" onClick={e => e.stopPropagation()}>
        <header className="image-lightbox-header">
          <span className="image-lightbox-title" title={fileName}>{fileName}</span>
          <div className="image-lightbox-actions">
            <button type="button" className="image-lightbox-btn" onClick={() => void copy()} title="Copy path">
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <button type="button" className="image-lightbox-btn close" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="image-lightbox-body">
          <img className="image-lightbox-img" src={src} alt={alt || fileName} />
        </div>
      </div>
    </div>
  )
}

export function ChatImage({
  src,
  alt,
  rawPath,
  kind = 'media',
}: {
  src: string
  alt?: string
  rawPath?: string
  kind?: 'media' | 'attachment' | 'markdown'
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const effectivePath = rawPath || src || ''
  const isData = effectivePath.startsWith('data:')
  const isRemote = isRemoteServerPath(effectivePath)

  const initialResolved = isData
    ? sanitizeDataUrl(effectivePath)
    : isRemote
    ? getCachedImageDataUrl(effectivePath) || ''
    : resolveImageSrc(effectivePath)

  const [resolvedSrc, setResolvedSrc] = useState(initialResolved)

  useEffect(() => {
    let cancelled = false

    if (isData) {
      setResolvedSrc(sanitizeDataUrl(effectivePath))
      setFailed(false)
      return
    }

    if (isRemote) {
      const cached = getCachedImageDataUrl(effectivePath)
      if (cached) {
        setResolvedSrc(cached)
        setFailed(false)
        return
      }

      setResolvedSrc('')
      setFailed(false)

      void fetchRemoteMedia(effectivePath)
        .then(dataUrl => {
          if (!cancelled && dataUrl) {
            const cleanUrl = sanitizeDataUrl(dataUrl)
            cacheImageDataUrl(effectivePath, cleanUrl)
            setResolvedSrc(cleanUrl)
            setFailed(false)
          } else if (!cancelled) {
            setFailed(true)
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
      return () => {
        cancelled = true
      }
    }

    const currentResolved = resolveImageSrc(effectivePath)
    setResolvedSrc(currentResolved)
    setFailed(false)
  }, [effectivePath, isData, isRemote])

  const fileName = rawPath
    ? (rawPath.split(/[/\\]/).filter(Boolean).pop() || rawPath)
    : alt || (isData ? 'Inline Image' : src.split(/[/\\]/).filter(Boolean).pop() || 'image')
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toUpperCase() || 'IMG' : 'IMG'

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(rawPath || resolvedSrc)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  if (failed || (!resolvedSrc && !isRemote)) {
    if (isData) {
      return (
        <div className="media-attachment-card media">
          <div className="media-card-icon-box">
            <ImageIcon size={18} />
          </div>
          <div className="media-card-content">
            <div className="media-card-filename">{alt || 'Inline Image'}</div>
            <div className="media-card-sub">
              <span className="media-card-badge">IMAGE</span>
              <span className="media-card-path">Could not render inline base64 image</span>
            </div>
          </div>
        </div>
      )
    }
    return <FileAttachmentCard rawPath={rawPath || src} kind={kind === 'attachment' ? 'attachment' : 'media'} />
  }

  return (
    <>
      <figure className={`chat-image-wrap ${kind} ${loaded && resolvedSrc ? 'is-loaded' : 'is-loading'}`}>
        <div
          className="chat-image-media-box"
          onClick={() => { if (resolvedSrc) setLightboxOpen(true) }}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && resolvedSrc) { e.preventDefault(); setLightboxOpen(true) } }}
          aria-label={`View full image: ${fileName}`}
        >
          {(!loaded || !resolvedSrc) && <div className="chat-image-skeleton" aria-hidden="true" />}
          <img
            className={`chat-image-rendered ${!resolvedSrc ? 'is-resolving' : ''}`}
            src={resolvedSrc || undefined}
            alt={alt || fileName}
            decoding="async"
            style={!resolvedSrc ? { display: 'none' } : undefined}
            onLoad={() => setLoaded(true)}
            onError={() => { if (resolvedSrc) setFailed(true) }}
          />
          <button
            type="button"
            className="chat-image-zoom-overlay"
            title="Expand image"
            aria-label="Expand image"
            onClick={e => { e.stopPropagation(); if (resolvedSrc) setLightboxOpen(true) }}
            disabled={!resolvedSrc}
          >
            <Maximize2 size={15} />
          </button>
        </div>
        <figcaption className="chat-image-caption">
          <div className="chat-image-info">
            <span className="chat-image-badge">{ext}</span>
            <span className="chat-image-filename" title={fileName}>{fileName}</span>
          </div>
          <div className="chat-image-actions">
            <button
              type="button"
              className="chat-image-btn"
              onClick={copy}
              title="Copy path or URL"
              aria-label="Copy file path"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            <button
              type="button"
              className="chat-image-btn"
              onClick={e => { e.stopPropagation(); if (resolvedSrc) setLightboxOpen(true) }}
              title="Expand image"
              aria-label="Expand image"
              disabled={!resolvedSrc}
            >
              <Maximize2 size={13} />
            </button>
          </div>
        </figcaption>
      </figure>
      {lightboxOpen && resolvedSrc && (
        <ImageLightbox
          src={resolvedSrc}
          alt={alt || fileName}
          rawPath={rawPath}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  )
}

export function FileAttachmentCard({ rawPath, kind }: { rawPath: string; kind: 'media' | 'attachment' }) {
  const [copied, setCopied] = useState(false)
  const cleanPath = rawPath.trim()
  const fileName = cleanPath.split(/[/\\]/).filter(Boolean).pop() || cleanPath
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : ''
  const isImage = isImagePath(cleanPath)
  const isCode = ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'json', 'yaml', 'yml', 'toml', 'html', 'css', 'sh', 'sql', 'c', 'cpp'].includes(ext)
  const isSheet = ['csv', 'tsv', 'xlsx', 'xls'].includes(ext)
  const isDoc = ['md', 'txt', 'pdf', 'doc', 'docx', 'rtf'].includes(ext)

  const copy = async () => {
    await navigator.clipboard.writeText(cleanPath)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const typeLabel = ext ? ext.toUpperCase() : kind === 'media' ? 'FILE' : 'ATTACHMENT'

  return (
    <div className={`media-attachment-card ${kind}`}>
      <div className="media-card-icon-box">
        {isImage ? <ImageIcon size={18} /> : isCode ? <FileCode size={18} /> : isSheet ? <FileSpreadsheet size={18} /> : isDoc ? <FileText size={18} /> : <File size={18} />}
      </div>
      <div className="media-card-content">
        <div className="media-card-filename" title={fileName}>{fileName}</div>
        <div className="media-card-sub">
          <span className="media-card-badge">{typeLabel}</span>
          <span className="media-card-path" title={cleanPath}>{cleanPath}</span>
        </div>
      </div>
      <button
        type="button"
        className="media-card-copy-btn"
        onClick={() => void copy()}
        title="Copy path"
        aria-label="Copy file path"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

export function MediaAttachmentCard({ rawPath, kind }: { rawPath: string; kind: 'media' | 'attachment' }) {
  const cleanPath = rawPath.trim()
  const fileName = cleanPath.split(/[/\\]/).filter(Boolean).pop() || cleanPath

  if (isImagePath(cleanPath)) {
    return <ChatImage src={cleanPath} alt={fileName} rawPath={cleanPath} kind={kind} />
  }

  return <FileAttachmentCard rawPath={cleanPath} kind={kind} />
}

export function prewarmMessageImageCache(text: string) {
  if (!text) return

  // 1. Find all base64 data URIs in markdown images: ![alt](data:image/...)
  const imgMatches = text.matchAll(/!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)\s]+(?:\s+[^)]+)?)\)/gi)
  const foundDataUrls: { alt: string; dataUrl: string }[] = []
  for (const match of imgMatches) {
    const alt = match[1].trim()
    const rawData = match[2].trim().replace(/\s+/g, '')
    const cleanData = sanitizeDataUrl(rawData)
    foundDataUrls.push({ alt, dataUrl: cleanData })
    if (alt) {
      cacheImageDataUrl(alt, cleanData)
    }
  }

  // Also check raw data URLs: data:image/...;base64,...
  if (foundDataUrls.length === 0) {
    const rawDataMatches = text.matchAll(/(data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+)/g)
    for (const rMatch of rawDataMatches) {
      const cleanData = sanitizeDataUrl(rMatch[1])
      foundDataUrls.push({ alt: 'image', dataUrl: cleanData })
    }
  }

  // 2. If data URLs were found, associate any companion image paths mentioned in the message
  if (foundDataUrls.length > 0) {
    const pathMatches = text.matchAll(/(?:MEDIA:\s*|\]\()([^\s)]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico|avif))/gi)
    for (const pMatch of pathMatches) {
      const fullPath = pMatch[1].trim()
      const baseName = fullPath.split(/[/\\]/).filter(Boolean).pop()
      if (baseName && !getCachedImageDataUrl(fullPath)) {
        cacheImageDataUrl(fullPath, foundDataUrls[0].dataUrl)
        cacheImageDataUrl(baseName, foundDataUrls[0].dataUrl)
      }
    }
  }
}

function normalizeMultilineImages(text: string): string {
  // Collapse multiline markdown images where the URL is split across lines (especially base64 data URIs)
  return text.replace(/!\[([^\]]*)\]\(([\s\S]*?)\)/g, (match, alt, rawUrl) => {
    const trimmed = rawUrl.trim()
    if (trimmed.startsWith('data:image/')) {
      return `![${alt}](${sanitizeDataUrl(trimmed)})`
    }
    return match
  })
}

function normalizeHtmlImages(text: string): string {
  // Convert <img ... src="..." ... /> to standard Markdown ![alt](src) outside code fences
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part
      return part.replace(/<img\s+([^>]*?)\/?>/gi, (match, attrs) => {
        const srcMatch = attrs.match(/src=["']([^"']+)["']/i)
        if (!srcMatch) return match
        const src = srcMatch[1]
        const altMatch = attrs.match(/alt=["']([^"']+)["']/i)
        const alt = altMatch ? altMatch[1] : ''
        return `![${alt}](${src})`
      })
    })
    .join('')
}

function normalizeLatex(text: string): string {
  // Normalize LaTeX delimiters \[ ... \] to $$ ... $$ and \( ... \) to $ ... $ outside of code fences
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n\n$$\n${math.trim()}\n$$\n\n`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`)
        .replace(/(^|\n)\$\$([^\n$]+)\$\$(\n|$)/g, (_, before, math, after) => `${before}\n\n$$\n${math.trim()}\n$$\n\n${after}`)
    })
    .join('')
}

function CodeBlock({ className, children }: { className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const value = String(children).replace(/\n$/, '')
  const language = className?.match(/language-([\w-]+)/)?.[1] || 'code'
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return <div className="code-block"><div className="code-head"><span>{language}</span><button onClick={() => void copy()} aria-label="Copy code">{copied ? <><Check size={13}/> Copied</> : <><Copy size={13}/> Copy</>}</button></div><pre><code className={className}>{children}</code></pre></div>
}

export const MarkdownContent = memo(function MarkdownContent({ children }: { children?: unknown }) {
  const text = typeof children === 'string' ? children : children == null ? '' : String(children)
  if (!text.trim()) return null
  prewarmMessageImageCache(text)
  const segments = parseMessageSegments(text)

  return (
    <div className="markdown-body">
      {segments.map((seg, idx) => {
        if (seg.type === 'media' || seg.type === 'attachment') {
          return <MediaAttachmentCard key={idx} rawPath={seg.path} kind={seg.type} />
        }
        const withMentionLinks = seg.content.replace(/(^|\s)(@[a-zA-Z0-9][\w-]*)\b/g, '$1[$2](hermes-mention:$2)')
        const withHtmlImages = normalizeHtmlImages(withMentionLinks)
        const withSingleLineImages = normalizeMultilineImages(withHtmlImages)
        const normalized = normalizeLatex(withSingleLineImages)
        return (
          <Markdown
            key={idx}
            urlTransform={url => url}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
            components={{
              a: ({ children: content, href, ...props }) => href?.startsWith('hermes-mention:')
                ? <span className="mention-link" {...props}>{content}</span>
                : <a {...props} href={href} target="_blank" rel="noreferrer">{content}</a>,
              code: ({ className, children: content, ...props }) => {
                const value = String(content)
                return className || value.includes('\n')
                  ? <CodeBlock className={className}>{content}</CodeBlock>
                  : <code className="inline-code" {...props}>{content}</code>
              },
              pre: ({ children: content }) => <>{content}</>,
              table: ({ children: content }) => (
                <div className="table-scroll" tabIndex={0} role="region" aria-label="Table">
                  <table>{content}</table>
                </div>
              ),
              img: ({ src, alt }) => <ChatImage src={src || ''} alt={alt || ''} kind="markdown" />,
            }}
          >
            {normalized}
          </Markdown>
        )
      })}
    </div>
  )
})

type MessageCardProps = {
  message: LiveMessage & { local?: boolean }
  onEdit: (text: string, id: number) => void
  profile?: LiveProfile
  fallbackName: string
  revealTimestamp: boolean
  onRevealTimestamp: () => void
}

export const MessageCard = memo(function MessageCard({ message, onEdit, profile: _profile, fallbackName: _fallbackName, revealTimestamp, onRevealTimestamp }: MessageCardProps) {
  const [copied, setCopied] = useState(false)
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null)
  const stats = formatResponseStats(message)
  const timestamp = formatMessageTime(message.timestamp)
  const textContent = typeof message.content === 'string' ? message.content : message.content == null ? '' : String(message.content)
  const cleanContent = stripAttachedContextScaffolding(textContent)
  const trimmed = cleanContent.trim()
  if (message.role === 'system' || message.role === 'tool' || !trimmed) return null

  const copy = async () => {
    await navigator.clipboard.writeText(cleanContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  const finishSwipe = (x: number) => {
    if (swipeStartX != null && swipeStartX - x > 42) onRevealTimestamp()
    setSwipeStartX(null)
  }
  if (message.role === 'user') return <article className="message-row user-row"><div className="user-bubble"><MarkdownContent>{cleanContent}</MarkdownContent></div><div className="message-actions"><button onClick={() => void copy()}>{copied ? <Check size={13}/> : <Copy size={13}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button><button onClick={() => onEdit(cleanContent, message.id)}>Edit</button></div></article>

  return <article className={`message-row assistant-row ${revealTimestamp ? 'timestamp-visible' : ''}`} onPointerDown={event => setSwipeStartX(event.clientX)} onPointerUp={event => finishSwipe(event.clientX)} onPointerCancel={() => setSwipeStartX(null)}>
    <div className="assistant-message-layout">
      <div className="assistant-bubble">
        {textContent && <MarkdownContent>{textContent}</MarkdownContent>}
        {stats && <div className="response-stats" aria-label="Response generation statistics">{stats}</div>}
      </div>
      <div className="message-actions"><button onClick={() => void copy()}>{copied ? <Check size={13}/> : <Copy size={13}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button></div>
    </div>
    {timestamp && <time className="message-time">{timestamp}</time>}
  </article>
})
