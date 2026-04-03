# Auto Rate Limit Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically discover rate limits from provider API response headers and propagate them into account-level enforcement, filling gaps where no manual limit is configured.

**Architecture:** Expand the header parser to cover 9 additional providers plus a generic OpenAI-compatible fallback. After writing discovered limits to `rate_limit_definitions`, a new store method checks each matching account for missing limits and inserts them. When any account is modified, the pool reloads to pick up the new limits. A dedup check prevents redundant writes and reloads.

**Tech Stack:** Go, SQLite (modernc.org/sqlite), net/http

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `internal/ratelimit/headers.go` | Modify | Expand provider mappings, add generic fallback |
| `internal/ratelimit/headers_test.go` | Modify | Tests for new providers and fallback |
| `internal/store/ratelimit_def.go` | Modify | Add `FillAccountLimitsFromDiscovered` method |
| `internal/store/ratelimit_def_test.go` | Modify | Tests for gap-filling logic |
| `internal/server/server.go` | Modify | Store encryption key on struct, update `rateLimitWriter` to propagate limits and reload pool |

---

### Task 1: Expand Header Mappings

**Files:**
- Modify: `internal/ratelimit/headers.go:20-29`
- Modify: `internal/ratelimit/headers_test.go`

- [ ] **Step 1: Write failing tests for new provider header parsing**

Add test cases for OpenAI, Anthropic, xAI, Together, Fireworks, DeepSeek, and OpenRouter to `internal/ratelimit/headers_test.go`:

