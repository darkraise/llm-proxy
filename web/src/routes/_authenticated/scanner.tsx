import { useState, useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  Play,
  Square,
  Trash2,
  CheckCircle2,
  Download,
  Plus,
  Pencil,
} from "lucide-react"
import type {
  DiscoveredKey,
  ScanKeyPattern,
} from "@/lib/api"
import { formatDateTime } from "@/lib/dateformat"
import { PageHeader } from "@/core/layout/page-header"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/core/components/ui/card"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/components/ui/select"
import { Switch } from "@/core/components/ui/switch"
import { Checkbox } from "@/core/components/ui/checkbox"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/core/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/components/ui/table"
import { Skeleton } from "@/core/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  useScannerStatus,
  useScannerKeys,
  useScannerHistory,
  useScannerConfig,
  useScannerPatterns,
  useScannerStart,
  useScannerStop,
  useValidateScannerKey,
  useDiscoverScannerModels,
  useImportScannerKey,
  useDeleteScannerKey,
  useBulkImportScannerKeys,
  useBulkDeleteScannerKeys,
  useUpdateScannerConfig,
  useUpsertScannerPattern,
  useDeleteScannerPattern,
} from "@/hooks/use-scanner"

const PAGE_SIZE = 20

function ScannerPage() {
  const [activeTab, setActiveTab] = useState("keys")

  const { data: status } = useScannerStatus()
  const startScan = useScannerStart()
  const stopScan = useScannerStop()

  const running = status?.status.running ?? false
  const hasError = !!status?.status.error && !running

  function handleToggleScan() {
    if (running) {
      stopScan.mutate(undefined, {
        onSuccess: () => toast.success("Scan stopped."),
        onError: (e) => toast.error(e.message),
      })
    } else {
      startScan.mutate(undefined, {
        onSuccess: () => toast.success("Scan started."),
        onError: (e) => toast.error(e.message),
      })
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Key Scanner"
        actions={
          <div className="flex items-center gap-3">
            {running && status && (
              <span className="text-sm text-muted-foreground">
                {status.status.patterns_done}/{status.status.patterns_total} patterns,{" "}
                {status.status.keys_found} keys found
              </span>
            )}
            <StatusIndicator running={running} hasError={hasError} />
            <Button
              variant={running ? "destructive" : "default"}
              onClick={handleToggleScan}
              disabled={startScan.isPending || stopScan.isPending}
            >
              {running ? (
                <>
                  <Square className="mr-1.5 h-4 w-4" />
                  Stop Scan
                </>
              ) : (
                <>
                  <Play className="mr-1.5 h-4 w-4" />
                  Start Scan
                </>
              )}
            </Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="keys">Keys</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
        </TabsList>

        <TabsContent value="keys">
          <KeysTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="patterns">
          <PatternsTab />
        </TabsContent>
      </Tabs>

      <ConfigSection />
    </div>
  )
}

function StatusIndicator({
  running,
  hasError,
}: {
  running: boolean
  hasError: boolean
}) {
  const color = running
    ? "bg-green-500"
    : hasError
      ? "bg-red-500"
      : "bg-gray-400"
  const label = running ? "Running" : hasError ? "Error" : "Idle"
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

// ─── Keys Tab ──────────────────────────────────────────────────────────────

function KeysTab() {
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<DiscoveredKey | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const { data, isLoading } = useScannerKeys({ limit: PAGE_SIZE, offset })
  const keys = data?.data ?? []
  const total = data?.total ?? 0

  const validateKey = useValidateScannerKey()
  const discoverModels = useDiscoverScannerModels()
  const importKey = useImportScannerKey()
  const deleteKey = useDeleteScannerKey()
  const bulkImport = useBulkImportScannerKeys()
  const bulkDelete = useBulkDeleteScannerKeys()

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === keys.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(keys.map((k) => k.id)))
    }
  }

  function handleValidate(id: number) {
    validateKey.mutate(id, {
      onSuccess: () => toast.success("Key validated."),
      onError: (e) => toast.error(e.message),
    })
  }

  function handleImport(key: DiscoveredKey) {
    toast.info("Discovering models...")
    discoverModels.mutate(key.id, {
      onSuccess: (result) => {
        const chatModels = result.models.map((m) => m.id)
        importKey.mutate(
          { id: key.id, models: { chat: chatModels }, name: undefined },
          {
            onSuccess: () => toast.success("Key imported."),
            onError: (e) => toast.error(e.message),
          },
        )
      },
      onError: () => {
        importKey.mutate(
          { id: key.id, models: { chat: [] }, name: undefined },
          {
            onSuccess: () => toast.success("Key imported (no models discovered)."),
            onError: (e) => toast.error(e.message),
          },
        )
      },
    })
  }

  function handleDelete(key: DiscoveredKey) {
    setDeleteTarget(key)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    deleteKey.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Key deleted.")
        setDeleteTarget(null)
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(deleteTarget.id)
          return next
        })
      },
      onError: (e) => toast.error(e.message),
    })
  }

  function handleBulkImport() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    bulkImport.mutate(
      { ids, models: { chat: [] } },
      {
        onSuccess: () => {
          toast.success(`${ids.length} key(s) imported.`)
          setSelected(new Set())
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  function handleBulkDelete() {
    setBulkDeleteOpen(true)
  }

  function confirmBulkDelete() {
    const ids = Array.from(selected)
    bulkDelete.mutate(ids, {
      onSuccess: () => {
        toast.success(`${ids.length} key(s) deleted.`)
        setSelected(new Set())
        setBulkDeleteOpen(false)
      },
      onError: (e) => toast.error(e.message),
    })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  if (isLoading) {
    return (
      <div className="space-y-3 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4 pt-2">
      {selected.size > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleBulkImport}
            disabled={bulkImport.isPending}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Import Selected
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkDelete}
            disabled={bulkDelete.isPending}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete Selected
          </Button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={keys.length > 0 && selected.size === keys.length}
                onCheckedChange={toggleAll}
              />
            </TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Masked Key</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Valid</TableHead>
            <TableHead>Imported</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No keys discovered yet.
              </TableCell>
            </TableRow>
          ) : (
            keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(key.id)}
                    onCheckedChange={() => toggleSelect(key.id)}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{key.provider}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {key.masked_key}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-sm">
                  {key.source_url ? (
                    <a
                      href={key.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {key.source}
                    </a>
                  ) : (
                    key.source
                  )}
                </TableCell>
                <TableCell>
                  <ValidBadge valid={key.valid} />
                </TableCell>
                <TableCell>
                  <Badge variant={key.imported ? "default" : "outline"}>
                    {key.imported ? "Yes" : "No"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleValidate(key.id)}
                      disabled={validateKey.isPending}
                      title="Validate"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                    {!key.imported && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleImport(key)}
                        disabled={discoverModels.isPending || importKey.isPending}
                        title="Import"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(key)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages} ({total} keys)
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset((p) => p + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Key"
        description={`Delete discovered key "${deleteTarget?.masked_key ?? ""}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        loading={deleteKey.isPending}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete Selected Keys"
        description={`Delete ${selected.size} selected key(s)? This cannot be undone.`}
        confirmLabel="Delete All"
        variant="destructive"
        onConfirm={confirmBulkDelete}
        loading={bulkDelete.isPending}
      />
    </div>
  )
}

function ValidBadge({ valid }: { valid: boolean | null }) {
  if (valid === true) return <Badge variant="default">Yes</Badge>
  if (valid === false) return <Badge variant="destructive">No</Badge>
  return <Badge variant="outline">Unknown</Badge>
}

// ─── History Tab ───────────────────────────────────────────────────────────

function HistoryTab() {
  const { data: history, isLoading } = useScannerHistory(20)

  if (isLoading) {
    return (
      <div className="space-y-3 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="pt-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Keys Found</TableHead>
            <TableHead className="text-right">New</TableHead>
            <TableHead className="text-right">Valid</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead>Error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(!history || history.length === 0) ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                No scan history yet.
              </TableCell>
            </TableRow>
          ) : (
            history.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="text-sm">
                  {formatDateTime(h.started_at)}
                </TableCell>
                <TableCell className="text-sm">{h.source}</TableCell>
                <TableCell>
                  <HistoryStatusBadge status={h.status} />
                </TableCell>
                <TableCell className="text-right">{h.keys_found}</TableCell>
                <TableCell className="text-right">{h.keys_new}</TableCell>
                <TableCell className="text-right">{h.keys_valid}</TableCell>
                <TableCell className="text-right text-sm">
                  {formatDuration(h.started_at, h.completed_at)}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                  {h.error_message ?? "-"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function HistoryStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <Badge variant="default">Completed</Badge>
    case "running":
      return <Badge variant="secondary">Running</Badge>
    case "failed":
      return <Badge variant="destructive">Failed</Badge>
    case "stopped":
      return <Badge variant="outline">Stopped</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function formatDuration(
  startedAt: string,
  completedAt?: string,
): string {
  if (!completedAt) return "-"
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 0 || isNaN(ms)) return "-"
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  if (mins < 60) return `${mins}m ${remSecs}s`
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hrs}h ${remMins}m`
}

// ─── Patterns Tab ──────────────────────────────────────────────────────────

const EMPTY_PATTERN: Omit<ScanKeyPattern, "id"> = {
  provider: "",
  prefix: "",
  regex: "",
  search_term: "",
  enabled: true,
}

function PatternsTab() {
  const [providerFilter, setProviderFilter] = useState<string>("")
  const [editingPattern, setEditingPattern] =
    useState<(Omit<ScanKeyPattern, "id"> & { id?: number }) | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScanKeyPattern | null>(null)

  const { data: patterns, isLoading } = useScannerPatterns(
    providerFilter || undefined,
  )
  const upsertPattern = useUpsertScannerPattern()
  const deletePattern = useDeleteScannerPattern()

  const providers = useMemo(() => {
    if (!patterns) return []
    const set = new Set(patterns.map((p) => p.provider))
    return Array.from(set).sort()
  }, [patterns])

  function handleAdd() {
    setEditingPattern({ ...EMPTY_PATTERN })
  }

  function handleEdit(p: ScanKeyPattern) {
    setEditingPattern({ ...p })
  }

  function handleSave() {
    if (!editingPattern) return
    if (!editingPattern.provider || !editingPattern.search_term) {
      toast.error("Provider and search term are required.")
      return
    }
    upsertPattern.mutate(editingPattern, {
      onSuccess: () => {
        toast.success("Pattern saved.")
        setEditingPattern(null)
      },
      onError: (e) => toast.error(e.message),
    })
  }

  function confirmDeletePattern() {
    if (!deleteTarget) return
    deletePattern.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Pattern deleted.")
        setDeleteTarget(null)
      },
      onError: (e) => toast.error(e.message),
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-3 pt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-3">
        <Select
          value={providerFilter}
          onValueChange={(v) => setProviderFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All providers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" onClick={handleAdd}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Pattern
        </Button>
      </div>

      {editingPattern && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingPattern.id ? "Edit Pattern" : "New Pattern"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Input
                  value={editingPattern.provider}
                  onChange={(e) =>
                    setEditingPattern((p) =>
                      p ? { ...p, provider: e.target.value } : p,
                    )
                  }
                  placeholder="openai"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Prefix</Label>
                <Input
                  value={editingPattern.prefix}
                  onChange={(e) =>
                    setEditingPattern((p) =>
                      p ? { ...p, prefix: e.target.value } : p,
                    )
                  }
                  placeholder="sk-"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Regex</Label>
                <Input
                  value={editingPattern.regex}
                  onChange={(e) =>
                    setEditingPattern((p) =>
                      p ? { ...p, regex: e.target.value } : p,
                    )
                  }
                  placeholder="sk-[a-zA-Z0-9]{48}"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Search Term</Label>
                <Input
                  value={editingPattern.search_term}
                  onChange={(e) =>
                    setEditingPattern((p) =>
                      p ? { ...p, search_term: e.target.value } : p,
                    )
                  }
                  placeholder="sk-"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={editingPattern.enabled}
                  onCheckedChange={(checked) =>
                    setEditingPattern((p) =>
                      p ? { ...p, enabled: checked } : p,
                    )
                  }
                />
                <Label>Enabled</Label>
              </div>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingPattern(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={upsertPattern.isPending}
                >
                  {upsertPattern.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Provider</TableHead>
            <TableHead>Prefix</TableHead>
            <TableHead>Regex</TableHead>
            <TableHead>Search Term</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(!patterns || patterns.length === 0) ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No patterns configured.
              </TableCell>
            </TableRow>
          ) : (
            patterns.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Badge variant="secondary">{p.provider}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{p.prefix || "-"}</TableCell>
                <TableCell className="max-w-[200px] truncate font-mono text-xs">
                  {p.regex || "-"}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.search_term}</TableCell>
                <TableCell>
                  <Badge variant={p.enabled ? "default" : "outline"}>
                    {p.enabled ? "Yes" : "No"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(p)}
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(p)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Pattern"
        description={`Delete pattern for "${deleteTarget?.provider ?? ""}" with search term "${deleteTarget?.search_term ?? ""}"?`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDeletePattern}
        loading={deletePattern.isPending}
      />
    </div>
  )
}

// ─── Config Section ────────────────────────────────────────────────────────

function ConfigSection() {
  const { data: config, isLoading } = useScannerConfig()
  const updateConfig = useUpdateScannerConfig()

  const [githubToken, setGithubToken] = useState("")
  const [delay, setDelay] = useState<string>("")
  const [maxPages, setMaxPages] = useState<string>("")
  const [initialized, setInitialized] = useState(false)

  if (config && !initialized) {
    setDelay(String(config.delay_seconds))
    setMaxPages(String(config.max_pages))
    setInitialized(true)
  }

  function handleSave() {
    const payload: {
      github_token?: string
      delay_seconds?: number
      max_pages?: number
    } = {}
    if (githubToken) payload.github_token = githubToken
    const d = parseInt(delay, 10)
    if (!isNaN(d) && d >= 0) payload.delay_seconds = d
    const mp = parseInt(maxPages, 10)
    if (!isNaN(mp) && mp > 0) payload.max_pages = mp
    updateConfig.mutate(payload, {
      onSuccess: () => {
        toast.success("Configuration saved.")
        setGithubToken("")
      },
      onError: (e) => toast.error(e.message),
    })
  }

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scanner Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>GitHub Token</Label>
            <Input
              type="password"
              placeholder={
                config?.github_token_configured
                  ? config.github_token_masked
                  : "ghp_..."
              }
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
            />
            {config?.github_token_configured && (
              <p className="text-xs text-muted-foreground">
                Token configured. Enter a new value to replace it.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Delay (seconds)</Label>
            <Input
              type="number"
              min={0}
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max Pages</Label>
            <Input
              type="number"
              min={1}
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
            />
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={updateConfig.isPending}
        >
          {updateConfig.isPending ? "Saving..." : "Save Configuration"}
        </Button>
      </CardContent>
    </Card>
  )
}

export const Route = createFileRoute("/_authenticated/scanner")({
  component: ScannerPage,
})
