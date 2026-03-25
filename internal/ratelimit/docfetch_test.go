package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/darkraise/llm-proxy/internal/store"
)

// ─── parseRateLimitValue ─────────────────────────────────────────────────────

func TestParseRateLimitValue(t *testing.T) {
	cases := []struct {
		input string
		want  int
	}{
		{"30", 30},
		{"1K", 1000},
		{"1k", 1000},
		{"14.4K", 14400},
		{"500K", 500000},
		{"1M", 1000000},
		{"1.5M", 1500000},
		{"—", 0},
		{"", 0},
		{"N/A", 0},
		{"-", 0},
		{"1,000", 1000},
		{"14,400", 14400},
		{"100 RPM", 100},
		{"0", 0},
	}

	for _, tc := range cases {
		got := parseRateLimitValue(tc.input)
		if got != tc.want {
			t.Errorf("parseRateLimitValue(%q) = %d, want %d", tc.input, got, tc.want)
		}
	}
}

// ─── mock HTML helpers ───────────────────────────────────────────────────────

const groqHTML = `<!DOCTYPE html>
<html><body>
<h2>Free Tier Rate Limits</h2>
<table>
  <thead>
    <tr>
      <th>Model</th>
      <th>RPM</th>
      <th>RPD</th>
      <th>TPM</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>llama-3.3-70b-versatile</td>
      <td>30</td>
      <td>1000</td>
      <td>12000</td>
    </tr>
    <tr>
      <td>llama-3.1-8b-instant</td>
      <td>30</td>
      <td>14400</td>
      <td>6000</td>
    </tr>
    <tr>
      <td>mixtral-8x7b-32768</td>
      <td>30</td>
      <td>14400</td>
      <td>5000</td>
    </tr>
  </tbody>
</table>
</body></html>`

const cerebrasHTML = `<!DOCTYPE html>
<html><body>
<h2>Rate Limits</h2>
<table>
  <thead>
    <tr>
      <th>Model</th>
      <th>Requests Per Minute</th>
      <th>Requests Per Day</th>
      <th>Tokens Per Minute</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>llama-3.3-70b</td>
      <td>30</td>
      <td>14.4K</td>
      <td>64K</td>
    </tr>
    <tr>
      <td>llama-3.1-8b</td>
      <td>30</td>
      <td>14.4K</td>
      <td>60K</td>
    </tr>
  </tbody>
</table>
</body></html>`

// patchFetch replaces the live URL for a provider with a mock server URL,
// runs f, then restores the originals.
func withMockServer(content string, f func(url string)) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(content))
	}))
	defer srv.Close()
	f(srv.URL)
}

// ─── Groq mock test ──────────────────────────────────────────────────────────

func TestFetchGroq_MockHTML(t *testing.T) {
	withMockServer(groqHTML, func(url string) {
		// Directly test the table parser on the mock HTML.
		defs := parseRateLimitTables(groqHTML, "groq")

		if len(defs) == 0 {
			t.Fatal("expected rate limit defs, got none")
		}

		byModelMetric := map[string]store.RateLimitDef{}
		for _, d := range defs {
			byModelMetric[d.Model+"/"+d.Metric] = d
		}

		tests := []struct {
			model  string
			metric string
			want   int
		}{
			{"llama-3.3-70b-versatile", "rpm", 30},
			{"llama-3.3-70b-versatile", "rpd", 1000},
			{"llama-3.3-70b-versatile", "tpm", 12000},
			{"llama-3.1-8b-instant", "rpm", 30},
			{"llama-3.1-8b-instant", "rpd", 14400},
			{"llama-3.1-8b-instant", "tpm", 6000},
			{"mixtral-8x7b-32768", "tpm", 5000},
		}

		for _, tc := range tests {
			key := tc.model + "/" + tc.metric
			d, ok := byModelMetric[key]
			if !ok {
				t.Errorf("missing def for %s", key)
				continue
			}
			if d.MaxValue != tc.want {
				t.Errorf("%s max_value = %d, want %d", key, d.MaxValue, tc.want)
			}
			if d.Provider != "groq" {
				t.Errorf("%s provider = %q, want groq", key, d.Provider)
			}
		}
	})
}

// ─── Cerebras mock test ──────────────────────────────────────────────────────

func TestFetchCerebras_MockHTML(t *testing.T) {
	withMockServer(cerebrasHTML, func(_ string) {
		defs := parseRateLimitTables(cerebrasHTML, "cerebras")

		if len(defs) == 0 {
			t.Fatal("expected rate limit defs, got none")
		}

		byModelMetric := map[string]store.RateLimitDef{}
		for _, d := range defs {
			byModelMetric[d.Model+"/"+d.Metric] = d
		}

		tests := []struct {
			model  string
			metric string
			want   int
		}{
			{"llama-3.3-70b", "rpm", 30},
			{"llama-3.3-70b", "rpd", 14400},
			{"llama-3.3-70b", "tpm", 64000},
			{"llama-3.1-8b", "rpm", 30},
			{"llama-3.1-8b", "rpd", 14400},
			{"llama-3.1-8b", "tpm", 60000},
		}

		for _, tc := range tests {
			key := tc.model + "/" + tc.metric
			d, ok := byModelMetric[key]
			if !ok {
				t.Errorf("missing def for %s", key)
				continue
			}
			if d.MaxValue != tc.want {
				t.Errorf("%s max_value = %d, want %d", key, d.MaxValue, tc.want)
			}
			if d.Provider != "cerebras" {
				t.Errorf("%s provider = %q, want cerebras", key, d.Provider)
			}
		}
	})
}

// ─── Unsupported provider ────────────────────────────────────────────────────

func TestFetchUnsupported(t *testing.T) {
	// Clear cache for this provider in case a prior test stored something.
	cache.Delete("openai")

	defs, err := FetchProviderRateLimits("openai")
	if err != nil {
		t.Fatalf("unexpected error for unsupported provider: %v", err)
	}
	if defs != nil {
		t.Fatalf("expected nil for unsupported provider, got %v", defs)
	}
}
