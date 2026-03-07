import { useState, useEffect, useCallback, memo } from 'react';
import { vscode } from '../../vscode';
import {
    Settings, Check, Loader2,
    ExternalLink, Eye, EyeOff, RefreshCw, Cpu, Cloud, X, Plus, KeyRound
} from 'lucide-react';

// ── Provider tanımları (frontend kopyası) ─────────────────────────────────────
export type ProviderId = 'ollama' | 'openrouter' | 'groq' | 'gemini' | 'cerebras' | 'mistral' | 'custom';

export interface ProviderDef {
    id: ProviderId;
    label: string;
    defaultBaseUrl: string;
    requiresApiKey: boolean;
    isLocal: boolean;
    keySignupUrl: string;
    docsUrl: string;
    badge?: string;         // "Free tier", "Very Fast", vb.
    defaultModels: Array<{ id: string; label: string }>;
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
            { id: 'codestral:22b',     label: 'Codestral 22B' },
            { id: 'llama3.3:70b',      label: 'Llama 3.3 70B' },
            { id: 'mistral:7b',        label: 'Mistral 7B' },
            { id: 'deepseek-r1:14b',   label: 'DeepSeek R1 14B' },
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
            { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1 (Free)' },
            { id: 'deepseek/deepseek-chat-v3-5:free',       label: 'DeepSeek V3.5 (Free)' },
            { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (Free)' },
            { id: 'qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B (Free)' },
            { id: 'microsoft/phi-4:free',                   label: 'Phi-4 (Free)' },
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
            { id: 'llama-3.3-70b-versatile',        label: 'Llama 3.3 70B' },
            { id: 'llama-3.1-8b-instant',           label: 'Llama 3.1 8B (Fast)' },
            { id: 'llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout' },
            { id: 'qwen3-32b',                      label: 'Qwen3 32B' },
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
            { id: 'gemini-2.0-flash',               label: 'Gemini 2.0 Flash (Free)' },
            { id: 'gemini-2.0-flash-lite',          label: 'Gemini 2.0 Flash Lite (Free)' },
            { id: 'gemini-2.5-pro-preview-06-05',   label: 'Gemini 2.5 Pro' },
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
            { id: 'llama3.1-8b',                      label: 'Llama 3.1 8B' },
            { id: 'gpt-oss-120b',                     label: 'GPT OSS 120B' },
            { id: 'qwen-3-235b-a22b-instruct-2507',   label: 'Qwen3 235B (preview)' },
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
            { id: 'mistral-small-latest',  label: 'Mistral Small' },
            { id: 'codestral-latest',      label: 'Codestral' },
            { id: 'open-mistral-7b',       label: 'Mistral 7B (Free)' },
        ],
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

// ── Props ──────────────────────────────────────────────────────────────────────
interface ProviderSettingsProps {
    currentProviderId: ProviderId;
    hasApiKey: boolean;
    currentBaseUrl: string;
    onClose: () => void;
    onProviderModels: (models: Array<{ id: string; label: string }>) => void;
    onModelSelect: (modelId: string) => void;
    currentModel: string;
    // Lifted state — unmount'ta kaybolmaması için parent'tan gelir
    apiKeyValue: string;
    baseUrlValue: string;
    onApiKeyChange: (v: string) => void;
    onBaseUrlChange: (v: string) => void;
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
    // apiKey ve baseUrl artık parent'tan (lifted state) — unmount'ta kaybolmaz
    const apiKey = apiKeyValue;
    const setApiKey = onApiKeyChange;
    // baseUrl boşsa currentBaseUrl'i fallback olarak kullan
    const baseUrl = baseUrlValue || currentBaseUrl;
    const setBaseUrl = onBaseUrlChange;

    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
    const [modelsError, setModelsError] = useState('');
    const [selectedModel, setSelectedModel] = useState(currentModel);
    // Multi-key rotation: ek key'ler (ilk key apiKey alanında)
    const [extraKeys, setExtraKeys] = useState<string[]>([]);
    const [keyCount, setKeyCount] = useState<number | null>(null);

    const def = PROVIDERS.find(p => p.id === selectedId)!;

    // Mevcut provider için key zaten kayıtlı mı?
    const currentProviderHasKey = selectedId === currentProviderId && hasApiKey;
    // Key gerekli mi ve elimizde var mı?
    const hasEffectiveKey = !def.requiresApiKey || apiKey.trim().length > 0 || currentProviderHasKey;

    // Provider değişince baseUrl'i default'a set et + key varsa otomatik model çek
    useEffect(() => {
        const d = PROVIDERS.find(p => p.id === selectedId);
        if (d) setBaseUrl(d.defaultBaseUrl);
        setModels([]);
        setModelsError('');
        setExtraKeys([]);
        setKeyCount(null);

        // Key gerektirmiyorsa veya mevcut provider için key zaten kayıtlıysa → otomatik fetch
        const canAutoFetch = !d?.requiresApiKey || (selectedId === currentProviderId && hasApiKey);
        if (canAutoFetch) {
            setFetchingModels(true);
            setTimeout(() => {
                vscode.postMessage({ type: 'fetchProviderModels' });
            }, 150);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    // Backend'den gelen providerModels mesajını dinle
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            if (e.data.type === 'providerModels') {
                setFetchingModels(false);
                if (e.data.error) {
                    setModelsError(e.data.error);
                } else {
                    const m = e.data.models || [];
                    setModels(m);
                    onProviderModels(m);
                    setModelsError('');
                }
            }
            if (e.data.type === 'providerChanged') {
                setSaving(false);
                setSaved(true);
                if (typeof e.data.keyCount === 'number') setKeyCount(e.data.keyCount);
                setTimeout(() => setSaved(false), 2000);
                // Apply sonrası otomatik model listesi çek
                setFetchingModels(true);
                setModelsError('');
                setTimeout(() => {
                    vscode.postMessage({ type: 'fetchProviderModels' });
                }, 200);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [onProviderModels]);

    const handleSave = useCallback(() => {
        // Key gerekli ama girilmemiş ve daha önce de kaydedilmemiş
        if (def.requiresApiKey && !apiKey.trim() && !currentProviderHasKey) {
            setModelsError('Please enter an API key before applying.');
            return;
        }
        setModelsError('');
        setSaving(true);
        // Tüm key'leri birleştir: ana key + extra key'ler
        const allKeys = [apiKey.trim(), ...extraKeys.map(k => k.trim())].filter(Boolean);
        vscode.postMessage({
            type: 'changeProvider',
            providerId: selectedId,
            apiKey: allKeys[0] || undefined,
            apiKeys: allKeys.length > 1 ? allKeys : undefined,
            baseUrl: baseUrl || def.defaultBaseUrl,
        });
    }, [selectedId, apiKey, extraKeys, baseUrl, def, currentProviderHasKey]);

    const handleFetchModels = useCallback(() => {
        // Key gerekli ama yoksa hata göster, istek atma
        if (def.requiresApiKey && !apiKey.trim() && !currentProviderHasKey) {
            setModelsError('API key required. Enter your key and click Apply first.');
            return;
        }
        setFetchingModels(true);
        setModelsError('');
        // Önce provider'ı kaydet (api key dahil), sonra model listesini çek
        vscode.postMessage({
            type: 'changeProvider',
            providerId: selectedId,
            apiKey: apiKey.trim() || undefined,
            baseUrl: baseUrl || def.defaultBaseUrl,
        });
        setTimeout(() => {
            vscode.postMessage({ type: 'fetchProviderModels' });
        }, 350);
    }, [selectedId, apiKey, baseUrl, def, currentProviderHasKey]);

    const handleModelPick = (id: string) => {
        setSelectedModel(id);
        onModelSelect(id);
        vscode.postMessage({ type: 'changeModel', model: id });
    };

    return (
        <div className="provider-settings">
            {/* Header */}
            <div className="ps-header">
                <Settings size={12} className="ps-header-icon" />
                <span className="ps-header-title">Provider Settings</span>
                <button className="ps-close" onClick={onClose} title="Close">
                    <X size={12} />
                </button>
            </div>

            {/* Provider grid */}
            <div className="ps-provider-grid">
                {PROVIDERS.map(p => (
                    <button
                        key={p.id}
                        className={`ps-provider-btn${selectedId === p.id ? ' active' : ''}`}
                        onClick={() => setSelectedId(p.id)}
                        title={p.label}
                    >
                        <span className="ps-provider-icon">
                            {p.isLocal ? <Cpu size={11} /> : <Cloud size={11} />}
                        </span>
                        <span className="ps-provider-label">{p.label}</span>
                        {p.badge && (
                            <span className="ps-provider-badge">{p.badge}</span>
                        )}
                        {selectedId === p.id && (
                            <Check size={10} className="ps-provider-check" />
                        )}
                    </button>
                ))}
            </div>

            {/* Config fields */}
            <div className="ps-config">
                {/* API Key */}
                {def.requiresApiKey && (
                    <div className="ps-field">
                        <label className="ps-label">
                            API Key
                            {def.keySignupUrl && (
                                <a
                                    href={def.keySignupUrl}
                                    className="ps-label-link"
                                    title="Get free API key"
                                    onClick={() => vscode.postMessage({ type: 'openUrl', url: def.keySignupUrl })}
                                >
                                    Get free key <ExternalLink size={9} />
                                </a>
                            )}
                        </label>
                        <div className="ps-input-wrap">
                            <input
                                type={showKey ? 'text' : 'password'}
                                className="ps-input"
                                value={apiKey}
                                onChange={e => setApiKey(e.target.value)}
                                placeholder={hasApiKey && selectedId === currentProviderId ? '••••••••••••••• (saved)' : 'sk-...'}
                                spellCheck={false}
                            />
                            <button
                                className="ps-eye-btn"
                                onClick={() => setShowKey(s => !s)}
                                title={showKey ? 'Hide' : 'Show'}
                                type="button"
                            >
                                {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
                            </button>
                        </div>
                    </div>
                )}

                {/* Extra API Keys (rotation) */}
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
                                onClick={() => setExtraKeys(k => [...k, ''])}
                                title="Add another API key"
                            >
                                <Plus size={10} /> Add key
                            </button>
                        </div>
                        {extraKeys.length === 0 && (
                            <p className="ps-extra-keys-hint">
                                Add multiple keys to auto-rotate on rate limit — no waiting.
                            </p>
                        )}
                        {extraKeys.map((k, i) => (
                            <div key={i} className="ps-input-wrap" style={{ marginTop: 4 }}>
                                <input
                                    type="password"
                                    className="ps-input"
                                    value={k}
                                    onChange={e => setExtraKeys(keys => keys.map((kk, ii) => ii === i ? e.target.value : kk))}
                                    placeholder={`Key ${i + 2}…`}
                                    spellCheck={false}
                                />
                                <button
                                    className="ps-eye-btn"
                                    type="button"
                                    onClick={() => setExtraKeys(keys => keys.filter((_, ii) => ii !== i))}
                                    title="Remove"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Base URL */}
                {(selectedId === 'ollama' || selectedId === 'custom') && (
                    <div className="ps-field">
                        <label className="ps-label">Base URL</label>
                        <input
                            type="text"
                            className="ps-input"
                            value={baseUrl}
                            onChange={e => setBaseUrl(e.target.value)}
                            placeholder={def.defaultBaseUrl}
                            spellCheck={false}
                        />
                    </div>
                )}

                {/* Save button — dim if key required but missing */}
                <button
                    className={`ps-save-btn${saved ? ' saved' : ''}${!hasEffectiveKey ? ' needs-key' : ''}`}
                    onClick={handleSave}
                    disabled={saving}
                    title={!hasEffectiveKey ? 'Enter an API key first' : undefined}
                >
                    {saving ? (
                        <><Loader2 size={11} className="spin-icon" /> Saving…</>
                    ) : saved ? (
                        <><Check size={11} /> Saved!</>
                    ) : (
                        'Apply'
                    )}
                </button>
            </div>

            {/* Model list */}
            <div className="ps-models-section">
                <div className="ps-models-header">
                    <span className="ps-models-title">Models</span>
                    <button
                        className="ps-fetch-btn"
                        onClick={handleFetchModels}
                        disabled={fetchingModels}
                        title="Fetch available models from provider"
                    >
                        {fetchingModels
                            ? <><Loader2 size={10} className="spin-icon" /> Loading…</>
                            : <><RefreshCw size={10} /> Refresh</>
                        }
                    </button>
                </div>

                {modelsError && (
                    <div className="ps-models-error">{modelsError}</div>
                )}

                <div className="ps-model-list">
                    {fetchingModels && models.length === 0 && (
                        <div className="ps-models-loading">
                            <Loader2 size={11} className="spin-icon" /> Fetching models…
                        </div>
                    )}
                    {!fetchingModels && models.length === 0 && def.defaultModels.length === 0 && (
                        <div className="ps-models-empty">No models found. Click Refresh.</div>
                    )}
                    {/* API'den geldiyse API listesi, yoksa static fallback — fetch devam ediyorsa hiç gösterme */}
                    {(!fetchingModels || models.length > 0) && (models.length > 0 ? models : def.defaultModels).map(m => (
                        <button
                            key={m.id}
                            className={`ps-model-item${selectedModel === m.id ? ' active' : ''}`}
                            onClick={() => handleModelPick(m.id)}
                            title={m.id}
                        >
                            <span className="ps-model-label">{m.label || m.id}</span>
                            <span className="ps-model-id">{m.id}</span>
                            {selectedModel === m.id && <Check size={9} className="ps-model-check" />}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
});
ProviderSettings.displayName = 'ProviderSettings';
