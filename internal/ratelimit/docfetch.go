package ratelimit

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/darkraise/llm-proxy/internal/store"
	"golang.org/x/net/html"
)

// cacheEntry holds a fetched result with its expiry time.
type cacheEntry struct {
	defs      []store.RateLimitDef
	expiresAt time.Time
}

var cache sync.Map // key: provider string → value: cacheEntry

const cacheTTL = 1 * time.Hour
const fetchTimeout = 10 * time.Second

// FetchProviderRateLimits fetches live rate limit definitions from provider
// documentation pages. Results are cached for 1 hour.
// Returns nil, nil for unsupported providers.
func FetchProviderRateLimits(provider string) ([]store.RateLimitDef, error) {
	if v, ok := cache.Load(provider); ok {
		entry := v.(cacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.defs, nil
		}
	}

	var defs []store.RateLimitDef

	// Try live fetch first (works when docs pages are server-rendered).
	switch provider {
	case "groq":
		if live, err := fetchGroq(); err == nil && len(live) > 0 {
			defs = live
		}
	case "cerebras":
		if live, err := fetchCerebras(); err == nil && len(live) > 0 {
			defs = live
		}
	}

	// Fall back to known defaults when live fetch fails or returns empty
	// (common for SPA docs pages that require JS rendering).
	if len(defs) == 0 {
		defs = knownDefaults(provider)
	}

	if len(defs) > 0 {
		cache.Store(provider, cacheEntry{defs: defs, expiresAt: time.Now().Add(cacheTTL)})
	}
	return defs, nil
}

// knownDefaults returns hardcoded free-tier rate limits from provider documentation.
// These are maintained manually and serve as a fallback when live docs pages
// cannot be parsed (e.g., SPA pages that require JS rendering).
func knownDefaults(provider string) []store.RateLimitDef {
	rl := func(p, m, metric string, max, win int) store.RateLimitDef {
		return store.RateLimitDef{Provider: p, Model: m, Metric: metric, MaxValue: max, WindowSecs: win}
	}
	switch provider {
	case "groq":
		return []store.RateLimitDef{
			rl("groq", "", "rpm", 30, 60),
			rl("groq", "", "tpm", 6000, 60),
			rl("groq", "llama-3.3-70b-versatile", "rpm", 30, 60),
			rl("groq", "llama-3.3-70b-versatile", "rpd", 1000, 86400),
			rl("groq", "llama-3.3-70b-versatile", "tpm", 12000, 60),
			rl("groq", "llama-3.1-8b-instant", "rpm", 30, 60),
			rl("groq", "llama-3.1-8b-instant", "rpd", 14400, 86400),
			rl("groq", "llama-3.1-8b-instant", "tpm", 6000, 60),
			rl("groq", "meta-llama/llama-4-scout-17b-16e-instruct", "rpm", 30, 60),
			rl("groq", "meta-llama/llama-4-scout-17b-16e-instruct", "rpd", 1000, 86400),
			rl("groq", "meta-llama/llama-4-scout-17b-16e-instruct", "tpm", 30000, 60),
		}
	case "google":
		return []store.RateLimitDef{
			rl("google", "", "rpm", 10, 60),
			rl("google", "", "rpd", 250, 86400),
			rl("google", "", "tpm", 1000000, 60),
		}
	case "openrouter":
		return []store.RateLimitDef{
			rl("openrouter", "", "rpm", 20, 60),
			rl("openrouter", "", "rpd", 200, 86400),
		}
	case "cerebras":
		return []store.RateLimitDef{
			rl("cerebras", "", "rpm", 30, 60),
			rl("cerebras", "", "tpm", 60000, 60),
			rl("cerebras", "llama-3.3-70b", "rpm", 30, 60),
			rl("cerebras", "llama-3.3-70b", "rpd", 14400, 86400),
			rl("cerebras", "llama-3.3-70b", "tpm", 64000, 60),
			rl("cerebras", "llama-3.1-8b", "rpm", 30, 60),
			rl("cerebras", "llama-3.1-8b", "rpd", 14400, 86400),
			rl("cerebras", "llama-3.1-8b", "tpm", 60000, 60),
		}
	case "mistral":
		return []store.RateLimitDef{
			rl("mistral", "", "rps", 1, 1),
			rl("mistral", "", "tpm", 500000, 60),
		}
	case "github":
		return []store.RateLimitDef{
			rl("github", "", "rpm", 10, 60),
			rl("github", "", "rpd", 50, 86400),
		}
	default:
		return nil
	}
}

func fetchGroq() ([]store.RateLimitDef, error) {
	body, err := fetchHTML("https://console.groq.com/docs/rate-limits")
	if err != nil {
		return nil, fmt.Errorf("fetch groq docs: %w", err)
	}
	return parseRateLimitTables(body, "groq"), nil
}

