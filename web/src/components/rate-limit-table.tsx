import { useState } from "react"
import { Plus, Save, Trash2 } from "lucide-react"
import type { RateLimitDef } from "@/lib/api"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/components/ui/table"

const METRICS = [
  { value: "rpm", label: "rpm — requests/min" },
  { value: "rpd", label: "rpd — requests/day" },
  { value: "tpm", label: "tpm — tokens/min" },
  { value: "tpd", label: "tpd — tokens/day" },
]

interface RowState {
  key: string
  id: number | null
  model: string
  metric: string
  max_value: string
  window_secs: string
  saving: boolean
}

function newRow(): RowState {
  return {
    key: crypto.randomUUID(),
    id: null,
    model: "",
    metric: "rpm",
    max_value: "",
    window_secs: "60",
    saving: false,
  }
}

function fromDef(def: RateLimitDef): RowState {
  return {
    key: String(def.id),
    id: def.id,
    model: def.model,
    metric: def.metric,
    max_value: String(def.max_value),
    window_secs: String(def.window_secs),
    saving: false,
  }
}

export interface RateLimitTableProps {
  provider: string
  limits: RateLimitDef[]
  onSave: (def: Omit<RateLimitDef, "id">) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

export function RateLimitTable({
  provider,
  limits,
  onSave,
  onDelete,
}: RateLimitTableProps) {
  const [newRows, setNewRows] = useState<RowState[]>([])
  const [existingEdits, setExistingEdits] = useState<Record<number, RowState>>({})

  function getExistingRow(def: RateLimitDef): RowState {
    return existingEdits[def.id] ?? fromDef(def)
  }

  function updateExisting(id: number, patch: Partial<RowState>) {
    setExistingEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? fromDef(limits.find((l) => l.id === id)!)), ...patch },
    }))
  }

  function updateNew(key: string, patch: Partial<RowState>) {
    setNewRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    )
  }

  async function handleSaveExisting(def: RateLimitDef) {
    const row = getExistingRow(def)
    updateExisting(def.id, { saving: true })
    try {
      await onSave({
        provider,
        model: row.model,
        metric: row.metric,
        max_value: Number(row.max_value),
        window_secs: Number(row.window_secs),
      })
      setExistingEdits((prev) => {
        const next = { ...prev }
        delete next[def.id]
        return next
      })
    } finally {
      updateExisting(def.id, { saving: false })
    }
  }

  async function handleSaveNew(key: string) {
    const row = newRows.find((r) => r.key === key)
    if (!row) return
    updateNew(key, { saving: true })
    try {
      await onSave({
        provider,
        model: row.model,
        metric: row.metric,
        max_value: Number(row.max_value),
        window_secs: Number(row.window_secs),
      })
      setNewRows((prev) => prev.filter((r) => r.key !== key))
    } finally {
      updateNew(key, { saving: false })
    }
  }

  async function handleDelete(def: RateLimitDef) {
    updateExisting(def.id, { saving: true })
    try {
      await onDelete(def.id)
    } finally {
      updateExisting(def.id, { saving: false })
    }
  }

  const modelPlaceholder = "model (blank = default)"

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="w-44">Metric</TableHead>
            <TableHead className="w-36">Max Value</TableHead>
            <TableHead className="w-36">Window (s)</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {limits.length === 0 && newRows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No rate limits configured. Click "Add Row" to add one.
              </TableCell>
            </TableRow>
          )}

          {limits.map((def) => {
            const row = getExistingRow(def)
            return (
              <TableRow key={def.id}>
                <TableCell>
                  <Input
                    value={row.model}
                    onChange={(e) => updateExisting(def.id, { model: e.target.value })}
                    placeholder={modelPlaceholder}
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={row.metric}
                    onValueChange={(v) => updateExisting(def.id, { metric: v })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRICS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={row.max_value}
                    onChange={(e) => updateExisting(def.id, { max_value: e.target.value })}
                    placeholder="e.g. 60"
                    className="h-8"
                    min={1}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={row.window_secs}
                    onChange={(e) =>
                      updateExisting(def.id, { window_secs: e.target.value })
                    }
                    placeholder="e.g. 60"
                    className="h-8"
                    min={1}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={row.saving || !row.max_value || !row.window_secs}
                      onClick={() => handleSaveExisting(def)}
                      title="Save"
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={row.saving}
                      onClick={() => handleDelete(def)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}

          {newRows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>
                <Input
                  value={row.model}
                  onChange={(e) => updateNew(row.key, { model: e.target.value })}
                  placeholder={modelPlaceholder}
                  className="h-8"
                />
              </TableCell>
              <TableCell>
                <Select
                  value={row.metric}
                  onValueChange={(v) => updateNew(row.key, { metric: v })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METRICS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  value={row.max_value}
                  onChange={(e) => updateNew(row.key, { max_value: e.target.value })}
                  placeholder="e.g. 60"
                  className="h-8"
                  min={1}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  value={row.window_secs}
                  onChange={(e) => updateNew(row.key, { window_secs: e.target.value })}
                  placeholder="e.g. 60"
                  className="h-8"
                  min={1}
                />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={row.saving || !row.max_value || !row.window_secs}
                    onClick={() => handleSaveNew(row.key)}
                    title="Save"
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={row.saving}
                    onClick={() =>
                      setNewRows((prev) => prev.filter((r) => r.key !== row.key))
                    }
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Button
        variant="outline"
        size="sm"
        onClick={() => setNewRows((prev) => [...prev, newRow()])}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add Row
      </Button>
    </div>
  )
}
