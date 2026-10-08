import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MarkdownContent } from './components/MarkdownContent'

describe('MarkdownContent Table rendering', () => {
  it('renders a Markdown table inside an accessible .table-scroll container', () => {
    const tableMarkdown = `
| Situation | Status | Priority | Description |
| :--- | :--- | :--- | :--- |
| Server Timeout | In-Progress | High | Gateway drop on heavy load |
| Memory Pressure | Resolved | Medium | GC sweep optimized |
`
    const html = renderToString(<MarkdownContent>{tableMarkdown}</MarkdownContent>)

    // Verify .table-scroll wrapper with accessibility attributes
    expect(html).toContain('class="table-scroll"')
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Table"')
    expect(html).toContain('tabindex="0"')

    // Verify table structure
    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).toContain('<tbody>')

    // Verify headers
    expect(html).toContain('<th')
    expect(html).toContain('Situation</th>')
    expect(html).toContain('Status</th>')
    expect(html).toContain('Priority</th>')
    expect(html).toContain('Description</th>')

    // Verify cell contents
    expect(html).toContain('Server Timeout</td>')
    expect(html).toContain('In-Progress</td>')
    expect(html).toContain('Gateway drop on heavy load</td>')
  })

  it('renders tables with formatting, code, and links in cells', () => {
    const tableMarkdown = `
| Key | Value | Code | Link |
| --- | --- | --- | --- |
| **API** | Enabled | \`GET /api\` | [Docs](https://example.com) |
`
    const html = renderToString(<MarkdownContent>{tableMarkdown}</MarkdownContent>)

    expect(html).toContain('<strong>API</strong>')
    expect(html).toContain('class="inline-code"')
    expect(html).toContain('href="https://example.com"')
  })
})
