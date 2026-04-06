import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/logs")({
  component: () => (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Usage Logs</h1>
    </div>
  ),
})
