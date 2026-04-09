# Validation Steps Editor — Design Spec

## Goal

Add a validation steps editor to the provider edit form (ProviderSheet) so users can configure which steps run when the scanner validates a discovered key, without needing direct API calls.

## Background

The backend already supports per-provider validation steps stored as a JSON string in the `validation_steps` column of the `providers` table. The `keyval.Validate` pipeline runs these steps sequentially when validating scanned keys. Two step types exist in the registry:

- **`models_fetch`** — calls the provider's models endpoint to verify the key is valid. No params.
- **`chat_completion`** — sends a minimal chat completion request. Params: `model` (string, defaults to first model from prior step), `message` (string, default "say ok"), `max_tokens` (number, default 5).

If no steps are configured, the pipeline defaults to `[{"step":"models_fetch"}]`.

The backend API already accepts `validation_steps` on both `POST /api/providers` and `PATCH /api/providers/:name`, including for builtin providers. The frontend simply never sends the field.

## Scope

Frontend-only change. No backend modifications needed.

### In Scope

- Add validation steps editor section to `ProviderSheet` in `providers.tsx`
- Parse existing `validation_steps` JSON from `Provider` into form state
- Serialize form state back to JSON and include in save payload
- Support adding, removing, and reordering steps
- Show contextual param fields based on step type
- Editable for both builtin and custom providers

### Out of Scope

- Adding new step types to the backend registry
- Free-form/custom step type names (only `models_fetch` and `chat_completion`)
- Drag-and-drop reordering (use up/down buttons instead)

## UI Design

### Location

The "Validation Steps" section appears in the ProviderSheet after the Capabilities checkboxes and before the Enabled toggle.

### Layout

```
Validation Steps
  Steps run sequentially to validate discovered keys

  ┌─────────────────────────────────────────────────┐
  │ [models_fetch ▼]                    [↑] [↓] [✕] │
  └─────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────┐
  │ [chat_completion ▼]                 [↑] [↓] [✕] │
  │  Model     [glm-4.5                           ] │
  │  Message   [say ok                            ] │
  │  Max Tokens [5                                ] │
  └─────────────────────────────────────────────────┘

  [+ Add Step]
```

### Step Card Behavior

Each step is rendered as a bordered card containing:

1. **Step type selector** — a `<Select>` dropdown with options `models_fetch` and `chat_completion`.
2. **Action buttons** — move up, move down, and remove. Up is disabled on the first step; down is disabled on the last.
3. **Param fields** (conditional on step type):
   - `models_fetch`: no additional fields.
   - `chat_completion`: three fields:
     - **Model** — text input, placeholder "auto" (uses first model from prior step if empty)
     - **Message** — text input, default value "say ok"
     - **Max Tokens** — number input, default value 5

### Add Step

The "Add Step" button appends a new `models_fetch` step (the simpler type, no params needed).

### Empty State

When the list is empty, show a muted text: "No steps configured. Default: models_fetch only." This communicates that the backend still validates with `models_fetch` even when the list is empty.

### Changing Step Type

When the user changes a step's type via the dropdown:
- Switching to `models_fetch`: clear any params from the step.
- Switching to `chat_completion`: initialize with default params (`model: ""`, `message: "say ok"`, `max_tokens: 5`).

## Data Flow

### Form State

Add to `FormState`:

```typescript
interface ValidationStepForm {
  step: "models_fetch" | "chat_completion"
  model: string      // chat_completion only
  message: string    // chat_completion only
  max_tokens: number // chat_completion only
}

// Added to FormState:
validation_steps: ValidationStepForm[]
```

### Parsing (Provider -> Form)

`providerToForm` parses the provider's `validation_steps` JSON string into `ValidationStepForm[]`. Each step is mapped: `models_fetch` gets empty param fields, `chat_completion` extracts `model`, `message`, `max_tokens` from `params` with defaults.

### Serialization (Form -> API Payload)

`handleSave` converts `ValidationStepForm[]` back to the API format: `[{"step":"models_fetch"}, {"step":"chat_completion","params":{"model":"glm-4.5","message":"say ok","max_tokens":5}}]`. For `models_fetch`, omit `params`. For `chat_completion`, include only non-default params (or include all — either is fine since the backend handles defaults).

The serialized JSON is sent as the `validation_steps` field in the save payload.

### Existing API Types

`ProviderInput` in `api.ts` already has `validation_steps?: ValidationStep[]` where `ValidationStep` is `{step: string, params?: Record<string, any>}`. The hook `useUpdateProvider` already sends `Partial<ProviderInput>`, so no API type changes are needed.

## Components

All changes are contained within `providers.tsx`:

- **`FormState`** — add `validation_steps: ValidationStepForm[]`
- **`emptyForm()`** — default to empty array
- **`providerToForm()`** — parse JSON string into typed form state
- **`handleSave()`** — serialize and include in payload
- **Inline JSX** — render the step list between Capabilities and Enabled toggle

No new files. The step list UI is small enough to be inline JSX in `ProviderSheet`, following the existing pattern of the capabilities checkboxes section.
