package provider

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/store"
)

type AccountInfo struct {
	store.Account
	DecryptedKey string
	DefaultModel string
}

type Pool struct {
	mu          sync.RWMutex
	accounts    []AccountInfo
	rateLimiter *RateLimiter
	index       int // round-robin index
}

func NewPool(accounts []store.Account) *Pool {
	rl := NewRateLimiter()

	infos := make([]AccountInfo, 0, len(accounts))
	for _, p := range accounts {
		if !p.Enabled {
			continue
		}
		infos = append(infos, AccountInfo{
			Account:      p,
			DecryptedKey: string(p.APIKey),
			DefaultModel: p.DefaultModel,
		})

		var limits []LimitConfig
		for _, l := range p.Limits {
			limits = append(limits, LimitConfig{
				Model: l.Model, Metric: l.Metric, MaxValue: l.MaxValue, WindowSecs: l.WindowSecs,
			})
		}
		rl.Configure(p.Name, limits)
	}

	return &Pool{
		accounts:    infos,
		rateLimiter: rl,
	}
}

func (p *Pool) Select(model string, maxRetries int) (*AccountInfo, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if model == "auto" {
		return p.selectAuto(maxRetries)
	}
	return p.selectByModel(model, maxRetries)
}

func (p *Pool) selectAuto(maxRetries int) (*AccountInfo, error) {
	n := len(p.accounts)
	for i := 0; i < min(maxRetries, n); i++ {
		account := &p.accounts[p.index%n]
		p.index = (p.index + 1) % n

		// Determine which model will actually be used for this account.
		effectiveModel := account.DefaultModel
		if effectiveModel == "" {
			effectiveModel = firstModelFromJSON(account.Models)
		}

		if p.rateLimiter.AllowForModel(account.Name, effectiveModel) {
			return account, nil
		}
	}
	return nil, fmt.Errorf("all accounts exhausted")
}

func (p *Pool) selectByModel(model string, maxRetries int) (*AccountInfo, error) {
	// Find all accounts offering this model
	var candidates []*AccountInfo
	for i := range p.accounts {
		if accountHasModel(&p.accounts[i], model) {
			candidates = append(candidates, &p.accounts[i])
		}
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no account found for model %q", model)
	}

	for i := 0; i < min(maxRetries, len(candidates)); i++ {
		c := candidates[i%len(candidates)]
		if p.rateLimiter.AllowForModel(c.Name, model) {
			return c, nil
		}
	}
	return nil, fmt.Errorf("all accounts for model %q exhausted", model)
}

func accountHasModel(p *AccountInfo, model string) bool {
	var models []string
	if err := json.Unmarshal([]byte(p.Models), &models); err != nil {
		return false
	}
	for _, m := range models {
		if m == model {
			return true
		}
	}
	return false
}

// firstModelFromJSON returns the first model from a JSON array string, or "" on error.
func firstModelFromJSON(modelsJSON string) string {
	var models []string
	if err := json.Unmarshal([]byte(modelsJSON), &models); err == nil && len(models) > 0 {
		return models[0]
	}
	return ""
}

func (p *Pool) RecordSuccess(name string, tokens int) {
	p.rateLimiter.RecordRequest(name)
	if tokens > 0 {
		p.rateLimiter.RecordTokens(name, tokens)
	}
}

// RecordSuccessForModel updates both account-level and model-specific counters.
func (p *Pool) RecordSuccessForModel(name, model string, tokens int) {
	p.rateLimiter.RecordRequestForModel(name, model)
	if tokens > 0 {
		p.rateLimiter.RecordTokensForModel(name, model, tokens)
	}
}

func (p *Pool) RecordRateLimit(name string, retryAfter time.Duration) {
	p.rateLimiter.RecordBackoff(name, retryAfter)
}

func (p *Pool) RecordError(name string, backoff time.Duration) {
	p.rateLimiter.RecordBackoff(name, backoff)
}

func (p *Pool) AllowTokens(name string, estimated int) bool {
	return p.rateLimiter.AllowTokens(name, estimated)
}

func (p *Pool) Status() map[string]AccountStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()

	result := make(map[string]AccountStatus)
	for _, acc := range p.accounts {
		result[acc.Name] = p.rateLimiter.Status(acc.Name)
	}
	return result
}

func (p *Pool) ListModels() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	seen := map[string]bool{"auto": true}
	models := []string{"auto"}
	for _, acc := range p.accounts {
		var ms []string
		json.Unmarshal([]byte(acc.Models), &ms)
		for _, m := range ms {
			if !seen[m] {
				seen[m] = true
				models = append(models, m)
			}
		}
	}
	return models
}

func (p *Pool) Accounts() []AccountInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.accounts
}

func (p *Pool) Reload(accounts []store.Account) {
	newPool := NewPool(accounts)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.accounts = newPool.accounts
	p.rateLimiter = newPool.rateLimiter
	p.index = 0
}
