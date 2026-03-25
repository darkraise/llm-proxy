package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

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
		`CREATE TABLE IF NOT EXISTS providers (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			name        TEXT UNIQUE NOT NULL,
			type        TEXT NOT NULL CHECK (type IN ('groq', 'google', 'openrouter', 'cerebras', 'mistral', 'github', 'ollama', 'openai-compatible')),
			base_url    TEXT NOT NULL DEFAULT '',
			api_key_enc BLOB NOT NULL DEFAULT '',
			models      TEXT NOT NULL DEFAULT '[]',
			priority    INTEGER NOT NULL DEFAULT 0,
			enabled     INTEGER NOT NULL DEFAULT 1,
			created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS provider_limits (
			provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
			metric      TEXT NOT NULL,
			max_value   INTEGER NOT NULL,
			window_secs INTEGER NOT NULL,
			PRIMARY KEY (provider_id, metric)
		)`,
		`CREATE TABLE IF NOT EXISTS request_logs (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			provider_id       INTEGER REFERENCES providers(id) ON DELETE SET NULL,
			provider_name     TEXT NOT NULL,
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
		`CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON request_logs(provider_id, timestamp)`,
		`CREATE TABLE IF NOT EXISTS daily_stats (
			date          TEXT NOT NULL,
			provider_id   INTEGER REFERENCES providers(id) ON DELETE SET NULL,
			provider_name TEXT NOT NULL,
			total_requests        INTEGER NOT NULL DEFAULT 0,
			success_count         INTEGER NOT NULL DEFAULT 0,
			error_count           INTEGER NOT NULL DEFAULT 0,
			total_prompt_tokens   INTEGER NOT NULL DEFAULT 0,
			total_completion_tokens INTEGER NOT NULL DEFAULT 0,
			avg_latency_ms        INTEGER,
			PRIMARY KEY (date, provider_id)
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
	return nil
}
