package store

import "fmt"

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