```go
func TestParseRateLimitHeaders_OpenAI(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "500")
	headers.Set("x-ratelimit-limit-tokens", "200000")

	defs := ratelimit.ParseRateLimitHeaders("openai", headers, "gpt-4o")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	byWindow := map[string]int{}
	for _, d := range defs {
		if d.Provider != "openai" {
			t.Errorf("expected provider openai, got %s", d.Provider)
		}
		if d.Model != "gpt-4o" {
			t.Errorf("expected model gpt-4o, got %s", d.Model)
		}
		byMetric[d.Metric] = d.MaxValue
		byWindow[d.Metric] = d.WindowSecs
	}

	if byMetric["rpm"] != 500 {
		t.Errorf("rpm: expected 500, got %d", byMetric["rpm"])
	}
	if byMetric["tpm"] != 200000 {
		t.Errorf("tpm: expected 200000, got %d", byMetric["tpm"])
	}
	if byWindow["rpm"] != 60 {
		t.Errorf("rpm window: expected 60, got %d", byWindow["rpm"])
	}
	if byWindow["tpm"] != 60 {
		t.Errorf("tpm window: expected 60, got %d", byWindow["tpm"])
	}
}

func TestParseRateLimitHeaders_Anthropic(t *testing.T) {
	headers := http.Header{}
	headers.Set("anthropic-ratelimit-requests-limit", "1000")
	headers.Set("anthropic-ratelimit-tokens-limit", "80000")

	defs := ratelimit.ParseRateLimitHeaders("anthropic", headers, "claude-sonnet-4-20250514")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	for _, d := range defs {
		if d.Provider != "anthropic" {
			t.Errorf("expected provider anthropic, got %s", d.Provider)
		}
		byMetric[d.Metric] = d.MaxValue
	}

	if byMetric["rpm"] != 1000 {
		t.Errorf("rpm: expected 1000, got %d", byMetric["rpm"])
	}
	if byMetric["tpm"] != 80000 {
		t.Errorf("tpm: expected 80000, got %d", byMetric["tpm"])
	}
}

func TestParseRateLimitHeaders_XAI(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "1200")
	headers.Set("x-ratelimit-limit-tokens", "100000")

	defs := ratelimit.ParseRateLimitHeaders("xai", headers, "grok-2")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	byWindow := map[string]int{}
	for _, d := range defs {
		byMetric[d.Metric] = d.MaxValue
		byWindow[d.Metric] = d.WindowSecs
	}

	if byMetric["rpd"] != 1200 {
		t.Errorf("rpd: expected 1200, got %d", byMetric["rpd"])
	}
	if byMetric["tpm"] != 100000 {
		t.Errorf("tpm: expected 100000, got %d", byMetric["tpm"])
	}
	if byWindow["rpd"] != 86400 {
		t.Errorf("rpd window: expected 86400, got %d", byWindow["rpd"])
	}
}

func TestParseRateLimitHeaders_Together(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit", "60")
	headers.Set("x-tokenlimit-limit", "100000")

	defs := ratelimit.ParseRateLimitHeaders("together", headers, "meta-llama/Llama-3-70b")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	byMetric := map[string]int{}
	byWindow := map[string]int{}
	for _, d := range defs {
		byMetric[d.Metric] = d.MaxValue
		byWindow[d.Metric] = d.WindowSecs
	}

	if byMetric["rps"] != 60 {
		t.Errorf("rps: expected 60, got %d", byMetric["rps"])
	}
	if byMetric["tps"] != 100000 {
		t.Errorf("tps: expected 100000, got %d", byMetric["tps"])
	}
	if byWindow["rps"] != 1 {
		t.Errorf("rps window: expected 1, got %d", byWindow["rps"])
	}
}

func TestParseRateLimitHeaders_Fireworks(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "600")

	defs := ratelimit.ParseRateLimitHeaders("fireworks", headers, "accounts/fireworks/models/llama-v3-70b")

	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}
	if defs[0].Metric != "rpm" {
		t.Errorf("expected rpm, got %s", defs[0].Metric)
	}
	if defs[0].MaxValue != 600 {
		t.Errorf("expected 600, got %d", defs[0].MaxValue)
	}
	if defs[0].WindowSecs != 60 {
		t.Errorf("expected window 60, got %d", defs[0].WindowSecs)
	}
}

func TestParseRateLimitHeaders_DeepSeek(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "60")

	defs := ratelimit.ParseRateLimitHeaders("deepseek", headers, "deepseek-chat")

	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}
	if defs[0].Metric != "rpm" || defs[0].MaxValue != 60 || defs[0].WindowSecs != 60 {
		t.Errorf("unexpected def: %+v", defs[0])
	}
}

func TestParseRateLimitHeaders_OpenRouter(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "200")

	defs := ratelimit.ParseRateLimitHeaders("openrouter", headers, "anthropic/claude-sonnet-4-20250514")

	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}
	if defs[0].Metric != "rpm" || defs[0].MaxValue != 200 || defs[0].WindowSecs != 60 {
		t.Errorf("unexpected def: %+v", defs[0])
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/ratelimit/ -v -run "TestParseRateLimitHeaders_(OpenAI|Anthropic|XAI|Together|Fireworks|DeepSeek|OpenRouter)"`
Expected: FAIL — all new providers return nil because they're not in `ProviderHeaderMappings`.

- [ ] **Step 3: Add new provider mappings to `ProviderHeaderMappings`**

Replace the `ProviderHeaderMappings` variable in `internal/ratelimit/headers.go:20-29` with:

```go
var ProviderHeaderMappings = map[string][]HeaderMapping{
	"openai": {
		{"x-ratelimit-limit-requests", "rpm", 60},
		{"x-ratelimit-limit-tokens", "tpm", 60},
	},
	"openai_legacy": {
		{"x-ratelimit-limit-requests", "rpm", 60},
		{"x-ratelimit-limit-tokens", "tpm", 60},
	},
	"anthropic": {
		{"anthropic-ratelimit-requests-limit", "rpm", 60},
		{"anthropic-ratelimit-tokens-limit", "tpm", 60},
	},
	"groq": {
		{"x-ratelimit-limit-requests", "rpd", 86400},
		{"x-ratelimit-limit-tokens", "tpm", 60},
	},
	"cerebras": {
		{"x-ratelimit-limit-requests-day", "rpd", 86400},
		{"x-ratelimit-limit-tokens-minute", "tpm", 60},
	},
	"xai": {
		{"x-ratelimit-limit-requests", "rpd", 86400},
		{"x-ratelimit-limit-tokens", "tpm", 60},
	},
	"together": {
		{"x-ratelimit-limit", "rps", 1},
		{"x-tokenlimit-limit", "tps", 1},
	},
	"fireworks": {
		{"x-ratelimit-limit-requests", "rpm", 60},
	},
	"deepseek": {
		{"x-ratelimit-limit-requests", "rpm", 60},
	},
	"openrouter": {
		{"x-ratelimit-limit-requests", "rpm", 60},
	},
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/ratelimit/ -v`
Expected: ALL PASS including existing Groq/Cerebras tests and all new provider tests.

