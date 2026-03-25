package provider

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/store"
)

type ProviderInfo struct {
	store.Provider
	DecryptedKey string
}

type Pool struct {
	mu          sync.RWMutex
	providers   []ProviderInfo
	rateLimiter *RateLimiter
	index       int // round-robin index
}

func NewPool(providers []store.Provider) *Pool {
	rl := NewRateLimiter()

	infos := make([]ProviderInfo, 0, len(providers))
	for _, p := range providers {
		if !p.Enabled {
			continue
		}
		infos = append(infos, ProviderInfo{Provider: p, DecryptedKey: string(p.APIKey)})
		var limits []LimitConfig
		for _, l := range p.Limits {
			limits = append(limits, LimitConfig{
				Metric: l.Metric, MaxValue: l.MaxValue, WindowSecs: l.WindowSecs,
			})
		}
		rl.Configure(p.Name, limits)
	}

	return &Pool{
		providers:   infos,
		rateLimiter: rl,
	}
}

func (p *Pool) Select(model string, maxRetries int) (*ProviderInfo, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if model == "auto" {
		return p.selectAuto(maxRetries)
	}
	return p.selectByModel(model, maxRetries)
}

func (p *Pool) selectAuto(maxRetries int) (*ProviderInfo, error) {
	n := len(p.providers)
	for i := 0; i < min(maxRetries, n); i++ {
		provider := &p.providers[p.index%n]
		p.index = (p.index + 1) % n
		if p.rateLimiter.Allow(provider.Name) {
			return provider, nil
		}
	}
	return nil, fmt.Errorf("all providers exhausted")
}

func (p *Pool) selectByModel(model string, maxRetries int) (*ProviderInfo, error) {
	// Find all providers offering this model
	var candidates []*ProviderInfo
	for i := range p.providers {
		if providerHasModel(&p.providers[i], model) {
			candidates = append(candidates, &p.providers[i])
		}
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no provider found for model %q", model)
	}

	for i := 0; i < min(maxRetries, len(candidates)); i++ {
		c := candidates[i%len(candidates)]
		if p.rateLimiter.Allow(c.Name) {
			return c, nil
		}
	}
	return nil, fmt.Errorf("all providers for model %q exhausted", model)
}

func providerHasModel(p *ProviderInfo, model string) bool {
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

func (p *Pool) RecordSuccess(name string, tokens int) {
	p.rateLimiter.RecordRequest(name)
	if tokens > 0 {
		p.rateLimiter.RecordTokens(name, tokens)
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

func (p *Pool) Status() map[string]ProviderStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()

	result := make(map[string]ProviderStatus)
	for _, prov := range p.providers {
		result[prov.Name] = p.rateLimiter.Status(prov.Name)
	}
	return result
}

func (p *Pool) ListModels() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	seen := map[string]bool{"auto": true}
	models := []string{"auto"}
	for _, prov := range p.providers {
		var ms []string
		json.Unmarshal([]byte(prov.Models), &ms)
		for _, m := range ms {
			if !seen[m] {
				seen[m] = true
				models = append(models, m)
			}
		}
	}
	return models
}

func (p *Pool) Providers() []ProviderInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.providers
}

func (p *Pool) Reload(providers []store.Provider) {
	newPool := NewPool(providers)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.providers = newPool.providers
	p.rateLimiter = newPool.rateLimiter
	p.index = 0
}
