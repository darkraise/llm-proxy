package store

import (
	"encoding/json"
	"fmt"
	"time"
)

type Provider struct {
	Name         string `json:"name"`
	DisplayName  string `json:"display_name"`
	BaseURL      string `json:"base_url"`
	ModelsURL    string `json:"models_url"`
	APIStandard  string `json:"api_standard"`
	AuthType     string `json:"auth_type"`
	AuthHeader   string `json:"auth_header"`
	Capabilities string `json:"capabilities"`
	DefaultLimits   string `json:"default_limits"`
	ValidationSteps string `json:"validation_steps"`
	IsBuiltin       bool   `json:"is_builtin"`
	Enabled      bool   `json:"enabled"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type ProviderLimit struct {
	Metric     string `json:"metric"`
	MaxValue   int    `json:"max_value"`
	WindowSecs int    `json:"window_secs"`
}

func (p Provider) ParseDefaultLimits() []ProviderLimit {
	var limits []ProviderLimit
	if p.DefaultLimits == "" || p.DefaultLimits == "[]" {
		return nil
	}
	json.Unmarshal([]byte(p.DefaultLimits), &limits)
	return limits
}

func (p Provider) HasCapability(cap string) bool {
	var caps []string
	if json.Unmarshal([]byte(p.Capabilities), &caps) != nil {
		return false
	}
	for _, c := range caps {
		if c == cap {
			return true
		}
	}
	return false
}

func (d *DB) ListProviders() ([]Provider, error) {
	rows, err := d.Query(`SELECT name, display_name, base_url, models_url, api_standard, auth_type, auth_header, capabilities, default_limits, validation_steps, is_builtin, enabled, created_at, updated_at FROM providers ORDER BY display_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProviders(rows)
}

func (d *DB) ListEnabledProviders() ([]Provider, error) {
	rows, err := d.Query(`SELECT name, display_name, base_url, models_url, api_standard, auth_type, auth_header, capabilities, default_limits, validation_steps, is_builtin, enabled, created_at, updated_at FROM providers WHERE enabled = 1 ORDER BY display_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProviders(rows)
}

func (d *DB) GetProvider(name string) (Provider, error) {
	var p Provider
	var isBuiltin, enabled int
	err := d.QueryRow(
		`SELECT name, display_name, base_url, models_url, api_standard, auth_type, auth_header, capabilities, default_limits, validation_steps, is_builtin, enabled, created_at, updated_at FROM providers WHERE name = ?`, name,
	).Scan(&p.Name, &p.DisplayName, &p.BaseURL, &p.ModelsURL, &p.APIStandard, &p.AuthType, &p.AuthHeader, &p.Capabilities, &p.DefaultLimits, &p.ValidationSteps, &isBuiltin, &enabled, &p.CreatedAt, &p.UpdatedAt)
	p.IsBuiltin = isBuiltin == 1
	p.Enabled = enabled == 1
	return p, err
}

func (d *DB) CreateProvider(p Provider) error {
	_, err := d.Exec(
		`INSERT INTO providers (name, display_name, base_url, models_url, api_standard, auth_type, auth_header, capabilities, default_limits, validation_steps, is_builtin, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.Name, p.DisplayName, p.BaseURL, p.ModelsURL, p.APIStandard, p.AuthType, p.AuthHeader, p.Capabilities, p.DefaultLimits, p.ValidationSteps, p.IsBuiltin, p.Enabled,
	)
	return err
}

func (d *DB) UpdateProvider(name string, p Provider) error {
	_, err := d.Exec(
		`UPDATE providers SET display_name = ?, base_url = ?, models_url = ?, api_standard = ?, auth_type = ?, auth_header = ?, capabilities = ?, default_limits = ?, validation_steps = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?`,
		p.DisplayName, p.BaseURL, p.ModelsURL, p.APIStandard, p.AuthType, p.AuthHeader, p.Capabilities, p.DefaultLimits, p.ValidationSteps, p.Enabled, name,
	)
	return err
}

func (d *DB) DeleteProvider(name string) error {
	res, err := d.Exec(`DELETE FROM providers WHERE name = ? AND is_builtin = 0`, name)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("cannot delete builtin provider or provider not found")
	}
	return nil
}

func (d *DB) CountAccountsByProvider(providerName string) (int, error) {
	var count int
	err := d.QueryRow(`SELECT COUNT(*) FROM accounts WHERE type = ?`, providerName).Scan(&count)
	return count, err
}

func scanProviders(rows interface{ Next() bool; Scan(...any) error }) ([]Provider, error) {
	var providers []Provider
	for rows.Next() {
		var p Provider
		var isBuiltin, enabled int
		if err := rows.Scan(&p.Name, &p.DisplayName, &p.BaseURL, &p.ModelsURL, &p.APIStandard, &p.AuthType, &p.AuthHeader, &p.Capabilities, &p.DefaultLimits, &p.ValidationSteps, &isBuiltin, &enabled, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.IsBuiltin = isBuiltin == 1
		p.Enabled = enabled == 1
		providers = append(providers, p)
	}
	return providers, nil
}
