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
		writeJSONError(w, 503, "scanner not configured")
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
		writeJSONError(w, 503, "scanner not configured")
		return
	}
	var req struct {
		Source string `json:"source"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if err := h.scanner.Start(req.Source); err != nil {
		writeJSONError(w, 409, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "started"})
}

func (h *AdminHandler) HandleStopScan(w http.ResponseWriter, r *http.Request) {
	if h.scanner == nil {
		writeJSONError(w, 503, "scanner not configured")
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
		writeJSONError(w, 500, err.Error())
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
	id, ok := parsePathID(w, r)
	if !ok {
		return
	}

	dk, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSONError(w, 404, "key not found")
		return
	}

	plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
	if err != nil {
		writeJSONError(w, 500, "failed to decrypt key")
		return
	}

	valid, err := scanner.ValidateKey(h.db, dk.Provider, string(plainKey))
	if err != nil {
		writeJSON(w, 200, map[string]any{"valid": false, "error": err.Error()})
		return
	}

	if err := h.db.UpdateDiscoveredKeyValidity(id, valid); err != nil {
		writeJSONError(w, 500, err.Error())
		return
	}

	updated, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSONError(w, 500, err.Error())
		return
	}

	writeJSON(w, 200, discoveredKeyResponse{
		DiscoveredKey: updated,
		MaskedKey:     maskKey(string(plainKey)),
	})
}

// HandleBulkValidateKeys validates multiple keys sequentially and streams
// results as Server-Sent Events. This avoids the SQLITE_BUSY errors that
// occur when the frontend fires many parallel validate requests.
//
// POST /api/scanner/keys/validate
func (h *AdminHandler) HandleBulkValidateKeys(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 {
		writeJSONError(w, 400, "ids array is required")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, 500, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(200)

	ctx := r.Context()
	for _, id := range req.IDs {
		if ctx.Err() != nil {
			return
		}

		dk, err := h.db.GetDiscoveredKey(id)
		if err != nil {
			continue
		}

		plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
		if err != nil {
			continue
		}

		valid, _ := scanner.ValidateKey(h.db, dk.Provider, string(plainKey))
		h.db.UpdateDiscoveredKeyValidity(id, valid)

		result, _ := json.Marshal(map[string]any{
			"id":         id,
			"provider":   dk.Provider,
			"masked_key": maskKey(string(plainKey)),
			"valid":      valid,
		})
		fmt.Fprintf(w, "data: %s\n\n", result)
		flusher.Flush()
	}

	fmt.Fprintf(w, "data: {\"done\":true}\n\n")
	flusher.Flush()
}

func (h *AdminHandler) HandleImportDiscoveredKey(w http.ResponseWriter, r *http.Request) {
	id, ok := parsePathID(w, r)
	if !ok {
		return
	}

	var req struct {
		Models map[string][]string `json:"models"`
		Name   string              `json:"name"`
		Limits []store.AccountLimit `json:"limits"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, 400, "invalid request")
		return
	}

	dk, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSONError(w, 404, "key not found")
		return
	}

	if dk.Imported {
		writeJSONError(w, 409, "key already imported")
		return
	}

	plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
	if err != nil {
		writeJSONError(w, 500, "failed to decrypt key")
		return
	}

	apiKeyEnc, err := crypto.Encrypt(h.encryptionKey, plainKey)
	if err != nil {
		writeJSONError(w, 500, "encryption failed")
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
			writeJSONError(w, 409, "API key already exists in another account")
			return
		}
		writeJSONError(w, 400, err.Error())
		return
	}

	if err := h.db.MarkDiscoveredKeyImported(id, accountID); err != nil {
		writeJSONError(w, 500, err.Error())
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
		writeJSONError(w, 400, "invalid request")
		return
	}

	ids := req.IDs
	if req.All {
		validTrue := true
		importedFalse := false
		keys, _, err := h.db.ListDiscoveredKeys("", "", &validTrue, &importedFalse, 100000, 0)
		if err != nil {
			writeJSONError(w, 500, err.Error())
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
	id, ok := parsePathID(w, r)
	if !ok {
		return
	}

	dk, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSONError(w, 404, "key not found")
		return
	}

	plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
	if err != nil {
		writeJSONError(w, 500, "failed to decrypt key")
		return
	}

	info := h.providerInfo(dk.Provider, "")
	results := keyval.Validate(r.Context(), info, string(plainKey), []keyval.StepConfig{{Step: "models_fetch"}})
	last := results[len(results)-1]

	if !last.Success {
		writeJSONError(w, 502, last.Error)
		return
	}

	models := make([]map[string]string, len(last.Models))
	for i, m := range last.Models {
		models[i] = map[string]string{"id": m, "name": m}
	}
	writeJSON(w, 200, map[string]any{"models": models})
}

