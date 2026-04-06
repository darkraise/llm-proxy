import type { AnyFieldApi } from "@tanstack/react-form"

export interface FieldWrapperProps {
  field: AnyFieldApi
  label: string
  description?: string
}

export interface FormSectionProps {
  title: string
  description?: string
  children: React.ReactNode
}

export interface FormActionsProps {
  submitLabel?: string
  cancelLabel?: string
  onCancel?: () => void
  isSubmitting?: boolean
  canSubmit?: boolean
}
