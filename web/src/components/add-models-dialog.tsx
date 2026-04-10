import { useState, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "darkraise-ui/components/dialog"
import { Button } from "darkraise-ui/components/button"
import { Input } from "darkraise-ui/components/input"
import { Checkbox } from "darkraise-ui/components/checkbox"
import { ScrollArea } from "darkraise-ui/components/scroll-area"
import { Separator } from "darkraise-ui/components/separator"
import { categorizeModels } from "@/lib/known-models"

interface AddModelsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableModels: string[]
  selectedModels: Record<string, string[]>
  onSave: (models: Record<string, string[]>) => void
}

export function AddModelsDialog({
  open,
  onOpenChange,
  availableModels,
  selectedModels,
  onSave,
}: AddModelsDialogProps) {
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState<Set<string>>(() => {
    const flat = Object.values(selectedModels).flat()
    return new Set(flat)
  })

  const categorized = useMemo(
    () => categorizeModels(availableModels),
    [availableModels],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return {
      chat: categorized.chat.filter((m) => m.toLowerCase().includes(q)),
      embedding: categorized.embedding.filter((m) =>
        m.toLowerCase().includes(q),
      ),
    }
  }, [categorized, search])

  function resetOnOpen(isOpen: boolean) {
    if (isOpen) {
      const flat = Object.values(selectedModels).flat()
      setSelection(new Set(flat))
      setSearch("")
    }
    onOpenChange(isOpen)
  }

  function toggleModel(model: string) {
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(model)) {
        next.delete(model)
      } else {
        next.add(model)
      }
      return next
    })
  }

  function selectAllInCategory(models: string[]) {
    setSelection((prev) => {
      const next = new Set(prev)
      for (const m of models) next.add(m)
      return next
    })
  }

  function deselectAllInCategory(models: string[]) {
    setSelection((prev) => {
      const next = new Set(prev)
      for (const m of models) next.delete(m)
      return next
    })
  }

  function handleSave() {
    const result = categorizeModels([...selection])
    onSave(result)
    onOpenChange(false)
  }

  function renderCategory(label: string, models: string[]) {
    if (models.length === 0) return null
    const allSelected = models.every((m) => selection.has(m))
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">{label}</h4>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => selectAllInCategory(models)}
              disabled={allSelected}
            >
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => deselectAllInCategory(models)}
            >
              None
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-1">
          {models.map((model) => (
            <label
              key={model}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={selection.has(model)}
                onCheckedChange={() => toggleModel(model)}
              />
              <span className="truncate">{model}</span>
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={resetOnOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Models</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <ScrollArea className="max-h-[400px]">
          <div className="space-y-4 pr-3">
            {renderCategory("Chat", filtered.chat)}
            {filtered.chat.length > 0 && filtered.embedding.length > 0 && (
              <Separator />
            )}
            {renderCategory("Embedding", filtered.embedding)}
            {filtered.chat.length === 0 && filtered.embedding.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No models match your search
              </p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save ({selection.size} selected)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
