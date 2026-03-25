package store

import (
	"fmt"
	"log/slog"
)

// RateLimitDef is a provider- or model-level rate limit template stored by an admin.
// When Model is "", the definition applies to all models for the provider.
type RateLimitDef struct {
	ID         int64  `json:"id"`
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	Metric     string `json:"metric"`
	MaxValue   int    `json:"max_value"`
	WindowSecs int    `json:"window_secs"`
}

// ListRateLimitDefs returns all rate limit definitions for the given provider,
// ordered by model then metric.
func (d *DB) ListRateLimitDefs(provider string) ([]RateLimitDef, error) {
	rows, err := d.Query(
		`SELECT id, provider, model, metric, max_value, window_secs
		 FROM rate_limit_definitions
		 WHERE provider = ?
		 ORDER BY model, metric`,
		provider,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var defs []RateLimitDef
	for rows.Next() {
		var def RateLimitDef
		if err := rows.Scan(&def.ID, &def.Provider, &def.Model, &def.Metric, &def.MaxValue, &def.WindowSecs); err != nil {
			return nil, err
		}
		defs = append(defs, def)
	}
	return defs, rows.Err()
}

// SetRateLimitDef upserts a rate limit definition using the UNIQUE(provider, model, metric) constraint.
func (d *DB) SetRateLimitDef(def RateLimitDef) error {
	_, err := d.Exec(
		`INSERT INTO rate_limit_definitions (provider, model, metric, max_value, window_secs)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(provider, model, metric) DO UPDATE SET
		   max_value   = excluded.max_value,
		   window_secs = excluded.window_secs`,
		def.Provider, def.Model, def.Metric, def.MaxValue, def.WindowSecs,
	)
	if err != nil {
		return fmt.Errorf("upsert rate limit def: %w", err)
	}
	return nil
}

// DeleteRateLimitDef removes a rate limit definition by ID.
func (d *DB) DeleteRateLimitDef(id int64) error {
	_, err := d.Exec("DELETE FROM rate_limit_definitions WHERE id = ?", id)
	return err
}

// SeedRateLimitDefaults populates the rate_limit_definitions table with known
// free-tier limits from provider documentation. Skips if any definitions already exist.
func (d *DB) SeedRateLimitDefaults() error {
	var count int
	if err := d.QueryRow("SELECT count(*) FROM rate_limit_definitions").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil // admin has already configured
	}

	type def struct {
		provider, model, metric string
		maxValue, windowSecs    int
	}

	defaults := []def{
		// ── Groq ─────────────────────────────────────────────────
		// Provider-level defaults
		{"groq", "", "rpm", 30, 60},
		{"groq", "", "tpm", 6000, 60},
		// Per-model overrides
		{"groq", "llama-3.3-70b-versatile", "rpm", 30, 60},
		{"groq", "llama-3.3-70b-versatile", "rpd", 1000, 86400},
		{"groq", "llama-3.3-70b-versatile", "tpm", 12000, 60},
		{"groq", "llama-3.1-8b-instant", "rpm", 30, 60},
		{"groq", "llama-3.1-8b-instant", "rpd", 14400, 86400},
		{"groq", "llama-3.1-8b-instant", "tpm", 6000, 60},
		{"groq", "meta-llama/llama-4-scout-17b-16e-instruct", "rpm", 30, 60},
		{"groq", "meta-llama/llama-4-scout-17b-16e-instruct", "rpd", 1000, 86400},
		{"groq", "meta-llama/llama-4-scout-17b-16e-instruct", "tpm", 30000, 60},

		// ── Google ───────────────────────────────────────────────
		{"google", "", "rpm", 10, 60},
		{"google", "", "rpd", 250, 86400},
		{"google", "", "tpm", 1000000, 60},

		// ── OpenRouter ───────────────────────────────────────────
		{"openrouter", "", "rpm", 20, 60},
		{"openrouter", "", "rpd", 200, 86400},

		// ── Cerebras ─────────────────────────────────────────────
		{"cerebras", "", "rpm", 30, 60},
		{"cerebras", "", "tpm", 60000, 60},
		{"cerebras", "llama-3.3-70b", "rpm", 30, 60},
		{"cerebras", "llama-3.3-70b", "rpd", 14400, 86400},
		{"cerebras", "llama-3.3-70b", "tpm", 64000, 60},
		{"cerebras", "llama-3.1-8b", "rpm", 30, 60},
		{"cerebras", "llama-3.1-8b", "rpd", 14400, 86400},
		{"cerebras", "llama-3.1-8b", "tpm", 60000, 60},

		// ── Mistral ──────────────────────────────────────────────
		{"mistral", "", "rps", 1, 1},
		{"mistral", "", "tpm", 500000, 60},

		// ── GitHub Models ────────────────────────────────────────
		{"github", "", "rpm", 10, 60},
		{"github", "", "rpd", 50, 86400},
	}

	slog.Info("seeding rate limit definitions from provider documentation", "count", len(defaults))
	for _, entry := range defaults {
		if err := d.SetRateLimitDef(RateLimitDef{
			Provider:   entry.provider,
			Model:      entry.model,
			Metric:     entry.metric,
			MaxValue:   entry.maxValue,
			WindowSecs: entry.windowSecs,
		}); err != nil {
			return fmt.Errorf("seed %s/%s/%s: %w", entry.provider, entry.model, entry.metric, err)
		}
	}
	return nil
}

// GetDefaultLimits returns merged AccountLimit entries for the given provider and models.
// For each (model, metric) pair, a model-specific definition takes precedence over a
// provider-level definition (model = ""). Only entries for the requested models are returned.
func (d *DB) GetDefaultLimits(provider string, models []string) ([]AccountLimit, error) {
	if len(models) == 0 {
		return nil, nil
	}

	defs, err := d.ListRateLimitDefs(provider)
	if err != nil {
		return nil, err
	}

	wantModel := make(map[string]bool, len(models))
	for _, m := range models {
		wantModel[m] = true
	}

	// Index provider-level defs by metric.
	providerDefs := map[string]RateLimitDef{}
	for _, def := range defs {
		if def.Model == "" {
			providerDefs[def.Metric] = def
		}
	}

	// Build per-model merged results: model-specific overrides provider-level.
	type key struct{ model, metric string }
	merged := make(map[key]AccountLimit)

	// Seed with provider-level defaults for every requested model.
	for _, m := range models {
		for metric, def := range providerDefs {
			merged[key{m, metric}] = AccountLimit{
				Model:      m,
				Metric:     metric,
				MaxValue:   def.MaxValue,
				WindowSecs: def.WindowSecs,
			}
		}
	}

	// Override with model-specific definitions where they exist.
	for _, def := range defs {
		if def.Model == "" || !wantModel[def.Model] {
			continue
		}
		merged[key{def.Model, def.Metric}] = AccountLimit{
			Model:      def.Model,
			Metric:     def.Metric,
			MaxValue:   def.MaxValue,
			WindowSecs: def.WindowSecs,
		}
	}

	limits := make([]AccountLimit, 0, len(merged))
	for _, l := range merged {
		limits = append(limits, l)
	}
	return limits, nil
}