func (h *AdminHandler) HandleChatTestByDiscoveredKey(w http.ResponseWriter, r *http.Request) {
	id, ok := parsePathID(w, r)
	if !ok {
		return
	}

	var req struct {
		Model   string `json:"model"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, 400, "invalid request body")
		return
	}
	if req.Model == "" {
		writeJSONError(w, 400, "model is required")
		return
	}
	if req.Message == "" {
		req.Message = "say ok"
	}

	dk, err := h.db.GetDiscoveredKey(id)
	if err != nil {
		writeJSONError(w, 404, "key not found")
		return
	}

	plainKey, err := crypto.Decrypt(h.encryptionKey, dk.KeyEnc)
	if err != nil {
		writeJSONError(w, 500, "failed to decrypt key")
		return
	}

	info := h.providerInfo(dk.Provider, "")
	steps := []keyval.StepConfig{
		{Step: "chat_completion", Params: map[string]any{
			"model": req.Model, "message": req.Message, "max_tokens": float64(20),
		}},
	}
	results := keyval.Validate(r.Context(), info, string(plainKey), steps)
	last := results[len(results)-1]

	writeJSON(w, 200, map[string]any{
		"status_code": last.StatusCode,
		"response":    last.Response,
		"rate_limits": last.RateLimits,
		"error":       last.Error,
	})
}

func (h *AdminHandler) HandleBulkDeleteKeys(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, 400, "invalid request")
		return
	}
	deleted, err := h.db.DeleteDiscoveredKeys(req.IDs)
	if err != nil {
		writeJSONError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"deleted": deleted})
}

func (h *AdminHandler) HandleDeleteDiscoveredKey(w http.ResponseWriter, r *http.Request) {
	id, ok := parsePathID(w, r)
	if !ok {
		return
	}

	if err := h.db.DeleteDiscoveredKey(id); err != nil {
		writeJSONError(w, 500, err.Error())
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
		writeJSONError(w, 500, err.Error())
		return
	}
	if histories == nil {
		histories = []store.ScanHistory{}
	}

	writeJSON(w, 200, histories)
}

func (h *AdminHandler) HandleGetScannerConfig(w http.ResponseWriter, r *http.Request) {
	all, _ := h.db.GetAllSettings()

	maskToken := func(key string) string {
		stored := all[key]
		if stored == "" || h.encryptionKey == nil {
			return ""
		}
		var enc []byte
		fmt.Sscanf(stored, "%x", &enc)
		if len(enc) == 0 {
			return ""
		}
		plain, err := crypto.Decrypt(h.encryptionKey, enc)
		if err != nil || len(plain) == 0 {
			return ""
		}
		if len(plain) >= 4 {
			return "..." + string(plain[len(plain)-4:])
		}
		return "***"
	}

	githubMasked := maskToken("scanner_github_token")
	delay, maxPages := h.scanner.GitHubConfig()

	writeJSON(w, 200, map[string]any{
		"github_token_configured": githubMasked != "",
		"github_token_masked":    githubMasked,
		"delay_seconds":          int(delay.Seconds()),
		"max_pages":              maxPages,
	})
}

func (h *AdminHandler) HandleUpdateScannerConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GithubToken *string `json:"github_token"`
		DelaySecs   *int   `json:"delay_seconds"`
		MaxPages    *int   `json:"max_pages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, 400, "invalid request")
		return
	}

	saveEncrypted := func(key, value string) error {
		if value != "" {
			enc, err := crypto.Encrypt(h.encryptionKey, []byte(value))
			if err != nil {
				return err
			}
			return h.db.SetSetting(key, fmt.Sprintf("%x", enc))
		}
		return h.db.SetSetting(key, "")
	}

	if req.GithubToken != nil {
		if err := saveEncrypted("scanner_github_token", *req.GithubToken); err != nil {
			writeJSONError(w, 500, err.Error())
			return
		}
		if h.scanner != nil {
			h.scanner.ConfigureGitHub(*req.GithubToken)
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
		writeJSONError(w, 500, err.Error())
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
		writeJSONError(w, 500, "failed to marshal JSON")
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
		writeJSONError(w, 500, err.Error())
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
		writeJSONError(w, 400, "invalid request")
		return
	}
	if err := h.db.UpsertKeyPattern(req); err != nil {
		writeJSONError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *AdminHandler) HandleDeleteKeyPattern(w http.ResponseWriter, r *http.Request) {
	id, ok := parsePathID(w, r)
	if !ok {
		return
	}
	if err := h.db.DeleteKeyPattern(id); err != nil {
		writeJSONError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "ok"})
}