- [ ] **Step 5: Commit**

```bash
git add internal/ratelimit/headers.go internal/ratelimit/headers_test.go
git commit -m "feat(ratelimit): add header mappings for OpenAI, Anthropic, xAI, Together, Fireworks, DeepSeek, OpenRouter"
```

---

### Task 2: Add Generic Fallback Parser

**Files:**
- Modify: `internal/ratelimit/headers.go:34-59`
- Modify: `internal/ratelimit/headers_test.go`

- [ ] **Step 1: Write failing tests for fallback behavior**

Add to `internal/ratelimit/headers_test.go`:

```go
func TestParseRateLimitHeaders_GenericFallback(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "100")
	headers.Set("x-ratelimit-limit-tokens", "50000")

	defs := ratelimit.ParseRateLimitHeaders("nvidia", headers, "meta/llama-3.1-70b")

	if len(defs) != 2 {
		t.Fatalf("expected 2 defs from generic fallback, got %d", len(defs))
	}

	byMetric := map[string]int{}
	byWindow := map[string]int{}
	for _, d := range defs {
		if d.Provider != "nvidia" {
			t.Errorf("expected provider nvidia, got %s", d.Provider)
		}
		byMetric[d.Metric] = d.MaxValue
		byWindow[d.Metric] = d.WindowSecs
	}

	if byMetric["rpm"] != 100 {
		t.Errorf("rpm: expected 100, got %d", byMetric["rpm"])
	}
	if byMetric["tpm"] != 50000 {
		t.Errorf("tpm: expected 50000, got %d", byMetric["tpm"])
	}
	if byWindow["rpm"] != 60 {
		t.Errorf("rpm window: expected 60, got %d", byWindow["rpm"])
	}
}

func TestParseRateLimitHeaders_GenericFallbackNoHeaders(t *testing.T) {
	headers := http.Header{}
	headers.Set("content-type", "application/json")

	defs := ratelimit.ParseRateLimitHeaders("nvidia", headers, "some-model")
	if len(defs) != 0 {
		t.Errorf("expected 0 defs when no rate limit headers present, got %d", len(defs))
	}
}

func TestParseRateLimitHeaders_ExplicitOverridesFallback(t *testing.T) {
	headers := http.Header{}
	headers.Set("x-ratelimit-limit-requests", "14400")
	headers.Set("x-ratelimit-limit-tokens", "6000")

	// Groq has explicit mapping where x-ratelimit-limit-requests is rpd (not rpm).
	// Verify the explicit mapping takes priority over generic fallback.
	defs := ratelimit.ParseRateLimitHeaders("groq", headers, "llama-3.3-70b")

	byMetric := map[string]int{}
	for _, d := range defs {
		byMetric[d.Metric] = d.WindowSecs
	}

	if byMetric["rpd"] != 86400 {
		t.Errorf("expected rpd with 86400s window (explicit), got window %d", byMetric["rpd"])
	}
	if _, hasRpm := byMetric["rpm"]; hasRpm {
		t.Error("should not have rpm — groq's explicit mapping uses rpd")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/ratelimit/ -v -run "TestParseRateLimitHeaders_(GenericFallback|ExplicitOverridesFallback)"`
Expected: FAIL — `nvidia` returns nil because it has no mapping and no fallback exists.

