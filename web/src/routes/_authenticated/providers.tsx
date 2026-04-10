import { useState, useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, X } from "lucide-react"
import type { Provider, ValidationStep } from "@/lib/api"
import { PageHeader } from "darkraise-ui/layout"
import { Card, CardContent, CardHeader, CardTitle } from "darkraise-ui/components/card"
import { Badge } from "darkraise-ui/components/badge"
import { Button } from "darkraise-ui/components/button"
import { Input } from "darkraise-ui/components/input"
import { Label } from "darkraise-ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "darkraise-ui/components/select"
import { Switch } from "darkraise-ui/components/switch"
import { Checkbox } from "darkraise-ui/components/checkbox"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "darkraise-ui/components/sheet"
import { Tabs, TabsList, TabsTrigger } from "darkraise-ui/components/tabs"
import { Separator } from "darkraise-ui/components/separator"
import { Skeleton } from "darkraise-ui/components/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
} from "@/hooks/use-providers"

type FilterTab = "all" | "builtin" | "custom"

const ALL_CAPABILITIES = ["chat", "embedding", "models"] as const
type Capability = typeof ALL_CAPABILITIES[number]

function parseCapabilities(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

type StepType = "models_fetch" | "chat_completion"

interface ValidationStepForm {
  step: StepType
  model: string
  message: string
  max_tokens: number
}

interface FormState {
  name: string
  display_name: string
  base_url: string
  models_url: string
  api_standard: string
  auth_type: string
  auth_header: string
  capabilities: Capability[]
  validation_steps: ValidationStepForm[]
  enabled: boolean
}

function emptyForm(): FormState {
  return {
    name: "",
    display_name: "",
    base_url: "",
    models_url: "",
    api_standard: "openai",
    auth_type: "bearer",
    auth_header: "",
    capabilities: [],
    validation_steps: [],
    enabled: true,
  }
}

function parseValidationSteps(raw: string): ValidationStepForm[] {
  if (!raw) return []
  try {
    const steps = JSON.parse(raw) as Array<{ step: string; params?: Record<string, any> }>
    return steps.map((s) => ({
      step: (s.step === "chat_completion" ? "chat_completion" : "models_fetch") as StepType,
      model: (s.params?.model as string) ?? "",
      message: (s.params?.message as string) ?? "say ok",
      max_tokens: (s.params?.max_tokens as number) ?? 5,
    }))
  } catch {
    return []
  }
}

function serializeValidationSteps(steps: ValidationStepForm[]): ValidationStep[] {
  return steps.map((s) => {
    if (s.step === "models_fetch") return { step: "models_fetch" }
    return {
      step: "chat_completion",
      params: {
        model: s.model || undefined,
        message: s.message || undefined,
        max_tokens: s.max_tokens,
      },
    }
  })
}

function providerToForm(p: Provider): FormState {
  return {
    name: p.name,
    display_name: p.display_name,
    base_url: p.base_url,
    models_url: p.models_url,
    api_standard: p.api_standard,
    auth_type: p.auth_type,
    auth_header: p.auth_header,
    capabilities: parseCapabilities(p.capabilities) as Capability[],
    validation_steps: parseValidationSteps(p.validation_steps),
    enabled: p.enabled,
  }
}

function ProviderCard({
  provider,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  provider: Provider
  onEdit: () => void
  onDelete: () => void
  onToggleEnabled: (enabled: boolean) => void
}) {
  const caps = parseCapabilities(provider.capabilities)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{provider.display_name}</CardTitle>
          <Badge variant={provider.is_builtin ? "secondary" : "outline"} className="shrink-0 text-xs">
            {provider.is_builtin ? "built-in" : "custom"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="truncate text-sm text-muted-foreground" title={provider.base_url}>
          {provider.base_url}
        </p>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Standard:</span>
          <Badge variant="outline" className="text-xs">{provider.api_standard}</Badge>
        </div>

        {caps.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {caps.map((cap) => (
              <Badge key={cap} variant="secondary" className="text-xs">{cap}</Badge>
            ))}
          </div>
        )}

        <Separator />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              checked={provider.enabled}
              onCheckedChange={onToggleEnabled}
            />
            <span className="text-sm text-muted-foreground">
              {provider.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            {!provider.is_builtin && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ProviderSheet({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: Provider | null
}) {
  const isCreate = provider === null
  const isBuiltin = provider?.is_builtin ?? false

  const [form, setForm] = useState<FormState>(() =>
    provider ? providerToForm(provider) : emptyForm()
  )

  const createProvider = useCreateProvider()
  const updateProvider = useUpdateProvider()

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleCapability(cap: Capability) {
    setForm((prev) => {
      const has = prev.capabilities.includes(cap)
      return {
        ...prev,
        capabilities: has
          ? prev.capabilities.filter((c) => c !== cap)
          : [...prev.capabilities, cap],
      }
    })
  }

  function addStep() {
    setForm((prev) => ({
      ...prev,
      validation_steps: [
        ...prev.validation_steps,
        { step: "models_fetch", model: "", message: "say ok", max_tokens: 5 },
      ],
    }))
  }

  function removeStep(index: number) {
    setForm((prev) => ({
      ...prev,
      validation_steps: prev.validation_steps.filter((_, i) => i !== index),
    }))
  }

  function moveStep(index: number, direction: -1 | 1) {
    setForm((prev) => {
      const steps = [...prev.validation_steps]
      const target = index + direction
      if (target < 0 || target >= steps.length) return prev
      ;[steps[index], steps[target]] = [steps[target], steps[index]]
      return { ...prev, validation_steps: steps }
    })
  }

  function updateStep(index: number, updates: Partial<ValidationStepForm>) {
    setForm((prev) => ({
      ...prev,
      validation_steps: prev.validation_steps.map((s, i) =>
        i === index ? { ...s, ...updates } : s
      ),
    }))
  }

  function changeStepType(index: number, newType: StepType) {
    if (newType === "models_fetch") {
      updateStep(index, { step: "models_fetch", model: "", message: "say ok", max_tokens: 5 })
    } else {
      updateStep(index, { step: "chat_completion", model: "", message: "say ok", max_tokens: 5 })
    }
  }

  function handleOpen(open: boolean) {
    if (open) {
      setForm(provider ? providerToForm(provider) : emptyForm())
    }
    onOpenChange(open)
  }

  function handleSave() {
    const payload = {
      name: form.name,
      display_name: form.display_name,
      base_url: form.base_url,
      models_url: form.models_url,
      api_standard: form.api_standard,
      auth_type: form.auth_type,
      auth_header: form.auth_header,
      capabilities: form.capabilities,
      validation_steps: serializeValidationSteps(form.validation_steps),
      enabled: form.enabled,
    }

    if (isCreate) {
      createProvider.mutate(payload, {
        onSuccess: () => {
          toast.success("Provider created")
          onOpenChange(false)
        },
        onError: (err) => toast.error(err.message),
      })
    } else {
      updateProvider.mutate(
        { name: form.name, data: payload },
        {
          onSuccess: () => {
            toast.success("Provider updated")
            onOpenChange(false)
          },
          onError: (err) => toast.error(err.message),
        },
      )
    }
  }

  const isPending = createProvider.isPending || updateProvider.isPending

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isCreate ? "Add Custom Provider" : "Edit Provider"}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              disabled={!isCreate && isBuiltin}
              placeholder="e.g. my-provider"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-display-name">Display Name</Label>
            <Input
              id="p-display-name"
              value={form.display_name}
              onChange={(e) => setField("display_name", e.target.value)}
              placeholder="e.g. My Provider"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-base-url">Base URL</Label>
            <Input
              id="p-base-url"
              value={form.base_url}
              onChange={(e) => setField("base_url", e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-models-url">Models URL</Label>
            <Input
              id="p-models-url"
              value={form.models_url}
              onChange={(e) => setField("models_url", e.target.value)}
              placeholder="https://api.example.com/v1/models"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-api-standard">API Standard</Label>
            <Select
              value={form.api_standard}
              onValueChange={(v) => setField("api_standard", v)}
            >
              <SelectTrigger id="p-api-standard">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">openai</SelectItem>
                <SelectItem value="anthropic">anthropic</SelectItem>
                <SelectItem value="google">google</SelectItem>
                <SelectItem value="cohere">cohere</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-auth-type">Auth Type</Label>
            <Select
              value={form.auth_type}
              onValueChange={(v) => setField("auth_type", v)}
            >
              <SelectTrigger id="p-auth-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bearer">bearer</SelectItem>
                <SelectItem value="x-api-key">x-api-key</SelectItem>
                <SelectItem value="custom">custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.auth_type === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="p-auth-header">Auth Header</Label>
              <Input
                id="p-auth-header"
                value={form.auth_header}
                onChange={(e) => setField("auth_header", e.target.value)}
                placeholder="X-Custom-Key"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Capabilities</Label>
            <div className="flex flex-col gap-2">
              {ALL_CAPABILITIES.map((cap) => (
                <div key={cap} className="flex items-center gap-2">
                  <Checkbox
                    id={`cap-${cap}`}
                    checked={form.capabilities.includes(cap)}
                    onCheckedChange={() => toggleCapability(cap)}
                  />
                  <Label htmlFor={`cap-${cap}`} className="font-normal cursor-pointer">
                    {cap}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Validation Steps</Label>
            <p className="text-xs text-muted-foreground">
              Steps run sequentially to validate discovered keys
            </p>

            {form.validation_steps.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No steps configured. Default: models_fetch only.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {form.validation_steps.map((vs, i) => (
                  <div
                    key={i}
                    className="rounded-md border p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <Select
                        value={vs.step}
                        onValueChange={(v) => changeStepType(i, v as StepType)}
                      >
                        <SelectTrigger className="flex-1 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="models_fetch">models_fetch</SelectItem>
                          <SelectItem value="chat_completion">chat_completion</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === 0}
                        onClick={() => moveStep(i, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === form.validation_steps.length - 1}
                        onClick={() => moveStep(i, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removeStep(i)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {vs.step === "chat_completion" && (
                      <div className="flex flex-col gap-2 pl-1">
                        <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                          <Label className="text-xs">Model</Label>
                          <Input
                            className="h-7 text-xs"
                            placeholder="auto"
                            value={vs.model}
                            onChange={(e) => updateStep(i, { model: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                          <Label className="text-xs">Message</Label>
                          <Input
                            className="h-7 text-xs"
                            value={vs.message}
                            onChange={(e) => updateStep(i, { message: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                          <Label className="text-xs">Max Tokens</Label>
                          <Input
                            type="number"
                            className="h-7 text-xs"
                            value={vs.max_tokens}
                            onChange={(e) =>
                              updateStep(i, { max_tokens: parseInt(e.target.value) || 0 })
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={addStep}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Step
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="p-enabled"
              checked={form.enabled}
              onCheckedChange={(v) => setField("enabled", v)}
            />
            <Label htmlFor="p-enabled" className="font-normal cursor-pointer">
              Enabled
            </Label>
          </div>
        </div>

        <div className="mt-auto flex gap-2 pt-6">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button className="flex-1" onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ProvidersPage() {
  const [filter, setFilter] = useState<FilterTab>("all")
  const [editOpen, setEditOpen] = useState(false)
  const [editProvider, setEditProvider] = useState<Provider | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null)

  const { data: providers, isLoading } = useProviders()
  const updateProvider = useUpdateProvider()
  const deleteProvider = useDeleteProvider()

  const filtered = useMemo(() => {
    if (!providers) return []
    if (filter === "builtin") return providers.filter((p) => p.is_builtin)
    if (filter === "custom") return providers.filter((p) => !p.is_builtin)
    return providers
  }, [providers, filter])

  function openCreate() {
    setEditProvider(null)
    setEditOpen(true)
  }

  function openEdit(p: Provider) {
    setEditProvider(p)
    setEditOpen(true)
  }

  function handleToggleEnabled(p: Provider, enabled: boolean) {
    const caps = parseCapabilities(p.capabilities)
    updateProvider.mutate(
      {
        name: p.name,
        data: {
          name: p.name,
          display_name: p.display_name,
          base_url: p.base_url,
          models_url: p.models_url,
          api_standard: p.api_standard,
          auth_type: p.auth_type,
          auth_header: p.auth_header,
          capabilities: caps,
          enabled,
        },
      },
      {
        onError: (err) => toast.error(`Toggle failed: ${err.message}`),
      },
    )
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteProvider.mutate(deleteTarget.name, {
      onSuccess: () => {
        toast.success(`Deleted provider "${deleteTarget.display_name}"`)
        setDeleteTarget(null)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Providers"
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Add Custom
          </Button>
        }
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="builtin">Built-in</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {providers?.length === 0
              ? "No providers configured."
              : "No providers match the current filter."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <ProviderCard
              key={p.name}
              provider={p}
              onEdit={() => openEdit(p)}
              onDelete={() => setDeleteTarget(p)}
              onToggleEnabled={(enabled) => handleToggleEnabled(p, enabled)}
            />
          ))}
        </div>
      )}

      <ProviderSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        provider={editProvider}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete Provider"
        description={`Are you sure you want to delete "${deleteTarget?.display_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteProvider.isPending}
      />
    </div>
  )
}

export const Route = createFileRoute("/_authenticated/providers")({
  component: ProvidersPage,
})
