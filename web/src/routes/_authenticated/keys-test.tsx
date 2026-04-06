import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { api, type KeyTestResult, type ChatTestResult } from "@/lib/api"
import { categorizeModels } from "@/lib/known-models"
import { useProviders } from "@/hooks/use-providers"
import { PageHeader } from "@/core/layout/page-header"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/core/components/ui/card"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Textarea } from "@/core/components/ui/textarea"
import { Separator } from "@/core/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/components/ui/select"

function KeysTestPage() {
  const { data: providers } = useProviders()

  const [provider, setProvider] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [testResult, setTestResult] = useState<KeyTestResult | null>(null)
  const [testLoading, setTestLoading] = useState(false)

  const [chatModel, setChatModel] = useState("")
  const [chatMessage, setChatMessage] = useState("")
  const [chatResult, setChatResult] = useState<ChatTestResult | null>(null)
  const [chatLoading, setChatLoading] = useState(false)

  const discoveredModels = testResult?.models ?? []
  const categorized = categorizeModels(discoveredModels)

  async function handleTestKey() {
    if (!provider || !apiKey) {
      toast.error("Select a provider and enter an API key.")
      return
    }
    setTestLoading(true)
    setTestResult(null)
    setChatResult(null)
    setChatModel("")
    try {
      const result = await api.keys.test(provider, apiKey)
      setTestResult(result)
    } catch (err: any) {
      toast.error(err?.message ?? "Test request failed.")
    } finally {
      setTestLoading(false)
    }
  }

  async function handleChatTest() {
    if (!chatModel || !chatMessage) {
      toast.error("Select a model and enter a message.")
      return
    }
    setChatLoading(true)
    setChatResult(null)
    try {
      const result = await api.keys.chatTest(provider, apiKey, chatModel, chatMessage)
      setChatResult(result)
    } catch (err: any) {
      toast.error(err?.message ?? "Chat test failed.")
    } finally {
      setChatLoading(false)
    }
  }

  const chatResponseText: string | null = (() => {
    if (!chatResult?.response) return null
    const r = chatResult.response
    try {
      return (
        r?.choices?.[0]?.message?.content ??
        r?.content?.[0]?.text ??
        r?.candidates?.[0]?.content?.parts?.[0]?.text ??
        JSON.stringify(r, null, 2)
      )
    } catch {
      return String(r)
    }
  })()

  const promptTokens: number | null =
    chatResult?.response?.usage?.prompt_tokens ??
    chatResult?.response?.usage?.input_tokens ??
    null

  const completionTokens: number | null =
    chatResult?.response?.usage?.completion_tokens ??
    chatResult?.response?.usage?.output_tokens ??
    null

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Keys Test" />

      {/* Section 1: Key Testing */}
      <Card>
        <CardHeader>
          <CardTitle>Key Testing</CardTitle>
          <CardDescription>
            Validate an API key against a provider and inspect rate limit headers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider…" />
                </SelectTrigger>
                <SelectContent>
                  {(providers ?? []).map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="sk-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>
          </div>

          <Button
            onClick={handleTestKey}
            disabled={testLoading || !provider || !apiKey.trim()}
          >
            {testLoading ? "Testing…" : "Test Key"}
          </Button>

          {testResult && (
            <>
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Badge variant={testResult.valid ? "default" : "destructive"}>
                    {testResult.valid ? "Valid" : "Invalid"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    HTTP {testResult.status_code}
                  </span>
                </div>

                {testResult.error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {testResult.error}
                  </p>
                )}

                {testResult.rate_limits && Object.keys(testResult.rate_limits).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Rate Limit Headers</p>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(testResult.rate_limits).map(([k, v]) => (
                            <tr key={k} className="border-b last:border-0">
                              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                {k}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {discoveredModels.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">
                      Discovered Models ({discoveredModels.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {discoveredModels.map((m) => (
                        <Badge key={m} variant="secondary" className="text-xs">
                          {m}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Model Discovery */}
      {discoveredModels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Model Discovery</CardTitle>
            <CardDescription>
              Models returned by the provider, categorized by type.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {categorized.chat.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">Chat</p>
                <div className="flex flex-wrap gap-1">
                  {categorized.chat.map((m) => (
                    <Badge key={m} variant="outline" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {categorized.embedding.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">Embedding</p>
                <div className="flex flex-wrap gap-1">
                  {categorized.embedding.map((m) => (
                    <Badge key={m} variant="secondary" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Section 3: Chat Test */}
      <Card>
        <CardHeader>
          <CardTitle>Chat Test</CardTitle>
          <CardDescription>
            Send a message using a discovered model to verify the key works end-to-end.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Model</Label>
            {categorized.chat.length > 0 ? (
              <Select value={chatModel} onValueChange={setChatModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select model…" />
                </SelectTrigger>
                <SelectContent>
                  {categorized.chat.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="e.g. gpt-4o"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              placeholder="Say hello…"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              rows={3}
            />
          </div>

          <Button onClick={handleChatTest} disabled={chatLoading || !provider || !apiKey}>
            {chatLoading ? "Sending…" : "Send"}
          </Button>

          {chatResult && (
            <>
              <Separator />

              {chatResult.error ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {chatResult.error}
                </p>
              ) : (
                <div className="space-y-3">
                  <Card className="bg-muted/40">
                    <CardContent className="pt-4">
                      <p className="whitespace-pre-wrap text-sm">{chatResponseText}</p>
                    </CardContent>
                  </Card>

                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span>HTTP {chatResult.status_code}</span>
                    {promptTokens !== null && (
                      <span>Prompt tokens: {promptTokens}</span>
                    )}
                    {completionTokens !== null && (
                      <span>Completion tokens: {completionTokens}</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export const Route = createFileRoute("/_authenticated/keys-test")({
  component: KeysTestPage,
})
