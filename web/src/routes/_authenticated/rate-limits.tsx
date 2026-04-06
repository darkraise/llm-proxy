import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/rate-limits")({
  component: () => (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Rate Limits</h1>
    </div>
  ),
})
