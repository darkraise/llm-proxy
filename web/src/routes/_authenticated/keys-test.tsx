import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/keys-test")({
  component: () => (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Keys Test</h1>
    </div>
  ),
})
