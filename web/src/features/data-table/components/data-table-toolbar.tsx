import { X } from "lucide-react"
import { Input } from "@/core/components/ui/input"
import { Button } from "@/core/components/ui/button"
import { ColumnVisibility } from "./column-visibility"
import type { DataTableToolbarProps } from "../types"

export function DataTableToolbar<TData>({
  table,
  searchKey,
  searchPlaceholder = "Search...",
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 items-center gap-2">
        {searchKey && (
          <Input
            placeholder={searchPlaceholder}
            value={
              (table.getColumn(searchKey)?.getFilterValue() as string) ?? ""
            }
            onChange={(e) =>
              table.getColumn(searchKey)?.setFilterValue(e.target.value)
            }
            className="h-9 w-64"
          />
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            className="h-9 px-2"
            onClick={() => table.resetColumnFilters()}
          >
            Reset
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
      <ColumnVisibility table={table} />
    </div>
  )
}
