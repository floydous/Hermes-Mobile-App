import type { LiveMessage } from './hermes'

export type ResponseStats = NonNullable<LiveMessage['usage']>

const compact = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K` : String(Math.round(value))

/** Displays only server-provided terminal usage; old transcript rows remain unadorned. */
export function formatResponseStats(message: LiveMessage): string | null {
  const usage = message.usage
  if (!usage?.model) return null
  const parts = [usage.model]
  if (typeof usage.total === 'number' && usage.total > 0) parts.push(`Σ ${compact(usage.total)} tok`)
  if (typeof usage.avg_tps === 'number' && usage.avg_tps > 0) parts.push(`${usage.avg_tps.toFixed(1)} tok/s`)
  return parts.join(' · ')
}

export function formatMessageTime(timestamp?: number): string | null {
  if (!timestamp) return null
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(timestamp * 1000))
    .replace('.', ':')
}
