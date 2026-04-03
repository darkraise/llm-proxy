package store

import (
	"sort"
	"testing"
)

func TestSetAndListRateLimitDefs(t *testing.T) {
	db := newTestDB(t)

	defs := []RateLimitDef{
		{Provider: "groq", Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60},
		{Provider: "groq", Model: "", Metric: "rpd", MaxValue: 1000, WindowSecs: 86400},
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpm", MaxValue: 20, WindowSecs: 60},
		{Provider: "google", Model: "", Metric: "rpm", MaxValue: 15, WindowSecs: 60},
	}
	for _, def := range defs {
		if err := db.SetRateLimitDef(def); err != nil {
			t.Fatalf("SetRateLimitDef(%+v): %v", def, err)
		}
	}

	groqDefs, err := db.ListRateLimitDefs("groq")
	if err != nil {
		t.Fatalf("ListRateLimitDefs: %v", err)
	}
	if len(groqDefs) != 3 {
		t.Fatalf("groq defs: got %d, want 3", len(groqDefs))
	}
	// Verify IDs are assigned.
	for _, d := range groqDefs {
		if d.ID == 0 {
			t.Errorf("expected non-zero ID for %+v", d)
		}
	}

	googleDefs, err := db.ListRateLimitDefs("google")
	if err != nil {
		t.Fatalf("ListRateLimitDefs google: %v", err)
	}
	if len(googleDefs) != 1 {
		t.Fatalf("google defs: got %d, want 1", len(googleDefs))
	}
}

func TestSetRateLimitDef_Upsert(t *testing.T) {
	db := newTestDB(t)

	def := RateLimitDef{Provider: "groq", Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60}
	if err := db.SetRateLimitDef(def); err != nil {
		t.Fatalf("initial set: %v", err)
	}

	// Update the same unique key.
	def.MaxValue = 60
	def.WindowSecs = 120
	if err := db.SetRateLimitDef(def); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	defs, _ := db.ListRateLimitDefs("groq")
	if len(defs) != 1 {
		t.Fatalf("expected 1 def after upsert, got %d", len(defs))
	}
	if defs[0].MaxValue != 60 {
		t.Errorf("max_value: got %d, want 60", defs[0].MaxValue)
	}
	if defs[0].WindowSecs != 120 {
		t.Errorf("window_secs: got %d, want 120", defs[0].WindowSecs)
	}
}

func TestDeleteRateLimitDef(t *testing.T) {
	db := newTestDB(t)

	if err := db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60}); err != nil {
		t.Fatalf("set: %v", err)
	}
	defs, _ := db.ListRateLimitDefs("groq")
	if len(defs) != 1 {
		t.Fatalf("expected 1 def, got %d", len(defs))
	}

	if err := db.DeleteRateLimitDef(defs[0].ID); err != nil {
		t.Fatalf("DeleteRateLimitDef: %v", err)
	}

	defs, _ = db.ListRateLimitDefs("groq")
	if len(defs) != 0 {
		t.Errorf("expected 0 defs after delete, got %d", len(defs))
	}
}

func TestGetDefaultLimits_ProviderOnly(t *testing.T) {
	db := newTestDB(t)

	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60})
	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "", Metric: "rpd", MaxValue: 1000, WindowSecs: 86400})

	limits, err := db.GetDefaultLimits("groq", []string{"llama-3.3-70b", "mixtral-8x7b"})
	if err != nil {
		t.Fatalf("GetDefaultLimits: %v", err)
	}
	// 2 metrics × 2 models = 4 entries.
	if len(limits) != 4 {
		t.Fatalf("limits count: got %d, want 4", len(limits))
	}
	for _, l := range limits {
		if l.Model == "" {
			t.Errorf("expected non-empty model in returned limits, got empty for metric %s", l.Metric)
		}
	}
}

func TestGetDefaultLimits_ModelOverridesProvider(t *testing.T) {
	db := newTestDB(t)

	// Provider-level: rpm=30
	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60})
	// Model-specific override: rpm=20 for llama-3.3-70b
	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpm", MaxValue: 20, WindowSecs: 60})

	limits, err := db.GetDefaultLimits("groq", []string{"llama-3.3-70b", "mixtral-8x7b"})
	if err != nil {
		t.Fatalf("GetDefaultLimits: %v", err)
	}
	if len(limits) != 2 {
		t.Fatalf("limits count: got %d, want 2", len(limits))
	}

	// Sort for deterministic comparison.
	sort.Slice(limits, func(i, j int) bool { return limits[i].Model < limits[j].Model })

	llamaLimit := limits[0] // llama-3.3-70b
	mixtralLimit := limits[1]

	if llamaLimit.Model != "llama-3.3-70b" {
		t.Fatalf("unexpected model order, got %s", llamaLimit.Model)
	}
	if llamaLimit.MaxValue != 20 {
		t.Errorf("llama rpm: got %d, want 20 (model override)", llamaLimit.MaxValue)
	}
	if mixtralLimit.MaxValue != 30 {
		t.Errorf("mixtral rpm: got %d, want 30 (provider default)", mixtralLimit.MaxValue)
	}
}

