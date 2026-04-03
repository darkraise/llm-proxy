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

	// Column additions (idempotent — ignore "duplicate column" errors)
	alterMigrations := []string{
		`ALTER TABLE request_logs ADD COLUMN provider_type TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE accounts RENAME COLUMN default_model TO default_models`,
		`ALTER TABLE providers ADD COLUMN default_limits TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE accounts ADD COLUMN api_key_hash TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE providers ADD COLUMN validation_steps TEXT NOT NULL DEFAULT ''`,
	}
	for _, m := range alterMigrations {
		d.Exec(m) // ignore errors (column already exists / already renamed)
	}

	d.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_api_key_hash ON accounts(api_key_hash) WHERE api_key_hash != ''`)

	// Migrate legacy flat model arrays to categorized format and plain
	// default_model strings to default_models JSON maps.
	d.migrateModelCategories()

	d.seedProviders()
	d.seedKeyPatterns()

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
			`INSERT INTO accounts_new (id, name, type, base_url, api_key_enc, models, priority, enabled, default_models, created_at, updated_at)
			 SELECT id, name, type, base_url, api_key_enc, models, priority, enabled, default_models, created_at, updated_at FROM accounts`,
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

func (d *DB) seedProviders() {
	type seed struct {
		name, displayName, baseURL, modelsURL, apiStandard, authType, authHeader, capabilities, defaultLimits, validationSteps string
	}
	// Default limits: rpm=requests/min(60s), rpd=requests/day(86400s), tpm=tokens/min(60s), tpd=tokens/day(86400s)
	providers := []seed{
		{"openai", "OpenAI", "https://api.openai.com/v1", "https://api.openai.com/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":500,"window_secs":60},{"metric":"tpm","max_value":200000,"window_secs":60}]`, ""},
		{"openai_legacy", "OpenAI (Legacy)", "https://api.openai.com/v1", "https://api.openai.com/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":500,"window_secs":60},{"metric":"tpm","max_value":200000,"window_secs":60}]`, ""},
		{"anthropic", "Anthropic", "https://api.anthropic.com/v1", "https://api.anthropic.com/v1/models", "openai", "api-key-header", "x-api-key", `["chat"]`, `[{"metric":"rpm","max_value":1000,"window_secs":60},{"metric":"tpm","max_value":80000,"window_secs":60}]`, ""},
		{"google", "Google Gemini", "", "https://generativelanguage.googleapis.com/v1beta/models", "google", "query-param", "", `["chat"]`, `[{"metric":"rpm","max_value":60,"window_secs":60},{"metric":"tpd","max_value":1500000,"window_secs":86400}]`, ""},
		{"xai", "xAI", "https://api.x.ai/v1", "https://api.x.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":60,"window_secs":60}]`, ""},
		{"groq", "Groq", "https://api.groq.com/openai/v1", "https://api.groq.com/openai/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":30,"window_secs":60},{"metric":"rpd","max_value":14400,"window_secs":86400},{"metric":"tpm","max_value":6000,"window_secs":60}]`, ""},
		{"together", "Together", "https://api.together.xyz/v1", "https://api.together.xyz/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":60,"window_secs":60}]`, ""},
		{"fireworks", "Fireworks", "https://api.fireworks.ai/inference/v1", "https://api.fireworks.ai/inference/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":600,"window_secs":60}]`, ""},
		{"cerebras", "Cerebras", "https://api.cerebras.ai/v1", "https://api.cerebras.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":30,"window_secs":60},{"metric":"rpd","max_value":1000,"window_secs":86400}]`, ""},
		{"sambanova", "SambaNova", "https://api.sambanova.ai/v1", "https://api.sambanova.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"lambda", "Lambda", "https://api.lambdalabs.com/v1", "https://api.lambdalabs.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"octoai", "OctoAI", "https://text.octoai.run/v1", "https://text.octoai.run/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"nvidia", "NVIDIA", "https://integrate.api.nvidia.com/v1", "https://integrate.api.nvidia.com/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[]`, ""},
		{"perplexity", "Perplexity", "https://api.perplexity.ai/v1", "https://api.perplexity.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":20,"window_secs":60}]`, ""},
		{"deepseek", "DeepSeek", "https://api.deepseek.com/v1", "https://api.deepseek.com/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":60,"window_secs":60}]`, ""},
		{"llm7", "LLM7", "https://api.llm7.io/v1", "https://api.llm7.io/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":200,"window_secs":60}]`, ""},
		{"mistral", "Mistral", "https://api.mistral.ai/v1", "https://api.mistral.ai/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":60,"window_secs":60}]`, ""},
		{"cohere", "Cohere", "https://api.cohere.ai/compatibility/v1", "https://api.cohere.ai/compatibility/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":20,"window_secs":60}]`, ""},
		{"ai21", "AI21", "https://api.ai21.com/studio/v1", "https://api.ai21.com/studio/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"voyage", "Voyage", "https://api.voyageai.com/v1", "https://api.voyageai.com/v1/models", "openai", "bearer", "", `["embedding"]`, `[{"metric":"rpm","max_value":300,"window_secs":60}]`, ""},
		{"replicate", "Replicate", "https://api.replicate.com/v1", "https://api.replicate.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"huggingface", "HuggingFace", "https://api-inference.huggingface.co", "https://huggingface.co/api/whoami-v2", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"stability", "Stability", "https://api.stability.ai/v1", "https://api.stability.ai/v1/engines/list", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"cloudflare", "Cloudflare", "", "https://api.cloudflare.com/client/v4/user/tokens/verify", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"github", "GitHub Models", "https://models.inference.ai.azure.com", "https://models.inference.ai.azure.com/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":15,"window_secs":60},{"metric":"rpd","max_value":150,"window_secs":86400}]`, ""},
		{"zhipu", "Zhipu", "https://open.bigmodel.cn/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"moonshot", "Moonshot", "https://api.moonshot.cn/v1", "https://api.moonshot.cn/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"dashscope", "DashScope", "https://dashscope.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"baidu_ernie", "Baidu ERNIE", "https://qianfan.baidubce.com/v2", "https://qianfan.baidubce.com/v2/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"minimax", "MiniMax", "https://api.minimax.chat/v1", "https://api.minimax.chat/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"yi", "Yi", "https://api.lingyiwanwu.com/v1", "https://api.lingyiwanwu.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"baichuan", "Baichuan", "https://api.baichuan-ai.com/v1", "https://api.baichuan-ai.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"siliconflow", "SiliconFlow", "https://api.siliconflow.cn/v1", "https://api.siliconflow.cn/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"stepfun", "StepFun", "https://api.stepfun.com/v1", "https://api.stepfun.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"ollama", "Ollama", "http://localhost:11434/v1", "", "openai", "none", "", `["chat","embedding"]`, `[]`, ""},
		{"openai-compatible", "OpenAI Compatible", "", "", "openai", "bearer", "", `["chat","embedding"]`, `[]`, ""},
	}
	for _, p := range providers {
		d.Exec(`INSERT OR IGNORE INTO providers (name, display_name, base_url, models_url, api_standard, auth_type, auth_header, capabilities, default_limits, validation_steps, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			p.name, p.displayName, p.baseURL, p.modelsURL, p.apiStandard, p.authType, p.authHeader, p.capabilities, p.defaultLimits, p.validationSteps)
	}
}

func (d *DB) seedKeyPatterns() {
	type seed struct {
		provider, prefix, regex, searchTerm string
	}
	patterns := []seed{
		{"openai", "sk-proj-", `sk-proj-[A-Za-z0-9_-]{80,}`, `"sk-proj-" in:file`},
		{"openai_legacy", "sk-", `sk-[A-Za-z0-9]{48}`, `"OPENAI_API_KEY" "sk-"`},
		{"anthropic", "sk-ant-api03-", `sk-ant-api03-[A-Za-z0-9_-]{93}`, `"sk-ant-api03" in:file`},
		{"google", "AIzaSy", `AIzaSy[A-Za-z0-9_-]{33}`, `"AIzaSy" in:file`},
		{"mistral", "MISTRAL_API_KEY", "MISTRAL_API_KEY[=: \"']{1,4}([A-Za-z0-9]{32})", `"MISTRAL_API_KEY" in:file`},
		{"cohere", "COHERE_API_KEY", `[A-Za-z0-9]{40}`, `"COHERE_API_KEY" in:file`},
		{"groq", "gsk_", `gsk_[A-Za-z0-9]{52}`, `"gsk_" in:file`},
		{"deepseek", "DEEPSEEK_API_KEY", `sk-[a-f0-9]{32}`, `"DEEPSEEK_API_KEY" "sk-"`},
		{"huggingface", "hf_", `hf_[A-Za-z0-9]{34}`, `"hf_" in:file`},
		{"replicate", "r8_", `r8_[A-Za-z0-9]{40}`, `"r8_" in:file`},
		{"together", "TOGETHER_API_KEY", `[A-Za-z0-9]{64}`, `"TOGETHER_API_KEY" in:file`},
		{"fireworks", "fw_", `fw_[A-Za-z0-9]{40,}`, `"fw_" in:file`},
		{"perplexity", "pplx-", `pplx-[a-f0-9]{48}`, `"pplx-" in:file`},
		{"voyage", "pa-", `pa-[A-Za-z0-9_-]{40,}`, `"VOYAGE_API_KEY" "pa-"`},
		{"ai21", "AI21_API_KEY", "AI21_API_KEY[=: \"']{1,4}([A-Za-z0-9]{40,})", `"AI21_API_KEY" in:file`},
		{"stability", "STABILITY_API_KEY", `sk-[A-Za-z0-9]{48,}`, `"STABILITY_API_KEY" "sk-"`},
		{"xai", "xai-", `xai-[A-Za-z0-9]{40,}`, `"xai-" in:file`},
		{"openrouter", "sk-or-v1-", `sk-or-v1-[a-f0-9]{64}`, `"sk-or-v1-" in:file`},
		{"llm7", "LLM7_API_KEY", "LLM7_API_KEY[=: \"']{1,4}([A-Za-z0-9+/]{100,}={0,2})", `"LLM7_API_KEY" in:file`},
		{"nvidia", "nvapi-", `nvapi-[A-Za-z0-9_-]{40,}`, `"nvapi-" in:file`},
		{"cerebras", "csk-", `csk-[A-Za-z0-9]{40,}`, `"csk-" in:file`},
		{"sambanova", "SAMBANOVA_API_KEY", "SAMBANOVA_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{36,})", `"SAMBANOVA_API_KEY" in:file`},
		{"cloudflare", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN[=: \"']{1,4}([A-Za-z0-9_-]{40,})", `"CLOUDFLARE_API_TOKEN" in:file`},
		{"octoai", "OCTOAI_TOKEN", "OCTOAI_TOKEN[=: \"']{1,4}([A-Za-z0-9_-]{40,})", `"OCTOAI_TOKEN" in:file`},
		{"lambda", "LAMBDA_API_KEY", "LAMBDA_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{40,})", `"LAMBDA_API_KEY" in:file`},
		{"zhipu", "ZHIPU_API_KEY", "ZHIPU_API_KEY[=: \"']{1,4}([A-Za-z0-9_.-]{40,})", `"ZHIPU_API_KEY" in:file`},
		{"moonshot", "MOONSHOT_API_KEY", `sk-[A-Za-z0-9]{40,}`, `"MOONSHOT_API_KEY" "sk-"`},
		{"dashscope", "DASHSCOPE_API_KEY", `sk-[A-Za-z0-9]{32,}`, `"DASHSCOPE_API_KEY" "sk-"`},
		{"baidu_ernie", "ERNIE_API_KEY", "(?:ERNIE|QIANFAN)_API_KEY[=: \"']{1,4}([A-Za-z0-9]{24,})", `"ERNIE_API_KEY" OR "QIANFAN_API_KEY" in:file`},
		{"minimax", "MINIMAX_API_KEY", "MINIMAX_API_KEY[=: \"']{1,4}([A-Za-z0-9]{40,})", `"MINIMAX_API_KEY" in:file`},
		{"yi", "YI_API_KEY", "YI_API_KEY[=: \"']{1,4}([A-Za-z0-9]{32,})", `"YI_API_KEY" in:file`},
		{"baichuan", "BAICHUAN_API_KEY", "BAICHUAN_API_KEY[=: \"']{1,4}([A-Za-z0-9]{32,})", `"BAICHUAN_API_KEY" in:file`},
		{"siliconflow", "SILICONFLOW_API_KEY", `sk-[A-Za-z0-9]{40,}`, `"SILICONFLOW_API_KEY" "sk-"`},
		{"stepfun", "STEPFUN_API_KEY", "STEPFUN_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"STEPFUN_API_KEY" in:file`},
		{"reka", "REKA_API_KEY", "REKA_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"REKA_API_KEY" in:file`},
		{"writer", "WRITER_API_KEY", "WRITER_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"WRITER_API_KEY" in:file`},
		{"upstage", "UPSTAGE_API_KEY", "UPSTAGE_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"UPSTAGE_API_KEY" in:file`},
		{"clarifai", "pat-", `pat-[A-Za-z0-9]{32,}`, `"pat-" "clarifai" in:file`},
		{"databricks", "dapi", `dapi[a-f0-9]{32}`, `"dapi" "databricks" in:file`},
		{"watsonx", "WATSONX_API_KEY", "(?:WATSONX|IBM)_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"WATSONX_API_KEY" OR "IBM_API_KEY" in:file`},
		{"runpod", "RUNPOD_API_KEY", "RUNPOD_API_KEY[=: \"']{1,4}([A-Za-z0-9]{32,})", `"RUNPOD_API_KEY" in:file`},
		{"lepton", "LEPTON_API_TOKEN", "LEPTON_API_TOKEN[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"LEPTON_API_TOKEN" in:file`},
		{"baseten", "BASETEN_API_KEY", "BASETEN_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"BASETEN_API_KEY" in:file`},
		{"unify", "UNIFY_API_KEY", "UNIFY_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"UNIFY_API_KEY" in:file`},
		{"neets", "NEETS_API_KEY", "NEETS_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"NEETS_API_KEY" in:file`},
		{"abacus", "ABACUS_API_KEY", "ABACUS_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"ABACUS_API_KEY" in:file`},
		{"tencent_hunyuan", "HUNYUAN_API_KEY", "(?:HUNYUAN_API_KEY|TENCENT_SECRET_KEY)[=: \"']{1,4}([A-Za-z0-9]{32,})", `"HUNYUAN_API_KEY" OR "TENCENT_SECRET_KEY" in:file`},
		{"iflytek_spark", "IFLYTEK_API_KEY", "(?:IFLYTEK|SPARK)_API_KEY[=: \"']{1,4}([A-Za-z0-9]{32,})", `"IFLYTEK_API_KEY" OR "SPARK_API_KEY" in:file`},
		{"volcengine", "VOLC_API_KEY", "(?:VOLC|ARK)_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"VOLC_API_KEY" OR "ARK_API_KEY" in:file`},
		{"360ai", "360_API_KEY", "(?:360|ZHINAO)_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"360_API_KEY" OR "ZHINAO_API_KEY" in:file`},
		{"tiangong", "TIANGONG_API_KEY", "(?:TIANGONG|KUNLUN)_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"TIANGONG_API_KEY" OR "KUNLUN_API_KEY" in:file`},
		{"sensenova", "SENSENOVA_API_KEY", "(?:SENSENOVA|SENSETIME)_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"SENSENOVA_API_KEY" OR "SENSETIME_API_KEY" in:file`},
	}
	for _, p := range patterns {
		d.Exec(`INSERT OR IGNORE INTO scanner_key_patterns (provider, prefix, regex, search_term) VALUES (?, ?, ?, ?)`,
			p.provider, p.prefix, p.regex, p.searchTerm)
	}
}
