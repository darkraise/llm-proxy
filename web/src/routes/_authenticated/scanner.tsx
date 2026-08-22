import { useState, useMemo, useEffect } from "react"
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
  Settings,
  FlaskConical,
  Send,
} from "lucide-react"
import {
  api,
  type DiscoveredKey,
  type ScanKeyPattern,
  type ChatTestResult,
} from "@/lib/api"
import { categorizeModels } from "@/lib/known-models"
import { useProviders } from "@/hooks/use-providers"
import { formatDateTime } from "@/lib/dateformat"
import { PageHeader } from "darkraise-ui/layout"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "darkraise-ui/components/card"
import { Badge } from "darkraise-ui/components/badge"
import { Button } from "darkraise-ui/components/button"
import { Input } from "darkraise-ui/components/input"
import { Label } from "darkraise-ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "darkraise-ui/components/select"
import { Switch } from "darkraise-ui/components/switch"
import { Checkbox } from "darkraise-ui/components/checkbox"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "darkraise-ui/components/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "darkraise-ui/components/table"
import { Skeleton } from "darkraise-ui/components/skeleton"
import { Separator } from "darkraise-ui/components/separator"
import { Textarea } from "darkraise-ui/components/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "darkraise-ui/components/dialog"
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
  const [configOpen, setConfigOpen] = useState(false)

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
              variant="outline"
              size="icon"
              onClick={() => setConfigOpen(true)}
              title="Scanner Configuration"
            >
              <Settings className="h-4 w-4" />
            </Button>
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

      <ConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
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
  const { data: status } = useScannerStatus()
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<DiscoveredKey | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [testTarget, setTestTarget] = useState<DiscoveredKey | null>(null)

  const [providerFilter, setProviderFilter] = useState("")
  const [importedFilter, setImportedFilter] = useState("")

  const { data, isLoading } = useScannerKeys({
    limit: PAGE_SIZE,
    offset,
    provider: providerFilter || undefined,
    imported: importedFilter || undefined,
  })
  const keys = data?.data ?? []
  const total = data?.total ?? 0

  const validateKey = useValidateScannerKey()
  const discoverModels = useDiscoverScannerModels()
  const importKey = useImportScannerKey()
  const deleteKey = useDeleteScannerKey()
  const bulkImport = useBulkImportScannerKeys()
  const bulkDelete = useBulkDeleteScannerKeys()

  const { data: allProviders } = useProviders()
  const providerOptions = useMemo(
    () => (allProviders ?? []).map((p) => p.name).sort(),
    [allProviders],
  )

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
      {/* Info pane */}
      {status && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            <span className="text-muted-foreground">Total:</span>{" "}
            <span className="font-medium">{status.total}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Valid:</span>{" "}
            <span className="font-medium text-green-500">{status.valid}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Imported:</span>{" "}
            <span className="font-medium">{status.imported}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Providers:</span>{" "}
            <span className="font-medium">{status.providers_count}</span>
          </span>
        </div>
      )}

      {/* Filters and bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={providerFilter}
          onValueChange={(v) => {
            setProviderFilter(v === "all" ? "" : v)
            setOffset(0)
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Providers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            {providerOptions.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={importedFilter}
          onValueChange={(v) => {
            setImportedFilter(v === "all" ? "" : v)
            setOffset(0)
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="false">Not Imported</SelectItem>
            <SelectItem value="true">Imported</SelectItem>
          </SelectContent>
        </Select>

        {selected.size > 0 && (
          <>
            <Separator orientation="vertical" className="h-6" />
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
              onClick={() => setBulkDeleteOpen(true)}
              disabled={bulkDelete.isPending}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete Selected
            </Button>
          </>
        )}
      </div>

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
                      onClick={() => setTestTarget(key)}
                      title="Test key"
                    >
                      <FlaskConical className="h-4 w-4" />
                    </Button>
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
                      onClick={() => setDeleteTarget(key)}
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

      <KeyTestDialog
        discoveredKey={testTarget}
        onOpenChange={(open) => !open && setTestTarget(null)}
      />
    </div>
  )
}

function ValidBadge({ valid }: { valid: boolean | null }) {
  if (valid === true) return <Badge variant="default">Yes</Badge>
  if (valid === false) return <Badge variant="destructive">No</Badge>
  return <Badge variant="outline">Unknown</Badge>
}

// ─── Key Test Dialog ──────────────────────────────────────────────────────

function KeyTestDialog({
  discoveredKey,
  onOpenChange,
}: {
  discoveredKey: DiscoveredKey | null
  onOpenChange: (open: boolean) => void
}) {
  const discoverModels = useDiscoverScannerModels()
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [chatModel, setChatModel] = useState("")
  const [chatMessage, setChatMessage] = useState("")
  const [chatResult, setChatResult] = useState<ChatTestResult | null>(null)
  const [chatLoading, setChatLoading] = useState(false)

  const open = discoveredKey !== null

  function handleDiscoverModels() {
    if (!discoveredKey) return
    setModelsLoading(true)
    discoverModels.mutate(discoveredKey.id, {
      onSuccess: (result) => {
        const ids = result.models.map((m) => m.id)
        setModels(ids)
        setModelsLoading(false)
      },
      onError: (e) => {
        toast.error(e.message)
        setModelsLoading(false)
      },
    })
  }

  async function handleChatTest() {
    if (!discoveredKey || !chatModel || !chatMessage) return
    setChatLoading(true)
    setChatResult(null)
    try {
      const result = await api.scanner.chatTest(
        discoveredKey.id,
        chatModel,
        chatMessage,
      )
      setChatResult(result)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Chat test failed")
    } finally {
      setChatLoading(false)
    }
  }

  function handleClose(v: boolean) {
    if (!v) {
      setModels([])
      setChatModel("")
      setChatMessage("")
      setChatResult(null)
    }
    onOpenChange(v)
  }

  const categorized = categorizeModels(models)

  const chatResponseText: string | null = (() => {
    if (!chatResult?.response) return null
    const r = chatResult.response
    try {
      return (
        r?.choices?.[0]?.message?.content ??
        r?.content?.[0]?.text ??
        r?.candidates?.[0]?.content?.parts?.[0]?.text ??
        JSON.stringify(r, null, 2)
      )
    } catch {
      return String(r)
    }
  })()

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Test Key — {discoveredKey?.provider}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Key:</span>{" "}
            <span className="font-mono">{discoveredKey?.masked_key}</span>
          </div>

          {/* Model Discovery */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDiscoverModels}
                disabled={modelsLoading}
              >
                {modelsLoading ? "Discovering..." : "Discover Models"}
              </Button>
              {models.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {models.length} model(s) found
                </span>
              )}
            </div>

            {models.length > 0 && (
              <div className="space-y-2">
                {categorized.chat.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Chat</p>
                    <div className="flex flex-wrap gap-1">
                      {categorized.chat.map((m) => (
                        <Badge key={m} variant="outline" className="text-xs">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {categorized.embedding.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Embedding</p>
                    <div className="flex flex-wrap gap-1">
                      {categorized.embedding.map((m) => (
                        <Badge key={m} variant="secondary" className="text-xs">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Chat Test */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Chat Test</p>
            <div className="space-y-1.5">
              <Label>Model</Label>
              {categorized.chat.length > 0 ? (
                <Select value={chatModel} onValueChange={setChatModel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select model..." />
                  </SelectTrigger>
                  <SelectContent>
                    {categorized.chat.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="e.g. gpt-4o"
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea
                placeholder="Say hello..."
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                rows={2}
              />
            </div>
            <Button
              size="sm"
              onClick={handleChatTest}
              disabled={chatLoading || !chatModel || !chatMessage}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {chatLoading ? "Sending..." : "Send"}
            </Button>

            {chatResult && (
              <div className="space-y-2">
                {chatResult.error ? (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {chatResult.error}
                  </p>
                ) : (
                  <>
                    <Card className="bg-muted/40">
                      <CardContent className="pt-4">
                        <p className="whitespace-pre-wrap text-sm">{chatResponseText}</p>
                      </CardContent>
                    </Card>
                    <p className="text-xs text-muted-foreground">
                      HTTP {chatResult.status_code}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
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

function ConfigDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: config } = useScannerConfig()
  const updateConfig = useUpdateScannerConfig()

  const [editingToken, setEditingToken] = useState(false)
  const [githubToken, setGithubToken] = useState("")
  const [delay, setDelay] = useState<string>("")
  const [maxPages, setMaxPages] = useState<string>("")

  useEffect(() => {
    if (!config) return
    setDelay(String(config.delay_seconds))
    setMaxPages(String(config.max_pages))
  }, [config])

  function handleSaveToken() {
    if (!githubToken.trim()) return
    updateConfig.mutate(
      { github_token: githubToken },
      {
        onSuccess: () => {
          toast.success("GitHub token saved.")
          setGithubToken("")
          setEditingToken(false)
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  function handleCancelToken() {
    setGithubToken("")
    setEditingToken(false)
  }

  function handleSave() {
    const payload: {
      delay_seconds?: number
      max_pages?: number
    } = {}
    const d = parseInt(delay, 10)
    if (!isNaN(d) && d >= 0) payload.delay_seconds = d
    const mp = parseInt(maxPages, 10)
    if (!isNaN(mp) && mp > 0) payload.max_pages = mp
    updateConfig.mutate(payload, {
      onSuccess: () => {
        toast.success("Configuration saved.")
        onOpenChange(false)
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Scanner Configuration</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>GitHub Token</Label>
            {editingToken ? (
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="ghp_..."
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  spellCheck={false}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveToken}
                    disabled={!githubToken.trim() || updateConfig.isPending}
                  >
                    {updateConfig.isPending ? "Saving..." : "Save Token"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelToken}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {config?.github_token_configured
                    ? config.github_token_masked
                    : "No token configured"}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setEditingToken(true)}
                  title="Edit token"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
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
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={updateConfig.isPending}
            >
              {updateConfig.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export const Route = createFileRoute("/_authenticated/scanner")({
  component: ScannerPage,
})
