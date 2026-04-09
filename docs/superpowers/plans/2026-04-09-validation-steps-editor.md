# Validation Steps Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validation steps editor to the provider edit sheet so users can configure scanner key validation steps from the UI.

**Architecture:** Single-file frontend change to `providers.tsx`. Extends `FormState` with a `validation_steps` array, adds parsing/serialization helpers, and renders an inline step list editor between the Capabilities section and the Enabled toggle. No backend changes needed — the API already accepts `validation_steps`.

**Tech Stack:** React 19, TypeScript, Radix UI (Select), lucide-react icons, TailwindCSS 4

**Spec:** `docs/superpowers/specs/2026-04-09-validation-steps-editor-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `web/src/routes/_authenticated/providers.tsx` | Add `ValidationStepForm` type, extend `FormState`, add parsing/serialization, render step list editor in `ProviderSheet` |

---

### Task 1: Add types, parsing, and serialization

Extends the form state model with validation steps and wires parsing/serialization so the data round-trips through the form correctly.

**Files:**
- Modify: `web/src/routes/_authenticated/providers.tsx`

- [ ] **Step 1: Add the `ValidationStepForm` interface and extend `FormState`**

After the existing `FormState` interface (line 51), add the new type. Then add the field to `FormState`:

```typescript
type StepType = "models_fetch" | "chat_completion"

interface ValidationStepForm {
  step: StepType
  model: string
  message: string
  max_tokens: number
}
```

Add to the `FormState` interface:

```typescript
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
```

- [ ] **Step 2: Update `emptyForm` to include empty validation_steps**

```typescript
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
```

- [ ] **Step 3: Add `parseValidationSteps` helper and update `providerToForm`**

Add the parser function before `providerToForm`:

```typescript
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
```

Update `providerToForm` to include the new field:

```typescript
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
```

- [ ] **Step 4: Add `serializeValidationSteps` helper**

Add after `parseValidationSteps`:

```typescript
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
```

This needs the `ValidationStep` import. Add it to the import from `@/lib/api`:

```typescript
import type { Provider, ValidationStep } from "@/lib/api"
```

- [ ] **Step 5: Update `handleSave` to include `validation_steps` in the payload**

In the `handleSave` function inside `ProviderSheet`, update the `payload` object:

```typescript
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
```

The rest of `handleSave` stays unchanged.

- [ ] **Step 6: Verify the app compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add web/src/routes/_authenticated/providers.tsx
git commit -m "feat(web): add validation steps form state, parsing, and serialization"
```

---

### Task 2: Add the validation steps editor UI

Renders the step list editor inside `ProviderSheet` with add, remove, reorder, and per-step param fields.

**Files:**
- Modify: `web/src/routes/_authenticated/providers.tsx`

- [ ] **Step 1: Add new icon imports**

Update the lucide-react import at the top of the file:

```typescript
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, X } from "lucide-react"
```

- [ ] **Step 2: Add step manipulation helpers inside `ProviderSheet`**

Inside the `ProviderSheet` function component, after the existing `toggleCapability` function, add:

```typescript
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
```

- [ ] **Step 3: Add the validation steps section JSX**

In the `ProviderSheet` return JSX, find the closing `</div>` of the Capabilities section (after the `ALL_CAPABILITIES.map` block, around line 356). Insert the following section BETWEEN the Capabilities `</div>` and the Enabled toggle `<div>`:

```tsx
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
                              updateStep(i, { max_tokens: parseInt(e.target.value) || 5 })
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
```

- [ ] **Step 4: Verify the dev server renders correctly**

Run: `cd web && npm run dev`

Open the browser, go to the Providers page, click Edit on any provider (e.g. Zhipu or DeepSeek which have validation steps configured). Verify:
1. The "Validation Steps" section appears between Capabilities and Enabled
2. Existing steps are rendered (Zhipu should show `models_fetch` + `chat_completion` with model `glm-4.5`)
3. The step type dropdown works
4. Up/down/remove buttons work
5. Param fields appear when step type is `chat_completion`
6. "Add Step" adds a new `models_fetch` step
7. Save persists changes (edit, reload, verify)

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd web && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/_authenticated/providers.tsx
git commit -m "feat(web): add validation steps editor UI to provider sheet"
```
