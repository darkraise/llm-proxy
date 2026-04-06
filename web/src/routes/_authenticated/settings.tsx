import { useState, useEffect } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { PageHeader } from "@/core/layout/page-header"
import { Card, CardContent } from "@/core/components/ui/card"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Button } from "@/core/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/components/ui/select"
import { Switch } from "@/core/components/ui/switch"
import { Textarea } from "@/core/components/ui/textarea"
import { Badge } from "@/core/components/ui/badge"
import { FormSection } from "@/features/forms"
import { useSettings, useUpdateSettings, useTestNotification } from "@/hooks/use-settings"
import { DATE_FORMAT_PRESETS } from "@/lib/dateformat"
import { api } from "@/lib/api"

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const testNotification = useTestNotification()

  // General section
  const [timeout, setTimeout] = useState("30")
  const [retries, setRetries] = useState("3")
  const [retention, setRetention] = useState("30")
  const [dateFormat, setDateFormat] = useState("compact")

  // Proxy auth section
  const [proxyToken, setProxyToken] = useState("")

  // Ollama section
  const [ollamaAutoDiscover, setOllamaAutoDiscover] = useState(false)
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434")

  // Import/Export section
  const [configImportYaml, setConfigImportYaml] = useState("")
  const [configImportResult, setConfigImportResult] = useState<string | null>(null)
  const [settingsImportYaml, setSettingsImportYaml] = useState("")
  const [settingsImportResult, setSettingsImportResult] = useState<string | null>(null)

  // Notification test result
  const [notifResult, setNotifResult] = useState<{ success: boolean } | null>(null)

  useEffect(() => {
    if (!settings) return
    setTimeout(settings.request_timeout_secs ?? "30")
    setRetries(settings.max_retries ?? "3")
    setRetention(settings.log_retention_days ?? "30")
    setDateFormat(settings.datetime_format ?? "compact")
    setProxyToken(settings.proxy_token ?? "")
    setOllamaAutoDiscover(settings.ollama_auto_discover === "true")
    setOllamaUrl(settings.ollama_url ?? "http://localhost:11434")
  }, [settings])

  const handleSaveGeneral = async () => {
    await updateSettings.mutateAsync({
      request_timeout_secs: timeout,
      max_retries: retries,
      log_retention_days: retention,
      datetime_format: dateFormat,
    })
    toast.success("General settings saved")
  }

  const handleSaveProxyAuth = async () => {
    await updateSettings.mutateAsync({ proxy_token: proxyToken })
    toast.success("Proxy token saved")
  }

  const handleSaveOllama = async () => {
    await updateSettings.mutateAsync({
      ollama_auto_discover: ollamaAutoDiscover ? "true" : "false",
      ollama_url: ollamaUrl,
    })
    toast.success("Ollama settings saved")
  }

  const handleTestNotification = async () => {
    const result = await testNotification.mutateAsync()
    setNotifResult(result)
    if (result.success) {
      toast.success("Test notification sent")
    } else {
      toast.error(result.error ?? "Notification test failed")
    }
  }

  const handleConfigImport = async () => {
    try {
      const result = await api.config.import(configImportYaml)
      setConfigImportResult(`Imported ${result.imported} account(s)`)
      toast.success(`Imported ${result.imported} account(s)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed"
      setConfigImportResult(`Error: ${msg}`)
      toast.error(msg)
    }
  }

  const handleSettingsImport = async () => {
    try {
      const result = await api.settingsConfig.import(settingsImportYaml)
      setSettingsImportResult(result.status)
      toast.success("Settings imported")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed"
      setSettingsImportResult(`Error: ${msg}`)
      toast.error(msg)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      {/* General */}
      <Card>
        <CardContent className="pt-6">
          <FormSection title="General" description="Basic proxy configuration">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="request_timeout_secs">Request Timeout (seconds)</Label>
                <Input
                  id="request_timeout_secs"
                  type="number"
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max_retries">Max Retries</Label>
                <Input
                  id="max_retries"
                  type="number"
                  value={retries}
                  onChange={(e) => setRetries(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="log_retention_days">Log Retention (days)</Label>
                <Input
                  id="log_retention_days"
                  type="number"
                  value={retention}
                  onChange={(e) => setRetention(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="datetime_format">Date/Time Format</Label>
                <Select value={dateFormat} onValueChange={setDateFormat}>
                  <SelectTrigger id="datetime_format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_FORMAT_PRESETS.map((preset) => (
                      <SelectItem key={preset.key} value={preset.key}>
                        {preset.label} — {preset.example}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="pt-2">
              <Button
                onClick={handleSaveGeneral}
                disabled={updateSettings.isPending}
              >
                Save General
              </Button>
            </div>
          </FormSection>
        </CardContent>
      </Card>

      {/* Proxy Authentication */}
      <Card>
        <CardContent className="pt-6">
          <FormSection title="Proxy Authentication" description="Token required for proxy API access">
            <div className="space-y-1.5">
              <Label htmlFor="proxy_token">Proxy Token</Label>
              <Input
                id="proxy_token"
                type="password"
                value={proxyToken}
                onChange={(e) => setProxyToken(e.target.value)}
                placeholder="Leave empty to disable authentication"
              />
            </div>
            <div className="pt-2">
              <Button
                onClick={handleSaveProxyAuth}
                disabled={updateSettings.isPending}
              >
                Save Proxy Token
              </Button>
            </div>
          </FormSection>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardContent className="pt-6">
          <FormSection title="Notifications" description="Alert configuration">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleTestNotification}
                disabled={testNotification.isPending}
              >
                Test Notification
              </Button>
              {notifResult !== null && (
                <Badge variant={notifResult.success ? "default" : "destructive"}>
                  {notifResult.success ? "Success" : "Failed"}
                </Badge>
              )}
            </div>
          </FormSection>
        </CardContent>
      </Card>

      {/* Ollama */}
      <Card>
        <CardContent className="pt-6">
          <FormSection title="Ollama" description="Local model fallback">
            <div className="flex items-center gap-3">
              <Switch
                id="ollama_auto_discover"
                checked={ollamaAutoDiscover}
                onCheckedChange={setOllamaAutoDiscover}
              />
              <Label htmlFor="ollama_auto_discover">Auto-discover</Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ollama_url">Ollama URL</Label>
              <Input
                id="ollama_url"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
            </div>
            <div className="pt-2">
              <Button
                onClick={handleSaveOllama}
                disabled={updateSettings.isPending}
              >
                Save Ollama
              </Button>
            </div>
          </FormSection>
        </CardContent>
      </Card>

      {/* Import / Export */}
      <Card>
        <CardContent className="pt-6">
          <FormSection title="Import / Export" description="Configuration backup and restore">
            <div className="space-y-6">
              {/* Config export/import */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Config (Accounts)</h4>
                <Button
                  variant="outline"
                  onClick={() => window.open(api.config.exportUrl(), "_blank")}
                >
                  Export Config
                </Button>
                <div className="space-y-1.5">
                  <Label htmlFor="config_import_yaml">Import Config (YAML)</Label>
                  <Textarea
                    id="config_import_yaml"
                    value={configImportYaml}
                    onChange={(e) => setConfigImportYaml(e.target.value)}
                    placeholder="Paste YAML here…"
                    rows={6}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleConfigImport}
                    disabled={!configImportYaml.trim()}
                  >
                    Import Config
                  </Button>
                  {configImportResult && (
                    <span className="text-sm text-muted-foreground">{configImportResult}</span>
                  )}
                </div>
              </div>

              <div className="border-t pt-6 space-y-3">
                <h4 className="text-sm font-medium">Settings</h4>
                <Button
                  variant="outline"
                  onClick={() => window.open(api.settingsConfig.exportUrl(), "_blank")}
                >
                  Export Settings
                </Button>
                <div className="space-y-1.5">
                  <Label htmlFor="settings_import_yaml">Import Settings (YAML)</Label>
                  <Textarea
                    id="settings_import_yaml"
                    value={settingsImportYaml}
                    onChange={(e) => setSettingsImportYaml(e.target.value)}
                    placeholder="Paste YAML here…"
                    rows={6}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSettingsImport}
                    disabled={!settingsImportYaml.trim()}
                  >
                    Import Settings
                  </Button>
                  {settingsImportResult && (
                    <span className="text-sm text-muted-foreground">{settingsImportResult}</span>
                  )}
                </div>
              </div>
            </div>
          </FormSection>
        </CardContent>
      </Card>
    </div>
  )
}
