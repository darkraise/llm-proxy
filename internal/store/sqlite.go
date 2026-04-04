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
	for _, pragma := range []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA busy_timeout = 30000",
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
	d.seedKeyPatterns()

	return nil
}

func (d *DB) seedProviders() {
	type seed struct {
		name, displayName, baseURL, modelsURL, apiStandard, authType, authHeader, capabilities, defaultLimits, validationSteps string
	}
	// Default limits: rpm=requests/min(60s), rpd=requests/day(86400s), tpm=tokens/min(60s), tpd=tokens/day(86400s)
	providers := []seed{
		{"openai", "OpenAI", "https://api.openai.com/v1", "https://api.openai.com/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":500,"window_secs":60},{"metric":"tpm","max_value":200000,"window_secs":60}]`, ""},
		{"anthropic", "Anthropic", "https://api.anthropic.com/v1", "https://api.anthropic.com/v1/models", "openai", "api-key-header", "x-api-key", `["chat"]`, `[{"metric":"rpm","max_value":1000,"window_secs":60},{"metric":"tpm","max_value":80000,"window_secs":60}]`, ""},
		{"google", "Google Gemini", "", "https://generativelanguage.googleapis.com/v1beta/models", "google", "query-param", "", `["chat"]`, `[{"metric":"rpm","max_value":60,"window_secs":60},{"metric":"tpd","max_value":1500000,"window_secs":86400}]`, ""},
		{"xai", "xAI", "https://api.x.ai/v1", "https://api.x.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":60,"window_secs":60}]`, ""},
		{"groq", "Groq", "https://api.groq.com/openai/v1", "https://api.groq.com/openai/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":30,"window_secs":60},{"metric":"rpd","max_value":14400,"window_secs":86400},{"metric":"tpm","max_value":6000,"window_secs":60}]`, ""},
		{"together", "Together", "https://api.together.xyz/v1", "https://api.together.xyz/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":60,"window_secs":60}]`, ""},
		{"fireworks", "Fireworks", "https://api.fireworks.ai/inference/v1", "https://api.fireworks.ai/inference/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":600,"window_secs":60}]`, ""},
		{"cerebras", "Cerebras", "https://api.cerebras.ai/v1", "https://api.cerebras.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":30,"window_secs":60},{"metric":"rpd","max_value":1000,"window_secs":86400}]`, ""},
		{"sambanova", "SambaNova", "https://api.sambanova.ai/v1", "https://api.sambanova.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"lambda", "Lambda", "https://api.lambdalabs.com/v1", "https://api.lambdalabs.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"clarifai", "Clarifai", "https://api.clarifai.com/v2/ext/openai/v1", "https://api.clarifai.com/v2/ext/openai/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"baseten", "Baseten", "https://inference.baseten.co/v1", "https://inference.baseten.co/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"nvidia", "NVIDIA", "https://integrate.api.nvidia.com/v1", "https://integrate.api.nvidia.com/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[]`, ""},
		{"perplexity", "Perplexity", "https://api.perplexity.ai/v1", "https://api.perplexity.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":20,"window_secs":60}]`, ""},
		{"deepseek", "DeepSeek", "https://api.deepseek.com/v1", "https://api.deepseek.com/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":60,"window_secs":60}]`, `[{"step":"models_fetch"},{"step":"chat_completion","params":{"model":"deepseek-chat","max_tokens":5}}]`},
		{"llm7", "LLM7", "https://api.llm7.io/v1", "https://api.llm7.io/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":200,"window_secs":60}]`, ""},
		{"mistral", "Mistral", "https://api.mistral.ai/v1", "https://api.mistral.ai/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":60,"window_secs":60}]`, ""},
		{"cohere", "Cohere", "https://api.cohere.ai/compatibility/v1", "https://api.cohere.ai/compatibility/v1/models", "openai", "bearer", "", `["chat","embedding"]`, `[{"metric":"rpm","max_value":20,"window_secs":60}]`, ""},
		{"ai21", "AI21", "https://api.ai21.com/studio/v1", "https://api.ai21.com/studio/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"voyage", "Voyage", "https://api.voyageai.com/v1", "https://api.voyageai.com/v1/models", "openai", "bearer", "", `["embedding"]`, `[{"metric":"rpm","max_value":300,"window_secs":60}]`, ""},
		{"replicate", "Replicate", "https://api.replicate.com/v1", "https://api.replicate.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"huggingface", "HuggingFace", "https://api-inference.huggingface.co", "https://huggingface.co/api/whoami-v2", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"github", "GitHub Models", "https://models.inference.ai.azure.com", "https://models.inference.ai.azure.com/models", "openai", "bearer", "", `["chat"]`, `[{"metric":"rpm","max_value":15,"window_secs":60},{"metric":"rpd","max_value":150,"window_secs":86400}]`, ""},
		{"zhipu", "Zhipu", "https://open.bigmodel.cn/api/paas/v4", "https://open.bigmodel.cn/api/paas/v4/models", "openai", "bearer", "", `["chat"]`, `[]`, `[{"step":"models_fetch"},{"step":"chat_completion","params":{"model":"glm-4.5","max_tokens":5}}]`},
		{"moonshot", "Moonshot", "https://api.moonshot.cn/v1", "https://api.moonshot.cn/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, `[{"step":"models_fetch"},{"step":"chat_completion","params":{"model":"kimi-k2.5","max_tokens":5}}]`},
		{"dashscope", "DashScope", "https://dashscope.aliyuncs.com/compatible-mode/v1", "https://dashscope.aliyuncs.com/compatible-mode/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"baidu_ernie", "Baidu ERNIE", "https://qianfan.baidubce.com/v2", "https://qianfan.baidubce.com/v2/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"minimax", "MiniMax", "https://api.minimax.chat/v1", "https://api.minimax.chat/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"yi", "Yi", "https://api.lingyiwanwu.com/v1", "https://api.lingyiwanwu.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"baichuan", "Baichuan", "https://api.baichuan-ai.com/v1", "https://api.baichuan-ai.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"siliconflow", "SiliconFlow", "https://api.siliconflow.cn/v1", "https://api.siliconflow.cn/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, `[{"step":"models_fetch"},{"step":"chat_completion","params":{"model":"Qwen/Qwen3-8B","max_tokens":5}}]`},
		{"stepfun", "StepFun", "https://api.stepfun.com/v1", "https://api.stepfun.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"reka", "Reka", "https://api.reka.ai/v1", "https://api.reka.ai/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"writer", "Writer", "https://api.writer.com/v1", "https://api.writer.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"upstage", "Upstage", "https://api.upstage.ai/v1/solar", "https://api.upstage.ai/v1/solar/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"volcengine", "Volcengine (Doubao)", "https://ark.cn-beijing.volces.com/api/v3", "https://ark.cn-beijing.volces.com/api/v3/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"tencent_hunyuan", "Tencent Hunyuan", "https://api.hunyuan.cloud.tencent.com/v1", "https://api.hunyuan.cloud.tencent.com/v1/models", "openai", "bearer", "", `["chat"]`, `[]`, ""},
		{"ollama", "Ollama", "http://localhost:11434/v1", "", "openai", "none", "", `["chat","embedding"]`, `[]`, ""},
		{"openai-compatible", "OpenAI Compatible", "", "", "openai", "bearer", "", `["chat","embedding"]`, `[]`, ""},
	}
	for _, p := range providers {
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
}

func (d *DB) seedKeyPatterns() {
	type seed struct {
		provider, prefix, regex, searchTerm string
	}
	patterns := []seed{
		{"openai", "sk-proj-", `sk-proj-[A-Za-z0-9_-]{80,}`, `"sk-proj-" in:file`},
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
		{"xai", "xai-", `xai-[A-Za-z0-9]{40,}`, `"xai-" in:file`},
		{"openrouter", "sk-or-v1-", `sk-or-v1-[a-f0-9]{64}`, `"sk-or-v1-" in:file`},
		{"llm7", "LLM7_API_KEY", "LLM7_API_KEY[=: \"']{1,4}([A-Za-z0-9+/]{100,}={0,2})", `"LLM7_API_KEY" in:file`},
		{"nvidia", "nvapi-", `nvapi-[A-Za-z0-9_-]{40,}`, `"nvapi-" in:file`},
		{"cerebras", "csk-", `csk-[A-Za-z0-9]{40,}`, `"csk-" in:file`},
		{"sambanova", "SAMBANOVA_API_KEY", "SAMBANOVA_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{36,})", `"SAMBANOVA_API_KEY" in:file`},
		{"github", "ghp_", `ghp_[A-Za-z0-9]{36}`, `"ghp_" in:file`},
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
		{"baseten", "BASETEN_API_KEY", "BASETEN_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"BASETEN_API_KEY" in:file`},
		{"tencent_hunyuan", "HUNYUAN_API_KEY", "(?:HUNYUAN_API_KEY|TENCENT_SECRET_KEY)[=: \"']{1,4}([A-Za-z0-9]{32,})", `"HUNYUAN_API_KEY" OR "TENCENT_SECRET_KEY" in:file`},
		{"volcengine", "VOLC_API_KEY", "(?:VOLC|ARK)_API_KEY[=: \"']{1,4}([A-Za-z0-9_-]{32,})", `"VOLC_API_KEY" OR "ARK_API_KEY" in:file`},
	}
	for _, p := range patterns {
		d.Exec(`INSERT OR IGNORE INTO scanner_key_patterns (provider, prefix, regex, search_term) VALUES (?, ?, ?, ?)`,
			p.provider, p.prefix, p.regex, p.searchTerm)
	}

	// Remove key patterns for providers no longer in the seed list.
	provNames := make([]any, len(patterns))
	for i, p := range patterns {
		provNames[i] = p.provider
	}
	ph := ""
	for i := range provNames {
		if i > 0 {
			ph += ","
		}
		ph += "?"
	}
	d.Exec(`DELETE FROM scanner_key_patterns WHERE provider NOT IN (`+ph+`)`, provNames...)
}
