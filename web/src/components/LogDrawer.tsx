import { RequestLog } from '../lib/api'
import { Drawer } from './ui/Drawer'
import { Badge } from './ui/Badge'

interface LogDrawerProps {
  log: RequestLog | null
  onClose: () => void
}

function statusVariant(code: number) {
  if (code >= 200 && code < 300) return 'success' as const
  if (code >= 400) return 'error' as const
  return 'warning' as const
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="text-[10px] uppercase tracking-wide text-text-secondary mb-3 font-medium">
      {children}
    </h3>
  )
}

function KVRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between mb-2">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <span className="text-[13px] text-text-primary">{children}</span>
    </div>
  )
}

export function LogDrawer({ log, onClose }: LogDrawerProps) {
  return (
    <Drawer open={log !== null} onClose={onClose} title="Request Detail" width={320}>
      {log && (
        <div>
          {/* Request section */}
          <div className="px-5 py-4 border-b border-border">
            <SectionHeading>REQUEST</SectionHeading>
            <KVRow label="Account">
              <span className="text-text-primary">{log.account_name || '\u2014'}</span>
            </KVRow>
            <KVRow label="Model">
              <span className="font-mono">{log.model || '\u2014'}</span>
            </KVRow>
            <KVRow label="Endpoint">
              <span>{log.endpoint || '\u2014'}</span>
            </KVRow>
            <KVRow label="Status">
              <Badge variant={statusVariant(log.status_code)}>
                {log.status_code}
              </Badge>
            </KVRow>
          </div>

          {/* Tokens section */}
          <div className="px-5 py-4 border-b border-border">
            <SectionHeading>TOKENS</SectionHeading>
            <KVRow label="Prompt">
              <span>{log.prompt_tokens}</span>
            </KVRow>
            <KVRow label="Completion">
              <span>{log.completion_tokens}</span>
            </KVRow>
            <KVRow label="Total">
              <span className="font-semibold">{log.prompt_tokens + log.completion_tokens}</span>
            </KVRow>
          </div>

          {/* Performance section */}
          <div className="px-5 py-4 border-b border-border">
            <SectionHeading>PERFORMANCE</SectionHeading>
            <KVRow label="Latency">
              <span>{log.latency_ms}ms</span>
            </KVRow>
            <KVRow label="Provider">
              <span>{log.account_name || '\u2014'}</span>
            </KVRow>
          </div>

          {/* Error section (conditional) */}
          {log.error_message && (
            <div className="px-5 py-4">
              <SectionHeading>ERROR</SectionHeading>
              <div className="bg-[rgba(248,81,73,0.08)] text-error rounded-lg p-3 text-[12px] font-mono break-all">
                {log.error_message}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}