- [ ] **Step 3: Add generic fallback to `ParseRateLimitHeaders`**

Replace the `ParseRateLimitHeaders` function body in `internal/ratelimit/headers.go`:

```go
var genericFallbackMappings = []HeaderMapping{
	{"x-ratelimit-limit-requests", "rpm", 60},
	{"x-ratelimit-limit-tokens", "tpm", 60},
}

func ParseRateLimitHeaders(providerType string, headers http.Header, model string) []store.RateLimitDef {
	mappings, ok := ProviderHeaderMappings[providerType]
	if !ok {
		mappings = genericFallbackMappings
	}

	var defs []store.RateLimitDef
	for _, m := range mappings {
		raw := headers.Get(m.Header)
		if raw == "" {
			continue
		}
		val, err := strconv.Atoi(raw)
		if err != nil || val <= 0 {
			continue
		}
		defs = append(defs, store.RateLimitDef{
			Provider:   providerType,
			Model:      model,
			Metric:     m.Metric,
			MaxValue:   val,
			WindowSecs: m.WindowSecs,
		})
	}
	return defs
}
```

- [ ] **Step 4: Replace the old "UnknownProvider" test**

The existing `TestParseRateLimitHeaders_UnknownProvider` test (lines 64-72 of `headers_test.go`) expects `nil` for `openai`, but now OpenAI has an explicit mapping and the fallback means unmapped providers also return results when headers are present. Delete the old test and replace it with:

```go
func TestParseRateLimitHeaders_UnknownProviderNoHeaders(t *testing.T) {
	headers := http.Header{}
	headers.Set("content-type", "application/json")

	defs := ratelimit.ParseRateLimitHeaders("some-unknown-provider", headers, "model-x")
	if len(defs) != 0 {
		t.Errorf("expected 0 defs for unknown provider with no rate limit headers, got %d", len(defs))
	}
}
```

- [ ] **Step 5: Run all ratelimit tests**

Run: `go test ./internal/ratelimit/ -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add internal/ratelimit/headers.go internal/ratelimit/headers_test.go
git commit -m "feat(ratelimit): add generic OpenAI-compatible fallback for unmapped providers"
```

---

### Task 3: Add `FillAccountLimitsFromDiscovered` Store Method

**Files:**
- Modify: `internal/store/ratelimit_def.go`
- Modify: `internal/store/ratelimit_def_test.go`

- [ ] **Step 1: Write failing tests for gap-filling logic**

Add to `internal/store/ratelimit_def_test.go`:

