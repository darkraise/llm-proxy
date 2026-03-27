import { ProviderBadge } from './ui/Badge';
import { StatusDot } from './ui/StatusDot';
import { ModelName } from './ui/ModelName';
import type { Account } from '../lib/api';
import { parseCategorizedModels, parseDefaultModels } from '../lib/api';

function getAccountStatus(account: Account): 'healthy' | 'rate-limited' | 'error' | 'disabled' {
  if (!account.enabled) return 'disabled';
  if (account.status?.reason?.includes('exhausted')) return 'rate-limited';
  if (account.status && !account.status.available) return 'error';
  return 'healthy';
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCategoryCounts(categorized: Record<string, string[]>): string {
  return Object.entries(categorized)
    .filter(([, models]) => models.length > 0)
    .map(([cat, models]) => `${models.length} ${cat}`)
    .join(' \u00b7 ');
}

interface AccountCardProps {
  account: Account;
  selected?: boolean;
  onClick: () => void;
}

export function AccountCard({ account, selected, onClick }: AccountCardProps) {
  const status = getAccountStatus(account);
  const categorized = parseCategorizedModels(account.models);
  const defaults = parseDefaultModels(account.default_models);
  const defaultChat = defaults.chat ?? '';
  const categorySummary = formatCategoryCounts(categorized);

  return (
    <div
      onClick={onClick}
      className={`bg-surface-raised border rounded-xl p-4 cursor-pointer transition-colors hover:border-[rgba(124,91,240,0.3)] ${selected ? 'border-accent-light ring-1 ring-accent-light' : 'border-border'} ${!account.enabled ? 'opacity-50' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <StatusDot status={status} />
        <span className="text-base font-semibold text-text-primary truncate flex-1">{account.name}</span>
        <ProviderBadge provider={account.type} />
      </div>

      {/* Stats row */}
      <div className="flex gap-3 py-2 border-y border-border-muted mb-3">
        <div className="flex-1 text-center">
          <div className="text-xs uppercase tracking-wider text-text-muted">Requests</div>
          <div className="text-sm font-semibold text-text-primary">{formatCompact(account.total_requests)}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-xs uppercase tracking-wider text-text-muted">Tokens</div>
          <div className="text-sm font-semibold text-text-primary">{formatCompact(account.total_tokens)}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-xs uppercase tracking-wider text-text-muted">Priority</div>
          <div className="text-sm font-semibold text-text-primary">{account.priority}</div>
        </div>
      </div>

      {/* Model row */}
      <div className="flex items-center gap-1.5">
        {defaultChat ? (
          <span className="bg-[rgba(255,255,255,0.05)] text-text-primary text-xs px-2 py-0.5 rounded truncate">
            <ModelName name={defaultChat} />
          </span>
        ) : (
          <span className="text-text-muted text-xs">No default model</span>
        )}
        {categorySummary && (
          <span className="bg-accent-muted text-accent-light text-xs px-2 py-0.5 rounded flex-shrink-0">
            {categorySummary}
          </span>
        )}
      </div>
    </div>
  );
}
