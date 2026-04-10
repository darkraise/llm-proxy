import { useState, useCallback } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { PageHeader } from "darkraise-ui/layout"
import { Badge } from "darkraise-ui/components/badge"
import { Button } from "darkraise-ui/components/button"
import { Input } from "darkraise-ui/components/input"
import { Skeleton } from "darkraise-ui/components/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "darkraise-ui/components/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "darkraise-ui/components/table"
import { useLogs } from "@/hooks/use-logs"
import { useAccounts } from "@/hooks/use-accounts"
import { LogDrawer } from "@/components/log-drawer"
import { formatDateTime } from "@/lib/dateformat"
import type { RequestLog } from "@/lib/api"

const PAGE_SIZES = [25, 50, 100] as const

function LogsPage() {
  const [account, setAccount] = useState<string>("")
  const [status, setStatus] = useState<string>("")
  const [model, setModel] = useState<string>("")
  const [from, setFrom] = useState<string>("")
  const [to, setTo] = useState<string>("")
  const [minLatency, setMinLatency] = useState<string>("")
  const [limit, setLimit] = useState<25 | 50 | 100>(25)
  const [offset, setOffset] = useState(0)

  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { data: accounts } = useAccounts()

  const filters = {
    account: account || undefined,
    status: status || undefined,
    model: model || undefined,
    from: from || undefined,
    to: to || undefined,
    min_latency: minLatency ? Number(minLatency) : undefined,
    limit,
    offset,
  }

  const { data, isLoading } = useLogs(filters)

  const logs = data?.data ?? []
  const total = data?.total ?? 0
  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit))

  const resetPagination = useCallback(() => setOffset(0), [])

  function handleRowClick(log: RequestLog) {
    setSelectedLog(log)
    setDrawerOpen(true)
  }

  function handleAccountChange(val: string) {
    setAccount(val === "__all__" ? "" : val)
    resetPagination()
  }

  function handleStatusChange(val: string) {
    setStatus(val === "__all__" ? "" : val)
    resetPagination()
  }

  function handleLimitChange(val: string) {
    setLimit(Number(val) as 25 | 50 | 100)
    resetPagination()
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Usage Logs" />

      {/* Filter toolbar */}
      <div className="flex flex-wrap gap-2">
        <Select value={account || "__all__"} onValueChange={handleAccountChange}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Accounts</SelectItem>
            {(accounts ?? []).map((a) => (
              <SelectItem key={a.id} value={a.name}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status || "__all__"} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="w-44"
          placeholder="Model filter"
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            resetPagination()
          }}
        />

        <Input
          type="date"
          className="w-40"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value)
            resetPagination()
          }}
        />

        <Input
          type="date"
          className="w-40"
          value={to}
          onChange={(e) => {
            setTo(e.target.value)
            resetPagination()
          }}
        />

        <Input
          className="w-36"
          placeholder="Min latency ms"
          type="number"
          min={0}
          value={minLatency}
          onChange={(e) => {
            setMinLatency(e.target.value)
            resetPagination()
          }}
        />

        <Select value={String(limit)} onValueChange={handleLimitChange}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Tokens</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  No logs found.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow
                  key={log.id}
                  className="cursor-pointer"
                  onClick={() => handleRowClick(log)}
                >
                  <TableCell className="font-mono text-xs tabular-nums whitespace-nowrap">
                    {formatDateTime(log.timestamp, "compact")}
                  </TableCell>
                  <TableCell>{log.account_name || "—"}</TableCell>
                  <TableCell className="max-w-48 truncate" title={log.model}>
                    {log.model}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {log.endpoint}
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.status === "success" ? "default" : "destructive"}>
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{log.latency_ms} ms</TableCell>
                  <TableCell className="tabular-nums">
                    {(log.prompt_tokens + log.completion_tokens).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total > 0
            ? `Page ${currentPage} of ${totalPages} — ${total.toLocaleString()} total`
            : "No results"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <LogDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        log={selectedLog}
      />
    </div>
  )
}

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
})
