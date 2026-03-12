import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
    Check,
    Cloud,
    Cpu,
    ExternalLink,
    Eye,
    EyeOff,
    KeyRound,
    Loader2,
    Plus,
    RefreshCw,
    Settings,
    X,
} from 'lucide-react';
import { vscode } from '../../vscode';
import { AutoApproveSettings } from './AutoApproveSettings';
import type { AutoApproveConfig, ModelDef, ProviderModelsFetchState, ProviderSavedConfig } from '../../types';
import {
    PROVIDERS as SHARED_PROVIDERS,
    type ProviderCapability,
    type ProviderId,
} from '../../catalog/providerCatalog';

interface ProviderDraft {
    apiKey: string;
    extraKeys: string[];
    baseUrl: string;
}

type ProviderDef = ProviderCapability & {
    defaultBaseUrl: string;
    credentialLabel?: string;
    credentialPlaceholder?: string;
    credentialHint?: string;
    credentialActionLabel?: string;
};

const UI_PROVIDER_OVERRIDES: Partial<Record<ProviderId, Pick<ProviderDef, 'credentialLabel' | 'credentialPlaceholder' | 'credentialHint' | 'credentialActionLabel'>>> = {
    puter: {
        credentialLabel: 'Auth Token',
        credentialPlaceholder: 'Paste your Puter auth token',
        credentialHint: "Use your Puter auth token. CodAI talks to Puter's OpenAI-compatible endpoint, so Claude works with the existing tool loop.",
        credentialActionLabel: 'Open Puter guide',
    },
};

export const PROVIDERS: ProviderDef[] = SHARED_PROVIDERS.map((provider) => ({
    ...provider,
    defaultBaseUrl: provider.baseUrl,
    ...UI_PROVIDER_OVERRIDES[provider.id],
}));

interface ProviderSettingsProps {
    currentProviderId: ProviderId;
    hasApiKey: boolean;
    currentBaseUrl: string;
    onClose: () => void;
    onModelSelect: (modelId: string) => void;
    currentModel: string;
    savedProviderConfigs: Partial<Record<ProviderId, ProviderSavedConfig>>;
    providerModelsById: Partial<Record<ProviderId, ModelDef[]>>;
    providerModelFetchStateById: Partial<Record<ProviderId, ProviderModelsFetchState>>;
    onProviderModelFetchStateChange: (providerId: ProviderId, fetchState: ProviderModelsFetchState) => void;
    onAutoApproveChange?: (cfg: AutoApproveConfig) => void;
}

const buildProviderDraft = (
    providerId: ProviderId,
    savedConfig?: ProviderSavedConfig
): ProviderDraft => {
    const providerDef = PROVIDERS.find((provider) => provider.id === providerId);
    const normalizedKeys = Array.isArray(savedConfig?.apiKeys)
        ? savedConfig.apiKeys.map((key) => key.trim()).filter(Boolean)
        : [];
    const primaryKey = normalizedKeys[0]
        || (typeof savedConfig?.apiKey === 'string' ? savedConfig.apiKey.trim() : '');

    return {
        apiKey: primaryKey,
        extraKeys: normalizedKeys.length > 0 ? normalizedKeys.slice(1) : [],
        baseUrl: (savedConfig?.baseUrl || providerDef?.defaultBaseUrl || '').trim(),
    };
};

const buildProviderDrafts = (
    savedProviderConfigs: Partial<Record<ProviderId, ProviderSavedConfig>>
): Record<ProviderId, ProviderDraft> =>
    Object.fromEntries(
        PROVIDERS.map((provider) => [
            provider.id,
            buildProviderDraft(provider.id, savedProviderConfigs[provider.id]),
        ])
    ) as Record<ProviderId, ProviderDraft>;

