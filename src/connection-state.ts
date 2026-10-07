export function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === 'string' && reason.trim()) return reason
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = String((reason as { message?: unknown }).message || '').trim()
    if (message) return message
  }
  return fallback
}

export function selectRestoredEndpoint(nativeEndpoint?: string | null, legacyEndpoint?: string | null, localEndpoint = 'http://127.0.0.1:9119'): string {
  return (nativeEndpoint || legacyEndpoint || localEndpoint).replace(/\/$/, '')
}

export function supportsBasicAuth(providers: unknown[] | undefined): boolean {
  return providers?.some(provider => provider === 'basic' || (
    typeof provider === 'object' && provider !== null && 'name' in provider && (provider as { name?: unknown }).name === 'basic'
  )) === true
}

export class RequestEpoch {
  private value = 0

  begin(): number {
    this.value += 1
    return this.value
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.value
  }
}
