import { useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/core/components/ui/dialog"
import { Button } from "@/core/components/ui/button"
import { Label } from "@/core/components/ui/label"
import { Switch } from "@/core/components/ui/switch"
import { Separator } from "@/core/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/core/components/ui/tabs"
import { useBulkEditAccounts, useBulkUpdateAccounts } from "@/hooks/use-accounts"
import { AddModelsDialog } from "./add-models-dialog"

interface BulkEditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: number[]
  onSaved: () => void
}

export function BulkEditModal({
  open,
  onOpenChange,
  selectedIds,
  onSaved,
}: BulkEditModalProps) {
  const [tab, setTab] = useState("state")
  const [enabled, setEnabled] = useState(true)
  const [models, setModels] = useState<Record<string, string[]> | null>(null)
  const [addModelsOpen, setAddModelsOpen] = useState(false)

  const bulkEdit = useBulkEditAccounts()
  const bulkUpdate = useBulkUpdateAccounts()

  function handleSaveState() {
    bulkUpdate.mutate(
      { ids: selectedIds, enabled },
      {
        onSuccess: () => {
          toast.success(`Updated ${selectedIds.length} accounts`)
          onSaved()
          onOpenChange(false)
        },
        onError: (err) => toast.error(`Bulk update failed: ${err.message}`),
      },
    )
  }

  function handleSaveModels() {
    if (!models) {
      toast.error("No models selected")
      return
    }
    bulkEdit.mutate(
      { ids: selectedIds, models },
      {
        onSuccess: () => {
          toast.success(`Updated models on ${selectedIds.length} accounts`)
          onSaved()
          onOpenChange(false)
        },
        onError: (err) => toast.error(`Bulk edit failed: ${err.message}`),
      },
    )
  }

  const saving = bulkEdit.isPending || bulkUpdate.isPending

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Edit</DialogTitle>
            <DialogDescription>
              Apply changes to {selectedIds.length} selected accounts
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="state" className="flex-1">
                State
              </TabsTrigger>
              <TabsTrigger value="models" className="flex-1">
                Models
              </TabsTrigger>
            </TabsList>

            <TabsContent value="state" className="space-y-4">
              <div className="flex items-center justify-between pt-2">
                <Label>Enabled</Label>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <Separator />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button onClick={handleSaveState} disabled={saving}>
                  {saving ? "Saving..." : "Apply"}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="models" className="space-y-4">
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddModelsOpen(true)}
                >
                  Select Models
                </Button>
                {models && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {Object.values(models).flat().length} models selected
                  </p>
                )}
              </div>
              <Separator />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveModels}
                  disabled={saving || !models}
                >
                  {saving ? "Saving..." : "Apply Models"}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AddModelsDialog
        open={addModelsOpen}
        onOpenChange={setAddModelsOpen}
        availableModels={models ? Object.values(models).flat() : []}
        selectedModels={models ?? {}}
        onSave={setModels}
      />
    </>
  )
}