```go
func TestFillAccountLimitsFromDiscovered_FillsGaps(t *testing.T) {
	db := newTestDB(t)

	// Create an account with type "groq" and one model, no limits.
	id, err := db.CreateAccount(Account{
		Name:    "groq-1",
		Type:    "groq",
		APIKey:  []byte("k"),
		Models:  "chat:llama-3.3-70b",
		Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Discovered limits for groq + llama-3.3-70b.
	defs := []RateLimitDef{
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "tpm", MaxValue: 6000, WindowSecs: 60},
	}

	modified, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if !modified {
		t.Error("expected modified=true when filling gaps")
	}

	// Verify limits were added.
	account, err := db.GetAccount(id)
	if err != nil {
		t.Fatal(err)
	}
	if len(account.Limits) != 2 {
		t.Fatalf("expected 2 limits, got %d", len(account.Limits))
	}

	byMetric := map[string]AccountLimit{}
	for _, l := range account.Limits {
		byMetric[l.Metric] = l
	}
	if byMetric["rpd"].MaxValue != 14400 {
		t.Errorf("rpd: expected 14400, got %d", byMetric["rpd"].MaxValue)
	}
	if byMetric["tpm"].MaxValue != 6000 {
		t.Errorf("tpm: expected 6000, got %d", byMetric["tpm"].MaxValue)
	}
}

func TestFillAccountLimitsFromDiscovered_DoesNotOverwrite(t *testing.T) {
	db := newTestDB(t)

	// Create account with an existing manually-configured limit.
	_, err := db.CreateAccount(Account{
		Name:    "groq-manual",
		Type:    "groq",
		APIKey:  []byte("k"),
		Models:  "chat:llama-3.3-70b",
		Enabled: true,
		Limits: []AccountLimit{
			{Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 100, WindowSecs: 86400},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Discovered limit with different value for same metric.
	defs := []RateLimitDef{
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "tpm", MaxValue: 6000, WindowSecs: 60},
	}

	modified, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if !modified {
		t.Error("expected modified=true because tpm was added")
	}

	account, _ := db.GetAccount(1)
	byMetric := map[string]AccountLimit{}
	for _, l := range account.Limits {
		byMetric[l.Metric] = l
	}

	// rpd should keep original value of 100.
	if byMetric["rpd"].MaxValue != 100 {
		t.Errorf("rpd should not be overwritten: expected 100, got %d", byMetric["rpd"].MaxValue)
	}
	// tpm should be filled in.
	if byMetric["tpm"].MaxValue != 6000 {
		t.Errorf("tpm should be filled: expected 6000, got %d", byMetric["tpm"].MaxValue)
	}
}

func TestFillAccountLimitsFromDiscovered_NoModification(t *testing.T) {
	db := newTestDB(t)

	// Create account with limits already matching discovered values.
	db.CreateAccount(Account{
		Name:    "groq-full",
		Type:    "groq",
		APIKey:  []byte("k"),
		Models:  "chat:llama-3.3-70b",
		Enabled: true,
		Limits: []AccountLimit{
			{Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
			{Model: "llama-3.3-70b", Metric: "tpm", MaxValue: 6000, WindowSecs: 60},
		},
	})

	defs := []RateLimitDef{
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "tpm", MaxValue: 6000, WindowSecs: 60},
	}

	modified, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if modified {
		t.Error("expected modified=false when all limits already exist")
	}
}

func TestFillAccountLimitsFromDiscovered_SkipsDisabledAccounts(t *testing.T) {
	db := newTestDB(t)

	db.CreateAccount(Account{
		Name:    "groq-disabled",
		Type:    "groq",
		APIKey:  []byte("k"),
		Models:  "chat:llama-3.3-70b",
		Enabled: false,
	})

	defs := []RateLimitDef{
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
	}

	modified, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if modified {
		t.Error("expected modified=false for disabled account")
	}
}

func TestFillAccountLimitsFromDiscovered_SkipsModelNotOnAccount(t *testing.T) {
	db := newTestDB(t)

	db.CreateAccount(Account{
		Name:    "groq-other",
		Type:    "groq",
		APIKey:  []byte("k"),
		Models:  "chat:mixtral-8x7b",
		Enabled: true,
	})

	defs := []RateLimitDef{
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
	}

	modified, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if modified {
		t.Error("expected modified=false when discovered model is not on account")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/store/ -v -run "TestFillAccountLimitsFromDiscovered"`
Expected: FAIL — `FillAccountLimitsFromDiscovered` does not exist.

- [ ] **Step 3: Implement `FillAccountLimitsFromDiscovered`**

Add to the end of `internal/store/ratelimit_def.go`:

