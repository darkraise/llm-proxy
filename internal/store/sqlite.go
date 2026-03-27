package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

type DB struct {
	*sql.DB
}

func NewDB(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=ON")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	// modernc.org/sqlite ignores DSN pragma parameters; set them explicitly.
	for _, pragma := range []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA foreign_keys = ON",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("pragma %q: %w", pragma, err)
		}
	}

	d := &DB{db}
	if err := d.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return d, nil
}

func (d *DB) migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS accounts (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			name          TEXT UNIQUE NOT NULL,
			type          TEXT NOT NULL,
			base_url      TEXT NOT NULL DEFAULT '',
			api_key_enc   BLOB NOT NULL DEFAULT '',
			models        TEXT NOT NULL DEFAULT '{}',
			priority      INTEGER NOT NULL DEFAULT 0,
			enabled       INTEGER NOT NULL DEFAULT 1,
			default_models TEXT NOT NULL DEFAULT '{}',
			created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS account_limits (
			account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			model       TEXT NOT NULL DEFAULT '',
			metric      TEXT NOT NULL,
			max_value   INTEGER NOT NULL,
			window_secs INTEGER NOT NULL,
			PRIMARY KEY (account_id, model, metric)
		)`,
		`CREATE TABLE IF NOT EXISTS rate_limit_definitions (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			provider    TEXT NOT NULL,
			model       TEXT NOT NULL DEFAULT '',
			metric      TEXT NOT NULL,
			max_value   INTEGER NOT NULL,
			window_secs INTEGER NOT NULL,
			UNIQUE(provider, model, metric)
		)`,
		`CREATE TABLE IF NOT EXISTS request_logs (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			account_id        INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
			account_name      TEXT NOT NULL,
			model             TEXT NOT NULL,
			endpoint          TEXT NOT NULL,
			status            TEXT NOT NULL,
			latency_ms        INTEGER,
			prompt_tokens     INTEGER,
			completion_tokens INTEGER,
			status_code       INTEGER,
			error_message     TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_account ON request_logs(account_id, timestamp)`,
		`CREATE TABLE IF NOT EXISTS daily_stats (
			date          TEXT NOT NULL,
			account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
			account_name  TEXT NOT NULL,
			total_requests        INTEGER NOT NULL DEFAULT 0,
			success_count         INTEGER NOT NULL DEFAULT 0,
			error_count           INTEGER NOT NULL DEFAULT 0,
			total_prompt_tokens   INTEGER NOT NULL DEFAULT 0,
			total_completion_tokens INTEGER NOT NULL DEFAULT 0,
			avg_latency_ms        INTEGER,
			PRIMARY KEY (date, account_id)
		)`,
		`CREATE TABLE IF NOT EXISTS settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
	}

	for _, m := range migrations {
		if _, err := d.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w\nSQL: %s", err, m)
		}
	}

	// Column additions (idempotent — ignore "duplicate column" errors)
	alterMigrations := []string{
		`ALTER TABLE request_logs ADD COLUMN provider_type TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE accounts RENAME COLUMN default_model TO default_models`,
	}
	for _, m := range alterMigrations {
		d.Exec(m) // ignore errors (column already exists / already renamed)
	}

	// Migrate legacy flat model arrays to categorized format and plain
	// default_model strings to default_models JSON maps.
	d.migrateModelCategories()

	// Remove CHECK constraint on accounts.type (allows adding new providers)
	// SQLite doesn't support ALTER CHECK, so recreate the table if needed.
	var hasCheck bool
	row := d.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'")
	var createSQL string
	if row.Scan(&createSQL) == nil {
		hasCheck = strings.Contains(createSQL, "CHECK")
	}
	if hasCheck {
		tx, err := d.Begin()
		if err != nil {
			return fmt.Errorf("begin tx: %w", err)
		}
		stmts := []string{
			`CREATE TABLE accounts_new (
				id            INTEGER PRIMARY KEY AUTOINCREMENT,
				name          TEXT UNIQUE NOT NULL,
				type          TEXT NOT NULL,
				base_url      TEXT NOT NULL DEFAULT '',
				api_key_enc   BLOB NOT NULL DEFAULT '',
				models        TEXT NOT NULL DEFAULT '{}',
				priority      INTEGER NOT NULL DEFAULT 0,
				enabled       BOOLEAN NOT NULL DEFAULT 1,
				default_models TEXT NOT NULL DEFAULT '{}',
				created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`,
			`INSERT INTO accounts_new (id, name, type, base_url, api_key_enc, models, priority, enabled, created_at, updated_at)
			 SELECT id, name, type, base_url, api_key_enc, models, priority, enabled, created_at, updated_at FROM accounts`,
			`DROP TABLE accounts`,
			`ALTER TABLE accounts_new RENAME TO accounts`,
		}
		for _, s := range stmts {
			if _, err := tx.Exec(s); err != nil {
				tx.Rollback()
				return fmt.Errorf("migrate accounts CHECK: %w", err)
			}
		}
		tx.Commit()
	}

	return nil
}

// migrateModelCategories converts legacy flat model arrays (e.g. '["m1","m2"]')
// to categorized format (e.g. '{"chat":["m1","m2"]}') and plain default_model
// strings to default_models JSON maps (e.g. '{"chat":"m1"}').
func (d *DB) migrateModelCategories() {
	rows, err := d.Query("SELECT id, models, default_models FROM accounts")
	if err != nil {
		return
	}
	defer rows.Close()

	type row struct {
		id            int64
		models        string
		defaultModels string
	}
	var toUpdate []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.models, &r.defaultModels); err != nil {
			continue
		}
		toUpdate = append(toUpdate, r)
	}
	rows.Close()

	for _, r := range toUpdate {
		changed := false

		// Migrate models: if starts with '[', it's a flat array — wrap in {"chat": ...}
		if strings.HasPrefix(strings.TrimSpace(r.models), "[") {
			var flat []string
			if json.Unmarshal([]byte(r.models), &flat) == nil {
				categorized := map[string][]string{CategoryChat: flat}
				data, _ := json.Marshal(categorized)
				r.models = string(data)
				changed = true
			}
		}

		// Migrate default_models: if non-empty and doesn't start with '{', it's a plain string
		trimmed := strings.TrimSpace(r.defaultModels)
		if trimmed != "" && !strings.HasPrefix(trimmed, "{") {
			dm := map[string]string{CategoryChat: trimmed}
			data, _ := json.Marshal(dm)
			r.defaultModels = string(data)
			changed = true
		}

		if changed {
			d.Exec("UPDATE accounts SET models = ?, default_models = ? WHERE id = ?",
				r.models, r.defaultModels, r.id)
		}
	}
}
