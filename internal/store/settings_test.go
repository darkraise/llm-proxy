package store

import (
	"path/filepath"
	"testing"
)

func newTestDB(t *testing.T) *DB {
	t.Helper()
	db, err := NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestSettings_GetSet(t *testing.T) {
	db := newTestDB(t)

	val, err := db.GetSetting("foo")
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if val != "" {
		t.Errorf("expected empty, got %q", val)
	}

	if err := db.SetSetting("foo", `"bar"`); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	val, err = db.GetSetting("foo")
	if err != nil {
		t.Fatalf("GetSetting: %v", err)
	}
	if val != `"bar"` {
		t.Errorf("expected %q, got %q", `"bar"`, val)
	}

	if err := db.SetSetting("foo", `"baz"`); err != nil {
		t.Fatalf("SetSetting upsert: %v", err)
	}
	val, _ = db.GetSetting("foo")
	if val != `"baz"` {
		t.Errorf("expected %q, got %q", `"baz"`, val)
	}
}

func TestSettings_GetAll(t *testing.T) {
	db := newTestDB(t)
	db.SetSetting("a", `1`)
	db.SetSetting("b", `2`)

	all, err := db.GetAllSettings()
	if err != nil {
		t.Fatalf("GetAllSettings: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 settings, got %d", len(all))
	}
	if all["a"] != `1` || all["b"] != `2` {
		t.Errorf("unexpected values: %v", all)
	}
}