```go
// FillAccountLimitsFromDiscovered inserts discovered rate limit definitions
// into account_limits for accounts of the given provider type, but only where
// the account does not already have a limit for that model+metric combination.
// Returns modified=true if any rows were inserted.
func (d *DB) FillAccountLimitsFromDiscovered(providerType string, defs []RateLimitDef) (modified bool, err error) {
	if len(defs) == 0 {
		return false, nil
	}

	rows, err := d.Query(
		`SELECT id, models FROM accounts WHERE type = ? AND enabled = 1`,
		providerType,
	)
	if err != nil {
		return false, fmt.Errorf("list accounts for provider %s: %w", providerType, err)
	}
	defer rows.Close()

	type acct struct {
		id     int64
		models map[string]bool
	}
	var accounts []acct
	for rows.Next() {
		var a acct
		var modelsStr string
		if err := rows.Scan(&a.id, &modelsStr); err != nil {
			return false, err
		}
		parsed := ParseCategorizedModels(modelsStr)
		all := AllModels(parsed)
		a.models = make(map[string]bool, len(all))
		for _, m := range all {
			a.models[m] = true
		}
		accounts = append(accounts, a)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}

	for _, a := range accounts {
		for _, def := range defs {
			if !a.models[def.Model] {
				continue
			}

			var exists int
			err := d.QueryRow(
				`SELECT COUNT(*) FROM account_limits WHERE account_id = ? AND model = ? AND metric = ?`,
				a.id, def.Model, def.Metric,
			).Scan(&exists)
			if err != nil {
				return modified, fmt.Errorf("check existing limit: %w", err)
			}
			if exists > 0 {
				continue
			}

			_, err = d.Exec(
				`INSERT INTO account_limits (account_id, model, metric, max_value, window_secs) VALUES (?, ?, ?, ?, ?)`,
				a.id, def.Model, def.Metric, def.MaxValue, def.WindowSecs,
			)
			if err != nil {
				return modified, fmt.Errorf("insert discovered limit: %w", err)
			}
			modified = true
		}
	}

	return modified, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/store/ -v -run "TestFillAccountLimitsFromDiscovered"`
Expected: ALL PASS

- [ ] **Step 5: Run all store tests to check for regressions**

Run: `go test ./internal/store/ -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add internal/store/ratelimit_def.go internal/store/ratelimit_def_test.go
git commit -m "feat(store): add FillAccountLimitsFromDiscovered for gap-filling propagation"
```

---

### Task 4: Wire Propagation into `rateLimitWriter`

**Files:**
- Modify: `internal/server/server.go:34-50` (Server struct)
- Modify: `internal/server/server.go:74` (store encryptionKey)
- Modify: `internal/server/server.go:484-497` (rateLimitWriter)

- [ ] **Step 1: Add `encryptionKey` field to the `Server` struct**

In `internal/server/server.go`, add `encryptionKey` to the struct at line 49 (before the closing brace):

```go
type Server struct {
	cfg           Config
	http          *http.Server
	mux           *http.ServeMux
	adminHttp     *http.Server
	adminMux      *http.ServeMux
	db            *store.DB
	pool          *provider.Pool
	proxy         *proxy.Handler
	admin         *admin.AdminHandler
	auth          *admin.Auth
	logChan       chan store.RequestLog
	rateLimitChan chan proxy.RateLimitUpdate
	notifier      *notify.Notifier
	notifyStop    chan struct{}
	scanner       *scanner.Manager
	encryptionKey []byte
}
```

- [ ] **Step 2: Store encryptionKey during `New()`**

In the `New()` function, the `Server` struct literal starts around line 193. Add `encryptionKey` to the struct initialization. Find the line `scanner:       scannerMgr,` and add after it:

```go
		encryptionKey: encryptionKey,
```

- [ ] **Step 3: Add a `reloadPool` helper method on `Server`**

Add this method to `internal/server/server.go`, right before the `rateLimitWriter` method:

```go
func (s *Server) reloadPool() {
	accounts, err := s.db.ListAccounts()
	if err != nil {
		slog.Error("rate limit propagation: failed to reload accounts", "error", err)
		return
	}
	for i := range accounts {
		if s.encryptionKey != nil {
			if plain, err := cryptopkg.Decrypt(s.encryptionKey, accounts[i].APIKey); err == nil {
				accounts[i].APIKey = plain
			}
		}
	}
	providerList, _ := s.db.ListEnabledProviders()
	providerMap := make(map[string]store.Provider, len(providerList))
	for _, p := range providerList {
		providerMap[p.Name] = p
	}
	s.pool.Reload(accounts, providerMap)
}
```

- [ ] **Step 4: Update `rateLimitWriter` to propagate and reload**

Replace the `rateLimitWriter` method in `internal/server/server.go:484-497`:

