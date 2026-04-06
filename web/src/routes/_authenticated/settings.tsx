import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/settings")({
  component: () => (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
    </div>
  ),
})
