package scanner

import (
	"context"
	"time"
)

type ProgressFunc func(provider string, done, total int)

type Source interface {
	Name() string
	Scan(ctx context.Context, patterns []KeyPattern, results chan<- RawKey, onProgress ProgressFunc) error
}

type KeyPattern struct {
	Provider   string
	Prefix     string
	Regex      string
	SearchTerm string
}

type RawKey struct {
	Key        string
	Provider   string
	Source     string
	SourceURL  string
	SourceRepo string
	SourceFile string
}

type ScanStatus struct {
	Running       bool       `json:"running"`
	Source        string     `json:"source"`
	Provider      string     `json:"provider"`
	KeysFound     int        `json:"keys_found"`
	KeysNew       int        `json:"keys_new"`
	PatternsTotal int        `json:"patterns_total"`
	PatternsDone  int        `json:"patterns_done"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
	Error         string     `json:"error,omitempty"`
}
