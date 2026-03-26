type Status = 'healthy' | 'rate-limited' | 'error' | 'disabled' | 'unknown';

const statusColors: Record<Status, string> = {
  healthy: 'bg-success',
  'rate-limited': 'bg-warning',
  error: 'bg-error',
  disabled: 'bg-text-muted',
  unknown: 'bg-text-muted',
};

export function StatusDot({ status, size = 8 }: { status: Status; size?: number }) {
  return <div className={`rounded-full ${statusColors[status]}`} style={{ width: size, height: size }} />;
}
