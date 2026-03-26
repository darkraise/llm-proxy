import { ProviderBadge } from './ui/Badge';
import { StatusDot } from './ui/StatusDot';
import { ModelName } from './ui/ModelName';
import type { Account } from '../lib/api';

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

function countModels(modelsJson: string): number {
  try { return (JSON.parse(modelsJson) as string[]).length; } catch { return 0; }
}

export const LIST_GRID_COLS = '28px 1.5fr 0.8fr 0.8fr 0.8fr 0.6fr 1.2fr 0.5fr';

interface AccountListRowProps {
  account: Account;
  selected?: boolean;
  onClick: () => void;
}

export function AccountListRow({ account, selected, onClick }: AccountListRowProps) {
  const status = getAccountStatus(account);
  const totalModels = countModels(account.models);

  return (
    <div
      onClick={onClick}
      className={`grid items-center px-3 py-2.5 border-b border-border-muted cursor-pointer hover:bg-[rgba(255,255,255,0.02)] transition-colors ${selected ? 'bg-accent-muted' : ''} ${!account.enabled ? 'opacity-50' : ''}`}
      style={{ gridTemplateColumns: LIST_GRID_COLS }}
    >
      <div className="flex justify-center">
        <StatusDot status={status} />
      </div>
      <div className="text-sm font-medium text-text-primary truncate pr-2">{account.name}</div>
      <div><ProviderBadge provider={account.type} /></div>
      <div className="text-sm text-text-primary text-right tabular-nums">{formatCompact(account.total_requests)}</div>
      <div className="text-sm text-text-primary text-right tabular-nums">{formatCompact(account.total_tokens)}</div>
      <div className="text-sm text-text-primary text-center">{account.priority}</div>
      <div className="text-xs text-text-secondary truncate">
        {account.default_model
          ? <ModelName name={account.default_model} className="truncate" />
          : '\u2014'}
      </div>
      <div className="text-xs text-accent-light text-center">{totalModels > 0 ? totalModels : '\u2014'}</div>
    </div>
  );
}
