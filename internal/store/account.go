package store

import (
	"fmt"
	"time"
)

type Account struct {
	ID           int64          `json:"id"`
	Name         string         `json:"name"`
	Type         string         `json:"type"`
	BaseURL      string         `json:"base_url"`
	APIKey       []byte         `json:"-"`
	Models       string         `json:"models"`
	Priority     int            `json:"priority"`
	Enabled      bool           `json:"enabled"`
	DefaultModels string         `json:"default_models"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	Limits       []AccountLimit `json:"limits"`
}

type AccountLimit struct {
	Model      string `json:"model"`
	Metric     string `json:"metric"`
	MaxValue   int    `json:"max_value"`
	WindowSecs int    `json:"window_secs"`
}

func (d *DB) CreateAccount(p Account) (int64, error) {
	tx, err := d.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO accounts (name, type, base_url, api_key_enc, models, priority, enabled, default_models)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		p.Name, p.Type, p.BaseURL, p.APIKey, p.Models, p.Priority, p.Enabled, p.DefaultModels,
	)
	if err != nil {
		return 0, fmt.Errorf("insert account: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	for _, l := range p.Limits {
		_, err := tx.Exec(
			`INSERT INTO account_limits (account_id, model, metric, max_value, window_secs) VALUES (?, ?, ?, ?, ?)`,
			id, l.Model, l.Metric, l.MaxValue, l.WindowSecs,
		)
		if err != nil {
			return 0, fmt.Errorf("insert limit %s/%s: %w", l.Model, l.Metric, err)
		}
	}

	return id, tx.Commit()
}

func (d *DB) GetAccount(id int64) (Account, error) {
	var p Account
	var enabled int
	err := d.QueryRow(
		`SELECT id, name, type, base_url, api_key_enc, models, priority, enabled, default_models, created_at, updated_at
		 FROM accounts WHERE id = ?`, id,
	).Scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.APIKey, &p.Models, &p.Priority, &enabled, &p.DefaultModels, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return p, err
	}
	p.Enabled = enabled == 1

	limits, err := d.getAccountLimits(id)
	if err != nil {
		return p, err
	}
	p.Limits = limits
	return p, nil
}

func (d *DB) ListAccounts() ([]Account, error) {
	rows, err := d.Query(
		`SELECT id, name, type, base_url, api_key_enc, models, priority, enabled, default_models, created_at, updated_at
		 FROM accounts ORDER BY priority, name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var p Account
		var enabled int
		if err := rows.Scan(&p.ID, &p.Name, &p.Type, &p.BaseURL, &p.APIKey, &p.Models, &p.Priority, &enabled, &p.DefaultModels, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Enabled = enabled == 1
		limits, err := d.getAccountLimits(p.ID)
		if err != nil {
			return nil, err
		}
		p.Limits = limits
		accounts = append(accounts, p)
	}
	return accounts, rows.Err()
}

func (d *DB) UpdateAccount(id int64, p Account) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		`UPDATE accounts SET name=?, type=?, base_url=?, api_key_enc=?, models=?, priority=?, enabled=?, default_models=?, updated_at=CURRENT_TIMESTAMP
		 WHERE id=?`,
		p.Name, p.Type, p.BaseURL, p.APIKey, p.Models, p.Priority, p.Enabled, p.DefaultModels, id,
	)
	if err != nil {
		return fmt.Errorf("update account: %w", err)
	}

	if _, err := tx.Exec("DELETE FROM account_limits WHERE account_id = ?", id); err != nil {
		return fmt.Errorf("delete limits: %w", err)
	}
	for _, l := range p.Limits {
		_, err := tx.Exec(
			`INSERT INTO account_limits (account_id, model, metric, max_value, window_secs) VALUES (?, ?, ?, ?, ?)`,
			id, l.Model, l.Metric, l.MaxValue, l.WindowSecs,
		)
		if err != nil {
			return fmt.Errorf("insert limit %s/%s: %w", l.Model, l.Metric, err)
		}
	}

	return tx.Commit()
}

func (d *DB) DeleteAccount(id int64) error {
	_, err := d.Exec("DELETE FROM accounts WHERE id = ?", id)
	return err
}

func (d *DB) getAccountLimits(accountID int64) ([]AccountLimit, error) {
	rows, err := d.Query(
		"SELECT model, metric, max_value, window_secs FROM account_limits WHERE account_id = ? ORDER BY model, metric",
		accountID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var limits []AccountLimit
	for rows.Next() {
		var l AccountLimit
		if err := rows.Scan(&l.Model, &l.Metric, &l.MaxValue, &l.WindowSecs); err != nil {
			return nil, err
		}
		limits = append(limits, l)
	}
	return limits, rows.Err()
}
