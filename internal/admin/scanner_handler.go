package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/darkraise/llm-proxy/internal/crypto"
	"github.com/darkraise/llm-proxy/internal/keyval"
	"github.com/darkraise/llm-proxy/internal/scanner"
	"github.com/darkraise/llm-proxy/internal/store"
)

func (h *AdminHandler) generateAccountName(provider string) string {
	return generateName(provider, h.usedAccountNames())
}

func (h *AdminHandler) usedAccountNames() map[string]bool {
	accounts, _ := h.db.ListAccounts()
	used := make(map[string]bool, len(accounts))
	for _, a := range accounts {
		used[a.Name] = true
	}
	return used
}

func generateName(provider string, used map[string]bool) string {
	for i := 1; ; i++ {
		name := fmt.Sprintf("%s-%d", provider, i)
		if !used[name] {
			return name
		}
	}
}

func maskKey(key string) string {
	if len(key) <= 14 {
		return strings.Repeat("*", len(key))
	}
	return key[:10] + "..." + key[len(key)-4:]
}

func (h *AdminHandler) HandleGetScannerStatus(w http.ResponseWriter, r *http.Request) {
	if h.scanner == nil {
		writeJSON(w, 503, map[string]string{"error": "scanner not configured"})
		return
	}
	status := h.scanner.Status()
	total, valid, imported, _ := h.db.CountDiscoveredKeys()
	providerCount, _ := h.db.CountKeyPatternProviders()
	sources := h.scanner.Sources()
	delay, maxPages := h.scanner.GitHubConfig()

	writeJSON(w, 200, map[string]any{
		"status":          status,
		"total":           total,
		"valid":           valid,
		"imported":        imported,
		"providers_count": providerCount,
		"sources":         sources,
		"config": map[string]any{
			"delay_seconds": int(delay.Seconds()),
			"max_pages":     maxPages,
		},
	})
}

func (h *AdminHandler) HandleStartScan(w http.ResponseWriter, r *http.Request) {
	if h.scanner == nil {
		writeJSON(w, 503, map[string]string{"error": "scanner not configured"})
		return
	}
	var req struct {
		Source string `json:"source"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if err := h.scanner.Start(req.Source); err != nil {
		writeJSON(w, 409, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "started"})
}

func (h *AdminHandler) HandleStopScan(w http.ResponseWriter, r *http.Request) {
	if h.scanner == nil {
		writeJSON(w, 503, map[string]string{"error": "scanner not configured"})
		return
	}
	h.scanner.Stop()
	writeJSON(w, 200, map[string]string{"status": "stopped"})
}

type discoveredKeyResponse struct {
	store.DiscoveredKey
	MaskedKey string `json:"masked_key"`
}

func (h *AdminHandler) HandleListDiscoveredKeys(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	providerFilter := q.Get("provider")
	sourceFilter := q.Get("source")

	var validFilter *bool
	if v := q.Get("valid"); v == "true" {
		b := true
		validFilter = &b
	} else if v == "false" {
		b := false
		validFilter = &b
	}

	var importedFilter *bool
	if v := q.Get("imported"); v == "true" {
		b := true
		importedFilter = &b
	} else if v == "false" {
		b := false
		importedFilter = &b
	}

	limit := 100
	if l, err := strconv.Atoi(q.Get("limit")); err == nil && l > 0 {
		limit = l
	}
	offset := 0
	if o, err := strconv.Atoi(q.Get("offset")); err == nil && o >= 0 {
		offset = o
	}

	keys, total, err := h.db.ListDiscoveredKeys(providerFilter, sourceFilter, validFilter, importedFilter, limit, offset)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	result := make([]discoveredKeyResponse, 0, len(keys))
	for _, dk := range keys {
		var masked string
		if h.encryptionKey != nil {
			if plain, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc); err == nil {
				masked = maskKey(string(plain))
			}
		}
		result = append(result, discoveredKeyResponse{DiscoveredKey: dk, MaskedKey: masked})
	}

	writeJSON(w, 200, map[string]any{"data": result, "total": total})
}

func (h *AdminHandler) HandleValidateDiscoveredKey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	dk, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "key not found"})
		return
	}

	plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to decrypt key"})
		return
	}

	valid, err := scanner.ValidateKey(h.db, dk.Provider, string(plainKey))
	if err != nil {
		writeJSON(w, 200, map[string]any{"valid": false, "error": err.Error()})
		return
	}

	if err := h.db.UpdateDiscoveredKeyValidity(id, valid); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	updated, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, 200, discoveredKeyResponse{
		DiscoveredKey: updated,
		MaskedKey:     maskKey(string(plainKey)),
	})
}

func (h *AdminHandler) HandleImportDiscoveredKey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	var req struct {
		Models map[string][]string `json:"models"`
		Name   string              `json:"name"`
		Limits []store.AccountLimit `json:"limits"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	dk, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "key not found"})
		return
	}

	if dk.Imported {
		writeJSON(w, 409, map[string]string{"error": "key already imported"})
		return
	}

	plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to decrypt key"})
		return
	}

	apiKeyEnc, err := crypto.Encrypt(h.encryptionKey, plainKey)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "encryption failed"})
		return
	}

	name := req.Name
	if name == "" {
		name = h.generateAccountName(dk.Provider)
	}

	account := store.Account{
		Name:       name,
		Type:       dk.Provider,
		APIKey:     apiKeyEnc,
		APIKeyHash: crypto.HashKey(string(plainKey)),
		Models:     store.FormatCategorizedModels(req.Models),
		Priority:   0,
		Enabled:    true,
		Limits:     req.Limits,
	}

	accountID, err := h.db.CreateAccount(account)
	if err != nil {
		if strings.Contains(err.Error(), "api_key_hash") {
			writeJSON(w, 409, map[string]string{"error": "API key already exists in another account"})
			return
		}
		writeJSON(w, 400, map[string]string{"error": err.Error()})
		return
	}

	if err := h.db.MarkDiscoveredKeyImported(id, accountID); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	h.reloadPool()
	writeJSON(w, 201, map[string]any{"id": accountID, "name": name})
}