func TestGetDefaultLimits_EmptyModels(t *testing.T) {
	db := newTestDB(t)
	db.SetRateLimitDef(RateLimitDef{Provider: "groq", Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60})

	limits, err := db.GetDefaultLimits("groq", nil)
	if err != nil {
		t.Fatalf("GetDefaultLimits(nil): %v", err)
	}
	if len(limits) != 0 {
		t.Errorf("expected empty result for nil models, got %d", len(limits))
	}
}

func TestGetDefaultLimits_ReturnsEmptyWithNoAdminDefs(t *testing.T) {
	db := newTestDB(t)

	// No admin-defined limits — falls back to provider's default_limits.
	// Groq has rpm, rpd, tpm seeded, so we expect 3 limits for the model.
	limits, err := db.GetDefaultLimits("groq", []string{"llama-3.3-70b-versatile"})
	if err != nil {
		t.Fatalf("GetDefaultLimits: %v", err)
	}
	if len(limits) == 0 {
		t.Errorf("expected provider default limits for groq, got 0")
	}

	// Unknown provider also returns empty.
	limits2, _ := db.GetDefaultLimits("unknown-provider", []string{"model"})
	if len(limits2) != 0 {
		t.Errorf("expected empty for unknown provider, got %d", len(limits2))
	}
}

func TestFillAccountLimitsFromDiscovered_FillsGaps(t *testing.T) {
	db := newTestDB(t)
	id, err := db.CreateAccount(Account{
		Name: "groq-1", Type: "groq", APIKey: []byte("k"),
		Models: `{"chat":["llama-3.3-70b"]}`, Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
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
	_, err := db.CreateAccount(Account{
		Name: "groq-manual", Type: "groq", APIKey: []byte("k"),
		Models: `{"chat":["llama-3.3-70b"]}`, Enabled: true,
		Limits: []AccountLimit{
			{Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 100, WindowSecs: 86400},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
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
	if byMetric["rpd"].MaxValue != 100 {
		t.Errorf("rpd should not be overwritten: expected 100, got %d", byMetric["rpd"].MaxValue)
	}
	if byMetric["tpm"].MaxValue != 6000 {
		t.Errorf("tpm should be filled: expected 6000, got %d", byMetric["tpm"].MaxValue)
	}
}

func TestFillAccountLimitsFromDiscovered_NoModification(t *testing.T) {
	db := newTestDB(t)
	db.CreateAccount(Account{
		Name: "groq-full", Type: "groq", APIKey: []byte("k"),
		Models: `{"chat":["llama-3.3-70b"]}`, Enabled: true,
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
		Name: "groq-disabled", Type: "groq", APIKey: []byte("k"),
		Models: `{"chat":["llama-3.3-70b"]}`, Enabled: false,
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
		Name: "groq-other", Type: "groq", APIKey: []byte("k"),
		Models: `{"chat":["mixtral-8x7b"]}`, Enabled: true,
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

func TestFillAccountLimitsFromDiscovered_DeduplicatesReloads(t *testing.T) {
	db := newTestDB(t)
	db.CreateAccount(Account{
		Name: "groq-dedup", Type: "groq", APIKey: []byte("k"),
		Models: `{"chat":["llama-3.3-70b"]}`, Enabled: true,
	})
	defs := []RateLimitDef{
		{Provider: "groq", Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 14400, WindowSecs: 86400},
	}
	modified1, err := db.FillAccountLimitsFromDiscovered("groq", defs)
	if err != nil {
		t.Fatal(err)
	}
	if !modified1 {
		t.Error("first call should return modified=true")
	}
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
	db.CreateAccount(Account{
		Name: "groq-a", Type: "groq", APIKey: []byte("k"),
		Models: `{"chat":["llama-3.3-70b"]}`, Enabled: true,
		Limits: []AccountLimit{
			{Model: "llama-3.3-70b", Metric: "rpd", MaxValue: 100, WindowSecs: 86400},
		},
	})
	id2, _ := db.CreateAccount(Account{
		Name: "groq-b", Type: "groq", APIKey: []byte("k"),
		Models: `{"chat":["llama-3.3-70b"]}`, Enabled: true,
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
	a, _ := db.GetAccount(1)
	b, _ := db.GetAccount(id2)
	if len(a.Limits) != 1 || a.Limits[0].MaxValue != 100 {
		t.Errorf("groq-a limit should be unchanged at 100, got %+v", a.Limits)
	}
	if len(b.Limits) != 1 || b.Limits[0].MaxValue != 14400 {
		t.Errorf("groq-b limit should be 14400, got %+v", b.Limits)
	}
}
