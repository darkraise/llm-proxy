import { useState, useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  LayoutGrid,
  List,
  Plus,
  ChevronDown,
  Search,
} from "lucide-react"
import type { Account } from "@/lib/api"
import { parseCategorizedModels, flattenModels } from "@/lib/api"
import { getDisplayName } from "@/lib/providers"
import { PageHeader } from "darkraise-ui/layout"
import { Button } from "darkraise-ui/components/button"
import { Input } from "darkraise-ui/components/input"
import { Card, CardContent } from "darkraise-ui/components/card"
import { Badge } from "darkraise-ui/components/badge"
import { Switch } from "darkraise-ui/components/switch"
import { Skeleton } from "darkraise-ui/components/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "darkraise-ui/components/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "darkraise-ui/components/dropdown-menu"
import {
  useAccounts,
  useUpdateAccount,
  useBulkUpdateAccounts,
  useBulkDeleteAccounts,
} from "@/hooks/use-accounts"
import { useProviders } from "@/hooks/use-providers"
import { useLocalStorage } from "@/hooks/use-local-storage"
import { AccountCard } from "@/components/account-card"
import { AccountDrawer } from "@/components/account-drawer"
import { BulkEditModal } from "@/components/bulk-edit-modal"
import { ConfirmDialog } from "@/components/confirm-dialog"

type ViewMode = "grid" | "list"
type StatusFilter = "all" | "active" | "inactive" | "error"

function accountStatus(a: Account): "active" | "inactive" | "error" {
  if (!a.enabled) return "inactive"
  if (a.status && !a.status.available) return "error"
  return "active"
}

function AccountsPage() {
  const [view, setView] = useLocalStorage<ViewMode>("accounts-view", "grid")
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editAccount, setEditAccount] = useState<Account | null>(null)
  const [providerFilter, setProviderFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const { data: accounts, isLoading } = useAccounts()
  const { data: providers } = useProviders()
  const updateAccount = useUpdateAccount()
  const bulkUpdate = useBulkUpdateAccounts()
  const bulkDelete = useBulkDeleteAccounts()

  const filtered = useMemo(() => {
    if (!accounts) return []
    return accounts.filter((a) => {
      if (providerFilter !== "all" && a.type !== providerFilter) return false
      if (statusFilter !== "all" && accountStatus(a) !== statusFilter) return false
      if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [accounts, providerFilter, statusFilter, search])

  function handleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleToggleEnabled(id: number, enabled: boolean) {
    const account = accounts?.find((a) => a.id === id)
    if (!account) return
    updateAccount.mutate(
      {
        id,
        data: {
          name: account.name,
          type: account.type,
          base_url: account.base_url,
          api_key: "",
          models: parseCategorizedModels(account.models),
          priority: account.priority,
          enabled,
          default_models: JSON.parse(account.default_models || "{}"),
          limits: account.limits ?? [],
        },
      },
      {
        onError: (err) => toast.error(`Toggle failed: ${err.message}`),
      },
    )
  }

  function openCreate() {
    setEditAccount(null)
    setDrawerOpen(true)
  }

  function openEdit(account: Account) {
    setEditAccount(account)
    setDrawerOpen(true)
  }

  function handleBulkEnable() {
    bulkUpdate.mutate(
      { ids: [...selectedIds], enabled: true },
      {
        onSuccess: () => {
          toast.success(`Enabled ${selectedIds.size} accounts`)
          setSelectedIds(new Set())
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function handleBulkDisable() {
    bulkUpdate.mutate(
      { ids: [...selectedIds], enabled: false },
      {
        onSuccess: () => {
          toast.success(`Disabled ${selectedIds.size} accounts`)
          setSelectedIds(new Set())
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  function handleBulkDelete() {
    bulkDelete.mutate([...selectedIds], {
      onSuccess: (res) => {
        toast.success(`Deleted ${res.deleted} accounts`)
        setSelectedIds(new Set())
        setDeleteConfirmOpen(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const selectedArray = [...selectedIds]

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Accounts"
        description={`${accounts?.length ?? 0} provider accounts configured`}
        actions={
          <>
            {selectedIds.size > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    Bulk ({selectedIds.size})
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleBulkEnable}>
                    Enable All
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleBulkDisable}>
                    Disable All
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setBulkEditOpen(true)}>
                    Edit...
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div className="flex rounded-md border">
              <Button
                variant={view === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-9 w-9 rounded-none rounded-l-md"
                onClick={() => setView("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={view === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-9 w-9 rounded-none rounded-r-md"
                onClick={() => setView("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" />
              Add Account
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search accounts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[220px] pl-8"
          />
        </div>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            {(providers ?? [])
              .filter((p) => p.enabled)
              .map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.display_name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {accounts?.length === 0
              ? "No accounts configured yet. Click 'Add Account' to get started."
              : "No accounts match the current filters."}
          </CardContent>
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              selected={selectedIds.has(account.id)}
              onSelect={handleSelect}
              onToggleEnabled={handleToggleEnabled}
              onClick={() => openEdit(account)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((account) => (
            <AccountListRow
              key={account.id}
              account={account}
              selected={selectedIds.has(account.id)}
              onSelect={handleSelect}
              onToggleEnabled={handleToggleEnabled}
              onClick={() => openEdit(account)}
            />
          ))}
        </div>
      )}

      <AccountDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        account={editAccount}
        onSaved={() => setSelectedIds(new Set())}
      />

      <BulkEditModal
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedIds={selectedArray}
        onSaved={() => setSelectedIds(new Set())}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Accounts"
        description={`Are you sure you want to delete ${selectedIds.size} accounts? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleBulkDelete}
        loading={bulkDelete.isPending}
      />
    </div>
  )
}

function AccountListRow({
  account,
  selected,
  onSelect,
  onToggleEnabled,
  onClick,
}: {
  account: Account
  selected: boolean
  onSelect: (id: number) => void
  onToggleEnabled: (id: number, enabled: boolean) => void
  onClick: () => void
}) {
  const models = parseCategorizedModels(account.models)
  const modelCount = flattenModels(models).length

  function statusColor() {
    if (!account.enabled) return "bg-muted-foreground/40"
    if (!account.status) return "bg-yellow-500"
    if (account.status.available) return "bg-green-500"
    return "bg-red-500"
  }

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={onClick}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(account.id)}
            className="h-4 w-4 cursor-pointer accent-primary"
          />
        </div>
        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor()}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{account.name}</p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {getDisplayName(account.type)}
        </Badge>
        <span className="shrink-0 text-xs text-muted-foreground">
          {modelCount} models
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {account.total_requests.toLocaleString()} req
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={account.enabled}
            onCheckedChange={(checked) =>
              onToggleEnabled(account.id, checked)
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

export const Route = createFileRoute("/_authenticated/accounts")({
  component: AccountsPage,
})
