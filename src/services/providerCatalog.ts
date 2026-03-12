import rawCatalog from '../shared/providerCatalog.json';

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

export interface ProviderDef {
    id: ProviderId;
    label: string;
    baseUrl: string;
    requiresApiKey: boolean;
    protocol: 'openai' | 'ollama';
    modelsEndpoint?: string;
    defaultModels: Array<{ id: string; label: string }>;
    docsUrl: string;
    keySignupUrl: string;
}

const catalogProviders = (rawCatalog.providers ?? []) as ProviderCapability[];

export const PROVIDER_LIST: ProviderCapability[] = catalogProviders.map((provider) => ({
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
    PROVIDER_LIST.map((provider) => [provider.id, provider])
) as Record<ProviderId, ProviderCapability>;

export const PROVIDER_DEFS: Record<ProviderId, ProviderDef> = Object.fromEntries(
    PROVIDER_LIST.map((provider) => [
        provider.id,
        {
            id: provider.id,
            label: provider.label,
            baseUrl: provider.baseUrl,
            requiresApiKey: provider.requiresApiKey,
            protocol: provider.protocol,
            modelsEndpoint: provider.modelsEndpoint,
            defaultModels: provider.defaultModels.map((model) => ({ id: model.id, label: model.label })),
            docsUrl: provider.docsUrl,
            keySignupUrl: provider.keySignupUrl,
        },
    ])
) as Record<ProviderId, ProviderDef>;

export const DEFAULT_PROVIDER: ProviderId = 'ollama';

export function listProviderCapabilities(): ProviderCapability[] {
    return PROVIDER_LIST.map((provider) => ({
        ...provider,
        defaultModels: provider.defaultModels.map((model) => ({ ...model })),
        fallbackModels: [...provider.fallbackModels],
    }));
}

export function getProviderCapability(providerId: ProviderId): ProviderCapability {
    return PROVIDER_CAPABILITIES[providerId];
}

export function resolveProviderModels(
    providerId: ProviderId,
    dynamicModels?: Array<{ id: string; label: string }>
): ModelDescriptor[] {
    const provider = getProviderCapability(providerId);
    if (!dynamicModels || dynamicModels.length === 0) {
        return provider.defaultModels.map((model) => ({ ...model }));
    }

    return dynamicModels.map((dynamicModel) => {
        const known = provider.defaultModels.find((model) => model.id === dynamicModel.id);
        return {
            id: dynamicModel.id,
            label: dynamicModel.label || dynamicModel.id,
            tag: provider.isLocal ? 'local' : 'cloud',
            supportsTools: known?.supportsTools ?? provider.supportsTools,
            supportsStreaming: known?.supportsStreaming ?? provider.supportsStreaming,
            supportsReasoning: known?.supportsReasoning ?? provider.supportsReasoning,
            supportsVision: known?.supportsVision ?? provider.supportsVision,
            maxContextTokens: known?.maxContextTokens ?? provider.maxContextTokens,
        };
    });
}

export function getModelDescriptor(
    providerId: ProviderId,
    modelId: string,
    dynamicModels?: Array<{ id: string; label: string }>
): ModelDescriptor | undefined {
    if (!modelId) return undefined;
    const models = resolveProviderModels(providerId, dynamicModels);
    return models.find((model) => model.id === modelId);
}

export function getContextWindowForModel(
    providerId: ProviderId,
    modelId: string,
    dynamicModels?: Array<{ id: string; label: string }>
): number {
    return getModelDescriptor(providerId, modelId, dynamicModels)?.maxContextTokens
        ?? getProviderCapability(providerId).maxContextTokens;
}

export function isKnownModel(
    providerId: ProviderId,
    modelId: string,
    dynamicModels?: Array<{ id: string; label: string }>
): boolean {
    if (providerId === 'custom') return true;
    return Boolean(getModelDescriptor(providerId, modelId, dynamicModels));
}
