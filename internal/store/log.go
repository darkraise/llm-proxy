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
	AccountName string
	Status      string
	Model       string
	From        *time.Time
	To          *time.Time
	Limit       int
	Offset      int
}

type OverviewStats struct {
	TotalRequests int     `json:"total_requests"`
	SuccessCount  int     `json:"success_count"`
	ErrorCount    int     `json:"error_count"`
	AvgLatencyMs  float64 `json:"avg_latency_ms"`
	P95LatencyMs  int     `json:"p95_latency_ms"`
	TotalTokens   int     `json:"total_tokens"`
}

func (d *DB) InsertRequestLog(l RequestLog) error {
	_, err := d.Exec(
		`INSERT INTO request_logs (account_id, account_name, model, endpoint, status, latency_ms, prompt_tokens, completion_tokens, status_code, error_message)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		l.AccountID, l.AccountName, l.Model, l.Endpoint, l.Status, l.LatencyMs, l.PromptTokens, l.CompletionTokens, l.StatusCode, l.ErrorMessage,
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
		"SELECT id, timestamp, account_id, account_name, model, endpoint, status, latency_ms, prompt_tokens, completion_tokens, status_code, error_message FROM request_logs WHERE %s ORDER BY timestamp DESC LIMIT ? OFFSET ?",
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
		if err := rows.Scan(&l.ID, &l.Timestamp, &l.AccountID, &l.AccountName, &l.Model, &l.Endpoint, &l.Status, &l.LatencyMs, &l.PromptTokens, &l.CompletionTokens, &l.StatusCode, &l.ErrorMessage); err != nil {
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
			coalesce(sum(prompt_tokens) + sum(completion_tokens), 0)
		FROM request_logs WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)`,
		sqliteTime(from), sqliteTime(to),
	).Scan(&s.TotalRequests, &s.SuccessCount, &s.ErrorCount, &s.AvgLatencyMs, &s.TotalTokens)
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
