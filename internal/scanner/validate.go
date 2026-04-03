package scanner

import (
	"context"

	"github.com/darkraise/llm-proxy/internal/keyval"
	"github.com/darkraise/llm-proxy/internal/store"
)

func ValidateKey(db *store.DB, provider, key string) (bool, error) {
	prov, err := db.GetProvider(provider)
	if err != nil {
		return false, err
	}

	info := keyval.ProviderInfo{
		Name:        prov.Name,
		BaseURL:     prov.BaseURL,
		ModelsURL:   prov.ModelsURL,
		AuthType:    prov.AuthType,
		AuthHeader:  prov.AuthHeader,
		APIStandard: prov.APIStandard,
	}

	steps := keyval.ParseStepConfigs(prov.ValidationSteps)
	results := keyval.Validate(context.Background(), info, key, steps)

	if len(results) == 0 {
		return false, nil
	}
	return results[len(results)-1].Success, nil
}
