import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const SelectRoot = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-text-primary",
      "focus:outline-hidden focus:ring-2 focus:ring-accent focus:border-transparent",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "[&>span]:truncate",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown size={14} className="text-text-muted shrink-0" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-100 max-h-60 min-w-32 overflow-auto rounded-lg border border-border bg-surface-overlay shadow-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" && "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm text-text-primary outline-hidden",
      "focus:bg-accent-muted focus:text-accent-light",
      "data-disabled:pointer-events-none data-disabled:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check size={12} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

// ─── Drop-in replacement wrapper ─────────────────────────────────────────────
// Preserves the same API as the old custom Select for easy migration.

interface SelectOption {
  value: string;
  label: React.ReactNode;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  placeholder?: string;
}

// Radix reserves "" for "no selection". Use a sentinel for options with empty string values.
const EMPTY_SENTINEL = '__empty__'

function toRadix(v: string) { return v === '' ? EMPTY_SENTINEL : v }
function fromRadix(v: string) { return v === EMPTY_SENTINEL ? '' : v }

export function Select({ value, onChange, options, className = '', placeholder }: SelectProps) {
  return (
    <SelectRoot value={toRadix(value)} onValueChange={(v) => onChange(fromRadix(v))}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder ?? 'Select...'} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value || EMPTY_SENTINEL} value={toRadix(opt.value)}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  )
}

export { SelectRoot, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem }
