package store

import (
	"fmt"
	"strings"
	"time"
)

// sqliteTime formats t for use in SQLite datetime comparisons.
// modernc.org/sqlite stores CURRENT_TIMESTAMP as RFC3339 UTC ("2006-01-02T15:04:05Z"),
// so query parameters must use the same format to match stored values.
func sqliteTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05Z")
}

type RequestLog struct {
	ID               int64     `json:"id"`
	Timestamp        time.Time `json:"timestamp"`
	AccountID        *int64    `json:"account_id,omitempty"`
	AccountName      string    `json:"account_name"`
	ProviderType     string    `json:"provider_type"`
	Model            string    `json:"model"`
	Endpoint         string    `json:"endpoint"`
	Status           string    `json:"status"`
	LatencyMs        int       `json:"latency_ms"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	StatusCode       int       `json:"status_code"`
	ErrorMessage     string    `json:"error_message,omitempty"`
}

type RequestLogFilter struct {
	AccountName  string
	Status       string
	Model        string
	From         *time.Time
	To           *time.Time
	MinLatencyMs int64 // 0 means no filter
	Limit        int
	Offset       int
}

type OverviewStats struct {
	TotalRequests      int     `json:"total_requests"`
	SuccessCount       int     `json:"success_count"`
	ErrorCount         int     `json:"error_count"`
	AvgLatencyMs       float64 `json:"avg_latency_ms"`
	P95LatencyMs       int     `json:"p95_latency_ms"`
	TotalTokens        int     `json:"total_tokens"`
	PromptTokens       int64   `json:"prompt_tokens"`
	CompletionTokens   int64   `json:"completion_tokens"`
	YesterdayRequests  int64   `json:"yesterday_requests"`
	YesterdayLatencyMs float64 `json:"yesterday_avg_latency_ms"`
}

type ProviderStats struct {
	Provider      string  `json:"provider"`
	TotalRequests int64   `json:"total_requests"`
	TotalTokens   int64   `json:"total_tokens"`
	ErrorCount    int64   `json:"error_count"`
	AvgLatencyMs  float64 `json:"avg_latency_ms"`
}

type ModelStats struct {
	Model         string `json:"model"`
	TotalRequests int64  `json:"total_requests"`
	TotalTokens   int64  `json:"total_tokens"`
}

func (d *DB) InsertRequestLog(l RequestLog) error {
	_, err := d.Exec(
		`INSERT INTO request_logs (account_id, account_name, provider_type, model, endpoint, status, latency_ms, prompt_tokens, completion_tokens, status_code, error_message)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		l.AccountID, l.AccountName, l.ProviderType, l.Model, l.Endpoint, l.Status, l.LatencyMs, l.PromptTokens, l.CompletionTokens, l.StatusCode, l.ErrorMessage,
	)
	return err
}

func (d *DB) QueryRequestLogs(f RequestLogFilter) ([]RequestLog, int, error) {
	where := []string{"1=1"}
	args := []any{}

	if f.AccountName != "" {
		where = append(where, "account_name = ?")
		args = append(args, f.AccountName)
	}
	if f.Status != "" {
		where = append(where, "status = ?")
		args = append(args, f.Status)
	}
	if f.Model != "" {
		where = append(where, "model = ?")
		args = append(args, f.Model)
	}
	if f.From != nil {
		where = append(where, "datetime(timestamp) >= datetime(?)")
		args = append(args, sqliteTime(*f.From))
	}
	if f.To != nil {
		where = append(where, "datetime(timestamp) <= datetime(?)")
		args = append(args, sqliteTime(*f.To))
	}
	if f.MinLatencyMs > 0 {
		where = append(where, "latency_ms >= ?")
		args = append(args, f.MinLatencyMs)
	}

	whereClause := strings.Join(where, " AND ")

	var total int
	countArgs := make([]any, len(args))
	copy(countArgs, args)
	if err := d.QueryRow("SELECT count(*) FROM request_logs WHERE "+whereClause, countArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count: %w", err)
	}

	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	query := fmt.Sprintf(
		"SELECT id, timestamp, account_id, account_name, provider_type, model, endpoint, status, latency_ms, prompt_tokens, completion_tokens, status_code, error_message FROM request_logs WHERE %s ORDER BY timestamp DESC LIMIT ? OFFSET ?",
		whereClause,
	)
	args = append(args, limit, f.Offset)

	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	var logs []RequestLog
	for rows.Next() {
		var l RequestLog
		if err := rows.Scan(&l.ID, &l.Timestamp, &l.AccountID, &l.AccountName, &l.ProviderType, &l.Model, &l.Endpoint, &l.Status, &l.LatencyMs, &l.PromptTokens, &l.CompletionTokens, &l.StatusCode, &l.ErrorMessage); err != nil {
			return nil, 0, err
		}
		logs = append(logs, l)
	}
	return logs, total, rows.Err()
}

