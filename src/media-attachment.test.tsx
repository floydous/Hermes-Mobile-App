import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'

import { FileAttachmentCard, MarkdownContent, cacheImageDataUrl, parseFileReference, rememberFileSize, splitFileAttachments, stripAttachedContextScaffolding } from './components/MarkdownContent'

describe('Media and Attachment parsing in MarkdownContent', () => {
  it('renders MEDIA: file path as an interactive attachment card with filename and badge', () => {
    const raw = `Here is the plan for today:\nMEDIA:/tmp/pi-agent-kernel.lUmFtX/.hermes/plans/2026-09-06_145709-hierarchical-grouped-ast-search-formatter.md\nLet me know if you want to proceed.`
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).toContain('media-attachment-card media')
    expect(html).toContain('2026-09-06_145709-hierarchical-grouped-ast-search-formatter.md')
    expect(html).toContain('media-card-badge')
    expect(html).toContain('MD')
    expect(html).toContain('/tmp/pi-agent-kernel.lUmFtX/.hermes/plans/2026-09-06_145709-hierarchical-grouped-ast-search-formatter.md')
    expect(html).toContain('Here is the plan for today:')
    expect(html).toContain('Let me know if you want to proceed.')
  })

  it('renders user Attached: files as an attachment card', () => {
    const raw = `Attached: quarterly_report.pdf\nPlease review the attached report.`
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).toContain('media-attachment-card attachment')
    expect(html).toContain('quarterly_report.pdf')
    expect(html).toContain('PDF')
    expect(html).toContain('Please review the attached report.')
  })

  it('keeps MEDIA: inside code fences as literal code without converting to card', () => {
    const raw = '```bash\nMEDIA:/tmp/fake-media-inside-code.txt\n```'
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).not.toContain('media-attachment-card')
    expect(html).toContain('fake-media-inside-code.txt')
  })

  it('renders MEDIA: image files directly in the chat interface', () => {
    const raw = `Here is the rendered chart:\nMEDIA:/tmp/charts/network_traffic.png\nLet me know what you think.`
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).toContain('chat-image-wrap media')
    expect(html).toContain('chat-image-rendered')
    expect(html).not.toContain('chat-image-badge')
    expect(html).not.toContain('chat-image-zoom-overlay')
    expect(html).not.toContain('chat-image-caption')
  })

  it('renders user Attached: image files directly with resolved data URLs', () => {
    cacheImageDataUrl('my_screenshot.jpg', 'data:image/jpeg;base64,fakebytes')
    const raw = `Attached: my_screenshot.jpg\nCan you analyze this issue?`
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).toContain('chat-image-wrap attachment')
    expect(html).toContain('chat-image-rendered')
    expect(html).toContain('src="data:image/jpeg;base64,fakebytes"')
    expect(html).toContain('role="button"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="View full image: my_screenshot.jpg"')
    expect(html).not.toContain('chat-image-badge')
    expect(html).not.toContain('chat-image-zoom-overlay')
    expect(html).not.toContain('chat-image-caption')
  })

  it('renders standard Markdown images with ChatImage component without wrapper UI', () => {
    const raw = `Check this image: ![Dashboard Architecture](https://example.com/arch.webp)`
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).toContain('chat-image-wrap markdown')
    expect(html).toContain('chat-image-rendered')
    expect(html).toContain('src="https://example.com/arch.webp"')
    expect(html).toContain('role="button"')
    expect(html).toContain('tabindex="0"')
    expect(html).not.toContain('chat-image-zoom-overlay')
    expect(html).not.toContain('chat-image-caption')
  })

  it('renders inline Base64 data URIs in Markdown without stripping', () => {
    const raw = `![Hermes Test Image (Base64)](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=)`
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).toContain('chat-image-wrap markdown')
    expect(html).toContain('chat-image-rendered')
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="')
    expect(html).toContain('Hermes Test Image (Base64)')
  })

  it('converts raw HTML <img> tags to rendered ChatImage components', () => {
    const raw = `Here is our branding: <img src="https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/static/img/nous-logo.png" alt="Nous Logo" width="120" />`
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).toContain('chat-image-wrap markdown')
    expect(html).toContain('chat-image-rendered')
    expect(html).toContain('src="https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/static/img/nous-logo.png"')
    expect(html).toContain('Nous Logo')
  })

  it('keeps raw HTML <img> inside code fences literal without converting', () => {
    const raw = '```html\n<img src="https://example.com/demo.png" alt="Demo" />\n```'
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).not.toContain('chat-image-wrap')
    expect(html).toContain('demo.png')
  })

  it('renders the exact agent test payload with all image patterns', () => {
    const userPayload = `
### 1. Hermes Native \`MEDIA:\` Directive
MEDIA:/home/floydyra/.hermes/cache/scratch/sample_image.png

### 2. Standard Markdown Image (Local File Path)
![Hermes Test Image (Local)](/home/floydyra/.hermes/cache/scratch/sample_image.png)

### 3. Inline Base64 Data URI in Markdown
![Hermes Test Image (Base64)](data:image/png;base64,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)

### 4. Standard Markdown Image (Remote Web URL)
![Nous Research Logo](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/static/img/nous-logo.png)

### 5. Raw HTML <img> Tag
<img src="https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/static/img/nous-logo.png" alt="Nous Logo" width="120" />
`

    const html = renderToString(<MarkdownContent>{userPayload}</MarkdownContent>)
    // Check Method 1: chat-image-wrap media with sample_image.png
    expect(html).toContain('chat-image-wrap media')
    expect(html).toContain('sample_image.png')

    // Check Method 2: chat-image-wrap markdown with sample_image.png
    expect(html).toContain('chat-image-wrap markdown')
    expect(html).toContain('Hermes Test Image (Local)')

    // Check Method 3: chat-image-wrap markdown with base64 data url
    expect(html).toContain('Hermes Test Image (Base64)')
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAIAAABJdyC1')

    // Check Method 4: Nous Logo
    expect(html).toContain('Nous Research Logo')

    // Check Method 5: Nous Logo from HTML
    expect(html).toContain('Nous Logo')
  })

  it('handles multiline Base64 data URIs in Markdown links without breaking parser', () => {
    const multilinePayload = `Here is the generated icon:\n\n![Generated Icon](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE\nAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk\n+A8AAQUBAScY42YAAAAASUVORK5CYII=)`
    const html = renderToString(<MarkdownContent>{multilinePayload}</MarkdownContent>)

    expect(html).toContain('chat-image-wrap markdown')
    expect(html).toContain('Generated Icon')
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="')
  })

  it('renders rehydrated unquoted @file: image attachment directly as ChatImage', () => {
    cacheImageDataUrl(
      '/home/floydyra/.hermes/attachments/RDT_20261009_1313205661320862993825685.jpg',
      'data:image/jpeg;base64,mockjpegbytes'
    )
    const rehydratedMessage = `@file:/home/floydyra/.hermes/attachments/RDT_20261009_1313205661320862993825685.jpg\n\nWhat do you see in this photo?`
    const html = renderToString(<MarkdownContent>{rehydratedMessage}</MarkdownContent>)

    // Must render the native ChatImage component without cluttered file extension badges
    expect(html).toContain('chat-image-wrap attachment')
    expect(html).toContain('chat-image-rendered')
    expect(html).toContain('src="data:image/jpeg;base64,mockjpegbytes"')
    expect(html).toContain('RDT_20261009_1313205661320862993825685.jpg')
    expect(html).not.toContain('chat-image-badge')

    // Must render the companion prompt text
    expect(html).toContain('What do you see in this photo?')

    // Must NOT leak the literal raw directive text
    expect(html).not.toContain('@file:')
  })

  it('renders unquoted @file: paths with spaces as attachment card', () => {
    const raw = `@file:/home/floydyra/.hermes/attachments/My Homework Assignment 2026.pdf`
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).toContain('media-attachment-card attachment')
    expect(html).toContain('My Homework Assignment 2026.pdf')
    expect(html).toContain('PDF')
    expect(html).not.toContain('@file:')
  })

  it('keeps @file: inside code blocks as literal code without parsing as attachment', () => {
    const raw = '```bash\n@file:/home/floydyra/sample.png\n```'
    const html = renderToString(<MarkdownContent>{raw}</MarkdownContent>)

    expect(html).not.toContain('chat-image-wrap')
    expect(html).not.toContain('media-attachment-card')
    expect(html).toContain('@file:/home/floydyra/sample.png')
  })

  it('preserves normal bot mentions while excluding @file: directives', () => {
    const textWithMention = 'Hello @homework-manager please help me with @researcher notes'
    const html = renderToString(<MarkdownContent>{textWithMention}</MarkdownContent>)

    expect(html).toContain('<span class="mention-link">@homework-manager</span>')
    expect(html).toContain('<span class="mention-link">@researcher</span>')
    expect(html).not.toContain('class="mention-link">@file')
  })

  describe('parseFileReference contract coverage', () => {
    it('accurately parses unquoted, backticked, quoted, and emoji-prefixed paths', () => {
      // Unquoted standard path
      expect(parseFileReference('@file:/home/floydyra/image.jpg')).toBe('/home/floydyra/image.jpg')

      // Unquoted path with spaces
      expect(parseFileReference('@file:/home/user/my vacation photos/beach.jpg')).toBe(
        '/home/user/my vacation photos/beach.jpg'
      )

      // Backticked path
      expect(parseFileReference('@file:`/home/user/my documents/spec.pdf`')).toBe(
        '/home/user/my documents/spec.pdf'
      )

      // Double-quoted path
      expect(parseFileReference('@file:"/home/user/my photos/trip.jpg"')).toBe(
        '/home/user/my photos/trip.jpg'
      )

      // Single-quoted path
      expect(parseFileReference("@file:'/home/user/notes/todo.md'")).toBe(
        '/home/user/notes/todo.md'
      )

      // Emoji paperclip prefix (with space)
      expect(parseFileReference('📎 @file:/home/user/paperclip.png')).toBe('/home/user/paperclip.png')

      // Emoji paperclip prefix with quoted path
      expect(parseFileReference('📎 @file:"/home/user/quoted paperclip.png"')).toBe(
        '/home/user/quoted paperclip.png'
      )

      // Empty or invalid directives return null
      expect(parseFileReference('@file:')).toBe(null)
      expect(parseFileReference('@file:   ')).toBe(null)
      expect(parseFileReference('@file:``')).toBe(null)
      expect(parseFileReference('@file:""')).toBe(null)
      expect(parseFileReference('@file:\'\'')).toBe(null)
      expect(parseFileReference('Just regular text')).toBe(null)
    })
  })

  it('strips backend Attached Context scaffolding and renders @file: as clean attachment card', () => {
    const rawBackendUserMessage = `@file:\`/home/floydyra/.hermes/profiles/homework-manager/attachments/Jadwal TKA Gladi dan Peserta 2026 - Final.pdf\`\n\n--- Attached Context ---\n\n📎 @file:\`/home/floydyra/.hermes/profiles/homework-manager/attachments/Jadwal TKA Gladi dan Peserta 2026 - Final.pdf\` (application/pdf, 398.3 KB) — binary file, not inlined as text. It is available on disk at \`/home/floydyra/.hermes/profiles/homework-manager/attachments/Jadwal TKA Gladi dan Peserta 2026 - Final.pdf\`. Use your tools to work with it (read or convert it, extract its text, or view/render it as needed); do not tell the user the file type is unsupported.`

    const html = renderToString(<MarkdownContent>{rawBackendUserMessage}</MarkdownContent>)

    // Must render the native attachment card for the PDF
    expect(html).toContain('media-attachment-card attachment')
    expect(html).toContain('Jadwal TKA Gladi dan Peserta 2026 - Final.pdf')
    expect(html).toContain('PDF')

    // Must NEVER leak the internal LLM scaffolding instructions
    expect(html).not.toContain('--- Attached Context ---')
    expect(html).not.toContain('binary file, not inlined as text')
    expect(html).not.toContain('do not tell the user the file type is unsupported')
  })
})

