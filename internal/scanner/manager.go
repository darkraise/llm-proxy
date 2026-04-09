package scanner

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/store"
)

type Manager struct {
	db            *store.DB
	encryptionKey []byte
	sources       map[string]Source
	mu            sync.Mutex
	status        ScanStatus
	cancelFn      context.CancelFunc
}

func NewManager(db *store.DB, encryptionKey []byte) *Manager {
	return &Manager{
		db:            db,
		encryptionKey: encryptionKey,
		sources:       make(map[string]Source),
	}
}

func (m *Manager) RegisterSource(s Source) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sources[s.Name()] = s
}

func (m *Manager) Sources() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	names := make([]string, 0, len(m.sources))
	for name := range m.sources {
		names = append(names, name)
	}
	return names
}


func (m *Manager) Status() ScanStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

func (m *Manager) Start(sourceFilter string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.status.Running {
		return errors.New("scan already running")
	}

	// Snapshot sources under the lock to avoid racing with ConfigureGitHub.
	sources := make(map[string]Source, len(m.sources))
	for k, v := range m.sources {
		sources[k] = v
	}

	ctx, cancel := context.WithCancel(context.Background())
	m.cancelFn = cancel
	now := time.Now()
	m.status = ScanStatus{
		Running:   true,
		Source:    sourceFilter,
		StartedAt: &now,
	}

	go m.run(ctx, sourceFilter, sources)
	return nil
}

func (m *Manager) Stop() {
	m.mu.Lock()
	cancel := m.cancelFn
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (m *Manager) run(ctx context.Context, sourceFilter string, sources map[string]Source) {
	startedAt := time.Now()

	patterns, err := m.db.ListEnabledKeyPatterns()
	if err != nil {
		m.finalize(startedAt, 0, 0, fmt.Sprintf("load patterns: %s", err))
		return
	}

	scanPatterns := make([]KeyPattern, 0, len(patterns))
	for _, p := range patterns {
		scanPatterns = append(scanPatterns, KeyPattern{
			Provider:   p.Provider,
			Prefix:     p.Prefix,
			Regex:      p.Regex,
			SearchTerm: p.SearchTerm,
		})
	}

	histID, err := m.db.InsertScanHistory(store.ScanHistory{
		Source:    sourceFilter,
		StartedAt: startedAt,
		Status:    "running",
	})
	if err != nil {
		slog.Error("scanner: failed to insert scan history", "error", err)
	}

	m.mu.Lock()
	m.status.PatternsTotal = len(scanPatterns)
	m.status.PatternsDone = 0
	m.mu.Unlock()

	onProgress := func(provider string, done, total int) {
		m.mu.Lock()
		m.status.Provider = provider
		m.status.PatternsDone = done
		m.status.PatternsTotal = total
		m.mu.Unlock()
	}

	resultsCh := make(chan RawKey, 100)

	var wg sync.WaitGroup
	for name, src := range sources {
		if sourceFilter != "" && name != sourceFilter {
			continue
		}
		wg.Add(1)
		go func(s Source) {
			defer wg.Done()
			if err := s.Scan(ctx, scanPatterns, resultsCh, onProgress); err != nil && !errors.Is(err, context.Canceled) {
				slog.Error("scanner: source scan failed", "source", s.Name(), "error", err)
			}
		}(src)
	}

	go func() {
		wg.Wait()
		close(resultsCh)
	}()

	keysFound := 0
	keysNew := 0
	keysValid := 0

	for raw := range resultsCh {
		keysFound++

		hash := crypto.HashKey(raw.Key)

		existing, err := m.db.GetDiscoveredKeyByHash(hash)
		if err != nil {
			slog.Error("scanner: db lookup failed", "error", err)
			continue
		}
		if existing != nil {
			continue
		}

		valid, vErr := ValidateKey(m.db, raw.Provider, raw.Key)
		if vErr != nil {
			slog.Debug("scanner: validation failed", "provider", raw.Provider, "error", vErr)
			continue
		}
		if !valid {
			continue
		}

		keysValid++

		keyEnc, err := crypto.Encrypt(m.encryptionKey, []byte(raw.Key))
		if err != nil {
			slog.Error("scanner: encrypt failed", "error", err)
			continue
		}

		validTrue := true
		n, err := m.db.InsertDiscoveredKey(store.DiscoveredKey{
			KeyHash:    hash,
			KeyEnc:     keyEnc,
			Provider:   raw.Provider,
			Source:     raw.Source,
			SourceURL:  raw.SourceURL,
			SourceRepo: raw.SourceRepo,
			SourceFile: raw.SourceFile,
			Valid:      &validTrue,
		})
		if err != nil {
			slog.Error("scanner: insert discovered key failed", "error", err)
			continue
		}
		if n > 0 {
			keysNew++
			slog.Info("scanner: valid key stored", "provider", raw.Provider, "repo", raw.SourceRepo)
		}

		m.mu.Lock()
		m.status.KeysFound = keysFound
		m.status.KeysNew = keysNew
		m.mu.Unlock()
	}

	m.finalize(startedAt, keysFound, keysNew, "")

	if histID > 0 {
		now := time.Now()
		_ = m.db.UpdateScanHistory(histID, store.ScanHistory{
			CompletedAt:  &now,
			Status:       "completed",
			KeysFound:    keysFound,
			KeysNew:      keysNew,
			KeysValid:    keysValid,
			ErrorMessage: "",
		})
	}
}

func (m *Manager) finalize(startedAt time.Time, keysFound, keysNew int, errMsg string) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status.Running = false
	m.status.KeysFound = keysFound
	m.status.KeysNew = keysNew
	m.status.CompletedAt = &now
	m.status.Error = errMsg
	m.cancelFn = nil
}

func (m *Manager) ConfigureGitHub(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if token != "" {
		m.sources["github"] = NewGitHubSource(token)
	} else {
		delete(m.sources, "github")
	}
}

func (m *Manager) ConfigureGitHubParams(delay time.Duration, maxPages int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if src, ok := m.sources["github"]; ok {
		if gs, ok := src.(*GitHubSource); ok {
			if delay > 0 {
				gs.SetDelay(delay)
			}
			if maxPages > 0 {
				gs.SetMaxPages(maxPages)
			}
		}
	}
}

func (m *Manager) GitHubConfig() (delay time.Duration, maxPages int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if src, ok := m.sources["github"]; ok {
		if gs, ok := src.(*GitHubSource); ok {
			return gs.Delay(), gs.MaxPages()
		}
	}
	return 5 * time.Second, 10
}
