import { memo, useCallback, useEffect, useState } from 'react';
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

export type ProviderId =
    | 'ollama'
    | 'openrouter'
    | 'groq'
    | 'gemini'
    | 'cerebras'
    | 'mistral'
    | 'puter'
    | 'custom';

export interface ProviderDef {
    id: ProviderId;
    label: string;
    defaultBaseUrl: string;
    requiresApiKey: boolean;
    isLocal: boolean;
    keySignupUrl: string;
    docsUrl: string;
    badge?: string;
    defaultModels: Array<{ id: string; label: string }>;
    credentialLabel?: string;
    credentialPlaceholder?: string;
    credentialHint?: string;
    credentialActionLabel?: string;
}

export const PROVIDERS: ProviderDef[] = [
    {
        id: 'ollama',
        label: 'Ollama',
        defaultBaseUrl: 'http://localhost:11434',
        requiresApiKey: false,
        isLocal: true,
        keySignupUrl: '',
        docsUrl: 'https://ollama.com',
        badge: 'Local',
        defaultModels: [
            { id: 'qwen2.5-coder:32b', label: 'Qwen2.5 Coder 32B' },
            { id: 'codestral:22b', label: 'Codestral 22B' },
            { id: 'llama3.3:70b', label: 'Llama 3.3 70B' },
            { id: 'mistral:7b', label: 'Mistral 7B' },
            { id: 'deepseek-r1:14b', label: 'DeepSeek R1 14B' },
        ],
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
        requiresApiKey: true,
        isLocal: false,
        keySignupUrl: 'https://openrouter.ai/keys',
        docsUrl: 'https://openrouter.ai/docs',
        badge: 'Free models',
        defaultModels: [
            { id: 'deepseek/deepseek-r1:free', label: 'DeepSeek R1 (Free)' },
            { id: 'deepseek/deepseek-chat-v3-5:free', label: 'DeepSeek V3.5 (Free)' },
            { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Free)' },
            { id: 'qwen/qwen3-235b-a22b:free', label: 'Qwen3 235B (Free)' },
            { id: 'microsoft/phi-4:free', label: 'Phi-4 (Free)' },
        ],
    },
    {
        id: 'groq',
        label: 'Groq',
        defaultBaseUrl: 'https://api.groq.com/openai/v1',
        requiresApiKey: true,
        isLocal: false,
        keySignupUrl: 'https://console.groq.com/keys',
        docsUrl: 'https://console.groq.com/docs',
        badge: 'Very Fast',
        defaultModels: [
            { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
            { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Fast)' },
            { id: 'llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout' },
            { id: 'qwen3-32b', label: 'Qwen3 32B' },
        ],
    },
    {
        id: 'gemini',
        label: 'Google Gemini',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        requiresApiKey: true,
        isLocal: false,
        keySignupUrl: 'https://aistudio.google.com/apikey',
        docsUrl: 'https://ai.google.dev/gemini-api/docs',
        badge: '1M context',
        defaultModels: [
            { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash (Free)' },
            { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Free)' },
            { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (Free)' },
            { id: 'gemini-2.5-pro-preview-06-05', label: 'Gemini 2.5 Pro' },
        ],
    },
    {
        id: 'cerebras',
        label: 'Cerebras',
        defaultBaseUrl: 'https://api.cerebras.ai/v1',
        requiresApiKey: true,
        isLocal: false,
        keySignupUrl: 'https://cloud.cerebras.ai',
        docsUrl: 'https://cloud.cerebras.ai',
        badge: '2100 TPS',
        defaultModels: [
            { id: 'llama3.1-8b', label: 'Llama 3.1 8B' },
            { id: 'gpt-oss-120b', label: 'GPT OSS 120B' },
            { id: 'qwen-3-235b-a22b-instruct-2507', label: 'Qwen3 235B (preview)' },
        ],
    },
    {
        id: 'mistral',
        label: 'Mistral AI',
        defaultBaseUrl: 'https://api.mistral.ai/v1',
        requiresApiKey: true,
        isLocal: false,
        keySignupUrl: 'https://console.mistral.ai',
        docsUrl: 'https://docs.mistral.ai',
        badge: 'Codestral',
        defaultModels: [
            { id: 'mistral-small-latest', label: 'Mistral Small' },
            { id: 'codestral-latest', label: 'Codestral' },
            { id: 'open-mistral-7b', label: 'Mistral 7B (Free)' },
        ],
    },
    {
        id: 'puter',
        label: 'Puter',
        defaultBaseUrl: 'https://api.puter.com/puterai/openai/v1',
        requiresApiKey: true,
        isLocal: false,
        keySignupUrl: 'https://developer.puter.com/tutorials/use-cline-with-puter/',
        docsUrl: 'https://developer.puter.com/tutorials/use-cline-with-puter/',
        badge: 'Claude via Puter',
        defaultModels: [
            { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
            { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
            { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
            { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
            { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
        ],
        credentialLabel: 'Auth Token',
        credentialPlaceholder: 'Paste your Puter auth token',
        credentialHint: "Use your Puter auth token. CodAI talks to Puter's OpenAI-compatible endpoint, so Claude works with the existing tool loop.",
        credentialActionLabel: 'Open Puter guide',
    },
    {
        id: 'custom',
        label: 'Custom / Self-hosted',
        defaultBaseUrl: 'http://localhost:8080/v1',
        requiresApiKey: false,
        isLocal: true,
        keySignupUrl: '',
        docsUrl: '',
        badge: 'OpenAI-compat',
        defaultModels: [],
    },
];

interface ProviderSettingsProps {
    currentProviderId: ProviderId;
    hasApiKey: boolean;
    currentBaseUrl: string;
    onClose: () => void;
    onProviderModels: (
        providerId: ProviderId,
        models: Array<{ id: string; label: string }>,
        isLocal: boolean
    ) => void;
    onModelSelect: (modelId: string) => void;
    currentModel: string;
    apiKeyValue: string;
    baseUrlValue: string;
    onApiKeyChange: (value: string) => void;
    onBaseUrlChange: (value: string) => void;
}

export const ProviderSettings = memo(({
    currentProviderId,
    hasApiKey,
    currentBaseUrl,
    onClose,
    onProviderModels,
    onModelSelect,
    currentModel,
    apiKeyValue,
    baseUrlValue,
    onApiKeyChange,
    onBaseUrlChange,
}: ProviderSettingsProps) => {
    const [selectedId, setSelectedId] = useState<ProviderId>(currentProviderId);
    const apiKey = apiKeyValue;
    const setApiKey = onApiKeyChange;
    const baseUrl = baseUrlValue || currentBaseUrl;
    const setBaseUrl = onBaseUrlChange;

    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
    const [modelsError, setModelsError] = useState('');
    const [selectedModel, setSelectedModel] = useState(currentModel);
    const [extraKeys, setExtraKeys] = useState<string[]>([]);
    const [keyCount, setKeyCount] = useState<number | null>(null);

    const def = PROVIDERS.find((provider) => provider.id === selectedId)!;
    const currentProviderHasKey = selectedId === currentProviderId && hasApiKey;
    const hasEffectiveKey = !def.requiresApiKey || apiKey.trim().length > 0 || currentProviderHasKey;
    const credentialLabel = def.credentialLabel || 'API Key';
    const credentialPlaceholder = def.credentialPlaceholder || 'sk-...';
    const credentialActionLabel = def.credentialActionLabel || 'Get free key';

    useEffect(() => {
        const nextProvider = PROVIDERS.find((provider) => provider.id === selectedId);
        if (nextProvider) {
            setBaseUrl(nextProvider.defaultBaseUrl);
            if (
                nextProvider.defaultModels.length > 0 &&
                !nextProvider.defaultModels.some((model) => model.id === selectedModel)
            ) {
                setSelectedModel(nextProvider.defaultModels[0].id);
            }
        }

        setModels([]);
        setModelsError('');
        setExtraKeys([]);
        setKeyCount(null);

        const canAutoFetch = !nextProvider?.requiresApiKey || (selectedId === currentProviderId && hasApiKey);
        if (canAutoFetch) {
            setFetchingModels(true);
            setTimeout(() => {
                vscode.postMessage({ type: 'fetchProviderModels' });
            }, 150);
        }
    }, [currentProviderId, hasApiKey, selectedId, selectedModel, setBaseUrl]);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.data.type === 'providerModels') {
                setFetchingModels(false);

                if (event.data.error) {
                    setModelsError(event.data.error);
                    return;
                }

                const incomingModels = event.data.models || [];
                const availableModels = incomingModels.length > 0 ? incomingModels : def.defaultModels;

                setModels(incomingModels);
                setModelsError('');
                onProviderModels(selectedId, incomingModels, def.isLocal);

                if (
                    availableModels.length > 0 &&
                    !availableModels.some((model: { id: string; label: string }) => model.id === selectedModel)
                ) {
                    const fallbackModelId = availableModels[0].id;
                    setSelectedModel(fallbackModelId);
                    onModelSelect(fallbackModelId);
                    vscode.postMessage({ type: 'changeModel', model: fallbackModelId });
                }
            }

            if (event.data.type === 'providerChanged') {
                setSaving(false);
                setSaved(true);
                if (typeof event.data.keyCount === 'number') {
                    setKeyCount(event.data.keyCount);
                }
                setTimeout(() => setSaved(false), 2000);
                setFetchingModels(true);
                setModelsError('');
                setTimeout(() => {
                    vscode.postMessage({ type: 'fetchProviderModels' });
                }, 200);
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [def.defaultModels, def.isLocal, onModelSelect, onProviderModels, selectedId, selectedModel]);

    const handleSave = useCallback(() => {
        if (def.requiresApiKey && !apiKey.trim() && !currentProviderHasKey) {
            setModelsError(`Please enter a ${credentialLabel.toLowerCase()} before applying.`);
            return;
        }

        setModelsError('');
        setSaving(true);

        const allKeys = [apiKey.trim(), ...extraKeys.map((key) => key.trim())].filter(Boolean);
        vscode.postMessage({
            type: 'changeProvider',
            providerId: selectedId,
            apiKey: allKeys[0] || undefined,
            apiKeys: allKeys.length > 1 ? allKeys : undefined,
            baseUrl: baseUrl || def.defaultBaseUrl,
        });

        if (selectedModel) {
            vscode.postMessage({ type: 'changeModel', model: selectedModel });
            onModelSelect(selectedModel);
        }
    }, [
        apiKey,
        baseUrl,
        credentialLabel,
        currentProviderHasKey,
        def,
        extraKeys,
        onModelSelect,
        selectedId,
        selectedModel,
    ]);

    const handleFetchModels = useCallback(() => {
        if (def.requiresApiKey && !apiKey.trim() && !currentProviderHasKey) {
            setModelsError(`${credentialLabel} required. Enter it and click Apply first.`);
            return;
        }

        setFetchingModels(true);
        setModelsError('');

        const allKeys = [apiKey.trim(), ...extraKeys.map((key) => key.trim())].filter(Boolean);
        vscode.postMessage({
            type: 'changeProvider',
            providerId: selectedId,
            apiKey: allKeys[0] || undefined,
            apiKeys: allKeys.length > 1 ? allKeys : undefined,
            baseUrl: baseUrl || def.defaultBaseUrl,
        });

        setTimeout(() => {
            vscode.postMessage({ type: 'fetchProviderModels' });
        }, 350);
    }, [apiKey, baseUrl, credentialLabel, currentProviderHasKey, def, extraKeys, selectedId]);

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
                                onChange={(event) => setApiKey(event.target.value)}
                                placeholder={
                                    hasApiKey && selectedId === currentProviderId
                                        ? '**************** (saved)'
                                        : credentialPlaceholder
                                }
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
                            {keyCount !== null && (
                                <span className="ps-key-badge">{keyCount} active</span>
                            )}
                            <button
                                className="ps-add-key-btn"
                                type="button"
                                onClick={() => setExtraKeys((keys) => [...keys, ''])}
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
                                        setExtraKeys((keys) =>
                                            keys.map((existingKey, existingIndex) =>
                                                existingIndex === index ? event.target.value : existingKey
                                            )
                                        )
                                    }
                                    placeholder={`${credentialLabel} ${index + 2}`}
                                    spellCheck={false}
                                />
                                <button
                                    className="ps-eye-btn"
                                    type="button"
                                    onClick={() =>
                                        setExtraKeys((keys) => keys.filter((_, existingIndex) => existingIndex !== index))
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
                            onChange={(event) => setBaseUrl(event.target.value)}
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

            <AutoApproveSettings />
        </div>
    );
});

ProviderSettings.displayName = 'ProviderSettings';
