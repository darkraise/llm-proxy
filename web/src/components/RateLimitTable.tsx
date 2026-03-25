import { useState } from 'react'
import { AccountLimit } from '../lib/api'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(1))}M`
  if (n >= 1_000 && n % 1_000 === 0) return `${n / 1_000}K`
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(1))}K`
  return String(n)
}

// ─── Metric definitions ───────────────────────────────────────────────────────

export const METRIC_DEFS: { key: string; label: string; short: string; window: number }[] = [
  { key: 'rpm',  label: 'Requests per minute', short: 'RPM',    window: 60 },
  { key: 'rpd',  label: 'Requests per day',    short: 'RPD',    window: 86400 },
  { key: 'rpmo', label: 'Requests per month',  short: 'RPM/mo', window: 2592000 },
  { key: 'rps',  label: 'Requests per second', short: 'RPS',    window: 1 },
  { key: 'tpm',  label: 'Tokens per minute',   short: 'TPM',    window: 60 },
  { key: 'tpd',  label: 'Tokens per day',      short: 'TPD',    window: 86400 },
  { key: 'tpmo', label: 'Tokens per month',    short: 'TPM/mo', window: 2592000 },
]

export const METRIC_WINDOW: Record<string, number> = Object.fromEntries(
  METRIC_DEFS.map((m) => [m.key, m.window]),
)

// ─── Matrix helpers ───────────────────────────────────────────────────────────

// matrix[model][metric] = max_value (null = not set / inherit)
type Matrix = Record<string, Record<string, number | null>>

function limitsToMatrix(limits: AccountLimit[]): Matrix {
  const matrix: Matrix = {}
  for (const l of limits) {
    if (!matrix[l.model]) matrix[l.model] = {}
    matrix[l.model][l.metric] = l.max_value
  }
  return matrix
}

