package store

import (
	"fmt"
	"time"
)

type Provider struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	Type      string          `json:"type"`
	BaseURL   string          `json:"base_url"`
	APIKey    []byte          `json:"-"`
	Models    string          `json:"models"`
	Priority  int             `json:"priority"`
	Enabled   bool            `json:"enabled"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	Limits    []ProviderLimit `json:"limits"`
}

type ProviderLimit struct {
	Metric     string `json:"metric"`
	MaxValue   int    `json:"max_value"`
	WindowSecs int    `json:"window_secs"`
}

func (d *DB) CreateProvider(p Provider) (int64, error) {
	tx, err := d.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO providers (name, type, base_url, api_key_enc, models, priority, enabled)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		p.Name, p.Type, p.BaseURL, p.APIKey, p.Models, p.Priority, p.Enabled,
	)
	if err != nil {
		return 0, fmt.Errorf("insert provider: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	for _, l := range p.Limits {
		_, err := tx.Exec(
			`INSERT INTO provider_limits (provider_id, metric, max_value, window_secs) VALUES (?, ?, ?, ?)`,
			id, l.Metric, l.MaxValue, l.WindowSecs,
		)
		if err != nil {
			return 0, fmt.Errorf("insert limit %s: %w", l.Metric, err)
		}
	}

	return id, tx.Commit()
}

func (d *DB) GetProvider(id int64) (Provider, error) {
	var p Provider
	var enabled int
	err := d.QueryRow(
		`SELECT id, name, type, base_url, api_key_enc, models, priority, enabled, created_at, updated_at
		 FROM providers WHERE id = ?`, id,
	).Scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.APIKey, &p.Models, &p.Priority, &enabled, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return p, err
	}
	p.Enabled = enabled == 1

	limits, err := d.getProviderLimits(id)
	if err != nil {
		return p, err
	}
	p.Limits = limits
	return p, nil
}

func (d *DB) ListProviders() ([]Provider, error) {
	rows, err := d.Query(
		`SELECT id, name, type, base_url, api_key_enc, models, priority, enabled, created_at, updated_at
		 FROM providers ORDER BY priority, name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var providers []Provider
	for rows.Next() {
		var p Provider
		var enabled int
		if err := rows.Scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.APIKey, &p.Models, &p.Priority, &enabled, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Enabled = enabled == 1
		limits, err := d.getProviderLimits(p.ID)
		if err != nil {
			return nil, err
		}
		p.Limits = limits
		providers = append(providers, p)
	}
	return providers, rows.Err()
}

func (d *DB) UpdateProvider(id int64, p Provider) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		`UPDATE providers SET name=?, type=?, base_url=?, api_key_enc=?, models=?, priority=?, enabled=?, updated_at=CURRENT_TIMESTAMP
		 WHERE id=?`,
		p.Name, p.Type, p.BaseURL, p.APIKey, p.Models, p.Priority, p.Enabled, id,
	)
	if err != nil {
		return fmt.Errorf("update provider: %w", err)
	}

	if _, err := tx.Exec("DELETE FROM provider_limits WHERE provider_id = ?", id); err != nil {
		return fmt.Errorf("delete limits: %w", err)
	}
	for _, l := range p.Limits {
		_, err := tx.Exec(
			`INSERT INTO provider_limits (provider_id, metric, max_value, window_secs) VALUES (?, ?, ?, ?)`,
			id, l.Metric, l.MaxValue, l.WindowSecs,
		)
		if err != nil {
			return fmt.Errorf("insert limit %s: %w", l.Metric, err)
		}
	}

	return tx.Commit()
}

func (d *DB) DeleteProvider(id int64) error {
	_, err := d.Exec("DELETE FROM providers WHERE id = ?", id)
	return err
}

func (d *DB) getProviderLimits(providerID int64) ([]ProviderLimit, error) {
	rows, err := d.Query(
		"SELECT metric, max_value, window_secs FROM provider_limits WHERE provider_id = ?",
		providerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var limits []ProviderLimit
	for rows.Next() {
		var l ProviderLimit
		if err := rows.Scan(&l.Metric, &l.MaxValue, &l.WindowSecs); err != nil {
			return nil, err
		}
		limits = append(limits, l)
	}
	return limits, rows.Err()
}
