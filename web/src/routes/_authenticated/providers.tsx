import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/providers")({
  component: () => (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Providers</h1>
    </div>
  ),
})
