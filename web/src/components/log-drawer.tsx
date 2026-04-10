import { formatDateTime } from "@/lib/dateformat"
import { Badge } from "darkraise-ui/components/badge"
import { Card } from "darkraise-ui/components/card"
import { Separator } from "darkraise-ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "darkraise-ui/components/sheet"
import type { RequestLog } from "@/lib/api"

interface LogDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  log: RequestLog | null
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

export function LogDrawer({ open, onOpenChange, log }: LogDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Request Details</SheetTitle>
        </SheetHeader>

        {log && (
          <div className="mt-4 space-y-4">
            <Field label="Timestamp">{formatDateTime(log.timestamp, "iso")}</Field>
            <Separator />

            <Field label="Account">{log.account_name || "—"}</Field>
            <Field label="Provider">{log.provider_type}</Field>
            <Field label="Model">{log.model}</Field>
            <Field label="Endpoint">{log.endpoint}</Field>
            <Separator />

            <Field label="Status">
              <Badge variant={log.status === "success" ? "default" : "destructive"}>
                {log.status}
              </Badge>
            </Field>
            <Field label="Status Code">{log.status_code}</Field>
            <Field label="Latency">{log.latency_ms} ms</Field>
            <Separator />

            <Field label="Prompt Tokens">{log.prompt_tokens.toLocaleString()}</Field>
            <Field label="Completion Tokens">{log.completion_tokens.toLocaleString()}</Field>

            {log.error_message && (
              <>
                <Separator />
                <Card className="border-destructive/50 bg-destructive/5 p-3">
                  <p className="text-xs font-medium text-destructive mb-1">Error</p>
                  <p className="text-sm text-destructive/90 break-words">{log.error_message}</p>
                </Card>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
