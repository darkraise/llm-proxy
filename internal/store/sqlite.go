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

	db, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_busy_timeout=30000&_foreign_keys=ON")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}

	// modernc.org/sqlite ignores DSN pragma parameters; set them explicitly.
	// synchronous=NORMAL is safe under WAL (durable across crash, may lose
	// last few committed transactions on power loss, never corrupts).
	// cache_size negative = KiB; mmap_size enables read-side mmap.
	for _, pragma := range []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA busy_timeout = 30000",
		"PRAGMA foreign_keys = ON",
		"PRAGMA cache_size = -65536",
		"PRAGMA temp_store = MEMORY",
		"PRAGMA mmap_size = 268435456",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, fmt.Errorf("pragma %q: %w", pragma, err)
		}
	}

	// modernc.org/sqlite serializes writes through a single mutex anyway, and
	// unbounded conns produce "database is locked" thrash under load. Pinning
	// to one connection eliminates that contention without changing semantics.
	db.SetMaxOpenConns(1)

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
			api_key_hash  TEXT NOT NULL DEFAULT '',
			models        TEXT NOT NULL DEFAULT '{}',
			priority      INTEGER NOT NULL DEFAULT 0,
			enabled       INTEGER NOT NULL DEFAULT 1,
			default_models TEXT NOT NULL DEFAULT '{}',
			created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_api_key_hash ON accounts(api_key_hash) WHERE api_key_hash != ''`,
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
			provider_type     TEXT NOT NULL DEFAULT '',
			latency_ms        INTEGER,
			prompt_tokens     INTEGER,
			completion_tokens INTEGER,
			status_code       INTEGER,
			error_message     TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_account ON request_logs(account_id, timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_status_ts ON request_logs(status, timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_account_name_ts ON request_logs(account_name, timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_provider_type_ts ON request_logs(provider_type, timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_request_logs_model_ts ON request_logs(model, timestamp)`,
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
		`CREATE TABLE IF NOT EXISTS provider_stability (
			provider   TEXT PRIMARY KEY,
			unstable   BOOLEAN NOT NULL DEFAULT 0,
			reason     TEXT NOT NULL DEFAULT '',
			marked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS providers (
			name           TEXT PRIMARY KEY,
			display_name   TEXT NOT NULL,
			base_url       TEXT NOT NULL DEFAULT '',
			models_url     TEXT NOT NULL DEFAULT '',
			api_standard   TEXT NOT NULL DEFAULT 'openai',
			auth_type      TEXT NOT NULL DEFAULT 'bearer',
			auth_header    TEXT NOT NULL DEFAULT '',
			capabilities   TEXT NOT NULL DEFAULT '["chat"]',
			default_limits   TEXT NOT NULL DEFAULT '[]',
			validation_steps TEXT NOT NULL DEFAULT '',
			is_builtin       INTEGER NOT NULL DEFAULT 0,
			enabled        INTEGER NOT NULL DEFAULT 1,
			created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS scanner_key_patterns (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			provider    TEXT NOT NULL,
			prefix      TEXT NOT NULL,
			regex       TEXT NOT NULL,
			search_term TEXT NOT NULL,
			enabled     INTEGER NOT NULL DEFAULT 1,
			UNIQUE(provider, prefix)
		)`,
		`CREATE TABLE IF NOT EXISTS discovered_keys (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			key_hash      TEXT UNIQUE NOT NULL,
			key_enc       BLOB NOT NULL,
			provider      TEXT NOT NULL,
			source        TEXT NOT NULL,
			source_url    TEXT NOT NULL DEFAULT '',
			source_repo   TEXT NOT NULL DEFAULT '',
			source_file   TEXT NOT NULL DEFAULT '',
			valid         INTEGER,
			imported      INTEGER NOT NULL DEFAULT 0,
			account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
			discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			tested_at     DATETIME,
			imported_at   DATETIME
		)`,
		`CREATE INDEX IF NOT EXISTS idx_discovered_keys_provider ON discovered_keys(provider)`,
		`CREATE INDEX IF NOT EXISTS idx_discovered_keys_valid ON discovered_keys(valid)`,
		`CREATE TABLE IF NOT EXISTS scan_history (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			source        TEXT NOT NULL,
			started_at    DATETIME NOT NULL,
			completed_at  DATETIME,
			status        TEXT NOT NULL DEFAULT 'running',
			keys_found    INTEGER NOT NULL DEFAULT 0,
			keys_new      INTEGER NOT NULL DEFAULT 0,
			keys_valid    INTEGER NOT NULL DEFAULT 0,
			error_message TEXT NOT NULL DEFAULT ''
		)`,
	}

	for _, m := range migrations {
		if _, err := d.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w\nSQL: %s", err, m)
		}
	}

	d.seedProviders()

	return nil
}

