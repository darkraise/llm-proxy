import { Button } from "@/core/components/ui/button"

interface FormActionsProps {
  submitLabel?: string
  cancelLabel?: string
  onCancel?: () => void
  isSubmitting?: boolean
  canSubmit?: boolean
}

export function FormActions({
  submitLabel = "Save",
  cancelLabel = "Cancel",
  onCancel,
  isSubmitting = false,
  canSubmit = true,
}: FormActionsProps) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
      <Button type="submit" disabled={!canSubmit || isSubmitting}>
        {isSubmitting ? "Saving..." : submitLabel}
      </Button>
    </div>
  )
}
