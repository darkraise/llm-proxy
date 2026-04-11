package store

import (
	"database/sql"
	"strings"
	"time"
)

type KeyPattern struct {
	ID         int64  `json:"id"`
	Provider   string `json:"provider"`
	Prefix     string `json:"prefix"`
	Regex      string `json:"regex"`
	SearchTerm string `json:"search_term"`
	Enabled    bool   `json:"enabled"`
}

type DiscoveredKey struct {
	ID           int64      `json:"id"`
	KeyHash      string     `json:"key_hash"`
	KeyEnc       []byte     `json:"-"`
	Provider     string     `json:"provider"`
	Source       string     `json:"source"`
	SourceURL    string     `json:"source_url"`
	SourceRepo   string     `json:"source_repo"`
	SourceFile   string     `json:"source_file"`
	Valid        *bool      `json:"valid"`
	Imported     bool       `json:"imported"`
	AccountID    *int64     `json:"account_id,omitempty"`
	DiscoveredAt time.Time  `json:"discovered_at"`
	TestedAt     *time.Time `json:"tested_at,omitempty"`
	ImportedAt   *time.Time `json:"imported_at,omitempty"`
}

type ScanHistory struct {
	ID           int64      `json:"id"`
	Source       string     `json:"source"`
	StartedAt    time.Time  `json:"started_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
	Status       string     `json:"status"`
	KeysFound    int        `json:"keys_found"`
	KeysNew      int        `json:"keys_new"`
	KeysValid    int        `json:"keys_valid"`
	ErrorMessage string     `json:"error_message,omitempty"`
}

func (d *DB) ListKeyPatterns(providerFilter string) ([]KeyPattern, error) {
	q := `SELECT id, provider, prefix, regex, search_term, enabled FROM scanner_key_patterns`
	var args []any
	if providerFilter != "" {
		q += ` WHERE provider = ?`
		args = append(args, providerFilter)
	}
	q += ` ORDER BY provider, prefix`
	rows, err := d.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanKeyPatterns(rows)
}

func (d *DB) ListEnabledKeyPatterns() ([]KeyPattern, error) {
	rows, err := d.Query(`SELECT id, provider, prefix, regex, search_term, enabled FROM scanner_key_patterns WHERE enabled = 1 ORDER BY provider, prefix`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanKeyPatterns(rows)
}

func (d *DB) UpsertKeyPattern(p KeyPattern) error {
	_, err := d.Exec(
		`INSERT OR REPLACE INTO scanner_key_patterns (id, provider, prefix, regex, search_term, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
		nullInt64(p.ID), p.Provider, p.Prefix, p.Regex, p.SearchTerm, p.Enabled,
	)
	return err
}

func (d *DB) DeleteKeyPattern(id int64) error {
	_, err := d.Exec(`DELETE FROM scanner_key_patterns WHERE id = ?`, id)
	return err
}

