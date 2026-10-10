import { cloneElement, isValidElement, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  Download,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Pencil,
  WifiOff,
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
import { extractCompactedUserAsk, isCompactionSummary, isContinuationNudge, isModelSwitchMarker, parseModelSwitchNotice } from '../session-cache'
import { resolveDelegationSenderProfile } from '../chat-turn'
import { formatMessageTime, formatResponseStats } from '../message-stats'
import { BotAvatar } from './BotAvatar'
import { ClarifyHistoryCard } from './ClarifyCard'
import {
  computeDismissDelay,
  computeSwipeTransform,
  processSwipeMove,
  shouldDismissOnRelease,
} from '../swipe-dismiss'

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

export function stripBackgroundProcessNotices(text: string): { clean: string; notices: string[] } {
  if (!text) return { clean: '', notices: [] }
  const notices: string[] = []
  // Matches [IMPORTANT: Background process ...] envelopes, handling nested brackets (such as [exit code 0], [BELUM SELESAI])
  const pattern = /(?:--\s*)?\[IMPORTANT:\s*Background process\s+proc_[a-zA-Z0-9_-]+[\s\S]*?\n\]/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    notices.push(match[0])
  }
  let clean = text.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim()
  if (!notices.length) {
    const fallbackPattern = /(?:--\s*)?\[IMPORTANT:\s*Background process\s+proc_[a-zA-Z0-9_-]+[\s\S]*?\](?=\s*$|\n\n)/gi
    while ((match = fallbackPattern.exec(text)) !== null) {
      notices.push(match[0])
    }
    clean = text.replace(fallbackPattern, '').replace(/\n{3,}/g, '\n\n').trim()
  }
  return { clean, notices }
}

export type AgentDelegation = {
  senderName: string
  handle: string
  body: string
  kind?: 'task' | 'reply' | 'result'
}

