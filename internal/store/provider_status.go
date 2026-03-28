package store

import "time"

type ProviderStability struct {
	Provider   string    `json:"provider"`
	Unstable   bool      `json:"unstable"`
	Reason     string    `json:"reason"`
	MarkedAt   time.Time `json:"marked_at"`
}

func (d *DB) MarkProviderUnstable(provider, reason string) error {
	_, err := d.Exec(`
		INSERT INTO provider_stability (provider, unstable, reason, marked_at)
		VALUES (?, 1, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(provider) DO UPDATE SET unstable=1, reason=?, marked_at=CURRENT_TIMESTAMP`,
		provider, reason, reason,
	)
	return err
}

func (d *DB) MarkProviderStable(provider string) error {
	_, err := d.Exec(`
		INSERT INTO provider_stability (provider, unstable, reason, marked_at)
		VALUES (?, 0, '', CURRENT_TIMESTAMP)
		ON CONFLICT(provider) DO UPDATE SET unstable=0, reason='', marked_at=CURRENT_TIMESTAMP`,
		provider,
	)
	return err
}

func (d *DB) GetProviderStability(provider string) (ProviderStability, error) {
	var ps ProviderStability
	err := d.QueryRow(
		"SELECT provider, unstable, reason, marked_at FROM provider_stability WHERE provider = ?",
		provider,
	).Scan(&ps.Provider, &ps.Unstable, &ps.Reason, &ps.MarkedAt)
	return ps, err
}

func (d *DB) ListUnstableProviders() ([]ProviderStability, error) {
	rows, err := d.Query(
		"SELECT provider, unstable, reason, marked_at FROM provider_stability WHERE unstable = 1 ORDER BY marked_at DESC",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ProviderStability
	for rows.Next() {
		var ps ProviderStability
		if err := rows.Scan(&ps.Provider, &ps.Unstable, &ps.Reason, &ps.MarkedAt); err != nil {
			return nil, err
		}
		result = append(result, ps)
	}
	return result, rows.Err()
}

func (d *DB) ListAllProviderStability() ([]ProviderStability, error) {
	rows, err := d.Query(
		"SELECT provider, unstable, reason, marked_at FROM provider_stability ORDER BY provider",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ProviderStability
	for rows.Next() {
		var ps ProviderStability
		if err := rows.Scan(&ps.Provider, &ps.Unstable, &ps.Reason, &ps.MarkedAt); err != nil {
			return nil, err
		}
		result = append(result, ps)
	}
	return result, rows.Err()
}