func (h *AdminHandler) HandleBulkImportKeys(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs    []int64              `json:"ids"`
		All    bool                 `json:"all"`
		Models map[string][]string  `json:"models"`
		Limits []store.AccountLimit `json:"limits"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	ids := req.IDs
	if req.All {
		validTrue := true
		importedFalse := false
		keys, _, err := h.db.ListDiscoveredKeys("", "", &validTrue, &importedFalse, 100000, 0)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		ids = make([]int64, 0, len(keys))
		for _, k := range keys {
			ids = append(ids, k.ID)
		}
	}

	usedNames := h.usedAccountNames()
	imported := 0
	for _, id := range ids {
		dk, err := h.db.GetDiscoveredKey(id)
		if err != nil || dk.Imported {
			continue
		}

		plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
		if err != nil {
			continue
		}

		apiKeyEnc, err := crypto.Encrypt(h.encryptionKey, plainKey)
		if err != nil {
			continue
		}

		name := generateName(dk.Provider, usedNames)
		usedNames[name] = true

		account := store.Account{
			Name:       name,
			Type:       dk.Provider,
			APIKey:     apiKeyEnc,
			APIKeyHash: crypto.HashKey(string(plainKey)),
			Models:     store.FormatCategorizedModels(req.Models),
			Enabled:    true,
			Limits:     req.Limits,
		}

		accountID, err := h.db.CreateAccount(account)
		if err != nil {
			continue
		}

		if err := h.db.MarkDiscoveredKeyImported(id, accountID); err != nil {
			continue
		}

		imported++
	}

	h.reloadPool()
	writeJSON(w, 200, map[string]any{"imported": imported})
}

func (h *AdminHandler) HandleDiscoverByDiscoveredKey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	dk, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "key not found"})
		return
	}

	plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to decrypt key"})
		return
	}

	info := h.providerInfo(dk.Provider, "")
	results := keyval.Validate(r.Context(), info, string(plainKey), []keyval.StepConfig{{Step: "models_fetch"}})
	last := results[len(results)-1]

	if !last.Success {
		writeJSON(w, 502, map[string]string{"error": last.Error})
		return
	}

	models := make([]map[string]string, len(last.Models))
	for i, m := range last.Models {
		models[i] = map[string]string{"id": m, "name": m}
	}
	writeJSON(w, 200, map[string]any{"models": models})
}

func (h *AdminHandler) HandleBulkDeleteKeys(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	deleted, err := h.db.DeleteDiscoveredKeys(req.IDs)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"deleted": deleted})
}

func (h *AdminHandler) HandleDeleteDiscoveredKey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}

	if err := h.db.DeleteDiscoveredKey(id); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *AdminHandler) HandleListScanHistory(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
		limit = l
	}

	histories, err := h.db.ListScanHistory(limit)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if histories == nil {
		histories = []store.ScanHistory{}
	}

	writeJSON(w, 200, histories)
}

func (h *AdminHandler) HandleGetScannerConfig(w http.ResponseWriter, r *http.Request) {
	all, _ := h.db.GetAllSettings()

	githubTokenMasked := ""
	if enc := all["scanner_github_token"]; enc != "" && h.encryptionKey != nil {
		if plain, err := crypto.Decrypt(h.encryptionKey, []byte(enc)); err == nil && len(plain) > 0 {
			if len(plain) >= 4 {
				githubTokenMasked = "..." + string(plain[len(plain)-4:])
			} else {
				githubTokenMasked = "***"
			}
		}
	}

	delay, maxPages := h.scanner.GitHubConfig()

	writeJSON(w, 200, map[string]any{
		"github_token_configured": githubTokenMasked != "",
		"github_token_masked":     githubTokenMasked,
		"delay_seconds":           int(delay.Seconds()),
		"max_pages":               maxPages,
	})
}

func (h *AdminHandler) HandleUpdateScannerConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GithubToken *string `json:"github_token"`
		DelaySecs   *int    `json:"delay_seconds"`
		MaxPages    *int    `json:"max_pages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}

	if req.GithubToken != nil {
		if *req.GithubToken != "" {
			enc, err := crypto.Encrypt(h.encryptionKey, []byte(*req.GithubToken))
			if err != nil {
				writeJSON(w, 500, map[string]string{"error": "encryption failed"})
				return
			}
			if err := h.db.SetSetting("scanner_github_token", string(enc)); err != nil {
				writeJSON(w, 500, map[string]string{"error": err.Error()})
				return
			}
			if h.scanner != nil {
				h.scanner.ConfigureGitHub(*req.GithubToken)
			}
		} else {
			h.db.SetSetting("scanner_github_token", "")
			if h.scanner != nil {
				h.scanner.ConfigureGitHub("")
			}
		}
	}

	if req.DelaySecs != nil || req.MaxPages != nil {
		delay := time.Duration(0)
		maxPages := 0
		if req.DelaySecs != nil && *req.DelaySecs > 0 {
			delay = time.Duration(*req.DelaySecs) * time.Second
			h.db.SetSetting("scanner_delay", fmt.Sprintf("%d", *req.DelaySecs))
		}
		if req.MaxPages != nil && *req.MaxPages > 0 {
			maxPages = *req.MaxPages
			h.db.SetSetting("scanner_max_pages", fmt.Sprintf("%d", *req.MaxPages))
		}
		if h.scanner != nil {
			h.scanner.ConfigureGitHubParams(delay, maxPages)
		}
	}

	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *AdminHandler) HandleExportScanResults(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	providerFilter := q.Get("provider")
	sourceFilter := q.Get("source")

	var validFilter *bool
	if v := q.Get("valid"); v == "true" {
		b := true
		validFilter = &b
	}

	keys, _, err := h.db.ListDiscoveredKeys(providerFilter, sourceFilter, validFilter, nil, 100000, 0)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	byProvider := make(map[string][]map[string]any)
	for _, dk := range keys {
		var plainKey string
		if h.encryptionKey != nil {
			if plain, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc); err == nil {
				plainKey = string(plain)
			}
		}
		if plainKey == "" {
			continue
		}
		entry := map[string]any{
			"key":  plainKey,
			"repo": dk.SourceRepo,
			"file": dk.SourceFile,
			"url":  dk.SourceURL,
		}
		if dk.Valid != nil {
			entry["valid"] = *dk.Valid
		}
		byProvider[dk.Provider] = append(byProvider[dk.Provider], entry)
	}

	grouped := make(map[string]any, len(byProvider))
	totalKeys := 0
	for prov, entries := range byProvider {
		grouped[prov] = map[string]any{
			"count": len(entries),
			"keys":  entries,
		}
		totalKeys += len(entries)
	}

	result := map[string]any{
		"scan_date":   time.Now().UTC().Format(time.RFC3339),
		"total_keys":  totalKeys,
		"by_provider": grouped,
	}

	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to marshal JSON"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=scanner-results.json")
	w.Write(data)
}

func (h *AdminHandler) HandleListKeyPatterns(w http.ResponseWriter, r *http.Request) {
	providerFilter := r.URL.Query().Get("provider")
	patterns, err := h.db.ListKeyPatterns(providerFilter)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if patterns == nil {
		patterns = []store.KeyPattern{}
	}
	writeJSON(w, 200, patterns)
}

func (h *AdminHandler) HandleUpsertKeyPattern(w http.ResponseWriter, r *http.Request) {
	var req store.KeyPattern
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request"})
		return
	}
	if err := h.db.UpsertKeyPattern(req); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *AdminHandler) HandleDeleteKeyPattern(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid id"})
		return
	}
	if err := h.db.DeleteKeyPattern(id); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
