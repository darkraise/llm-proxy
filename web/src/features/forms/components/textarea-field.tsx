import { Textarea } from "@/core/components/ui/textarea"
import { FieldWrapper } from "./field-wrapper"
import type { AnyFieldApi } from "@tanstack/react-form"

interface TextareaFieldProps {
  field: AnyFieldApi
  label: string
  description?: string
  placeholder?: string
  rows?: number
}

export function TextareaField({
  field,
  label,
  description,
  placeholder,
  rows = 3,
}: TextareaFieldProps) {
  return (
    <FieldWrapper field={field} label={label} description={description}>
      <Textarea
        id={field.name}
        placeholder={placeholder}
        rows={rows}
        value={field.state.value as string}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
    </FieldWrapper>
  )
}