export const ProviderSettings = memo(({
    currentProviderId,
    hasApiKey,
    currentBaseUrl,
    onClose,
    onModelSelect,
    currentModel,
    savedProviderConfigs,
    providerModelsById,
    providerModelFetchStateById,
    onProviderModelFetchStateChange,
    onAutoApproveChange,
}: ProviderSettingsProps) => {
    const [selectedId, setSelectedId] = useState<ProviderId>(currentProviderId);
    const [providerDrafts, setProviderDrafts] = useState<Record<ProviderId, ProviderDraft>>(
        () => buildProviderDrafts(savedProviderConfigs)
    );

    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [selectedModel, setSelectedModel] = useState(currentModel);
    const modelsRequestSeq = useRef(0);

    const def = PROVIDERS.find((provider) => provider.id === selectedId)!;
    const currentDraft = providerDrafts[selectedId] ?? buildProviderDraft(selectedId, savedProviderConfigs[selectedId]);
    const apiKey = currentDraft.apiKey;
    const extraKeys = currentDraft.extraKeys;
    const baseUrl = currentDraft.baseUrl || currentBaseUrl || def.defaultBaseUrl;
    const persistedConfig = savedProviderConfigs[selectedId];
    const persistedHasKey = !!persistedConfig?.hasApiKey
        || !!persistedConfig?.apiKey
        || !!persistedConfig?.apiKeys?.some((key) => key.trim().length > 0)
        || (selectedId === currentProviderId && hasApiKey);
    const hasEffectiveKey = !def.requiresApiKey
        || apiKey.trim().length > 0
        || extraKeys.some((key) => key.trim().length > 0)
        || persistedHasKey;
    const configuredKeyCount = (apiKey.trim().length > 0 ? 1 : 0) + extraKeys.filter((key) => key.trim().length > 0).length;
    const fetchState = providerModelFetchStateById[selectedId] || { loading: false, error: null, requestId: null };
    const fetchingModels = fetchState.loading;
    const modelsError = fetchState.error || '';
    const models = providerModelsById[selectedId] || [];
    const credentialLabel = def.credentialLabel || 'API Key';
    const credentialPlaceholder = def.credentialPlaceholder || 'sk-...';
    const credentialActionLabel = def.credentialActionLabel || 'Get free key';

    const updateDraft = useCallback((providerId: ProviderId, updater: (draft: ProviderDraft) => ProviderDraft) => {
        setProviderDrafts((drafts) => ({
            ...drafts,
            [providerId]: updater(drafts[providerId] ?? buildProviderDraft(providerId, savedProviderConfigs[providerId])),
        }));
    }, [savedProviderConfigs]);

    useEffect(() => {
        setProviderDrafts(buildProviderDrafts(savedProviderConfigs));
    }, [savedProviderConfigs]);

    useEffect(() => {
        setSelectedId(currentProviderId);
    }, [currentProviderId]);

    useEffect(() => {
        setSelectedModel(currentModel);
    }, [currentModel]);

    const requestModels = useCallback((providerId: ProviderId, keyOverride?: string, extraKeyOverrides?: string[], baseUrlOverride?: string) => {
        const requestId = `provider-models-${providerId}-${Date.now()}-${modelsRequestSeq.current++}`;
        onProviderModelFetchStateChange(providerId, {
            loading: true,
            error: null,
            requestId,
            lastFetchedAt: Date.now(),
        });

        const allKeys = [
            typeof keyOverride === 'string' ? keyOverride.trim() : apiKey.trim(),
            ...((extraKeyOverrides ?? extraKeys).map((key) => key.trim()))
        ].filter(Boolean);

        vscode.postMessage({
            type: 'fetchProviderModels',
            requestId,
            providerId,
            apiKey: allKeys[0] || undefined,
            apiKeys: allKeys.length > 1 ? allKeys : undefined,
            baseUrl: baseUrlOverride || baseUrl || PROVIDERS.find((provider) => provider.id === providerId)?.defaultBaseUrl,
        });
    }, [apiKey, baseUrl, extraKeys, onProviderModelFetchStateChange]);

    useEffect(() => {
        const nextProvider = PROVIDERS.find((provider) => provider.id === selectedId);
        if (nextProvider) {
            if (nextProvider.defaultModels.length > 0) {
                setSelectedModel((currentSelectedModel) =>
                    nextProvider.defaultModels.some((model) => model.id === currentSelectedModel)
                        ? currentSelectedModel
                        : nextProvider.defaultModels[0].id
                );
            }
        }

        const persistedDraft = buildProviderDraft(selectedId, savedProviderConfigs[selectedId]);
        const persistedKeys = [persistedDraft.apiKey, ...persistedDraft.extraKeys].filter((key) => key.trim().length > 0);
        const canAutoFetch = !nextProvider?.requiresApiKey || persistedKeys.length > 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (canAutoFetch) {
            const requestId = `provider-models-${selectedId}-${Date.now()}-${modelsRequestSeq.current++}`;
            onProviderModelFetchStateChange(selectedId, {
                loading: true,
                error: null,
                requestId,
                lastFetchedAt: Date.now(),
            });
            timer = setTimeout(() => {
                vscode.postMessage({
                    type: 'fetchProviderModels',
                    requestId,
                    providerId: selectedId,
                    apiKey: persistedKeys[0] || undefined,
                    apiKeys: persistedKeys.length > 1 ? persistedKeys : undefined,
                    baseUrl: persistedDraft.baseUrl || (selectedId === currentProviderId ? currentBaseUrl : nextProvider?.defaultBaseUrl),
                });
            }, 150);
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [currentBaseUrl, currentProviderId, onProviderModelFetchStateChange, savedProviderConfigs, selectedId]);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.data.type === 'providerChanged') {
                setSaving(false);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    useEffect(() => {
        const availableModels = models.length > 0 ? models : def.defaultModels;
        if (
            availableModels.length > 0 &&
            !availableModels.some((model: { id: string; label: string }) => model.id === selectedModel)
        ) {
            const fallbackModelId = availableModels[0].id;
            setSelectedModel(fallbackModelId);
            onModelSelect(fallbackModelId);
            vscode.postMessage({ type: 'changeModel', model: fallbackModelId });
        }
    }, [def.defaultModels, models, onModelSelect, selectedModel]);

    const handleSave = useCallback(() => {
        if (def.requiresApiKey && !apiKey.trim() && !extraKeys.some((key) => key.trim().length > 0)) {
            onProviderModelFetchStateChange(selectedId, {
                loading: false,
                error: `Please enter a ${credentialLabel.toLowerCase()} before applying.`,
                requestId: null,
                lastFetchedAt: Date.now(),
            });
            return;
        }

        onProviderModelFetchStateChange(selectedId, {
            loading: false,
            error: null,
            requestId: null,
            lastFetchedAt: Date.now(),
        });
        setSaving(true);

        const allKeys = [apiKey.trim(), ...extraKeys.map((key) => key.trim())].filter(Boolean);
        vscode.postMessage({
            type: 'changeProvider',
            providerId: selectedId,
            apiKey: allKeys[0] || undefined,
            apiKeys: allKeys.length > 1 ? allKeys : undefined,
            baseUrl: baseUrl || def.defaultBaseUrl,
            model: selectedModel || undefined,
        });

        if (selectedModel) {
            vscode.postMessage({ type: 'changeModel', model: selectedModel });
            onModelSelect(selectedModel);
        }
    }, [
        apiKey,
        baseUrl,
        credentialLabel,
        def,
        extraKeys,
        onProviderModelFetchStateChange,
        onModelSelect,
        selectedId,
        selectedModel,
    ]);

    const handleFetchModels = useCallback(() => {
        if (def.requiresApiKey && !apiKey.trim() && !extraKeys.some((key) => key.trim().length > 0)) {
            onProviderModelFetchStateChange(selectedId, {
                loading: false,
                error: `${credentialLabel} required. Enter it and click Apply first.`,
                requestId: null,
                lastFetchedAt: Date.now(),
            });
            return;
        }

        requestModels(selectedId, apiKey, extraKeys, baseUrl || def.defaultBaseUrl);
    }, [apiKey, baseUrl, credentialLabel, def, extraKeys, onProviderModelFetchStateChange, requestModels, selectedId]);

    const handleModelPick = (id: string) => {
        setSelectedModel(id);
        onModelSelect(id);
        vscode.postMessage({ type: 'changeModel', model: id });
    };

    return (
        <div className="provider-settings">
            <div className="ps-header">
                <Settings size={12} className="ps-header-icon" />
                <span className="ps-header-title">Provider Settings</span>
                <button className="ps-close" onClick={onClose} title="Close">
                    <X size={12} />
                </button>
            </div>

            <div className="ps-provider-grid">
                {PROVIDERS.map((provider) => (
                    <button
                        key={provider.id}
                        className={`ps-provider-btn${selectedId === provider.id ? ' active' : ''}`}
                        onClick={() => setSelectedId(provider.id)}
                        title={provider.label}
                    >
                        <span className="ps-provider-icon">
                            {provider.isLocal ? <Cpu size={11} /> : <Cloud size={11} />}
                        </span>
                        <span className="ps-provider-label">{provider.label}</span>
                        {provider.badge && (
                            <span className="ps-provider-badge">{provider.badge}</span>
                        )}
                        {selectedId === provider.id && (
                            <Check size={10} className="ps-provider-check" />
                        )}
                    </button>
                ))}
            </div>

            <div className="ps-config">
                {def.requiresApiKey && (
                    <div className="ps-field">
                        <label className="ps-label">
                            {credentialLabel}
                            {def.keySignupUrl && (
                                <a
                                    href={def.keySignupUrl}
                                    className="ps-label-link"
                                    title={credentialActionLabel}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        vscode.postMessage({ type: 'openUrl', url: def.keySignupUrl });
                                    }}
                                >
                                    {credentialActionLabel} <ExternalLink size={9} />
                                </a>
                            )}
                        </label>
                        <div className="ps-input-wrap">
                            <input
                                type={showKey ? 'text' : 'password'}
                                className="ps-input"
                                value={apiKey}
                                onChange={(event) => updateDraft(selectedId, (draft) => ({ ...draft, apiKey: event.target.value }))}
                                placeholder={credentialPlaceholder}
                                spellCheck={false}
                            />
                            <button
                                className="ps-eye-btn"
                                onClick={() => setShowKey((visible) => !visible)}
                                title={showKey ? 'Hide' : 'Show'}
                                type="button"
                            >
                                {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
                            </button>
                        </div>
                        {def.credentialHint && (
                            <p className="ps-extra-keys-hint">{def.credentialHint}</p>
                        )}
                    </div>
                )}

                {def.requiresApiKey && (
                    <div className="ps-field">
                        <div className="ps-extra-keys-header">
                            <KeyRound size={10} />
                            <span>Extra keys for rotation</span>
                            {configuredKeyCount > 0 && (
                                <span className="ps-key-badge">{configuredKeyCount} active</span>
                            )}
                            <button
                                className="ps-add-key-btn"
                                type="button"
                                onClick={() => updateDraft(selectedId, (draft) => ({ ...draft, extraKeys: [...draft.extraKeys, ''] }))}
                                title={`Add another ${credentialLabel.toLowerCase()}`}
                            >
                                <Plus size={10} /> Add key
                            </button>
                        </div>
                        {extraKeys.length === 0 && (
                            <p className="ps-extra-keys-hint">
                                Add multiple keys to auto-rotate on rate limit without waiting.
                            </p>
                        )}
                        {extraKeys.map((key, index) => (
                            <div key={index} className="ps-input-wrap" style={{ marginTop: 4 }}>
                                <input
                                    type="password"
                                    className="ps-input"
                                    value={key}
                                    onChange={(event) =>
                                        updateDraft(selectedId, (draft) => ({
                                            ...draft,
                                            extraKeys: draft.extraKeys.map((existingKey, existingIndex) =>
                                                existingIndex === index ? event.target.value : existingKey
                                            ),
                                        }))
                                    }
                                    placeholder={`${credentialLabel} ${index + 2}`}
                                    spellCheck={false}
                                />
                                <button
                                    className="ps-eye-btn"
                                    type="button"
                                    onClick={() =>
                                        updateDraft(selectedId, (draft) => ({
                                            ...draft,
                                            extraKeys: draft.extraKeys.filter((_, existingIndex) => existingIndex !== index),
                                        }))
                                    }
                                    title="Remove"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {(selectedId === 'ollama' || selectedId === 'custom') && (
                    <div className="ps-field">
                        <label className="ps-label">Base URL</label>
                        <input
                            type="text"
                            className="ps-input"
                            value={baseUrl}
                            onChange={(event) => updateDraft(selectedId, (draft) => ({ ...draft, baseUrl: event.target.value }))}
                            placeholder={def.defaultBaseUrl}
                            spellCheck={false}
                        />
                    </div>
                )}

                <button
                    className={`ps-save-btn${saved ? ' saved' : ''}${!hasEffectiveKey ? ' needs-key' : ''}`}
                    onClick={handleSave}
                    disabled={saving}
                    title={!hasEffectiveKey ? `Enter a ${credentialLabel.toLowerCase()} first` : undefined}
                >
                    {saving ? (
                        <><Loader2 size={11} className="spin-icon" /> Saving...</>
                    ) : saved ? (
                        <><Check size={11} /> Saved!</>
                    ) : (
                        'Apply'
                    )}
                </button>
            </div>

            <div className="ps-models-section">
                <div className="ps-models-header">
                    <span className="ps-models-title">Models</span>
                    <button
                        className="ps-fetch-btn"
                        onClick={handleFetchModels}
                        disabled={fetchingModels}
                        title="Fetch available models from provider"
                    >
                        {fetchingModels ? (
                            <><Loader2 size={10} className="spin-icon" /> Loading...</>
                        ) : (
                            <><RefreshCw size={10} /> Refresh</>
                        )}
                    </button>
                </div>

                {modelsError && (
                    <div className="ps-models-error">{modelsError}</div>
                )}

                <div className="ps-model-list">
                    {fetchingModels && models.length === 0 && (
                        <div className="ps-models-loading">
                            <Loader2 size={11} className="spin-icon" /> Fetching models...
                        </div>
                    )}
                    {!fetchingModels && models.length === 0 && def.defaultModels.length === 0 && (
                        <div className="ps-models-empty">No models found. Click Refresh.</div>
                    )}
                    {(!fetchingModels || models.length > 0) &&
                        (models.length > 0 ? models : def.defaultModels).map((model) => (
                            <button
                                key={model.id}
                                className={`ps-model-item${selectedModel === model.id ? ' active' : ''}`}
                                onClick={() => handleModelPick(model.id)}
                                title={model.id}
                            >
                                <span className="ps-model-label">{model.label || model.id}</span>
                                <span className="ps-model-id">{model.id}</span>
                                {selectedModel === model.id && (
                                    <Check size={9} className="ps-model-check" />
                                )}
                            </button>
                        ))}
                </div>
            </div>

            <AutoApproveSettings onConfigChange={onAutoApproveChange} />
        </div>
    );
});

ProviderSettings.displayName = 'ProviderSettings';