func (d *DB) seedProviders() {
	type seed struct {
		name, displayName, baseURL, modelsURL, apiStandard, authType, authHeader string
		capabilities, defaultLimits, validationSteps                            string
		scanPrefix, scanRegex, scanSearchTerm                                   string // empty = no scanner pattern
		defaultMetrics                                                          string // empty = use fallback ["rpm","rpd","tpm","tpd"]
	}
	providers := []seed{
		{name: "openai", displayName: "OpenAI", baseURL: "https://api.openai.com/v1", modelsURL: "https://api.openai.com/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat","embedding"]`, defaultLimits: `[{"metric":"rpm","max_value":500,"window_secs":60},{"metric":"tpm","max_value":200000,"window_secs":60}]`,
			scanPrefix: "sk-proj-", scanRegex: `sk-proj-[A-Za-z0-9_-]{80,}`, scanSearchTerm: `"sk-proj-" in:file`, defaultMetrics: `["tpd"]`},
		{name: "google", displayName: "Google Gemini", modelsURL: "https://generativelanguage.googleapis.com/v1beta/models", apiStandard: "google", authType: "query-param", capabilities: `["chat"]`, defaultLimits: `[{"metric":"rpm","max_value":60,"window_secs":60},{"metric":"tpd","max_value":1500000,"window_secs":86400}]`,
			scanPrefix: "AIzaSy", scanRegex: `AIzaSy[A-Za-z0-9_-]{33}`, scanSearchTerm: `"AIzaSy" in:file`, defaultMetrics: `["rpm","rpd","tpm"]`},
		{name: "groq", displayName: "Groq", baseURL: "https://api.groq.com/openai/v1", modelsURL: "https://api.groq.com/openai/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`, defaultLimits: `[{"metric":"rpm","max_value":30,"window_secs":60},{"metric":"rpd","max_value":14400,"window_secs":86400},{"metric":"tpm","max_value":6000,"window_secs":60}]`,
			scanPrefix: "gsk_", scanRegex: `gsk_[A-Za-z0-9]{52}`, scanSearchTerm: `"gsk_" in:file`, defaultMetrics: `["rpm","rpd","tpm","tpd"]`},
		{name: "together", displayName: "Together", baseURL: "https://api.together.xyz/v1", modelsURL: "https://api.together.xyz/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat","embedding"]`, defaultLimits: `[{"metric":"rpm","max_value":60,"window_secs":60}]`,
			scanPrefix: "TOGETHER_API_KEY", scanRegex: `[A-Za-z0-9]{64}`, scanSearchTerm: `"TOGETHER_API_KEY" in:file`},
		{name: "cerebras", displayName: "Cerebras", baseURL: "https://api.cerebras.ai/v1", modelsURL: "https://api.cerebras.ai/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`, defaultLimits: `[{"metric":"rpm","max_value":30,"window_secs":60},{"metric":"rpd","max_value":1000,"window_secs":86400}]`,
			scanPrefix: "csk-", scanRegex: `csk-[A-Za-z0-9]{40,}`, scanSearchTerm: `"csk-" in:file`, defaultMetrics: `["rpm","rph","rpd","tpm","tph","tpd"]`},
		{name: "sambanova", displayName: "SambaNova", baseURL: "https://api.sambanova.ai/v1", modelsURL: "https://api.sambanova.ai/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`,
			scanPrefix: "SAMBANOVA_API_KEY", scanRegex: "SAMBANOVA_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{36,})", scanSearchTerm: `"SAMBANOVA_API_KEY" in:file`},
		{name: "clarifai", displayName: "Clarifai", baseURL: "https://api.clarifai.com/v2/ext/openai/v1", modelsURL: "https://api.clarifai.com/v2/ext/openai/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`,
			scanPrefix: "pat-", scanRegex: `pat-[A-Za-z0-9]{32,}`, scanSearchTerm: `"pat-" "clarifai" in:file`},
		{name: "nvidia", displayName: "NVIDIA", baseURL: "https://integrate.api.nvidia.com/v1", modelsURL: "https://integrate.api.nvidia.com/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat","embedding"]`,
			scanPrefix: "nvapi-", scanRegex: `nvapi-[A-Za-z0-9_-]{40,}`, scanSearchTerm: `"nvapi-" in:file`, defaultMetrics: `["rpm"]`},
		{name: "deepseek", displayName: "DeepSeek", baseURL: "https://api.deepseek.com/v1", modelsURL: "https://api.deepseek.com/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`, defaultLimits: `[{"metric":"rpm","max_value":60,"window_secs":60}]`, validationSteps: `[{"step":"models_fetch"},{"step":"chat_completion","params":{"model":"deepseek-chat","max_tokens":5}}]`,
			scanPrefix: "DEEPSEEK_API_KEY", scanRegex: `sk-[a-f0-9]{32}`, scanSearchTerm: `"DEEPSEEK_API_KEY" "sk-"`},
		{name: "llm7", displayName: "LLM7", baseURL: "https://api.llm7.io/v1", modelsURL: "https://api.llm7.io/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`,
			scanPrefix: "LLM7_API_KEY", scanRegex: "LLM7_API_KEY[=: \"']{1,4}([A-Za-z0-9+/]{100,}={0,2})", scanSearchTerm: `"LLM7_API_KEY" in:file`, defaultMetrics: `["rps","rpm","rph"]`},
		{name: "openrouter", displayName: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", modelsURL: "https://openrouter.ai/api/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`, defaultLimits: `[{"metric":"rpm","max_value":200,"window_secs":60}]`,
			scanPrefix: "sk-or-v1-", scanRegex: `sk-or-v1-[a-f0-9]{64}`, scanSearchTerm: `"sk-or-v1-" in:file`, defaultMetrics: `["rpm","rpd"]`},
		{name: "mistral", displayName: "Mistral", baseURL: "https://api.mistral.ai/v1", modelsURL: "https://api.mistral.ai/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat","embedding"]`, defaultLimits: `[{"metric":"rpm","max_value":60,"window_secs":60}]`,
			scanPrefix: "MISTRAL_API_KEY", scanRegex: "MISTRAL_API_KEY[=: \"']{1,4}([A-Za-z0-9]{32})", scanSearchTerm: `"MISTRAL_API_KEY" in:file`, defaultMetrics: `["tpm","tpmo"]`},
		{name: "cohere", displayName: "Cohere", baseURL: "https://api.cohere.ai/compatibility/v1", modelsURL: "https://api.cohere.ai/compatibility/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat","embedding"]`, defaultLimits: `[{"metric":"rpm","max_value":20,"window_secs":60}]`,
			scanPrefix: "COHERE_API_KEY", scanRegex: `[A-Za-z0-9]{40}`, scanSearchTerm: `"COHERE_API_KEY" in:file`, defaultMetrics: `["rpm","ipm"]`},
		{name: "voyage", displayName: "Voyage", baseURL: "https://api.voyageai.com/v1", modelsURL: "https://api.voyageai.com/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["embedding"]`, defaultLimits: `[{"metric":"rpm","max_value":300,"window_secs":60}]`,
			scanPrefix: "pa-", scanRegex: `pa-[A-Za-z0-9_-]{40,}`, scanSearchTerm: `"VOYAGE_API_KEY" "pa-"`},
		{name: "huggingface", displayName: "HuggingFace", baseURL: "https://api-inference.huggingface.co", modelsURL: "https://huggingface.co/api/whoami-v2", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`,
			scanPrefix: "hf_", scanRegex: `hf_[A-Za-z0-9]{34}`, scanSearchTerm: `"hf_" in:file`},
		{name: "github", displayName: "GitHub Models", baseURL: "https://models.inference.ai.azure.com", modelsURL: "https://models.inference.ai.azure.com/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`, defaultLimits: `[{"metric":"rpm","max_value":15,"window_secs":60},{"metric":"rpd","max_value":150,"window_secs":86400}]`,
			scanPrefix: "ghp_", scanRegex: `ghp_[A-Za-z0-9]{36}`, scanSearchTerm: `"ghp_" in:file`},
		{name: "zhipu", displayName: "Zhipu", baseURL: "https://open.bigmodel.cn/api/paas/v4", modelsURL: "https://open.bigmodel.cn/api/paas/v4/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`, validationSteps: `[{"step":"models_fetch"},{"step":"chat_completion","params":{"model":"glm-4.5","max_tokens":5}}]`,
			scanPrefix: "ZHIPU_API_KEY", scanRegex: "ZHIPU_API_KEY[=: \"']{1,4}([A-Za-z0-9_.-]{40,})", scanSearchTerm: `"ZHIPU_API_KEY" in:file`},
		{name: "siliconflow", displayName: "SiliconFlow", baseURL: "https://api.siliconflow.cn/v1", modelsURL: "https://api.siliconflow.cn/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`, validationSteps: `[{"step":"models_fetch"},{"step":"chat_completion","params":{"model":"Qwen/Qwen3-8B","max_tokens":5}}]`,
			scanPrefix: "SILICONFLOW_API_KEY", scanRegex: `sk-[A-Za-z0-9]{40,}`, scanSearchTerm: `"SILICONFLOW_API_KEY" "sk-"`},
		{name: "reka", displayName: "Reka", baseURL: "https://api.reka.ai/v1", modelsURL: "https://api.reka.ai/v1/models", apiStandard: "openai", authType: "bearer", capabilities: `["chat"]`,
			scanPrefix: "REKA_API_KEY", scanRegex: "REKA_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", scanSearchTerm: `"REKA_API_KEY" in:file`},
		{name: "ollama", displayName: "Ollama", baseURL: "http://localhost:11434/v1", apiStandard: "openai", authType: "none", capabilities: `["chat","embedding"]`},
		{name: "openai-compatible", displayName: "OpenAI Compatible", apiStandard: "openai", authType: "bearer", capabilities: `["chat","embedding"]`},
	}

	for _, p := range providers {
		if p.defaultLimits == "" {
			p.defaultLimits = "[]"
		}
		d.Exec(`INSERT OR IGNORE INTO providers (name, display_name, base_url, models_url, api_standard, auth_type, auth_header, capabilities, default_limits, validation_steps, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			p.name, p.displayName, p.baseURL, p.modelsURL, p.apiStandard, p.authType, p.authHeader, p.capabilities, p.defaultLimits, p.validationSteps)
	}

	// Remove builtin providers no longer in the seed list.
	names := make([]any, len(providers))
	for i, p := range providers {
		names[i] = p.name
	}
	placeholders := ""
	for i := range names {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
	}
	d.Exec(`DELETE FROM providers WHERE is_builtin = 1 AND name NOT IN (`+placeholders+`)`, names...)

	// Seed scanner key patterns from provider definitions.
	for _, p := range providers {
		if p.scanPrefix == "" {
			continue
		}
		d.Exec(`INSERT OR IGNORE INTO scanner_key_patterns (provider, prefix, regex, search_term) VALUES (?, ?, ?, ?)`,
			p.name, p.scanPrefix, p.scanRegex, p.scanSearchTerm)
	}
	d.Exec(`DELETE FROM scanner_key_patterns WHERE provider NOT IN (`+placeholders+`)`, names...)

	// Seed default supported metrics per provider (only if not already set by admin).
	for _, p := range providers {
		if p.defaultMetrics == "" {
			continue
		}
		key := "ratelimit_metrics:" + p.name
		existing, _ := d.GetSetting(key)
		if existing == "" {
			d.SetSetting(key, p.defaultMetrics)
		}
	}
}
