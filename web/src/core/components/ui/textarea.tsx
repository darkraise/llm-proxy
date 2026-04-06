import * as React from "react"

import { cn } from "@/core/lib/utils"

function Textarea({
  className,
  ref,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "card-surface border-input bg-card text-card-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full border px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  )
}

export { Textarea }
