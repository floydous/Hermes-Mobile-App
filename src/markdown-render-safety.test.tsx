import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { isPlainTextMessage, MarkdownContent } from './components/MarkdownContent'

describe('Markdown Content Rendering Safety & Syntax Highlighting', () => {
  it('renders and highlights standard backtick-fenced code blocks', () => {
    const markdown = '```js\nconst greeting = "hello";\nconsole.log(greeting);\n```'
    const html = renderToString(<MarkdownContent>{markdown}</MarkdownContent>)

    expect(html).toContain('code-block')
    expect(html).toContain('language-js')
    expect(html).toContain('hljs')
  })

  it('renders and highlights tilde-fenced code blocks (~~~)', () => {
    const markdown = '~~~python\ndef hello():\n    return "world"\n~~~'
    const html = renderToString(<MarkdownContent>{markdown}</MarkdownContent>)

    expect(html).toContain('code-block')
    expect(html).toContain('language-python')
    expect(html).toContain('hljs')
  })

  it('renders and highlights code blocks nested inside blockquotes', () => {
    const quotedTildes = '> ~~~python\n> def hello():\n>     return "world"\n> ~~~'
    const htmlQuoted = renderToString(<MarkdownContent>{quotedTildes}</MarkdownContent>)

    expect(htmlQuoted).toContain('code-block')
    expect(htmlQuoted).toContain('language-python')
    expect(htmlQuoted).toContain('hljs')

    const indentedCode = 'Section header:\n\n    const answer = 42;'
    const htmlIndented = renderToString(<MarkdownContent>{indentedCode}</MarkdownContent>)
    expect(htmlIndented).toContain('code-block')

    const quotedIndented = '>     const answer = 42;'
    const htmlQuotedIndented = renderToString(<MarkdownContent>{quotedIndented}</MarkdownContent>)
    expect(htmlQuotedIndented).toContain('code-block')
    expect(htmlQuotedIndented).toContain('const answer = 42;')
  })

  it('renders inline code without math or syntax plugin overhead', () => {
    const markdown = 'Here is some `inline code` and normal text.'
    const html = renderToString(<MarkdownContent>{markdown}</MarkdownContent>)

    expect(html).toContain('inline-code')
    expect(html).toContain('inline code')
    expect(html).not.toContain('katex')
  })

  it('renders KaTeX equations when math delimiters are present', () => {
    const mathMarkdown = 'The equation is $E=mc^2$ and here is block math:\n\n$$\\int_0^1 x dx$$\n'
    const html = renderToString(<MarkdownContent>{mathMarkdown}</MarkdownContent>)

    expect(html).toContain('katex')
    expect(html).toContain('katex-mathml')

    // Also test simple paired single-character math like $x$ and $a + b$
    const simpleMathHtml = renderToString(<MarkdownContent>{'Solve for $x$ in $a + b = c$'}</MarkdownContent>)
    expect(simpleMathHtml).toContain('katex')
  })

  it('safely renders currency and shell variables without crashing or corrupting text', () => {
    const currencyMarkdown = 'Price is $50 today and $100 tomorrow. Shell path is $HOME/bin.'
    const html = renderToString(<MarkdownContent>{currencyMarkdown}</MarkdownContent>)

    expect(html).toContain('$50')
    expect(html).toContain('$100')
    expect(html).toContain('$HOME/bin')
  })

  it('preserves plain text in fast-path without modifying content', () => {
    const plain = 'This is a normal paragraph with no images, no math, and no attachments.'
    const html = renderToString(<MarkdownContent>{plain}</MarkdownContent>)

    expect(html).toContain('This is a normal paragraph with no images, no math, and no attachments.')
    expect(html).not.toContain('media-attachment-card')
  })

  it('correctly normalizes uppercase and mixed-case <IMG> and <Img> HTML tags to markdown images', () => {
    const uppercaseImg = 'Check out this screenshot: <IMG src="https://example.com/upper.png" alt="Upper Screenshot" />'
    const htmlUpper = renderToString(<MarkdownContent>{uppercaseImg}</MarkdownContent>)
    expect(htmlUpper).toContain('src="https://example.com/upper.png"')
    expect(htmlUpper).toContain('alt="Upper Screenshot"')

    const mixedImg = 'Another view: <Img src="https://example.com/mixed.png" alt="Mixed Screenshot" />'
    const htmlMixed = renderToString(<MarkdownContent>{mixedImg}</MarkdownContent>)
    expect(htmlMixed).toContain('src="https://example.com/mixed.png"')
    expect(htmlMixed).toContain('alt="Mixed Screenshot"')
  })

  it('correctly handles uppercase and mixed-case variations in context scaffolding', () => {
    // Genuinely uppercase scaffolding to verify case-insensitive detection
    const scaffoldingUpper = '[THE USER SENT A DOCUMENT: "specs.pdf". IT IS SAVED AT: /docs/specs.pdf. ITS CONTENT HAS BEEN INCLUDED BELOW:]'
    const htmlScaffolding = renderToString(<MarkdownContent>{scaffoldingUpper}</MarkdownContent>)
    expect(htmlScaffolding).toContain('media-attachment-card')
    expect(htmlScaffolding).toContain('specs.pdf')

    const mentionText = 'Paging @coder and @tester for code review'
    const htmlMention = renderToString(<MarkdownContent>{mentionText}</MarkdownContent>)
    expect(htmlMention).toContain('class="mention-link"')
    expect(htmlMention).toContain('@coder')
    expect(htmlMention).toContain('@tester')
    expect(htmlMention).not.toContain('node=')
  })

  it('accurately classifies plain text vs markdown syntax via isPlainTextMessage', () => {
    // Pure plain text
    expect(isPlainTextMessage('Hello world, how are you today?')).toBe(true)
    expect(isPlainTextMessage('Paragraph 1.\n\nParagraph 2.')).toBe(true)
    expect(isPlainTextMessage('Simple sentence with numbers 123 and punctuation (fine).')).toBe(true)

    // Markdown syntax MUST return false
    expect(isPlainTextMessage('Bold **text**')).toBe(false)
    expect(isPlainTextMessage('Italic *text*')).toBe(false)
    expect(isPlainTextMessage('Code `inline`')).toBe(false)
    expect(isPlainTextMessage('# Heading')).toBe(false)
    expect(isPlainTextMessage('[link](https://example.com)')).toBe(false)
    expect(isPlainTextMessage('Plain text with url https://example.com')).toBe(false)
    expect(isPlainTextMessage('- bullet item')).toBe(false)
    expect(isPlainTextMessage('1. ordered item')).toBe(false)
    expect(isPlainTextMessage('    indented code block')).toBe(false)
    expect(isPlainTextMessage('> quote')).toBe(false)
    expect(isPlainTextMessage('Equation $E=mc^2$')).toBe(false)
    expect(isPlainTextMessage('Mention @alice')).toBe(false)
    expect(isPlainTextMessage('MEDIA:/path/to/img.png')).toBe(false)
  })
})
