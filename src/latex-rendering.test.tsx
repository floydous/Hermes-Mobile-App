import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MarkdownContent } from './components/MarkdownContent'

describe('MarkdownContent LaTeX rendering', () => {
  it('renders inline math with $ delimiters', () => {
    const html = renderToString(<MarkdownContent>$E = mc^2$</MarkdownContent>)
    expect(html).toContain('class="katex"')
  })

  it('renders block math with $$ delimiters even without newlines', () => {
    const html = renderToString(<MarkdownContent>{'$$\\int_0^1 x dx = \\frac{1}{2}$$'}</MarkdownContent>)
    expect(html).toContain('class="katex-display"')
    expect(html).toContain('class="katex"')
  })

  it('normalizes and renders LaTeX delimiters \\( ... \\) and \\[ ... \\]', () => {
    const html = renderToString(
      <MarkdownContent>
        {'Inline \\(x + y = z\\) and block:\n\\[\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\\]'}
      </MarkdownContent>
    )
    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-display"')
  })

  it('preserves code blocks containing latex-like text without converting inside code', () => {
    const html = renderToString(
      <MarkdownContent>
        {'Here is code:\n```\nconst math = "\\(x + y\\)";\n```'}
      </MarkdownContent>
    )
    expect(html).toContain('&quot;\\(x + y\\)&quot;')
  })
})