func fetchCerebras() ([]store.RateLimitDef, error) {
	body, err := fetchHTML("https://inference-docs.cerebras.ai/support/rate-limits")
	if err != nil {
		return nil, fmt.Errorf("fetch cerebras docs: %w", err)
	}
	return parseRateLimitTables(body, "cerebras"), nil
}

func fetchHTML(url string) (string, error) {
	client := &http.Client{Timeout: fetchTimeout}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; llm-proxy/1.0)")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	buf := new(strings.Builder)
	_, err = io.Copy(buf, resp.Body)
	return buf.String(), err
}

// parseRateLimitTables finds all <table> elements in the HTML and extracts
// rate limit definitions from rows whose headers match known column names.
func parseRateLimitTables(htmlStr, provider string) []store.RateLimitDef {
	doc, err := html.Parse(strings.NewReader(htmlStr))
	if err != nil {
		return nil
	}

	tables := findNodes(doc, "table")
	var defs []store.RateLimitDef
	for _, table := range tables {
		defs = append(defs, parseTable(table, provider)...)
	}
	return defs
}

// parseTable extracts rate limit definitions from a single <table> node.
func parseTable(table *html.Node, provider string) []store.RateLimitDef {
	rows := findNodes(table, "tr")
	if len(rows) < 2 {
		return nil
	}

	// First row: identify column indices.
	headers := rowCells(rows[0])
	colModel := -1
	colRPM := -1
	colRPD := -1
	colTPM := -1
	colTPD := -1

	for i, h := range headers {
		norm := strings.ToLower(strings.TrimSpace(h))
		switch {
		case strings.Contains(norm, "model"):
			colModel = i
		case norm == "rpm" || strings.Contains(norm, "requests per minute") || strings.Contains(norm, "req/min"):
			colRPM = i
		case norm == "rpd" || strings.Contains(norm, "requests per day") || strings.Contains(norm, "req/day"):
			colRPD = i
		case norm == "tpm" || strings.Contains(norm, "tokens per minute") || strings.Contains(norm, "tok/min"):
			colTPM = i
		case norm == "tpd" || strings.Contains(norm, "tokens per day") || strings.Contains(norm, "tok/day"):
			colTPD = i
		}
	}

	// Need at least a model column and one metric column to be useful.
	if colModel == -1 || (colRPM == -1 && colRPD == -1 && colTPM == -1 && colTPD == -1) {
		return nil
	}

	var defs []store.RateLimitDef
	for _, row := range rows[1:] {
		cells := rowCells(row)
		if colModel >= len(cells) {
			continue
		}
		model := strings.TrimSpace(cells[colModel])
		if model == "" || model == "—" {
			continue
		}

		add := func(col int, metric string, window int) {
			if col < 0 || col >= len(cells) {
				return
			}
			v := parseRateLimitValue(cells[col])
			if v <= 0 {
				return
			}
			defs = append(defs, store.RateLimitDef{
				Provider:   provider,
				Model:      model,
				Metric:     metric,
				MaxValue:   v,
				WindowSecs: window,
			})
		}

		add(colRPM, "rpm", 60)
		add(colRPD, "rpd", 86400)
		add(colTPM, "tpm", 60)
		add(colTPD, "tpd", 86400)
	}
	return defs
}

// rowCells returns the text content of each <td> or <th> in a <tr> node.
func rowCells(tr *html.Node) []string {
	var cells []string
	for c := tr.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && (c.Data == "td" || c.Data == "th") {
			cells = append(cells, nodeText(c))
		}
	}
	return cells
}

// nodeText returns the concatenated text content of a node and its descendants.
func nodeText(n *html.Node) string {
	if n.Type == html.TextNode {
		return n.Data
	}
	var sb strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		sb.WriteString(nodeText(c))
	}
	return sb.String()
}

// findNodes returns all descendant nodes with the given tag name.
func findNodes(n *html.Node, tag string) []*html.Node {
	var result []*html.Node
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode && node.Data == tag {
			result = append(result, node)
		}
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return result
}

// parseRateLimitValue parses strings like "30", "1K", "14.4K", "500K", "1M",
// "1,000", "—", "" into an integer. Returns 0 for unrecognised or zero values.
func parseRateLimitValue(s string) int {
	s = strings.TrimSpace(s)
	if s == "" || s == "—" || s == "-" || s == "N/A" || s == "n/a" {
		return 0
	}

	// Strip commas (e.g. "1,000").
	s = strings.ReplaceAll(s, ",", "")

	// Extract the first token (handles "30 RPM" → "30").
	if idx := strings.IndexAny(s, " \t\n"); idx > 0 {
		s = s[:idx]
	}

	multiplier := 1.0
	upper := strings.ToUpper(s)
	switch {
	case strings.HasSuffix(upper, "M"):
		multiplier = 1_000_000
		s = s[:len(s)-1]
	case strings.HasSuffix(upper, "K"):
		multiplier = 1_000
		s = s[:len(s)-1]
	}

	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return int(f * multiplier)
}