func (d *DB) GetOverviewStats(from, to time.Time) (OverviewStats, error) {
	var s OverviewStats
	err := d.QueryRow(`
		SELECT
			count(*),
			count(CASE WHEN status = 'success' THEN 1 END),
			count(CASE WHEN status != 'success' THEN 1 END),
			coalesce(avg(CASE WHEN status = 'success' THEN latency_ms END), 0),
			coalesce(sum(prompt_tokens) + sum(completion_tokens), 0),
			coalesce(sum(prompt_tokens), 0),
			coalesce(sum(completion_tokens), 0)
		FROM request_logs WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)`,
		sqliteTime(from), sqliteTime(to),
	).Scan(&s.TotalRequests, &s.SuccessCount, &s.ErrorCount, &s.AvgLatencyMs, &s.TotalTokens,
		&s.PromptTokens, &s.CompletionTokens)
	if err != nil {
		return s, err
	}

	// Yesterday's stats for trend comparison
	yesterdayStart := from.AddDate(0, 0, -1)
	err = d.QueryRow(`
		SELECT
			count(*),
			coalesce(avg(CASE WHEN status = 'success' THEN latency_ms END), 0)
		FROM request_logs WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)`,
		sqliteTime(yesterdayStart), sqliteTime(from),
	).Scan(&s.YesterdayRequests, &s.YesterdayLatencyMs)
	return s, err
}

