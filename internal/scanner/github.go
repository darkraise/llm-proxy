package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"sync"
	"time"
)

const githubAPIBase = "https://api.github.com"

type GitHubSource struct {
	token    string
	mu       sync.RWMutex
	delay    time.Duration
	maxPages int
}

func NewGitHubSource(token string) *GitHubSource {
	return &GitHubSource{
		token:    token,
		delay:    5 * time.Second,
		maxPages: 10,
	}
}

func (g *GitHubSource) SetDelay(d time.Duration) {
	g.mu.Lock()
	g.delay = d
	g.mu.Unlock()
}

func (g *GitHubSource) SetMaxPages(n int) {
	g.mu.Lock()
	g.maxPages = n
	g.mu.Unlock()
}

func (g *GitHubSource) Delay() time.Duration {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.delay
}

func (g *GitHubSource) MaxPages() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return g.maxPages
}

func (g *GitHubSource) Name() string { return "github" }

func (g *GitHubSource) Scan(ctx context.Context, patterns []KeyPattern, results chan<- RawKey, onProgress ProgressFunc) error {
	client := &http.Client{Timeout: 30 * time.Second}

	for i, pattern := range patterns {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if onProgress != nil {
			onProgress(pattern.Provider, i, len(patterns))
		}
		if err := g.scanPattern(ctx, client, pattern, results); err != nil {
			slog.Error("github scanner: pattern scan failed", "provider", pattern.Provider, "error", err)
		}
	}
	if onProgress != nil {
		onProgress("", len(patterns), len(patterns))
	}
	return nil
}

type githubSearchResponse struct {
	Items []struct {
		Repository struct {
			FullName string `json:"full_name"`
		} `json:"repository"`
		Path        string `json:"path"`
		HTMLURL     string `json:"html_url"`
		TextMatches []struct {
			Fragment string `json:"fragment"`
		} `json:"text_matches"`
	} `json:"items"`
}

func (g *GitHubSource) scanPattern(ctx context.Context, client *http.Client, pattern KeyPattern, results chan<- RawKey) error {
	if pattern.SearchTerm == "" || pattern.Regex == "" {
		return nil
	}

	rx, err := regexp.Compile(pattern.Regex)
	if err != nil {
		return fmt.Errorf("compile regex for %s: %w", pattern.Provider, err)
	}

	delay := g.Delay()
	maxPages := g.MaxPages()

	ticker := time.NewTicker(delay)
	defer ticker.Stop()

	for page := 1; page <= maxPages; page++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		if page > 1 {
			select {
			case <-ticker.C:
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		searchURL := buildGitHubSearchURL(pattern.SearchTerm, page)
		resp, err := g.doRequest(ctx, client, searchURL, delay)
		if err != nil {
			slog.Warn("github scanner: request failed", "provider", pattern.Provider, "page", page, "error", err)
			break
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			break
		}

		if resp.StatusCode != 200 {
			slog.Warn("github scanner: non-200 response", "provider", pattern.Provider, "status", resp.StatusCode)
			break
		}

		var data githubSearchResponse
		if err := json.Unmarshal(body, &data); err != nil {
			break
		}

		if len(data.Items) == 0 {
			break
		}

		for _, item := range data.Items {
			for _, tm := range item.TextMatches {
				matches := rx.FindAllStringSubmatch(tm.Fragment, -1)
				for _, m := range matches {
					key := m[0]
					if len(m) > 1 && m[1] != "" {
						key = m[1]
					}
					select {
					case results <- RawKey{
						Key:        key,
						Provider:   pattern.Provider,
						Source:     g.Name(),
						SourceURL:  item.HTMLURL,
						SourceRepo: item.Repository.FullName,
						SourceFile: item.Path,
					}:
					case <-ctx.Done():
						return ctx.Err()
					}
				}
			}
		}

		if len(data.Items) < 30 {
			break
		}
	}

	return nil
}

func (g *GitHubSource) doRequest(ctx context.Context, client *http.Client, endpoint string, fallbackDelay time.Duration) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "token "+g.token)
	req.Header.Set("Accept", "application/vnd.github.text-match+json")

	slog.Debug("egress", "method", "GET", "url", endpoint, "target", "github")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	slog.Debug("egress response", "url", endpoint, "status", resp.StatusCode)

	if resp.StatusCode == 403 || resp.StatusCode == 429 {
		remaining := resp.Header.Get("X-RateLimit-Remaining")
		if remaining == "0" {
			resetHeader := resp.Header.Get("X-RateLimit-Reset")
			wait := fallbackDelay
			if resetTs, err := strconv.ParseInt(resetHeader, 10, 64); err == nil {
				if d := time.Until(time.Unix(resetTs, 0)); d > 0 {
					wait = d
				}
			}
			slog.Warn("github scanner: rate limited, waiting", "wait", wait)
			resp.Body.Close()
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			req2, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
			if err != nil {
				return nil, err
			}
			req2.Header.Set("Authorization", "token "+g.token)
			req2.Header.Set("Accept", "application/vnd.github.text-match+json")
			return client.Do(req2)
		}
	}

	return resp, nil
}

func buildGitHubSearchURL(query string, page int) string {
	params := url.Values{}
	params.Set("q", query)
	params.Set("page", strconv.Itoa(page))
	params.Set("per_page", "30")
	return githubAPIBase + "/search/code?" + params.Encode()
}