describe('splitFileAttachments', () => {
  it('moves files out of the bubble text and reads their size from the attached context', () => {
    const raw = 'Look at this\n@file:`/home/u/report.pdf`\n\n--- Attached Context ---\n\n📎 @file:`/home/u/report.pdf` (application/pdf, 49.2 KB) — binary file, not inlined as text.'
    const { text, files } = splitFileAttachments(stripAttachedContextScaffolding(raw), raw)
    expect(text).toBe('Look at this')
    expect(files).toEqual([{ path: '/home/u/report.pdf', size: '49 KB' }])
  })

  it('measures text files the backend inlined, and files sent from this device', () => {
    const body = 'x'.repeat(3000)
    const raw = `@file:/home/u/notes.json\n\nSee\n\n--- Attached Context ---\n\n📄 @file:/home/u/notes.json (117 tokens)\n\`\`\`json\n${body}\n\`\`\``
    expect(splitFileAttachments(stripAttachedContextScaffolding(raw), raw).files[0].size).toBe('3 KB')
    rememberFileSize('sent.zip', 5 * 1024 * 1024)
    expect(splitFileAttachments('Here\nAttached: sent.zip').files[0].size).toBe('5.0 MB')
  })

  it('keeps images in the bubble and leaves plain text untouched', () => {
    expect(splitFileAttachments('MEDIA:/tmp/chart.png\nNice').files).toEqual([])
    expect(splitFileAttachments('Just words').text).toBe('Just words')
  })

  it('shows the type and size under a middle-truncated name', () => {
    const html = renderToString(<FileAttachmentCard rawPath="/a/tka-2026-kisi-kisi-semua-mapel.pdf" kind="attachment" detail="49 KB"/>)
    expect(html).toContain('file-thumb pdf')
    // The name loses its extension and keeps its last 8 characters whole: tka-2026-kisi-kisi-se…ua-mapel
    expect(html).toContain('<span>tka-2026-kisi-kisi-sem</span><span>ua-mapel</span>')
    expect(html).toContain('PDF · 49 KB')
  })
})
