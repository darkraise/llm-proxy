package store

import (
	"testing"
)

func TestAccountCRUD(t *testing.T) {
	db := newTestDB(t)

	p := Account{
		Name:    "groq",
		Type:    "groq",
		BaseURL: "https://api.groq.com/openai/v1",
		APIKey:  []byte("encrypted-key"),
		Models:  `["llama-3.3-70b-versatile"]`,
		Priority: 0,
		Enabled: true,
		Limits: []AccountLimit{
			{Metric: "rpm", MaxValue: 30, WindowSecs: 60},
			{Metric: "rpd", MaxValue: 1000, WindowSecs: 86400},
		},
	}

	id, err := db.CreateAccount(p)
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
	if id == 0 {
		t.Fatal("expected non-zero ID")
	}

	got, err := db.GetAccount(id)
	if err != nil {
		t.Fatalf("GetAccount: %v", err)
	}
	if got.Name != "groq" {
		t.Errorf("name: got %q, want %q", got.Name, "groq")
	}
	if got.Type != "groq" {
		t.Errorf("type: got %q, want %q", got.Type, "groq")
	}
	if len(got.Limits) != 2 {
		t.Fatalf("limits: got %d, want 2", len(got.Limits))
	}

	all, err := db.ListAccounts()
	if err != nil {
		t.Fatalf("ListAccounts: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("list: got %d, want 1", len(all))
	}

	p.Name = "groq-updated"
	p.Limits = []AccountLimit{
		{Metric: "rpm", MaxValue: 60, WindowSecs: 60},
	}
	if err := db.UpdateAccount(id, p); err != nil {
		t.Fatalf("UpdateAccount: %v", err)
	}
	got, _ = db.GetAccount(id)
	if got.Name != "groq-updated" {
		t.Errorf("name after update: got %q", got.Name)
	}
	if len(got.Limits) != 1 {
		t.Errorf("limits after update: got %d, want 1", len(got.Limits))
	}
	if got.Limits[0].MaxValue != 60 {
		t.Errorf("limit max_value: got %d, want 60", got.Limits[0].MaxValue)
	}

	if err := db.DeleteAccount(id); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}
	all, _ = db.ListAccounts()
	if len(all) != 0 {
		t.Errorf("list after delete: got %d", len(all))
	}
}

func TestAccountCRUD_UniqueNameConstraint(t *testing.T) {
	db := newTestDB(t)

	p := Account{Name: "groq", Type: "groq", APIKey: []byte("k")}
	_, err := db.CreateAccount(p)
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = db.CreateAccount(p)
	if err == nil {
		t.Error("expected unique constraint error, got nil")
	}
}

func TestAccountCRUD_CascadeDeleteLimits(t *testing.T) {
	db := newTestDB(t)

	p := Account{
		Name: "test", Type: "groq", APIKey: []byte("k"),
		Limits: []AccountLimit{{Metric: "rpm", MaxValue: 10, WindowSecs: 60}},
	}
	id, _ := db.CreateAccount(p)
	db.DeleteAccount(id)

	var count int
	db.QueryRow("SELECT count(*) FROM account_limits WHERE account_id = ?", id).Scan(&count)
	if count != 0 {
		t.Errorf("orphaned limits: %d", count)
	}
}

func TestAccountCRUD_DefaultModel(t *testing.T) {
	db := newTestDB(t)

	p := Account{
		Name:         "groq-default-model",
		Type:         "groq",
		APIKey:       []byte("k"),
		DefaultModel: "llama-3.3-70b",
	}
	id, err := db.CreateAccount(p)
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}

	got, err := db.GetAccount(id)
	if err != nil {
		t.Fatalf("GetAccount: %v", err)
	}
	if got.DefaultModel != "llama-3.3-70b" {
		t.Errorf("default_model: got %q, want %q", got.DefaultModel, "llama-3.3-70b")
	}

	p.DefaultModel = "mixtral-8x7b"
	if err := db.UpdateAccount(id, p); err != nil {
		t.Fatalf("UpdateAccount: %v", err)
	}
	got, _ = db.GetAccount(id)
	if got.DefaultModel != "mixtral-8x7b" {
		t.Errorf("default_model after update: got %q, want %q", got.DefaultModel, "mixtral-8x7b")
	}
}

func TestAccountCRUD_PerModelLimits(t *testing.T) {
	db := newTestDB(t)

	p := Account{
		Name:   "groq-model-limits",
		Type:   "groq",
		APIKey: []byte("k"),
		Limits: []AccountLimit{
			{Model: "", Metric: "rpm", MaxValue: 30, WindowSecs: 60},
			{Model: "llama-3.3-70b", Metric: "rpm", MaxValue: 20, WindowSecs: 60},
		},
	}
	id, err := db.CreateAccount(p)
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}

	got, err := db.GetAccount(id)
	if err != nil {
		t.Fatalf("GetAccount: %v", err)
	}
	if len(got.Limits) != 2 {
		t.Fatalf("limits: got %d, want 2", len(got.Limits))
	}

	// Verify both model="" and model="llama-3.3-70b" limits are stored.
	limitMap := map[string]int{} // model -> max_value
	for _, l := range got.Limits {
		limitMap[l.Model] = l.MaxValue
	}
	if limitMap[""] != 30 {
		t.Errorf("account-level rpm: got %d, want 30", limitMap[""])
	}
	if limitMap["llama-3.3-70b"] != 20 {
		t.Errorf("llama rpm: got %d, want 20", limitMap["llama-3.3-70b"])
	}
}
