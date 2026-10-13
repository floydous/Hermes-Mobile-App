import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { MarkdownContent } from './components/MarkdownContent'

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
})
