import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { PageHeader } from "@/core/layout/page-header"
import { Skeleton } from "@/core/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/core/components/ui/tabs"
import { Card, CardContent } from "@/core/components/ui/card"
import { useProviders } from "@/hooks/use-providers"
import {
  useRateLimits,
  useSetRateLimit,
  useDeleteRateLimit,
} from "@/hooks/use-ratelimits"
import { RateLimitTable } from "@/components/rate-limit-table"
import type { RateLimitDef } from "@/lib/api"

function RateLimitsPage() {
  const { data: providers, isLoading: providersLoading } = useProviders()

  const providerNames = (providers ?? []).map((p) => p.name)
  const [selectedProvider, setSelectedProvider] = useState<string>("")

  const activeProvider =
    selectedProvider || providerNames[0] || ""

  const { data: limits, isLoading: limitsLoading } = useRateLimits(
    activeProvider || undefined,
  )

  const setRateLimit = useSetRateLimit()
  const deleteRateLimit = useDeleteRateLimit()

  async function handleSave(def: Omit<RateLimitDef, "id">) {
    await setRateLimit.mutateAsync(def)
    toast.success("Rate limit saved")
  }

  async function handleDelete(id: number) {
    await deleteRateLimit.mutateAsync(id)
    toast.success("Rate limit deleted")
  }

  if (providersLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Rate Limits" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (providerNames.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Rate Limits" />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No providers configured. Add a provider first.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Rate Limits" />

      <Tabs
        value={activeProvider}
        onValueChange={(v) => setSelectedProvider(v)}
      >
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          {providerNames.map((name) => (
            <TabsTrigger key={name} value={name} className="shrink-0">
              {providers?.find((p) => p.name === name)?.display_name ?? name}
            </TabsTrigger>
          ))}
        </TabsList>

        {providerNames.map((name) => (
          <TabsContent key={name} value={name}>
            {limitsLoading && activeProvider === name ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <RateLimitTable
                provider={name}
                limits={limits ?? []}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

export const Route = createFileRoute("/_authenticated/rate-limits")({
  component: RateLimitsPage,
})
