import type { Account } from "@/lib/api"
import { parseCategorizedModels, flattenModels } from "@/lib/api"
import { getDisplayName } from "@/lib/providers"
import { Card, CardContent } from "darkraise-ui/components/card"
import { Badge } from "darkraise-ui/components/badge"
import { Switch } from "darkraise-ui/components/switch"
import { Checkbox } from "darkraise-ui/components/checkbox"

interface AccountCardProps {
  account: Account
  selected: boolean
  onSelect: (id: number) => void
  onToggleEnabled: (id: number, enabled: boolean) => void
  onClick: () => void
}

function StatusDot({ account }: { account: Account }) {
  if (!account.enabled) {
    return <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
  }
  if (!account.status) {
    return <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
  }
  if (account.status.available) {
    return <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
  }
  return <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
}

export function AccountCard({
  account,
  selected,
  onSelect,
  onToggleEnabled,
  onClick,
}: AccountCardProps) {
  const models = parseCategorizedModels(account.models)
  const modelCount = flattenModels(models).length

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={onClick}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <Badge variant="secondary">{getDisplayName(account.type)}</Badge>
          <div className="flex items-center gap-2">
            <StatusDot account={account} />
            <div onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selected}
                onCheckedChange={() => onSelect(account.id)}
              />
            </div>
          </div>
        </div>

        <div>
          <p className="font-semibold leading-tight">{account.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {modelCount} {modelCount === 1 ? "model" : "models"}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {account.total_requests.toLocaleString()} requests
          </p>
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={account.enabled}
              onCheckedChange={(checked) =>
                onToggleEnabled(account.id, checked)
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
