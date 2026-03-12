import rawCatalog from '../../../src/shared/providerCatalog.json';

export type ProviderId =
    | 'ollama'
    | 'openrouter'
    | 'groq'
    | 'gemini'
    | 'cerebras'
    | 'mistral'
    | 'puter'
    | 'custom';

export interface ModelDescriptor {
    id: string;
    label: string;
    tag: 'cloud' | 'local';
    supportsTools: boolean;
    supportsStreaming: boolean;
    supportsReasoning: boolean;
    supportsVision: boolean;
    maxContextTokens: number;
}

export interface ProviderCapability {
    id: ProviderId;
    label: string;
    baseUrl: string;
    requiresApiKey: boolean;
    protocol: 'openai' | 'ollama';
    modelsEndpoint?: string;
    docsUrl: string;
    keySignupUrl: string;
    isLocal: boolean;
    badge?: string;
    supportsTools: boolean;
    supportsStreaming: boolean;
    supportsReasoning: boolean;
    supportsVision: boolean;
    maxContextTokens: number;
    defaultModel: string;
    fallbackModels: string[];
    defaultModels: ModelDescriptor[];
}

const catalogProviders = (rawCatalog.providers ?? []) as ProviderCapability[];

export const PROVIDERS: ProviderCapability[] = catalogProviders.map((provider) => ({
    ...provider,
    defaultModels: Array.isArray(provider.defaultModels)
        ? provider.defaultModels.map((model) => ({
            ...model,
            supportsTools: model.supportsTools ?? provider.supportsTools,
            supportsStreaming: model.supportsStreaming ?? provider.supportsStreaming,
            supportsReasoning: model.supportsReasoning ?? provider.supportsReasoning,
            supportsVision: model.supportsVision ?? provider.supportsVision,
            maxContextTokens: model.maxContextTokens ?? provider.maxContextTokens,
        }))
        : [],
}));

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapability> = Object.fromEntries(
    PROVIDERS.map((provider) => [provider.id, provider])
) as Record<ProviderId, ProviderCapability>;

export const DEFAULT_PROVIDER: ProviderId = 'ollama';

export function getProviderCapability(providerId: ProviderId): ProviderCapability {
    return PROVIDER_CAPABILITIES[providerId];
}
