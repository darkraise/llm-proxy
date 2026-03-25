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

func TestGetDefaultLimits_FallsBackToDocumentedDefaults(t *testing.T) {
	db := newTestDB(t)

	// No admin-defined limits — should fall back to documented free-tier defaults
	limits, err := db.GetDefaultLimits("groq", []string{"llama-3.3-70b-versatile"})
	if err != nil {
		t.Fatalf("GetDefaultLimits: %v", err)
	}
	if len(limits) == 0 {
		t.Fatal("expected documented defaults for groq, got empty")
	}

	found := false
	for _, l := range limits {
		if l.Model == "llama-3.3-70b-versatile" && l.Metric == "tpm" && l.MaxValue == 12000 {
			found = true
		}
	}
	if !found {
		t.Error("expected documented tpm=12000 for llama-3.3-70b-versatile")
	}

	// Unknown provider should return empty
	limits2, _ := db.GetDefaultLimits("unknown-provider", []string{"model"})
	if len(limits2) != 0 {
		t.Errorf("expected empty for unknown provider, got %d", len(limits2))
	}
}
