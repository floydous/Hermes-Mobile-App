export type AttachmentReference = {
  name: string
  refText: string
}

export function buildAttachmentPrompt(text: string, attachments: AttachmentReference[]): string {
  return [...attachments.map(item => item.refText.trim()).filter(Boolean), text.trim()].filter(Boolean).join('\n\n')
}

export function attachmentSummary(text: string, attachments: AttachmentReference[]): string {
  const cleanText = text.trim()
  const attachmentLines = attachments.map(item => `Attached: ${item.name}`).join('\n')
  if (cleanText && attachmentLines) return `${cleanText}\n\n${attachmentLines}`
  if (cleanText) return cleanText
  return attachmentLines
}
