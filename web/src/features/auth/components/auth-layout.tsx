import { Outlet } from "@tanstack/react-router"

export function AuthLayout() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col items-center justify-center overflow-hidden bg-primary/5 lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,hsl(var(--primary)/0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,hsl(var(--primary)/0.1),transparent_60%)]" />
        <div className="relative z-10 flex flex-col items-center gap-4 px-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
            <span className="text-2xl font-bold text-primary-foreground">L</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight">LLM Proxy</h2>
          <p className="max-w-md text-muted-foreground">
            Multi-provider LLM gateway with rate limiting, automatic retries,
            and unified API.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center p-8">
        <Outlet />
      </div>
    </div>
  )
}
