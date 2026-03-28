// Date/time format presets and formatter.
// The active format is stored in settings as 'datetime_format'.

export const DATE_FORMAT_PRESETS = [
  { key: 'iso',       label: 'ISO',        example: '2026-03-28 14:30:05',   pattern: 'YYYY-MM-DD HH:mm:ss' },
  { key: 'iso-short', label: 'ISO Short',  example: '2026-03-28 14:30',      pattern: 'YYYY-MM-DD HH:mm' },
  { key: 'us',        label: 'US',         example: '03/28/2026 2:30:05 PM', pattern: 'MM/DD/YYYY h:mm:ss A' },
  { key: 'us-short',  label: 'US Short',   example: '03/28/2026 2:30 PM',    pattern: 'MM/DD/YYYY h:mm A' },
  { key: 'eu',        label: 'EU',         example: '28/03/2026 14:30:05',   pattern: 'DD/MM/YYYY HH:mm:ss' },
  { key: 'eu-short',  label: 'EU Short',   example: '28/03/2026 14:30',      pattern: 'DD/MM/YYYY HH:mm' },
  { key: 'compact',   label: 'Compact',    example: '03-28 14:30:05',        pattern: 'MM-DD HH:mm:ss' },
  { key: 'relative',  label: 'Relative',   example: '5 min ago',             pattern: 'relative' },
] as const

export type DateFormatKey = typeof DATE_FORMAT_PRESETS[number]['key']

export const DEFAULT_FORMAT: DateFormatKey = 'compact'

export function formatDateTime(ts: string | Date, formatKey: string = DEFAULT_FORMAT): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts
  if (isNaN(d.getTime())) return String(ts)

  if (formatKey === 'relative') return formatRelative(d)

  const preset = DATE_FORMAT_PRESETS.find((p) => p.key === formatKey)
  if (!preset) return formatPattern(d, 'YYYY-MM-DD HH:mm:ss')
  return formatPattern(d, preset.pattern)
}

function formatPattern(d: Date, pattern: string): string {
  const Y = d.getFullYear()
  const M = d.getMonth() + 1
  const D = d.getDate()
  const H = d.getHours()
  const m = d.getMinutes()
  const s = d.getSeconds()
  const h12 = H % 12 || 12
  const ampm = H >= 12 ? 'PM' : 'AM'

  return pattern
    .replace('YYYY', String(Y))
    .replace('MM', String(M).padStart(2, '0'))
    .replace('DD', String(D).padStart(2, '0'))
    .replace('HH', String(H).padStart(2, '0'))
    .replace('hh', String(h12).padStart(2, '0'))
    .replace(/\bh\b/, String(h12))
    .replace('mm', String(m).padStart(2, '0'))
    .replace('ss', String(s).padStart(2, '0'))
    .replace('A', ampm)
}

function formatRelative(d: Date): string {
  const now = Date.now()
  const diff = now - d.getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return formatPattern(d, 'YYYY-MM-DD')
}
