import { Inbox } from "lucide-react"

export function DataTableEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Inbox className="mb-2 h-10 w-10" />
      <p className="text-sm">No results found</p>
    </div>
  )
}
