import { ProviderBadge, providerHexColors } from './ui/Badge';
import { ToggleSwitch } from './ui/ToggleSwitch';
import { ModelName } from './ui/ModelName';
import type { Account } from '../lib/api';
import { parseCategorizedModels, parseDefaultModels } from '../lib/api';

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
  onToggleEnabled?: (id: number, enabled: boolean) => void;
}

export function AccountCard({ account, selected, onClick, onToggleEnabled }: AccountCardProps) {
  const categorized = parseCategorizedModels(account.models);
  const defaults = parseDefaultModels(account.default_models);
  const defaultChat = defaults.chat ?? '';
  const categorySummary = formatCategoryCounts(categorized);
  const hexColor = providerHexColors[account.type] ?? '#a78bfa';

  return (
    <div
      onClick={onClick}
      className={`rounded-xl cursor-pointer transition-all ${!account.enabled ? 'opacity-50' : ''}`}
      style={{
        backgroundColor: `${hexColor}08`,
        borderTop: `${selected ? 3 : 1}px solid ${selected ? hexColor : hexColor + '30'}`,
        borderRight: `${selected ? 3 : 1}px solid ${selected ? hexColor : hexColor + '30'}`,
        borderBottom: `${selected ? 3 : 1}px solid ${selected ? hexColor : hexColor + '30'}`,
        borderLeft: `3px solid ${hexColor}`,
        paddingTop: selected ? 18 : 20,
        paddingRight: selected ? 18 : 20,
        paddingBottom: selected ? 18 : 20,
        paddingLeft: 20,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div onClick={(e) => e.stopPropagation()}>
          <ToggleSwitch
            checked={account.enabled}
            onChange={(v) => onToggleEnabled?.(account.id, v)}
          />
        </div>
        <span className="text-base font-semibold text-text-primary truncate flex-1">{account.name}</span>
        <ProviderBadge provider={account.type} />
      </div>

      {/* Stats row */}
      <div className="flex gap-4 py-3 border-y border-border-muted mb-4">
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
