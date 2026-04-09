package provider

import (
	"fmt"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/store"
)

type AccountInfo struct {
	store.Account
	DecryptedKey  string
	DefaultModels map[string]string
	APIStandard   string // "openai", "google"
	AuthType      string // "bearer", "api-key-header", "query-param", "none"
	AuthHeader    string // custom header name for api-key-header
	ProviderURL   string // resolved base URL
}

type Pool struct {
	mu          sync.RWMutex
	accounts    []AccountInfo
	rateLimiter *RateLimiter
	index       int // round-robin index
}

func NewPool(accounts []store.Account, providers map[string]store.Provider) *Pool {
	rl := NewRateLimiter()

	infos := make([]AccountInfo, 0, len(accounts))
	for _, p := range accounts {
		if !p.Enabled {
			continue
		}

		prov, ok := providers[p.Type]
		if ok && !prov.Enabled {
			continue
		}
		apiStandard := "openai"
		authType := "bearer"
		authHeader := ""
		providerURL := p.BaseURL
		if ok {
			apiStandard = prov.APIStandard
			authType = prov.AuthType
			authHeader = prov.AuthHeader
			if providerURL == "" {
				providerURL = prov.BaseURL
			}
		}

		infos = append(infos, AccountInfo{
			Account:       p,
			DecryptedKey:  string(p.APIKey),
			DefaultModels: store.ParseDefaultModels(p.DefaultModels),
			APIStandard:   apiStandard,
			AuthType:      authType,
			AuthHeader:    authHeader,
			ProviderURL:   providerURL,
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

func (p *Pool) Select(model string, category string, maxRetries int) (*AccountInfo, error) {
	return p.SelectExcluding(model, category, maxRetries, nil)
}

func (p *Pool) SelectExcluding(model string, category string, maxRetries int, skipProviders map[string]bool) (*AccountInfo, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if model == "auto" {
		return p.selectAutoExcluding(category, maxRetries, skipProviders)
	}
	return p.selectByModelExcluding(model, maxRetries, skipProviders)
}

func (p *Pool) selectAutoExcluding(category string, maxRetries int, skipProviders map[string]bool) (*AccountInfo, error) {
	n := len(p.accounts)
	for i := 0; i < min(maxRetries, n); i++ {
		account := &p.accounts[p.index%n]
		p.index = (p.index + 1) % n

		// Skip excluded provider types
		if skipProviders != nil && skipProviders[account.Type] {
			continue
		}

		// Only consider accounts that have models in the requested category.
		parsed := store.ParseCategorizedModels(account.Models)
		catModels := store.ModelsForCategory(parsed, category)
		if len(catModels) == 0 {
			continue
		}

		// Determine which model will actually be used for this account.
		effectiveModel := account.DefaultModels[category]
		if effectiveModel == "" && len(catModels) > 0 {
			effectiveModel = catModels[0]
		}

		if p.rateLimiter.AllowForModel(account.Name, effectiveModel) {
			return account, nil
		}
	}
	return nil, fmt.Errorf("all accounts exhausted")
}

func (p *Pool) selectByModelExcluding(model string, maxRetries int, skipProviders map[string]bool) (*AccountInfo, error) {
	var candidates []*AccountInfo
	for i := range p.accounts {
		if skipProviders != nil && skipProviders[p.accounts[i].Type] {
			continue
		}
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
	parsed := store.ParseCategorizedModels(p.Models)
	for _, m := range store.AllModels(parsed) {
		if m == model {
			return true
		}
	}
	return false
}

func (p *Pool) RecordSuccessForModel(name, model string, tokens int) {
	p.mu.RLock()
	rl := p.rateLimiter
	p.mu.RUnlock()
	rl.RecordRequestForModel(name, model)
	if tokens > 0 {
		rl.RecordTokensForModel(name, model, tokens)
	}
}

func (p *Pool) RecordRateLimit(name string, retryAfter time.Duration) {
	p.mu.RLock()
	rl := p.rateLimiter
	p.mu.RUnlock()
	rl.RecordBackoff(name, retryAfter)
}

func (p *Pool) RecordError(name string, backoff time.Duration) {
	p.mu.RLock()
	rl := p.rateLimiter
	p.mu.RUnlock()
	rl.RecordBackoff(name, backoff)
}

func (p *Pool) RecordInputsForModel(name, model string, inputs int) {
	if inputs > 0 {
		p.mu.RLock()
		rl := p.rateLimiter
		p.mu.RUnlock()
		rl.RecordInputsForModel(name, model, inputs)
	}
}

func (p *Pool) AllowTokensForModel(name, model string, estimated int) bool {
	p.mu.RLock()
	rl := p.rateLimiter
	p.mu.RUnlock()
	return rl.AllowTokensForModel(name, model, estimated)
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
		parsed := store.ParseCategorizedModels(acc.Models)
		for _, m := range store.AllModels(parsed) {
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

func (p *Pool) Reload(accounts []store.Account, providers map[string]store.Provider) {
	newPool := NewPool(accounts, providers)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.accounts = newPool.accounts
	p.rateLimiter = newPool.rateLimiter
	p.index = 0
}
