import type { ProviderId } from './providerCatalog';
import { getModelDescriptor, getProviderCapability, resolveProviderModels } from './providerCatalog';
import type { ProviderPreflightResult } from './runtimeTypes';

type ValidateRequest = {
    providerId: ProviderId;
    model: string;
    baseUrl: string;
    apiKey?: string;
    apiKeys?: string[];
    requiresTools: boolean;
    dynamicModels?: Array<{ id: string; label: string }>;
};

export class ProviderPreflight {
    public validateRequest(request: ValidateRequest): ProviderPreflightResult {
        const capability = getProviderCapability(request.providerId);
        const errors: string[] = [];
        const warnings: string[] = [];
        const keyCount = (request.apiKeys?.filter((key) => key.trim()).length ?? 0)
            || (request.apiKey?.trim() ? 1 : 0);
        const resolvedModel = request.model || capability.defaultModel || capability.fallbackModels[0] || '';
        const knownModels = resolveProviderModels(request.providerId, request.dynamicModels);
        const modelDescriptor = getModelDescriptor(request.providerId, resolvedModel, request.dynamicModels);

        if (!request.baseUrl.trim()) {
            errors.push(`${capability.label}: base URL is empty.`);
        }

        if (capability.requiresApiKey && keyCount === 0) {
            errors.push(`${capability.label}: API key is required.`);
        }

        if (!resolvedModel && request.providerId !== 'custom') {
            errors.push(`${capability.label}: no model selected.`);
        }

        if (resolvedModel && request.providerId !== 'custom' && knownModels.length > 0 && !modelDescriptor) {
            errors.push(`${capability.label}: "${resolvedModel}" is not a known model for this provider.`);
        }

        if (request.requiresTools && !capability.supportsTools) {
            errors.push(`${capability.label}: this provider is not configured for tool use.`);
        }

        if (request.requiresTools && modelDescriptor && !modelDescriptor.supportsTools) {
            errors.push(`${capability.label}: "${resolvedModel}" does not support tool calling.`);
        }

        if (modelDescriptor && modelDescriptor.maxContextTokens < 32_000) {
            warnings.push(`${capability.label}: "${resolvedModel}" has a small context window (${modelDescriptor.maxContextTokens} tokens).`);
        }

        return {
            ok: errors.length === 0,
            providerId: request.providerId,
            model: request.model,
            resolvedModel,
            warnings,
            errors,
            supportsTools: modelDescriptor?.supportsTools ?? capability.supportsTools,
        };
    }
}