```go
func (s *Server) rateLimitWriter() {
	for update := range s.rateLimitChan {
		for _, def := range update.Defs {
			if err := s.db.SetRateLimitDef(def); err != nil {
				slog.Error("rate limit upsert failed",
					"provider", def.Provider,
					"model", def.Model,
					"metric", def.Metric,
					"error", err,
				)
			}
		}

		modified, err := s.db.FillAccountLimitsFromDiscovered(update.Provider, update.Defs)
		if err != nil {
			slog.Error("rate limit propagation failed",
				"provider", update.Provider,
				"error", err,
			)
			continue
		}
		if modified {
			slog.Info("discovered rate limits propagated, reloading pool",
				"provider", update.Provider,
				"model", update.Model,
			)
			s.reloadPool()
		}
	}
}
```

- [ ] **Step 5: Verify the project compiles**

Run: `go build ./...`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Run all tests**

Run: `go test ./...`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add internal/server/server.go
git commit -m "feat(server): wire rate limit propagation into rateLimitWriter with pool reload"
```

---

### Task 5: Integration Test

**Files:**
- Modify: `internal/ratelimit/headers_test.go` (add integration-style test)

This test verifies the full end-to-end behavior: parsing headers → propagation → dedup. Since `rateLimitWriter` is a goroutine tied to `Server`, and the propagation logic is in the store layer, we test the store-level flow directly.

- [ ] **Step 1: Write integration test for the full propagation flow**

Add to `internal/store/ratelimit_def_test.go`:

```go
func TestFillAccountLimitsFromDiscovered_DeduplicatesReloads(t *testing.T) {
	db := newTestDB(t)

	db.CreateAccount(Account{
		Name:    "groq-dedup",
		Type:    "groq",
		APIKey:  []byte("k"),
		Models:  "chat:llama-3.3-70b",
		Enabled: true,
	})

	defs := []RateLimitDef{
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
	}

	// First call: should modify.
	modified1, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if !modified1 {
		t.Error("first call should return modified=true")
	}

	// Second call with same defs: should not modify (dedup).
	modified2, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if modified2 {
		t.Error("second call should return modified=false (dedup)")
	}
}

func TestFillAccountLimitsFromDiscovered_MultipleAccounts(t *testing.T) {
	db := newTestDB(t)

	// Two groq accounts, one with existing limits, one without.
	db.CreateAccount(Account{
		Name:    "groq-a",
		Type:    "groq",
		APIKey:  []byte("k"),
		Models:  "chat:llama-3.3-70b",
		Enabled: true,
		Limits: []AccountLimit{
			{Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 100, WindowSecs: 86400},
		},
	})
	id2, _ := db.CreateAccount(Account{
		Name:    "groq-b",
		Type:    "groq",
		APIKey:  []byte("k"),
		Models:  "chat:llama-3.3-70b",
		Enabled: true,
	})

	defs := []RateLimitDef{
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
	}

	modified, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if !modified {
		t.Error("expected modified=true for groq-b")
	}

	// groq-a should keep 100, groq-b should get 14400.
	a, _ := db.GetAccount(1)
	b, _ := db.GetAccount(id2)

	if len(a.Limits) != 1 || a.Limits[0].MaxValue != 100 {
		t.Errorf("groq-a limit should be unchanged at 100, got %+v", a.Limits)
	}
	if len(b.Limits) != 1 || b.Limits[0].MaxValue != 14400 {
		t.Errorf("groq-b limit should be 14400, got %+v", b.Limits)
	}
}
```

- [ ] **Step 2: Run new integration tests**

Run: `go test ./internal/store/ -v -run "TestFillAccountLimitsFromDiscovered_(DeduplicatesReloads|MultipleAccounts)"`
Expected: ALL PASS

- [ ] **Step 3: Run all project tests**

Run: `go test ./...`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add internal/store/ratelimit_def_test.go
git commit -m "test(store): add dedup and multi-account integration tests for rate limit propagation"
```