func (d *DB) GetAccountStats(from, to time.Time) ([]AccountStats, error) {
	rows, err := d.Query(`
		SELECT
			account_name,
			count(*) as total,
			count(CASE WHEN status = 'success' THEN 1 END) as successes,
			count(CASE WHEN status != 'success' THEN 1 END) as errors,
			coalesce(avg(CASE WHEN status = 'success' THEN latency_ms END), 0) as avg_lat,
			coalesce(sum(prompt_tokens), 0) as prompt_tok,
			coalesce(sum(completion_tokens), 0) as comp_tok
		FROM request_logs WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)
		GROUP BY account_name ORDER BY total DESC`,
		sqliteTime(from), sqliteTime(to),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []AccountStats
	for rows.Next() {
		var s AccountStats
		if err := rows.Scan(&s.AccountName, &s.TotalRequests, &s.SuccessCount, &s.ErrorCount, &s.AvgLatencyMs, &s.PromptTokens, &s.CompletionTokens); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

func (d *DB) GetProviderStats(from, to time.Time) ([]ProviderStats, error) {
	rows, err := d.Query(`
		SELECT r.provider_type AS provider,
		       COUNT(*) AS total_requests,
		       COALESCE(SUM(r.prompt_tokens + r.completion_tokens), 0) AS total_tokens,
		       SUM(CASE WHEN r.status = 'error' THEN 1 ELSE 0 END) AS error_count,
		       COALESCE(AVG(CASE WHEN r.status = 'success' THEN r.latency_ms END), 0) AS avg_latency_ms
		FROM request_logs r
		WHERE datetime(r.timestamp) BETWEEN datetime(?) AND datetime(?)
		  AND r.provider_type != ''
		GROUP BY r.provider_type
		ORDER BY total_requests DESC`,
		sqliteTime(from), sqliteTime(to),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []ProviderStats
	for rows.Next() {
		var s ProviderStats
		if err := rows.Scan(&s.Provider, &s.TotalRequests, &s.TotalTokens, &s.ErrorCount, &s.AvgLatencyMs); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

func (d *DB) GetModelStats(from, to time.Time, provider string) ([]ModelStats, error) {
	query := `
		SELECT r.model,
		       COUNT(*) AS total_requests,
		       COALESCE(SUM(r.prompt_tokens + r.completion_tokens), 0) AS total_tokens
		FROM request_logs r`
	args := []any{}

	if provider != "" {
		query += ` WHERE datetime(r.timestamp) BETWEEN datetime(?) AND datetime(?)
		AND r.provider_type = ?`
		args = append(args, sqliteTime(from), sqliteTime(to), provider)
	} else {
		query += ` WHERE datetime(r.timestamp) BETWEEN datetime(?) AND datetime(?)`
		args = append(args, sqliteTime(from), sqliteTime(to))
	}

	query += ` GROUP BY r.model ORDER BY total_requests DESC LIMIT 20`

	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []ModelStats
	for rows.Next() {
		var s ModelStats
		if err := rows.Scan(&s.Model, &s.TotalRequests, &s.TotalTokens); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

type ErrorRateResult struct {
	TotalRequests int
	ErrorCount    int
	ErrorRate     float64 // 0.0 to 100.0
}

func (d *DB) GetErrorRate(from, to time.Time) (ErrorRateResult, error) {
	var r ErrorRateResult
	err := d.QueryRow(`
		SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
		FROM request_logs
		WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)`,
		sqliteTime(from), sqliteTime(to),
	).Scan(&r.TotalRequests, &r.ErrorCount)
	if err != nil {
		return r, err
	}
	if r.TotalRequests > 0 {
		r.ErrorRate = float64(r.ErrorCount) / float64(r.TotalRequests) * 100
	}
	return r, nil
}

// AccountTotals holds lifetime aggregate counts for a single account.
type AccountTotals struct {
	AccountName   string `json:"account_name"`
	TotalRequests int    `json:"total_requests"`
	TotalTokens   int    `json:"total_tokens"`
}

// GetAccountTotals returns lifetime total requests and tokens per account (no time window).
func (d *DB) GetAccountTotals() (map[string]AccountTotals, error) {
	rows, err := d.Query(`
		SELECT account_name,
		       count(*),
		       coalesce(sum(prompt_tokens) + sum(completion_tokens), 0)
		FROM request_logs
		GROUP BY account_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]AccountTotals)
	for rows.Next() {
		var t AccountTotals
		if err := rows.Scan(&t.AccountName, &t.TotalRequests, &t.TotalTokens); err != nil {
			return nil, err
		}
		result[t.AccountName] = t
	}
	return result, rows.Err()
}

type AccountStats struct {
	AccountName      string  `json:"account_name"`
	TotalRequests    int     `json:"total_requests"`
	SuccessCount     int     `json:"success_count"`
	ErrorCount       int     `json:"error_count"`
	AvgLatencyMs     float64 `json:"avg_latency_ms"`
	PromptTokens     int     `json:"prompt_tokens"`
	CompletionTokens int     `json:"completion_tokens"`
}

func (d *DB) RollupDailyStats(retentionDays int) error {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	_, err := d.Exec(`
		INSERT OR REPLACE INTO daily_stats (date, account_id, account_name, total_requests, success_count, error_count, total_prompt_tokens, total_completion_tokens, avg_latency_ms)
		SELECT
			date(timestamp) as d,
			account_id,
			account_name,
			count(*),
			count(CASE WHEN status = 'success' THEN 1 END),
			count(CASE WHEN status != 'success' THEN 1 END),
			coalesce(sum(prompt_tokens), 0),
			coalesce(sum(completion_tokens), 0),
			coalesce(avg(CASE WHEN status = 'success' THEN latency_ms END), 0)
		FROM request_logs
		WHERE datetime(timestamp) < datetime(?)
		GROUP BY d, account_id, account_name`,
		sqliteTime(cutoff),
	)
	return err
}

func (d *DB) PruneOldLogs(retentionDays int) (int64, error) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	res, err := d.Exec("DELETE FROM request_logs WHERE datetime(timestamp) < datetime(?)", sqliteTime(cutoff))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
