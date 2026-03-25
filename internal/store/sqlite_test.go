package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewDB_CreatesTablesOnInit(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	db, err := NewDB(dbPath)
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	defer db.Close()

	tables := []string{"accounts", "account_limits", "request_logs", "daily_stats", "settings", "rate_limit_definitions"}
	for _, table := range tables {
		var count int
		err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&count)
		if err != nil {
			t.Fatalf("query table %s: %v", table, err)
		}
		if count != 1 {
			t.Errorf("table %s not found", table)
		}
	}
}

func TestNewDB_IdempotentMigrations(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	db1, err := NewDB(dbPath)
	if err != nil {
		t.Fatalf("first NewDB: %v", err)
	}
	db1.Close()

	db2, err := NewDB(dbPath)
	if err != nil {
		t.Fatalf("second NewDB: %v", err)
	}
	db2.Close()
}

func TestNewDB_CreatesParentDirectories(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "sub", "dir", "test.db")

	db, err := NewDB(dbPath)
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	defer db.Close()

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("database file was not created")
	}
}
