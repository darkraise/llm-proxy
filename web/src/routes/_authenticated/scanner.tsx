import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/scanner")({
  component: () => (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Scanner</h1>
    </div>
  ),
})
