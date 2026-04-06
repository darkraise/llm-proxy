import type { ReactNode } from "react"
import { Label } from "@/core/components/ui/label"
import type { AnyFieldApi } from "@tanstack/react-form"

interface FieldWrapperProps {
  field: AnyFieldApi
  label: string
  description?: string
  labelExtra?: ReactNode
  children: ReactNode
}

export function FieldWrapper({
  field,
  label,
  description,
  labelExtra,
  children,
}: FieldWrapperProps) {
  const errors = field.state.meta.isTouched ? field.state.meta.errors : []

  return (
    <div className="space-y-2">
      {labelExtra ? (
        <div className="flex items-center justify-between">
          <Label htmlFor={field.name}>{label}</Label>
          {labelExtra}
        </div>
      ) : (
        <Label htmlFor={field.name}>{label}</Label>
      )}
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {children}
      {errors.map((err) => (
        <p key={err.message} className="text-xs text-destructive">
          {err.message}
        </p>
      ))}
    </div>
  )
}
