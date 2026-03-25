package store

import (
	"testing"
)

func TestProviderCRUD(t *testing.T) {
	db := newTestDB(t)

	p := Provider{
		Name:    "groq",
		Type:    "openai",
		BaseURL: "https://api.groq.com/openai/v1",
		APIKey:  []byte("encrypted-key"),
		Models:  `["llama-3.3-70b-versatile"]`,
		Priority: 0,
		Enabled: true,
		Limits: []ProviderLimit{
			{Metric: "rpm", MaxValue: 30, WindowSecs: 60},
			{Metric: "rpd", MaxValue: 1000, WindowSecs: 86400},
		},
	}

	id, err := db.CreateProvider(p)
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	if id == 0 {
		t.Fatal("expected non-zero ID")
	}

	got, err := db.GetProvider(id)
	if err != nil {
		t.Fatalf("GetProvider: %v", err)
	}
	if got.Name != "groq" {
		t.Errorf("name: got %q, want %q", got.Name, "groq")
	}
	if got.Type != "openai" {
		t.Errorf("type: got %q, want %q", got.Type, "openai")
	}
	if len(got.Limits) != 2 {
		t.Fatalf("limits: got %d, want 2", len(got.Limits))
	}

	all, err := db.ListProviders()
	if err != nil {
		t.Fatalf("ListProviders: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("list: got %d, want 1", len(all))
	}

	p.Name = "groq-updated"
	p.Limits = []ProviderLimit{
		{Metric: "rpm", MaxValue: 60, WindowSecs: 60},
	}
	if err := db.UpdateProvider(id, p); err != nil {
		t.Fatalf("UpdateProvider: %v", err)
	}
	got, _ = db.GetProvider(id)
	if got.Name != "groq-updated" {
		t.Errorf("name after update: got %q", got.Name)
	}
	if len(got.Limits) != 1 {
		t.Errorf("limits after update: got %d, want 1", len(got.Limits))
	}
	if got.Limits[0].MaxValue != 60 {
		t.Errorf("limit max_value: got %d, want 60", got.Limits[0].MaxValue)
	}

	if err := db.DeleteProvider(id); err != nil {
		t.Fatalf("DeleteProvider: %v", err)
	}
	all, _ = db.ListProviders()
	if len(all) != 0 {
		t.Errorf("list after delete: got %d", len(all))
	}
}

func TestProviderCRUD_UniqueNameConstraint(t *testing.T) {
	db := newTestDB(t)

	p := Provider{Name: "groq", Type: "openai", APIKey: []byte("k")}
	_, err := db.CreateProvider(p)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = db.CreateProvider(p)
	if err == nil {
		t.Error("expected unique constraint error, got nil")
	}
}

func TestProviderCRUD_CascadeDeleteLimits(t *testing.T) {
	db := newTestDB(t)

	p := Provider{
		Name: "test", Type: "openai", APIKey: []byte("k"),
		Limits: []ProviderLimit{{Metric: "rpm", MaxValue: 10, WindowSecs: 60}},
	}
	id, _ := db.CreateProvider(p)
	db.DeleteProvider(id)

	var count int
	db.QueryRow("SELECT count(*) FROM provider_limits WHERE provider_id = ?", id).Scan(&count)
	if count != 0 {
		t.Errorf("orphaned limits: %d", count)
	}
}
