import { Switch } from "@/core/components/ui/switch"
import { Label } from "@/core/components/ui/label"
import type { AnyFieldApi } from "@tanstack/react-form"

interface SwitchFieldProps {
  field: AnyFieldApi
  label: string
  description?: string
}

export function SwitchField({ field, label, description }: SwitchFieldProps) {
  return (
    <div className="flex items-start justify-between rounded-lg border border-border p-4">
      <div className="space-y-0.5">
        <Label htmlFor={field.name}>{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch
        id={field.name}
        checked={field.state.value as boolean}
        onCheckedChange={(checked) => field.handleChange(checked)}
        onBlur={field.handleBlur}
      />
    </div>
  )
}
