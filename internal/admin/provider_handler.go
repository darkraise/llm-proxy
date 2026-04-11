package admin

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/darkraise/llm-proxy/internal/store"
)

var validProviderName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

var validAPIStandards = map[string]bool{
	"openai": true, "google": true, "anthropic": true, "cohere_embed": true,
}
var validAuthTypes = map[string]bool{
	"bearer": true, "api-key-header": true, "query-param": true, "none": true,
}

func (h *AdminHandler) HandleListProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := h.db.ListProviders()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to list providers"})
		return
	}
	if providers == nil {
		providers = []store.Provider{}
	}
	writeJSON(w, 200, providers)
}

func (h *AdminHandler) HandleGetProvider(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	p, err := h.db.GetProvider(name)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "provider not found"})
		return
	}
	writeJSON(w, 200, p)
}

func (h *AdminHandler) HandleCreateProvider(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name            string          `json:"name"`
		DisplayName     string          `json:"display_name"`
		BaseURL         string          `json:"base_url"`
		ModelsURL       string          `json:"models_url"`
		APIStandard     string          `json:"api_standard"`
		AuthType        string          `json:"auth_type"`
		AuthHeader      string          `json:"auth_header"`
		Capabilities    []string        `json:"capabilities"`
		ValidationSteps json.RawMessage `json:"validation_steps"`
		Enabled         *bool           `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request body"})
		return
	}

	input.Name = strings.TrimSpace(strings.ToLower(input.Name))
	if !validProviderName.MatchString(input.Name) {
		writeJSON(w, 400, map[string]string{"error": "name must be lowercase alphanumeric with hyphens or underscores"})
		return
	}
	if input.DisplayName == "" {
		writeJSON(w, 400, map[string]string{"error": "display_name is required"})
		return
	}
	if input.APIStandard == "" {
		input.APIStandard = "openai"
	}
	if !validAPIStandards[input.APIStandard] {
		writeJSON(w, 400, map[string]string{"error": "api_standard must be one of: openai, google, anthropic, cohere_embed"})
		return
	}
	if input.AuthType == "" {
		input.AuthType = "bearer"
	}
	if !validAuthTypes[input.AuthType] {
		writeJSON(w, 400, map[string]string{"error": "auth_type must be one of: bearer, api-key-header, query-param, none"})
		return
	}
	if len(input.Capabilities) == 0 {
		input.Capabilities = []string{"chat"}
	}

	capsJSON, _ := json.Marshal(input.Capabilities)
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}

	vsJSON := ""
	if input.ValidationSteps != nil {
		vsJSON = string(input.ValidationSteps)
	}

	if err := h.db.CreateProvider(store.Provider{
		Name:            input.Name,
		DisplayName:     input.DisplayName,
		BaseURL:         input.BaseURL,
		ModelsURL:       input.ModelsURL,
		APIStandard:     input.APIStandard,
		AuthType:        input.AuthType,
		AuthHeader:      input.AuthHeader,
		Capabilities:    string(capsJSON),
		ValidationSteps: vsJSON,
		Enabled:         enabled,
	}); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeJSON(w, 409, map[string]string{"error": "provider with this name already exists"})
			return
		}
		writeJSON(w, 500, map[string]string{"error": "failed to create provider"})
		return
	}

	writeJSON(w, 201, map[string]string{"status": "created"})
}

func (h *AdminHandler) HandleUpdateProvider(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	existing, err := h.db.GetProvider(name)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "provider not found"})
		return
	}

	var input struct {
		DisplayName     *string              `json:"display_name"`
		BaseURL         *string              `json:"base_url"`
		ModelsURL       *string              `json:"models_url"`
		APIStandard     *string              `json:"api_standard"`
		AuthType        *string              `json:"auth_type"`
		AuthHeader      *string              `json:"auth_header"`
		Capabilities    []string             `json:"capabilities"`
		DefaultLimits   []store.ProviderLimit `json:"default_limits"`
		ValidationSteps json.RawMessage      `json:"validation_steps"`
		Enabled         *bool                `json:"enabled"`
		SetLimits       bool                 `json:"set_limits"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid request body"})
		return
	}

	updated := existing
	if input.DisplayName != nil {
		updated.DisplayName = *input.DisplayName
	}
	if input.BaseURL != nil {
		updated.BaseURL = *input.BaseURL
	}
	if input.Enabled != nil {
		updated.Enabled = *input.Enabled
	}
	if input.SetLimits {
		limitsJSON, _ := json.Marshal(input.DefaultLimits)
		updated.DefaultLimits = string(limitsJSON)
	}
	if input.ValidationSteps != nil {
		updated.ValidationSteps = string(input.ValidationSteps)
	}

	// Builtin providers: only allow display_name, base_url, enabled, default_limits, validation_steps changes.
	if !existing.IsBuiltin {
		if input.ModelsURL != nil {
			updated.ModelsURL = *input.ModelsURL
		}
		if input.APIStandard != nil {
			if !validAPIStandards[*input.APIStandard] {
				writeJSON(w, 400, map[string]string{"error": "invalid api_standard"})
				return
			}
			updated.APIStandard = *input.APIStandard
		}
		if input.AuthType != nil {
			if !validAuthTypes[*input.AuthType] {
				writeJSON(w, 400, map[string]string{"error": "invalid auth_type"})
				return
			}
			updated.AuthType = *input.AuthType
		}
		if input.AuthHeader != nil {
			updated.AuthHeader = *input.AuthHeader
		}
		if input.Capabilities != nil {
			capsJSON, _ := json.Marshal(input.Capabilities)
			updated.Capabilities = string(capsJSON)
		}
	}

	if err := h.db.UpdateProvider(name, updated); err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to update provider"})
		return
	}

	writeJSON(w, 200, map[string]string{"status": "updated"})
}

func (h *AdminHandler) HandleDeleteProvider(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	existing, err := h.db.GetProvider(name)
	if err != nil {
		writeJSON(w, 404, map[string]string{"error": "provider not found"})
		return
	}
	if existing.IsBuiltin {
		writeJSON(w, 403, map[string]string{"error": "cannot delete builtin provider; disable it instead"})
		return
	}

	count, _ := h.db.CountAccountsByProvider(name)
	if count > 0 {
		writeJSON(w, 409, map[string]string{"error": "cannot delete provider with existing accounts; remove or reassign them first"})
		return
	}

	if err := h.db.DeleteProvider(name); err != nil {
		writeJSON(w, 500, map[string]string{"error": "failed to delete provider"})
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}