export function parseAgentDelegation(
  text: string,
  message?: LiveMessage & { local?: boolean },
  previousMessage?: LiveMessage,
  profiles?: LiveProfile[]
): AgentDelegation | null {
  if (!text) return null
  // Only incoming user-role messages can be delegations; assistant responses are never delegations
  if (message && message.role !== 'user') return null
  // Messages typed locally by the human user in this app are NEVER agent delegations
  if (message?.local) return null

  const trimmed = text.trim()

  // 1. Explicit delegation prefix (authoritative Hermes stamp):
  // Format: "Message from 🤖 <name> (@<handle>): ..." or "Message from <name> (@<handle>): ..."
  const matchExplicit = trimmed.match(/^Message from (?:🤖\s*([^\n(@:]+?)(?:\s*\(@([A-Za-z0-9_.-]+)\))?|([^\n(@:]+?)\s*\(@([A-Za-z0-9_.-]+)\)):\s*([\s\S]*)$/i)
  if (matchExplicit) {
    const senderName = (matchExplicit[1] || matchExplicit[3] || '').trim()
    const handle = (matchExplicit[2] || matchExplicit[4] || senderName).trim()
    const body = (matchExplicit[5] || '').trim()
    if (senderName && body) {
      return { senderName, handle, body, kind: 'task' }
    }
  }

  // 2. Multilingual reply headers from known bots:
  // Format: "Balasan dari @<handle>:" or "Balasan dari **@<handle>**:"
  const matchReply = trimmed.match(/^(?:Balasan|Pesan|Reply|Response)\s+dari\s+(?:\*\*@?|@)([a-zA-Z0-9_-]+)\*\*?:\s*([\s\S]*)$/i)
  if (matchReply) {
    const handle = matchReply[1].trim()
    const body = matchReply[2].trim()
    const isKnown = !profiles || profiles.some(p => p.name.toLowerCase() === handle.toLowerCase() || p.display_name?.toLowerCase() === handle.toLowerCase()) || handle.toLowerCase() === 'hermes' || handle.toLowerCase() === 'default'
    if (isKnown && handle && body) {
      return { senderName: handle, handle, body, kind: 'reply' }
    }
  }

  // 3. Process completion metadata from background delegation are internal runtime signals (never render as chat turns):
  if (message) {
    const displayKind = (message as any).display_kind
    if (displayKind === 'process_complete' || displayKind === 'async_delegation_complete' || displayKind === 'hidden') {
      return null
    }
  }

  // 4. Preceding delegation context: if previous assistant turn dispatched to a known bot in roster
  if (previousMessage && previousMessage.role === 'assistant') {
    const prevContent = typeof previousMessage.content === 'string' ? previousMessage.content : ''
    const prevHadDelegation =
      previousMessage.tool_name === 'message_agent' ||
      previousMessage.tool_name === 'delegate_task' ||
      /(?:message_agent|delegate_task|request to|tugas ke|sent a request to|dispatched to|pesan ke)\s*@?([a-zA-Z0-9_-]+)/i.test(prevContent)

    if (prevHadDelegation) {
      const targetMatch = prevContent.match(/(?:request to|tugas ke|sent a request to|dispatched to|message_agent.*?target=["']?|pesan ke)\s*@?([a-zA-Z0-9_-]+)/i)
      const targetName = targetMatch ? targetMatch[1].trim().toLowerCase() : ''
      // Strictly match a real bot in the roster
      const matchedProfile = profiles?.find(p => p.name.toLowerCase() === targetName || p.display_name?.toLowerCase() === targetName)
      if (matchedProfile && (
        trimmed.includes('[BELUM SELESAI]') ||
        trimmed.includes('[SELESAI]') ||
        trimmed.includes('Daftar Tugas') ||
        trimmed.includes('Status Keseluruhan') ||
        /^[A-Za-z0-9 ./-]+:\s+[^\n]+\[(?:BELUM SELESAI|SELESAI|DONE|TODO)\]/m.test(trimmed)
      )) {
        return { senderName: matchedProfile.name, handle: matchedProfile.name, body: trimmed, kind: 'result' }
      }
    }
  }

  return null
}

export function stripAttachedContextScaffolding(text: string): string {
  if (!text) return ''

  // Convert backend document notices into clean attachment directives.
  // Requires high-entropy Hermes signature: 'saved at:' AND ('not inlined' or 'has been included')
  // so casual conversational mentions of brackets can never trigger a false positive.
  let stripped = text.replace(
    /\[The user sent a (?:text )?document:\s*['"]([^'"]+)['"]\.\s*(?:It is saved at|The file is also saved at):\s*([^\s\]]+?)\.\s*(?:Its (?:text|content) (?:is not inlined|has been included)|To read it, extract)[\s\S]*?\]/gi,
    (_, name, path) => {
      const cleanPath = path ? path.replace(/[.]+$/, '').trim() : name.trim()
      return `\nAttached: ${cleanPath}\n`
    }
  )

  stripped = stripped
    .replace(/^\s*\[STILL IN PROGRESS\s*[—–-]\s*this is the active request[\s\S]*?do not start over\.?\]\s*/i, '')
    .replace(/^\s*\[PRIOR CONTEXT\s*[—–-]\s*for reference only;?\s*not a new message\.?\]\s*/i, '')
    .replace(/\[OUT-OF-BAND USER MESSAGE\s*[—–-]\s*a direct message from the user[\s\S]*?conversation history\]/gi, '')
    .replace(/\[\/OUT-OF-BAND USER MESSAGE\]/gi, '')
    .replace(/\n*--- (?:Attached Context|Context Warnings) ---\n[\s\S]*$/, '')
    .trim()
  const { clean } = stripBackgroundProcessNotices(stripped)
  return clean
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

export async function triggerDownload(src: string, fileName: string) {
  try {
    if (src.startsWith('data:')) {
      const a = document.createElement('a')
      a.href = src
      const hasExt = /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(fileName)
      a.download = hasExt ? fileName : `${fileName}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      return
    }

    try {
      const response = await fetch(src)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch {
      // Fallback for CORS restricted images: trigger anchor download directly
      const a = document.createElement('a')
      a.href = src
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  } catch {
    window.open(src, '_blank')
  }
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
  const [downloading, setDownloading] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const [isClosing, setIsClosing] = useState(false)
  const [isGlidingOut, setIsGlidingOut] = useState(false)
  const [zoomScale, setZoomScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const closeTimerRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const startXRef = useRef<number | null>(null)
  const isSwipeDownRef = useRef(false)
  const initialPinchDistRef = useRef<number | null>(null)
  const initialPinchScaleRef = useRef(1)
  const lastTapTimeRef = useRef(0)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)
  const initialPanRef = useRef({ x: 0, y: 0 })

  const isData = src.startsWith('data:')
  const rawFileName = rawPath
    ? (rawPath.split(/[/\\]/).filter(Boolean).pop() || rawPath)
    : alt || (isData ? 'image.png' : src.split(/[/\\]/).filter(Boolean).pop() || 'image.png')
  const fileName = rawFileName.trim() || 'image.png'

  const prefersReducedMotion = () => {
    try {
      return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  }

  // Dismissal from top-bar X button or Escape key (subtle scale-down exit)
  const dismiss = useCallback(() => {
    if (isClosing || isGlidingOut) return
    const delay = computeDismissDelay(prefersReducedMotion())
    if (delay === 0) {
      onClose()
      return
    }
    setIsClosing(true)
    setIsEntering(false)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      onClose()
    }, delay)
  }, [isClosing, isGlidingOut, onClose])

  // Dismissal from swipe-down gesture: continues gliding smoothly downwards off-screen
  const dismissViaSwipeDown = useCallback((finalDragY: number) => {
    if (isClosing || isGlidingOut) return
    const delay = computeDismissDelay(prefersReducedMotion())
    if (delay === 0) {
      onClose()
      return
    }
    setIsGlidingOut(true)
    setIsEntering(false)
    setIsDragging(false)
    setDragY(finalDragY + 600)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      onClose()
    }, delay)
  }, [isClosing, isGlidingOut, onClose])

  // Unconditional unmount cleanup for dismissal timers
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (prefersReducedMotion()) {
      setIsEntering(false)
      return
    }
    const timer = window.setTimeout(() => {
      setIsEntering(false)
    }, 280)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    const origOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = origOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [dismiss])

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setDownloading(true)
    try {
      await triggerDownload(src, fileName)
    } finally {
      setTimeout(() => setDownloading(false), 800)
    }
  }

  // Double-tap or double-click to toggle zoom (1x <-> 2.5x)
  const toggleZoom = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation()
    if (zoomScale > 1.05) {
      setZoomScale(1)
      setPan({ x: 0, y: 0 })
    } else {
      setZoomScale(2.5)
      setPan({ x: 0, y: 0 })
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (isClosing || isGlidingOut) return
    setIsEntering(false)

    // Two-finger pinch-to-zoom
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      initialPinchDistRef.current = dist
      initialPinchScaleRef.current = zoomScale
      setIsDragging(false)
      isSwipeDownRef.current = false
      return
    }

    if (e.touches.length === 1) {
      const touchX = e.touches[0].clientX
      const touchY = e.touches[0].clientY
      const now = Date.now()

      // Double-tap detection (<300ms)
      if (now - lastTapTimeRef.current < 300) {
        lastTapTimeRef.current = 0
        toggleZoom(e)
        return
      }
      lastTapTimeRef.current = now

      startYRef.current = touchY
      startXRef.current = touchX

      if (zoomScale > 1.05) {
        // In zoomed mode: start panning
        panStartRef.current = { x: touchX, y: touchY }
        initialPanRef.current = { ...pan }
        setIsDragging(true)
      } else {
        // In 1x mode: ready for swipe-down to dismiss
        isSwipeDownRef.current = false
        setIsDragging(false)
      }
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isClosing || isGlidingOut) return

    // Two-finger pinch-to-zoom handling
    if (e.touches.length === 2 && initialPinchDistRef.current != null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      const ratio = dist / initialPinchDistRef.current
      const nextScale = Math.min(4, Math.max(1, initialPinchScaleRef.current * ratio))
      setZoomScale(nextScale)
      if (nextScale <= 1.05) {
        setPan({ x: 0, y: 0 })
      }
      if (e.cancelable) e.preventDefault()
      return
    }

    if (e.touches.length === 1) {
      const currentX = e.touches[0].clientX
      const currentY = e.touches[0].clientY

      if (zoomScale > 1.05 && panStartRef.current) {
        // Zoomed in: pan image freely within bounds
        const deltaX = currentX - panStartRef.current.x
        const deltaY = currentY - panStartRef.current.y
        const maxPanX = (window.innerWidth * (zoomScale - 1)) / 1.8
        const maxPanY = (window.innerHeight * (zoomScale - 1)) / 1.8
        setPan({
          x: Math.max(-maxPanX, Math.min(maxPanX, initialPanRef.current.x + deltaX)),
          y: Math.max(-maxPanY, Math.min(maxPanY, initialPanRef.current.y + deltaY)),
        })
        if (e.cancelable) e.preventDefault()
        return
      }

      // Not zoomed in: swipe-down to dismiss
      if (startYRef.current != null && startXRef.current != null) {
        const res = processSwipeMove(startXRef.current, startYRef.current, currentX, currentY, isSwipeDownRef.current)
        if (res.active) {
          isSwipeDownRef.current = true
          setIsDragging(true)
          setDragY(res.dragY)
          if (res.shouldPreventDefault && e.cancelable) e.preventDefault()
        }
      }
    }
  }

  const handleTouchEnd = () => {
    if (isClosing || isGlidingOut) return
    initialPinchDistRef.current = null
    panStartRef.current = null

    if (zoomScale <= 1.05 && isSwipeDownRef.current && shouldDismissOnRelease(dragY)) {
      dismissViaSwipeDown(dragY)
      return
    }

    setIsDragging(false)
    setDragY(0)
    startYRef.current = null
    startXRef.current = null
    isSwipeDownRef.current = false
  }

  const handleTouchCancel = () => {
    if (isClosing || isGlidingOut) return
    initialPinchDistRef.current = null
    panStartRef.current = null
    setIsDragging(false)
    setDragY(0)
    startYRef.current = null
    startXRef.current = null
    isSwipeDownRef.current = false
  }

  const { backdropOpacity, scale } = computeSwipeTransform(dragY, isDragging)

  const backdropClass = [
    'image-lightbox-backdrop',
    isEntering && 'is-entering',
    isClosing && 'is-closing',
    isGlidingOut && 'is-gliding-out',
  ].filter(Boolean).join(' ')

  const topBarClass = [
    'image-lightbox-top-bar',
    isEntering && 'is-entering',
    (isClosing || isGlidingOut) && 'is-closing',
  ].filter(Boolean).join(' ')

  const stageClass = [
    'image-lightbox-stage',
    isEntering && 'is-entering',
    isClosing && 'is-closing',
    isGlidingOut && 'is-gliding-out',
  ].filter(Boolean).join(' ')

  const stageStyle: React.CSSProperties = isClosing
    ? {}
    : isGlidingOut
    ? {
        transform: `translate3d(0, ${dragY}px, 0) scale(${scale * 0.9})`,
        opacity: 0,
        transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.20s ease',
      }
    : {
        transform: zoomScale > 1.05
          ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoomScale})`
          : `translate3d(0, ${dragY}px, 0) scale(${scale})`,
        transition: isDragging
          ? 'none'
          : 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
      }

  const backdropStyle: React.CSSProperties = isClosing
    ? {}
    : isGlidingOut
    ? {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        transition: 'background-color 0.20s ease',
      }
    : {
        backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})`,
        transition: isDragging ? 'none' : 'background-color 0.22s ease',
      }

  const content = (
    <div
      className={backdropClass}
      style={backdropStyle}
      onClick={dismiss}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <header className={topBarClass} onClick={e => e.stopPropagation()}>
        <button
          type="button"
          className="image-lightbox-circle-btn"
          onClick={dismiss}
          title="Close preview"
          aria-label="Close image preview"
        >
          <X size={20} />
        </button>
        <button
          type="button"
          className="image-lightbox-circle-btn"
          onClick={handleDownload}
          title="Download image"
          aria-label="Download image"
        >
          {downloading ? <Check size={18} /> : <Download size={19} />}
        </button>
      </header>

      <div
        className={stageClass}
        style={stageStyle}
      >
        <img
          className="image-lightbox-img"
          src={src}
          alt={alt || fileName}
          onClick={toggleZoom}
        />
      </div>
    </div>
  )
  if (typeof document !== 'undefined' && document.body) {
    return createPortal(content, document.body)
  }
  return content
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
  const cleanPath = rawPath.trim()
  const fileName = cleanPath.split(/[/\\]/).filter(Boolean).pop() || cleanPath
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : ''
  const isImage = isImagePath(cleanPath)
  const isCode = ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'json', 'yaml', 'yml', 'toml', 'html', 'css', 'sh', 'sql', 'c', 'cpp'].includes(ext)
  const isSheet = ['csv', 'tsv', 'xlsx', 'xls'].includes(ext)
  const isDoc = ['md', 'txt', 'pdf', 'doc', 'docx', 'rtf'].includes(ext)

  const typeLabel = ext ? ext.toUpperCase() : 'FILE'

  return (
    <div className={`media-attachment-card ${kind}`} title={fileName} aria-label={`Attached file: ${fileName}`} data-path={cleanPath}>
      <div className="media-card-icon-box" aria-hidden="true">
        {isImage ? <ImageIcon size={14} /> : isCode ? <FileCode size={14} /> : isSheet ? <FileSpreadsheet size={14} /> : isDoc ? <FileText size={14} /> : <File size={14} />}
      </div>
      <div className="media-card-content">
        <span className="media-card-filename">{fileName}</span>
      </div>
      <span className="media-card-badge">{typeLabel}</span>
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

export const MarkdownContent = memo(function MarkdownContent({
  children,
}: {
  children?: unknown
  isStreaming?: boolean
}) {
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
  previousMessage?: LiveMessage
  onEdit: (text: string, id: number) => void
  profile?: LiveProfile
  profiles?: LiveProfile[]
  fallbackName: string
  isCompleted?: boolean
  isActiveTurn?: boolean
  activeToolStatus?: string
  revealTimestamp: boolean
  onRevealTimestamp: () => void
}

export function AgentDispatchBubble({
  delegation,
  senderProfile,
  isCompleted,
}: {
  delegation: AgentDelegation
  senderProfile?: LiveProfile
  isCompleted?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const isCollapsible = (delegation.body.split('\n').length > 4 || delegation.body.length > 200)

  const label = delegation.kind === 'result'
    ? 'Response'
    : delegation.kind === 'reply'
    ? 'Reply'
    : 'Dispatched'

  return (
    <div className="agent-dispatch-bubble">
      <header className="agent-dispatch-header">
        <div className="agent-dispatch-avatar" aria-hidden="true">
          <BotAvatar
            profile={senderProfile}
            fallbackName={delegation.handle || delegation.senderName}
            variant="dispatch"
          />
        </div>
        <div className="agent-dispatch-meta">
          <span className="agent-dispatch-handle">{`@${delegation.handle}`}</span>
        </div>
      </header>

      <div className={`agent-dispatch-body ${isCollapsible && !expanded ? 'is-collapsed' : ''}`}>
        <MarkdownContent>{delegation.body}</MarkdownContent>
        {isCollapsible && !expanded && (
          <div className="agent-dispatch-fade" aria-hidden="true" />
        )}
      </div>

      {(isCollapsible || isCompleted) && (
        <footer className="agent-dispatch-footer">
          {isCollapsible ? (
            <button
              type="button"
              className="agent-dispatch-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded(prev => !prev)}
            >
              <span>{expanded ? 'Show less' : 'Show more'}</span>
              <ChevronDown size={12} className={expanded ? 'is-expanded' : ''} />
            </button>
          ) : <span />}

          {isCompleted && (
            <div className="agent-dispatch-status completed" title="Completed">
              <Check size={11} strokeWidth={2.5} />
              <span>Completed</span>
            </div>
          )}
        </footer>
      )}
    </div>
  )
}

export function getUiZoomFactor(): number {
  if (typeof document === 'undefined') return 1
  try {
    const docEl = document.documentElement
    const computed = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(docEl) : null

    // 1. Check custom property --ui-scale (computed or inline)
    const propVal = computed?.getPropertyValue('--ui-scale') || docEl.style.getPropertyValue('--ui-scale')
    const parsedProp = parseFloat(propVal)
    if (!isNaN(parsedProp) && parsedProp > 0) return parsedProp

    // 2. Check CSS zoom (computed or inline)
    const zoomVal = (computed as any)?.zoom || (docEl.style as any)?.zoom
    const parsedZoom = parseFloat(zoomVal)
    if (!isNaN(parsedZoom) && parsedZoom > 0) return parsedZoom
  } catch {}
  return 1
}

export const MessageCard = memo(function MessageCard({ message, previousMessage, onEdit, profile: _profile, profiles, fallbackName: _fallbackName, isCompleted, isActiveTurn, activeToolStatus, revealTimestamp, onRevealTimestamp }: MessageCardProps) {
  const [copied, setCopied] = useState(false)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [actionSheetExiting, setActionSheetExiting] = useState(false)
  const [isPressing, setIsPressing] = useState(false)
  const [bubbleRect, setBubbleRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const pressTimerRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null)
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null)
  const stats = formatResponseStats(message)
  const timestamp = formatMessageTime(message.timestamp)
  const rawContent = message.display_content || message.content
  const textContent = typeof rawContent === 'string' ? rawContent : rawContent == null ? '' : String(rawContent)
  let cleanContent = stripAttachedContextScaffolding(textContent)
  let trimmed = cleanContent.trim()
  if (message.role === 'system' || !trimmed) return null

  // If this is a synthetic context compaction handoff message
  if (isCompactionSummary(trimmed)) {
    const extractedUserAsk = extractCompactedUserAsk(trimmed)
    if (extractedUserAsk) {
      cleanContent = extractedUserAsk
      trimmed = extractedUserAsk.trim()
    } else {
      return (
        <div className="compacted-history-notice-row" role="status" aria-label="Earlier conversation compacted">
          <div className="compacted-history-capsule">
            <Layers size={13} className="compacted-history-icon" aria-hidden="true" />
            <span>Earlier conversation compacted for context</span>
          </div>
        </div>
      )
    }
  }

  // If this is a synthetic network cutoff / continuation nudge, render a clean notice capsule
  if (isContinuationNudge(trimmed)) {
    return (
      <div className="network-cutoff-notice-row" role="status" aria-label="Response continued after network interruption">
        <div className="network-cutoff-capsule">
          <WifiOff size={13} className="network-cutoff-icon" aria-hidden="true" />
          <span>Response continued after network interruption</span>
        </div>
      </div>
    )
  }

  // If this is a synthetic model switch marker injected by the gateway
  const displayKind = (message as any).display_kind
  if (displayKind === 'model_switch' || isModelSwitchMarker(trimmed)) {
    const modelNotice = parseModelSwitchNotice(trimmed)
    return (
      <div className="model-switch-notice-row" role="status" aria-label="Model changed">
        <div className="model-switch-capsule">
          <Cpu size={13} className="model-switch-icon" aria-hidden="true" />
          <span>
            Model switched to <strong>{modelNotice?.model || 'new model'}</strong>
            {modelNotice?.provider ? ` (${modelNotice.provider})` : ''}
          </span>
        </div>
      </div>
    )
  }

  // If this is a tool message for clarify, render the ClarifyHistoryCard
  if (message.role === 'tool') {
    const isClarify = message.tool_name === 'clarify' || (message as any).name === 'clarify'
    if (isClarify) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && Array.isArray(parsed.responses)) {
          return (
            <article className="message-row clarify-history-row">
              <ClarifyHistoryCard responses={parsed.responses} outcome={parsed.outcome} />
            </article>
          )
        }
      } catch {}
    }
    return null
  }

  // Internal runtime scaffolding (process completion signals and hidden system rows) are never rendered
  if (displayKind === 'hidden' || displayKind === 'process_complete' || displayKind === 'async_delegation_complete') return null
  if (/^\[IMPORTANT:\s*Background process\s+/i.test(textContent.trim()) && textContent.trim().endsWith(']')) return null

  const copy = async () => {
    await navigator.clipboard.writeText(cleanContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  const finishSwipe = (x: number) => {
    if (swipeStartX != null && swipeStartX - x > 42) onRevealTimestamp()
    setSwipeStartX(null)
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (target?.closest('.table-scroll, table, pre, code, .code-block, a, button, input, textarea')) return
    touchStartPosRef.current = { x: e.clientX, y: e.clientY }

    // Start squish animation only after holding for a fraction of a second (140ms),
    // ensuring ordinary tapping or flicking to scroll never causes a flash of squish
    if (pressTimerRef.current != null) window.clearTimeout(pressTimerRef.current)
    pressTimerRef.current = window.setTimeout(() => {
      setIsPressing(true)
    }, 140)

    const targetEl = e.currentTarget as HTMLElement
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      setBubbleRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
    }
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = window.setTimeout(() => {
      setIsPressing(false)
      const el = bubbleRef.current || targetEl
      if (el) {
        const r = el.getBoundingClientRect()
        setBubbleRect({
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
        })
      }
      try { navigator.vibrate?.(15) } catch {}
      setActionSheetOpen(true)
    }, 460)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!touchStartPosRef.current) return
    const dx = Math.abs(e.clientX - touchStartPosRef.current.x)
    const dy = Math.abs(e.clientY - touchStartPosRef.current.y)
    if (dx > 10 || dy > 10) {
      setIsPressing(false)
      if (pressTimerRef.current != null) {
        window.clearTimeout(pressTimerRef.current)
        pressTimerRef.current = null
      }
      if (longPressTimerRef.current != null) {
        window.clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }
  }

  const handlePointerUp = () => {
    setIsPressing(false)
    if (pressTimerRef.current != null) {
      window.clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    touchStartPosRef.current = null
  }

  const closeActionSheet = () => {
    if (actionSheetExiting) return
    setActionSheetExiting(true)
    window.setTimeout(() => {
      setActionSheetOpen(false)
      setActionSheetExiting(false)
    }, 160)
  }

  useEffect(() => {
    if (!actionSheetOpen) return
    const prevOverflow = document.body.style.overflow
    const prevTouchAction = document.body.style.touchAction
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'
    const onMobileBack = (e: Event) => {
      e.preventDefault()
      closeActionSheet()
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.touchAction = prevTouchAction
      window.removeEventListener('hermes-mobile-back', onMobileBack)
    }
  }, [actionSheetOpen, actionSheetExiting])

  const renderActionSheet = () => {
    if (!actionSheetOpen || typeof document === 'undefined') return null

    const zoom = getUiZoomFactor()
    const docEl = document.documentElement
    const viewportH = typeof window !== 'undefined' ? (docEl.clientHeight || window.innerHeight) : 700
    const viewportW = typeof window !== 'undefined' ? (docEl.clientWidth || window.innerWidth) : 380

    // When CSS zoom is active on documentElement, getBoundingClientRect() returns
    // zoomed visual viewport coordinates. Elements rendered in position: fixed inside
    // the zoomed root would be scaled a second time. Divide by zoom to normalize.
    const scaledRect = bubbleRect ? {
      top: bubbleRect.top / zoom,
      left: bubbleRect.left / zoom,
      width: bubbleRect.width / zoom,
      height: bubbleRect.height / zoom,
    } : null

    // Truly tall bubble: actual rendered height exceeds 48% of viewport
    const isTall = Boolean(scaledRect && scaledRect.height > viewportH * 0.48)

    let bubblePositionStyle: React.CSSProperties = {}
    let pillsPositionStyle: React.CSSProperties = {}

    if (scaledRect) {
      // Horizontal positioning in unscaled layout coordinate space:
      // For assistant messages, align left edge of pills to left edge of bubble.
      // For user messages, align right edge of pills flush to right edge of bubble.
      const pillsEstimatedWidth = message.role === 'user' ? 186 : 96
      const pillsLeft = message.role === 'user'
        ? Math.max(16, Math.min(viewportW - pillsEstimatedWidth - 16, scaledRect.left + scaledRect.width - pillsEstimatedWidth))
        : Math.max(16, Math.min(viewportW - pillsEstimatedWidth - 16, scaledRect.left))

      if (isTall) {
        // Long / overflowing message bubble:
        // Gracefully contain within a clean 48vh viewport window with a bottom fade mask
        const maxHeight = Math.min(Math.round(viewportH * 0.48), 380)
        const visibleHeight = Math.min(scaledRect.height, maxHeight)
        const top = Math.max(68, Math.min(scaledRect.top, viewportH - visibleHeight - 70))
        const safeWidth = Math.ceil(scaledRect.width) + 3

        bubblePositionStyle = {
          position: 'fixed',
          top: `${top}px`,
          left: `${scaledRect.left}px`,
          width: `${safeWidth}px`,
          maxWidth: `${safeWidth}px`,
          height: `${visibleHeight}px`,
          maxHeight: `${visibleHeight}px`,
          margin: 0,
        }
        // Action pills float cleanly right below the clamped preview (snug 8px gap)
        pillsPositionStyle = {
          position: 'fixed',
          top: `${top + visibleHeight + 8}px`,
          left: `${pillsLeft}px`,
        }
      } else {
        // Standard in-place message:
        // Add subtle sub-pixel buffer and use auto height so text never wraps onto an extra cropped line
        const safeWidth = Math.ceil(scaledRect.width) + 3

        bubblePositionStyle = {
          position: 'fixed',
          top: `${scaledRect.top}px`,
          left: `${scaledRect.left}px`,
          width: `${safeWidth}px`,
          minWidth: `${scaledRect.width}px`,
          minHeight: `${scaledRect.height}px`,
          height: 'auto',
          margin: 0,
        }

        // Determine whether to place pills above or below based on available space:
        // If there is >= 54px above, place snug 8px above; otherwise snug 8px below.
        const canShowAbove = scaledRect.top >= 54
        const pillsTop = canShowAbove
          ? Math.max(12, scaledRect.top - 46)
          : scaledRect.top + scaledRect.height + 8

        pillsPositionStyle = {
          position: 'fixed',
          top: `${pillsTop}px`,
          left: `${pillsLeft}px`,
        }
      }
    }

    return createPortal(
      <div
        className={`message-action-modal-backdrop ${actionSheetExiting ? 'exiting' : ''}`}
        role="presentation"
        onClick={closeActionSheet}
      >
        <div
          className={`message-action-sheet-in-place ${message.role === 'user' ? 'user-sheet' : 'assistant-sheet'}`}
          role="dialog"
          aria-label="Message actions"
          onClick={e => e.stopPropagation()}
        >
          <div
            className={`message-action-bubble-clone ${isTall ? 'is-tall-clamped' : ''} ${message.role === 'user' ? 'user-bubble' : 'assistant-bubble'}`}
            style={bubblePositionStyle}
          >
            <MarkdownContent>{cleanContent}</MarkdownContent>
          </div>
          <div className="message-action-pills" style={pillsPositionStyle}>
            <button
              type="button"
              className="message-action-pill-btn"
              onClick={() => {
                void copy()
                closeActionSheet()
              }}
            >
              <Copy size={15} />
              <span>Copy</span>
            </button>
            {message.role === 'user' && (
              <button
                type="button"
                className="message-action-pill-btn"
                onClick={() => {
                  closeActionSheet()
                  onEdit(cleanContent, message.id)
                }}
              >
                <Pencil size={15} />
                <span>Edit</span>
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body
    )
  }

  const delegation = message.role === 'user' ? parseAgentDelegation(cleanContent, message, previousMessage, profiles) : null
  if (delegation) {
    const senderProfile = resolveDelegationSenderProfile(delegation.handle, delegation.senderName, profiles)
    return (
      <>
        <article className="message-row agent-delegation-row">
          <AgentDispatchBubble
            delegation={delegation}
            senderProfile={senderProfile}
            isCompleted={isCompleted}
          />
          {isActiveTurn && activeToolStatus && (
            <div className="dispatch-child-branch">
              <div className="dispatch-branch-stem" aria-hidden="true">
                <span className="dispatch-branch-corner">└</span>
              </div>
              <div className="dispatch-branch-pill">
                <span className="dispatch-pulse-dot" aria-hidden="true" />
                <span className="dispatch-branch-text">{activeToolStatus}</span>
              </div>
            </div>
          )}
        </article>
      </>
    )
  }

  const isTallBubble = Boolean(bubbleRect && bubbleRect.height > 160)
  const squishClass = isPressing ? (isTallBubble ? 'is-squished is-tall-squish' : 'is-squished') : ''

  if (message.role === 'user') {
    return (
      <>
        <article className="message-row user-row">
          <div
            className={`user-bubble ${squishClass}`}
            ref={bubbleRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <MarkdownContent>{cleanContent}</MarkdownContent>
          </div>
        </article>
        {renderActionSheet()}
      </>
    )
  }

  return (
    <>
      <article
        className={`message-row assistant-row ${revealTimestamp ? 'timestamp-visible' : ''}`}
        onPointerDown={event => setSwipeStartX(event.clientX)}
        onPointerUp={event => finishSwipe(event.clientX)}
        onPointerCancel={() => setSwipeStartX(null)}
      >
        <div className="assistant-message-layout">
          <div
            className={`assistant-bubble ${squishClass}`}
            ref={bubbleRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {cleanContent && <MarkdownContent>{cleanContent}</MarkdownContent>}
            {stats && <div className="response-stats" aria-label="Response generation statistics">{stats}</div>}
          </div>
        </div>
        {timestamp && <time className="message-time">{timestamp}</time>}
      </article>
      {renderActionSheet()}
    </>
  )
})
