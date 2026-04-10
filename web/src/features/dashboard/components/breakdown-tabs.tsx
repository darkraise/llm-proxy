import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "darkraise-ui/components/tabs"

interface BreakdownItem {
  label: string
  value: number
  total: number
}

interface BreakdownTabsProps {
  providers: BreakdownItem[]
  accounts: BreakdownItem[]
  models: BreakdownItem[]
}

function BreakdownList({ items }: { items: BreakdownItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data for this period
      </p>
    )
  }

  const maxValue = Math.max(...items.map((i) => i.value))

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate font-medium">{item.label}</span>
            <span className="text-muted-foreground">
              {item.value.toLocaleString()}
            </span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{
                width: maxValue > 0 ? `${(item.value / maxValue) * 100}%` : "0%",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function BreakdownTabs({
  providers,
  accounts,
  models,
}: BreakdownTabsProps) {
  return (
    <Tabs defaultValue="providers">
      <TabsList>
        <TabsTrigger value="providers">By Provider</TabsTrigger>
        <TabsTrigger value="accounts">By Account</TabsTrigger>
        <TabsTrigger value="models">By Model</TabsTrigger>
      </TabsList>
      <TabsContent value="providers">
        <BreakdownList items={providers} />
      </TabsContent>
      <TabsContent value="accounts">
        <BreakdownList items={accounts} />
      </TabsContent>
      <TabsContent value="models">
        <BreakdownList items={models} />
      </TabsContent>
    </Tabs>
  )
}
