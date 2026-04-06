import { useState, useEffect } from "react"
import { toast } from "sonner"
import type { Account, AccountInput } from "@/lib/api"
import { parseCategorizedModels, flattenModels, parseDefaultModels } from "@/lib/api"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/core/components/ui/sheet"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Switch } from "@/core/components/ui/switch"
import { Separator } from "@/core/components/ui/separator"
import { Badge } from "@/core/components/ui/badge"
import { ScrollArea } from "@/core/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/components/ui/select"
import { useProviders } from "@/hooks/use-providers"
import {
  useCreateAccount,
  useUpdateAccount,
  useDeleteAccount,
  useGetAccountKey,
  useDiscoverAccountModelsById,
} from "@/hooks/use-accounts"
import { ConfirmDialog } from "./confirm-dialog"
import { AddModelsDialog } from "./add-models-dialog"

interface AccountDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account | null
  onSaved: () => void
}

export function AccountDrawer({
  open,
  onOpenChange,
  account,
  onSaved,
}: AccountDrawerProps) {
  const isEdit = account !== null
  const { data: providers } = useProviders()
  const createAccount = useCreateAccount()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount()
  const getKey = useGetAccountKey()
  const discoverModels = useDiscoverAccountModelsById()

  const [providerType, setProviderType] = useState("")
  const [name, setName] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState("")
  const [models, setModels] = useState<Record<string, string[]>>({})
  const [enabled, setEnabled] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addModelsOpen, setAddModelsOpen] = useState(false)
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    if (account) {
      setProviderType(account.type)
      setName(account.name)
      setApiKey("")
      setShowKey(false)
      setBaseUrl(account.base_url)
      setModels(parseCategorizedModels(account.models))
      setEnabled(account.enabled)
      setDiscoveredModels([])
    } else {
      setProviderType("")
      setName("")
      setApiKey("")
      setShowKey(false)
      setBaseUrl("")
      setModels({})
      setEnabled(true)
      setDiscoveredModels([])
    }
  }, [open, account])

  useEffect(() => {
    if (!providerType || isEdit) return
    const provider = providers?.find((p) => p.name === providerType)
    if (provider?.base_url) {
      setBaseUrl(provider.base_url)
    }
  }, [providerType, providers, isEdit])

  function handleShowKey() {
    if (!account) return
    getKey.mutate(account.id, {
      onSuccess: (res) => {
        setApiKey(res.key)
        setShowKey(true)
      },
      onError: (err) => toast.error(`Failed to fetch key: ${err.message}`),
    })
  }

  function handleDiscover() {
    if (!account) return
    discoverModels.mutate(account.id, {
      onSuccess: (res) => {
        const discovered = res.models.map((m) => m.id)
        setDiscoveredModels(discovered)
        setAddModelsOpen(true)
      },
      onError: (err) => toast.error(`Discovery failed: ${err.message}`),
    })
  }

  function handleRemoveModel(model: string) {
    setModels((prev) => {
      const next: Record<string, string[]> = {}
      for (const [cat, list] of Object.entries(prev)) {
        const filtered = list.filter((m) => m !== model)
        if (filtered.length > 0) next[cat] = filtered
      }
      return next
    })
  }

  function handleSave() {
    const defaultModels: Record<string, string> = {}
    if (isEdit) {
      const existing = parseDefaultModels(account.default_models)
      for (const [cat, list] of Object.entries(models)) {
        if (list.length > 0) {
          defaultModels[cat] = existing[cat] && list.includes(existing[cat])
            ? existing[cat]
            : list[0]
        }
      }
    } else {
      for (const [cat, list] of Object.entries(models)) {
        if (list.length > 0) defaultModels[cat] = list[0]
      }
    }

    const payload: AccountInput = {
      name,
      type: providerType,
      base_url: baseUrl,
      api_key: apiKey,
      models,
      priority: account?.priority ?? 0,
      enabled,
      default_models: defaultModels,
      limits: account?.limits ?? [],
    }

    if (isEdit) {
      updateAccount.mutate(
        { id: account.id, data: payload },
        {
          onSuccess: () => {
            toast.success("Account updated")
            onSaved()
            onOpenChange(false)
          },
          onError: (err) => toast.error(`Update failed: ${err.message}`),
        },
      )
    } else {
      createAccount.mutate(payload, {
        onSuccess: () => {
          toast.success("Account created")
          onSaved()
          onOpenChange(false)
        },
        onError: (err) => toast.error(`Create failed: ${err.message}`),
      })
    }
  }

  function handleDelete() {
    if (!account) return
    deleteAccount.mutate(account.id, {
      onSuccess: () => {
        toast.success("Account deleted")
        setDeleteOpen(false)
        onSaved()
        onOpenChange(false)
      },
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    })
  }

  const saving = createAccount.isPending || updateAccount.isPending
  const allModels = flattenModels(models)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{isEdit ? "Edit Account" : "New Account"}</SheetTitle>
            <SheetDescription>
              {isEdit
                ? "Update account configuration"
                : "Configure a new provider account"}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-5 pb-6">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={providerType}
                  onValueChange={setProviderType}
                  disabled={isEdit}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {(providers ?? [])
                      .filter((p) => p.enabled)
                      .map((p) => (
                        <SelectItem key={p.name} value={p.name}>
                          {p.display_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Account Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My OpenAI Key"
                />
              </div>

              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex gap-2">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={isEdit ? "Leave blank to keep current" : "sk-..."}
                  />
                  {isEdit && !showKey && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={handleShowKey}
                      disabled={getKey.isPending}
                    >
                      {getKey.isPending ? "..." : "Show"}
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Base URL</Label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Models ({allModels.length})</Label>
                  <div className="flex gap-1">
                    {isEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDiscover}
                        disabled={discoverModels.isPending}
                      >
                        {discoverModels.isPending ? "Discovering..." : "Discover"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAddModelsOpen(true)}
                    >
                      Add Models
                    </Button>
                  </div>
                </div>
                {allModels.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {allModels.map((m) => (
                      <Badge
                        key={m}
                        variant="secondary"
                        className="cursor-pointer gap-1"
                        onClick={() => handleRemoveModel(m)}
                      >
                        {m}
                        <span className="text-muted-foreground/70">&times;</span>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No models configured
                  </p>
                )}
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>
            </div>
          </ScrollArea>

          <Separator />

          <div className="flex items-center gap-2 pt-4">
            {isEdit && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !name || !providerType}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Account"
        description={`Are you sure you want to delete "${account?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteAccount.isPending}
      />

      <AddModelsDialog
        open={addModelsOpen}
        onOpenChange={setAddModelsOpen}
        availableModels={
          discoveredModels.length > 0
            ? discoveredModels
            : allModels
        }
        selectedModels={models}
        onSave={setModels}
      />
    </>
  )
}