func (d *DB) InsertDiscoveredKey(dk DiscoveredKey) (int64, error) {
	var validVal any
	var testedAt any
	if dk.Valid != nil {
		if *dk.Valid {
			validVal = 1
		} else {
			validVal = 0
		}
		testedAt = time.Now()
	}
	res, err := d.Exec(
		`INSERT OR IGNORE INTO discovered_keys (key_hash, key_enc, provider, source, source_url, source_repo, source_file, valid, tested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		dk.KeyHash, dk.KeyEnc, dk.Provider, dk.Source, dk.SourceURL, dk.SourceRepo, dk.SourceFile, validVal, testedAt,
	)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (d *DB) GetDiscoveredKey(id int64) (DiscoveredKey, error) {
	row := d.QueryRow(`SELECT id, key_hash, key_enc, provider, source, source_url, source_repo, source_file, valid, imported, account_id, discovered_at, tested_at, imported_at FROM discovered_keys WHERE id = ?`, id)
	return scanDiscoveredKey(row)
}

func (d *DB) GetDiscoveredKeyByHash(hash string) (*DiscoveredKey, error) {
	row := d.QueryRow(`SELECT id, key_hash, key_enc, provider, source, source_url, source_repo, source_file, valid, imported, account_id, discovered_at, tested_at, imported_at FROM discovered_keys WHERE key_hash = ?`, hash)
	dk, err := scanDiscoveredKey(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &dk, nil
}

func (d *DB) ListDiscoveredKeys(provider, source string, valid *bool, imported *bool, limit, offset int) ([]DiscoveredKey, int, error) {
	var conditions []string
	var args []any

	if provider != "" {
		conditions = append(conditions, "provider = ?")
		args = append(args, provider)
	}
	if source != "" {
		conditions = append(conditions, "source = ?")
		args = append(args, source)
	}
	if valid != nil {
		if *valid {
			conditions = append(conditions, "valid = 1")
		} else {
			conditions = append(conditions, "valid = 0")
		}
	}
	if imported != nil {
		if *imported {
			conditions = append(conditions, "imported = 1")
		} else {
			conditions = append(conditions, "imported = 0")
		}
	}

	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	if err := d.QueryRow("SELECT COUNT(*) FROM discovered_keys"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `SELECT id, key_hash, key_enc, provider, source, source_url, source_repo, source_file, valid, imported, account_id, discovered_at, tested_at, imported_at FROM discovered_keys` + where + ` ORDER BY discovered_at DESC LIMIT ? OFFSET ?`
	rows, err := d.Query(q, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var keys []DiscoveredKey
	for rows.Next() {
		dk, err := scanDiscoveredKey(rows)
		if err != nil {
			return nil, 0, err
		}
		keys = append(keys, dk)
	}
	return keys, total, nil
}

func (d *DB) UpdateDiscoveredKeyValidity(id int64, valid bool) error {
	_, err := d.Exec(`UPDATE discovered_keys SET valid = ?, tested_at = CURRENT_TIMESTAMP WHERE id = ?`, valid, id)
	return err
}

func (d *DB) MarkDiscoveredKeyImported(id int64, accountID int64) error {
	_, err := d.Exec(`UPDATE discovered_keys SET imported = 1, account_id = ?, imported_at = CURRENT_TIMESTAMP WHERE id = ?`, accountID, id)
	return err
}

func (d *DB) DeleteDiscoveredKey(id int64) error {
	_, err := d.Exec(`DELETE FROM discovered_keys WHERE id = ?`, id)
	return err
}

func (d *DB) DeleteDiscoveredKeys(ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	res, err := d.Exec("DELETE FROM discovered_keys WHERE id IN ("+strings.Join(placeholders, ",")+")", args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (d *DB) CountDiscoveredKeys() (total, valid, imported int, err error) {
	err = d.QueryRow(`SELECT COUNT(*), COALESCE(SUM(CASE WHEN valid = 1 THEN 1 ELSE 0 END), 0), COALESCE(SUM(imported), 0) FROM discovered_keys`).Scan(&total, &valid, &imported)
	return
}

func (d *DB) CountKeyPatternProviders() (int, error) {
	var count int
	err := d.QueryRow(`SELECT COUNT(DISTINCT provider) FROM scanner_key_patterns WHERE enabled = 1`).Scan(&count)
	return count, err
}

func (d *DB) InsertScanHistory(h ScanHistory) (int64, error) {
	res, err := d.Exec(
		`INSERT INTO scan_history (source, started_at, status) VALUES (?, ?, ?)`,
		h.Source, h.StartedAt, h.Status,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) UpdateScanHistory(id int64, h ScanHistory) error {
	_, err := d.Exec(
		`UPDATE scan_history SET completed_at = ?, status = ?, keys_found = ?, keys_new = ?, keys_valid = ?, error_message = ? WHERE id = ?`,
		h.CompletedAt, h.Status, h.KeysFound, h.KeysNew, h.KeysValid, h.ErrorMessage, id,
	)
	return err
}

func (d *DB) ListScanHistory(limit int) ([]ScanHistory, error) {
	rows, err := d.Query(`SELECT id, source, started_at, completed_at, status, keys_found, keys_new, keys_valid, error_message FROM scan_history ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var histories []ScanHistory
	for rows.Next() {
		var h ScanHistory
		var completedAt sql.NullTime
		if err := rows.Scan(&h.ID, &h.Source, &h.StartedAt, &completedAt, &h.Status, &h.KeysFound, &h.KeysNew, &h.KeysValid, &h.ErrorMessage); err != nil {
			return nil, err
		}
		if completedAt.Valid {
			h.CompletedAt = &completedAt.Time
		}
		histories = append(histories, h)
	}
	return histories, nil
}

type scannable interface {
	Scan(...any) error
}

func scanKeyPatterns(rows interface {
	Next() bool
	Scan(...any) error
}) ([]KeyPattern, error) {
	var patterns []KeyPattern
	for rows.Next() {
		var p KeyPattern
		var enabled int
		if err := rows.Scan(&p.ID, &p.Provider, &p.Prefix, &p.Regex, &p.SearchTerm, &enabled); err != nil {
			return nil, err
		}
		p.Enabled = enabled == 1
		patterns = append(patterns, p)
	}
	return patterns, nil
}

func scanDiscoveredKey(s scannable) (DiscoveredKey, error) {
	var dk DiscoveredKey
	var valid sql.NullBool
	var accountID sql.NullInt64
	var testedAt, importedAt sql.NullTime
	var imported int
	if err := s.Scan(
		&dk.ID, &dk.KeyHash, &dk.KeyEnc, &dk.Provider, &dk.Source,
		&dk.SourceURL, &dk.SourceRepo, &dk.SourceFile,
		&valid, &imported, &accountID,
		&dk.DiscoveredAt, &testedAt, &importedAt,
	); err != nil {
		return DiscoveredKey{}, err
	}
	if valid.Valid {
		dk.Valid = &valid.Bool
	}
	dk.Imported = imported == 1
	if accountID.Valid {
		dk.AccountID = &accountID.Int64
	}
	if testedAt.Valid {
		dk.TestedAt = &testedAt.Time
	}
	if importedAt.Valid {
		dk.ImportedAt = &importedAt.Time
	}
	return dk, nil
}

func nullInt64(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}
