import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/accounts")({
  component: () => (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Accounts</h1>
    </div>
  ),
})
