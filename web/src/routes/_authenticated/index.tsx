import { useState, useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { Activity, AlertTriangle, Clock, Zap } from "lucide-react"
import { PageHeader } from "@/core/layout/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/components/ui/select"
import { Switch } from "@/core/components/ui/switch"
import { Label } from "@/core/components/ui/label"
import { Card, CardContent } from "@/core/components/ui/card"
import { Skeleton } from "@/core/components/ui/skeleton"
import { StatCard, BreakdownTabs } from "@/features/dashboard"
import { ChartCard, BarChart } from "@/features/charts"
import { formatCompact } from "@/lib/api"
import {
  useStatsOverview,
  useStatsProviders,
  useStatsAccounts,
  useStatsModels,
} from "@/hooks/use-stats"

const RANGE_OPTIONS = [
  { value: "1h", label: "Last hour", ms: 60 * 60 * 1000 },
  { value: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { value: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { value: "365d", label: "Last year", ms: 365 * 24 * 60 * 60 * 1000 },
] as const

function computeFrom(range: string): string {
  const opt = RANGE_OPTIONS.find((r) => r.value === range)
  const ms = opt?.ms ?? 24 * 60 * 60 * 1000
  return new Date(Date.now() - ms).toISOString()
}

function Dashboard() {
  const [range, setRange] = useState("24h")
  const [autoRefresh, setAutoRefresh] = useState(false)
  const queryClient = useQueryClient()

  const from = useMemo(() => computeFrom(range), [range])

  const { data: overview, isLoading: loadingOverview } = useStatsOverview(from)
  const { data: providerStats } = useStatsProviders(from)
  const { data: accountStats } = useStatsAccounts(from)
  const { data: modelStats } = useStatsModels(undefined, from)

  function handleAutoRefreshToggle(checked: boolean) {
    setAutoRefresh(checked)
    if (checked) {
      queryClient.invalidateQueries({ queryKey: ["stats"] })
    }
  }

  const requestsTrend = useMemo(() => {
    if (!overview || !overview.yesterday_requests) return undefined
    const pct =
      ((overview.total_requests - overview.yesterday_requests) /
        overview.yesterday_requests) *
      100
    return {
      value: Math.abs(parseFloat(pct.toFixed(1))),
      isPositive: pct >= 0,
    }
  }, [overview])

  const providerChartData = useMemo(
    () =>
      (providerStats ?? [])
        .slice()
        .sort((a, b) => b.total_requests - a.total_requests)
        .map((p) => ({
          provider: p.provider,
          total_requests: p.total_requests,
        })),
    [providerStats],
  )

  const providerBreakdown = useMemo(
    () =>
      (providerStats ?? [])
        .slice()
        .sort((a, b) => b.total_requests - a.total_requests)
        .slice(0, 10)
        .map((p) => ({
          label: p.provider,
          value: p.total_requests,
          total: overview?.total_requests ?? 0,
        })),
    [providerStats, overview],
  )

  const accountBreakdown = useMemo(
    () =>
      (accountStats ?? [])
        .slice()
        .sort((a, b) => b.total_requests - a.total_requests)
        .slice(0, 10)
        .map((a) => ({
          label: a.account_name,
          value: a.total_requests,
          total: overview?.total_requests ?? 0,
        })),
    [accountStats, overview],
  )

  const modelBreakdown = useMemo(
    () =>
      (modelStats ?? [])
        .slice()
        .sort((a, b) => b.total_requests - a.total_requests)
        .slice(0, 10)
        .map((m) => ({
          label: m.model,
          value: m.total_requests,
          total: overview?.total_requests ?? 0,
        })),
    [modelStats, overview],
  )

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor="auto-refresh" className="text-sm">
                Auto-refresh
              </Label>
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={handleAutoRefreshToggle}
              />
            </div>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loadingOverview ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              label="Total Requests"
              value={overview?.total_requests?.toLocaleString() ?? 0}
              icon={Activity}
              trend={requestsTrend}
            />
            <StatCard
              label="Total Tokens"
              value={formatCompact(overview?.total_tokens ?? 0)}
              icon={Zap}
            />
            <StatCard
              label="Error Count"
              value={overview?.error_count?.toLocaleString() ?? 0}
              icon={AlertTriangle}
            />
            <StatCard
              label="Avg Latency"
              value={`${(overview?.avg_latency_ms ?? 0).toFixed(0)}ms`}
              icon={Clock}
            />
          </>
        )}
      </div>

      <ChartCard
        title="Requests by Provider"
        description="Total requests per provider in the selected time range"
      >
        {providerChartData.length > 0 ? (
          <BarChart
            data={providerChartData}
            xKey="provider"
            yKeys={["total_requests"]}
          />
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No request data for this period
          </p>
        )}
      </ChartCard>

      <Card>
        <CardContent className="p-6">
          <BreakdownTabs
            providers={providerBreakdown}
            accounts={accountBreakdown}
            models={modelBreakdown}
          />
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
})
