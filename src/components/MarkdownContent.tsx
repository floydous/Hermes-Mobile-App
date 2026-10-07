import { memo, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'

import type { LiveMessage, LiveProfile } from '../hermes'
import { formatMessageTime, formatResponseStats } from '../message-stats'

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
  const withMentionLinks = text.replace(/(^|\s)(@[a-zA-Z0-9][\w-]*)\b/g, '$1[$2](hermes-mention:$2)')
  const normalized = normalizeLatex(withMentionLinks)
  return <div className="markdown-body"><Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]} components={{
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
    table: ({ children: content }) => <div className="table-scroll"><table>{content}</table></div>,
  }}>{normalized}</Markdown></div>
})

type MessageCardProps = {
  message: LiveMessage & { local?: boolean }
  onEdit: (text: string) => void
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
  const trimmed = textContent.trim()
  if (message.role === 'system' || message.role === 'tool' || !trimmed) return null

  const copy = async () => {
    await navigator.clipboard.writeText(textContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  const finishSwipe = (x: number) => {
    if (swipeStartX != null && swipeStartX - x > 42) onRevealTimestamp()
    setSwipeStartX(null)
  }
  if (message.role === 'user') return <article className="message-row user-row"><div className="user-bubble"><MarkdownContent>{textContent}</MarkdownContent></div><div className="message-actions"><button onClick={() => void copy()}>{copied ? <Check size={13}/> : <Copy size={13}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button><button onClick={() => onEdit(textContent)}>Edit</button></div></article>

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