function matrixToLimits(matrix: Matrix): AccountLimit[] {
  const limits: AccountLimit[] = []
  for (const [model, metrics] of Object.entries(matrix)) {
    for (const [metric, value] of Object.entries(metrics)) {
      if (value !== null && value !== undefined) {
        limits.push({
          model,
          metric,
          max_value: value,
          window_secs: METRIC_WINDOW[metric] ?? 60,
        })
      }
    }
  }
  return limits
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface RateLimitTableProps {
  /** Model names for rows (one row per model, plus the default row). */
  models: string[]
  /** Flat array of current limits. */
  limits: AccountLimit[]
  /** Called whenever any cell changes with the updated flat array. */
  onChange: (limits: AccountLimit[]) => void
  /** Label for the first "default" row. */
  defaultRowLabel?: string
  /** When true, cells are not editable. */
  readOnly?: boolean
}

// ─── Editable cell: shows compact format, raw number on focus ────────────────

function EditableCell({
  value,
  displayValue,
  placeholder,
  isOverride,
  onChange,
}: {
  value: number | null
  displayValue: string | null
  placeholder: string
  isOverride: boolean
  onChange: (raw: string) => void
}) {
  const [focused, setFocused] = useState(false)

  return focused ? (
    <input
      type="number"
      min={1}
      autoFocus
      className={[
        'rlt-input',
        'w-full bg-transparent border border-accent rounded px-2 py-1',
        'text-center text-sm focus:outline-none bg-surface',
        'transition-colors placeholder-text-muted',
        isOverride ? 'text-warning' : 'text-text-primary',
      ].join(' ')}
      value={value !== null ? String(value) : ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setFocused(false)}
    />
  ) : (
    <div
      onClick={() => setFocused(true)}
      className={[
        'w-full border border-border/40 rounded px-2 py-1 cursor-text',
        'text-center text-sm transition-colors hover:border-border',
        value !== null
          ? isOverride ? 'text-warning' : 'text-text-primary'
          : 'text-text-muted',
      ].join(' ')}
    >
      {displayValue ?? placeholder}
    </div>
  )
}

export function RateLimitTable({
  models,
  limits,
  onChange,
  defaultRowLabel = 'Default (all)',
  readOnly = false,
}: RateLimitTableProps) {
  const matrix = limitsToMatrix(limits)
  // Ensure the default row entry exists in matrix
  if (!matrix['']) matrix[''] = {}

  function getCellValue(model: string, metric: string): number | null {
    return matrix[model]?.[metric] ?? null
  }

  function getDefaultValue(metric: string): number | null {
    return matrix['']?.[metric] ?? null
  }

  function handleCellChange(model: string, metric: string, raw: string) {
    const next: Matrix = {}
    // Deep-clone existing matrix
    for (const [m, metrics] of Object.entries(matrix)) {
      next[m] = { ...metrics }
    }
    if (!next[model]) next[model] = {}

    const parsed = raw === '' ? null : parseInt(raw, 10)
    next[model][metric] = Number.isFinite(parsed as number) ? (parsed as number) : null

    // Remove model entry entirely if all its cells are null (keeps matrix clean)
    if (model !== '') {
      const hasAny = Object.values(next[model]).some((v) => v !== null)
      if (!hasAny) delete next[model]
    }

    onChange(matrixToLimits(next))
  }

  const rows = ['', ...models]

  return (
    <div className="rounded-lg border border-border flex flex-col">
      {/* Remove number input spin buttons */}
      <style>{`
        .rlt-input::-webkit-inner-spin-button,
        .rlt-input::-webkit-outer-spin-button { display: none; }
        .rlt-input { -moz-appearance: textfield; }
        .rlt-table thead th { position: sticky; top: 0; z-index: 1; }
      `}</style>

      <div className="overflow-auto" style={{ maxHeight: '400px' }}>
        <table className="rlt-table w-full border-collapse">
          {/* Sticky header */}
          <thead>
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-text-secondary uppercase tracking-wide border-b border-border bg-surface-overlay w-40">
                Model
              </th>
              {METRIC_DEFS.map((m) => (
                <th
                  key={m.key}
                  title={m.label}
                  className="px-2 py-2 text-xs font-medium text-text-secondary uppercase tracking-wide border-b border-border bg-surface-overlay text-center whitespace-nowrap"
                >
                  {m.short}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((model) => {
              const isDefault = model === ''
              return (
                <tr
                  key={model === '' ? '__default__' : model}
                  className={isDefault ? 'bg-surface/50' : 'bg-surface-raised hover:bg-surface-overlay/40'}
                >
                  {/* Model name cell */}
                  <td className="px-3 py-2 border-b border-border text-sm font-mono text-text-primary whitespace-nowrap overflow-hidden max-w-[12rem]">
                    {isDefault ? (
                      <span className="text-text-secondary italic">{defaultRowLabel}</span>
                    ) : (
                      <span title={model} className="block truncate">{model}</span>
                    )}
                  </td>

                  {/* Metric cells */}
                  {METRIC_DEFS.map((m) => {
                    const value = getCellValue(model, m.key)
                    const defaultVal = isDefault ? null : getDefaultValue(m.key)
                    const isOverride = !isDefault && value !== null

                    const displayVal = value !== null ? formatCompact(value) : null
                    const displayDefault = defaultVal !== null ? formatCompact(defaultVal) : null
                    const placeholderText = displayDefault ?? '—'

                    return (
                      <td key={m.key} className="px-1 py-1.5 border-b border-border">
                        {readOnly ? (
                          <div className={`text-center text-sm px-2 py-1 ${
                            value !== null ? (isOverride ? 'text-warning' : 'text-text-primary') : 'text-text-muted'
                          }`}>
                            {displayVal ?? displayDefault ?? '—'}
                          </div>
                        ) : (
                          <EditableCell
                            value={value}
                            displayValue={displayVal}
                            placeholder={placeholderText}
                            isOverride={isOverride}
                            onChange={(raw) => handleCellChange(model, m.key, raw)}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend (hidden in read-only mode) */}
      {!readOnly && <div className="flex items-center gap-4 px-3 py-2 border-t border-border bg-surface-overlay text-xs text-text-muted flex-shrink-0">
        <span>
          <span className="text-warning font-medium">Amber</span>
          {' '}= override
        </span>
        <span>Gray placeholder = inherited from default</span>
        <span>
          <span className="font-medium">—</span>
          {' '}= no limit set
        </span>
      </div>}
    </div>
  )
}
