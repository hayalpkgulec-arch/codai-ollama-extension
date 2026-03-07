// ── Provider definitions ───────────────────────────────────────────────────

export type ProviderId = 'ollama' | 'openrouter' | 'groq' | 'gemini' | 'cerebras' | 'mistral' | 'custom';

export interface ProviderDef {
    id: ProviderId;
    label: string;
    baseUrl: string;
    requiresApiKey: boolean;
    /** OpenAI-compat /chat/completions endpoint veya Ollama /api/chat */
    protocol: 'openai' | 'ollama';
    /** Model listesi endpoint. undefined = statik liste kullan */
    modelsEndpoint?: string;
    defaultModels: Array<{ id: string; label: string }>;
    docsUrl: string;
    keySignupUrl: string;
}

export const PROVIDER_DEFS: Record<ProviderId, ProviderDef> = {
    ollama: {
        id: 'ollama',
        label: 'Ollama (Local)',
        baseUrl: 'http://localhost:11434',
        requiresApiKey: false,
        protocol: 'ollama',
        modelsEndpoint: '/api/tags',
        defaultModels: [
            { id: 'qwen2.5-coder:32b', label: 'Qwen2.5 Coder 32B' },
            { id: 'codestral:22b',     label: 'Codestral 22B' },
            { id: 'llama3.3:70b',      label: 'Llama 3.3 70B' },
            { id: 'mistral:7b',        label: 'Mistral 7B' },
            { id: 'deepseek-r1:14b',   label: 'DeepSeek R1 14B' },
        ],
        docsUrl: 'https://ollama.com',
        keySignupUrl: '',
    },
    openrouter: {
        id: 'openrouter',
        label: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        requiresApiKey: true,
        protocol: 'openai',
        modelsEndpoint: '/models',
        defaultModels: [
            { id: 'deepseek/deepseek-r1:free',                   label: 'DeepSeek R1 (Free)' },
            { id: 'deepseek/deepseek-chat-v3-5:free',            label: 'DeepSeek V3.5 (Free)' },
            { id: 'meta-llama/llama-3.3-70b-instruct:free',      label: 'Llama 3.3 70B (Free)' },
            { id: 'qwen/qwen3-235b-a22b:free',                   label: 'Qwen3 235B (Free)' },
            { id: 'microsoft/phi-4:free',                        label: 'Phi-4 (Free)' },
            { id: 'google/gemma-3-27b-it:free',                  label: 'Gemma 3 27B (Free)' },
            { id: 'deepseek/deepseek-r1',                        label: 'DeepSeek R1' },
            { id: 'openai/gpt-4o',                               label: 'GPT-4o' },
            { id: 'anthropic/claude-3.5-sonnet',                 label: 'Claude 3.5 Sonnet' },
        ],
        docsUrl: 'https://openrouter.ai/docs',
        keySignupUrl: 'https://openrouter.ai/keys',
    },
    groq: {
        id: 'groq',
        label: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        requiresApiKey: true,
        protocol: 'openai',
        modelsEndpoint: '/models',
        defaultModels: [
            { id: 'llama-3.3-70b-versatile',              label: 'Llama 3.3 70B' },
            { id: 'llama-3.1-8b-instant',                 label: 'Llama 3.1 8B (Fast)' },
            { id: 'llama-4-scout-17b-16e-instruct',       label: 'Llama 4 Scout 17B' },
            { id: 'qwen3-32b',                            label: 'Qwen3 32B' },
            { id: 'deepseek-r1-distill-llama-70b',        label: 'DeepSeek R1 70B' },
        ],
        docsUrl: 'https://console.groq.com/docs',
        keySignupUrl: 'https://console.groq.com/keys',
    },
    gemini: {
        id: 'gemini',
        label: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        requiresApiKey: true,
        protocol: 'openai',
        defaultModels: [
            { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash (Free)' },
            { id: 'gemini-2.0-flash',               label: 'Gemini 2.0 Flash (Free)' },
            { id: 'gemini-2.0-flash-lite',          label: 'Gemini 2.0 Flash Lite (Free)' },
            { id: 'gemini-2.5-pro-preview-06-05',   label: 'Gemini 2.5 Pro' },
        ],
        docsUrl: 'https://ai.google.dev/gemini-api/docs',
        keySignupUrl: 'https://aistudio.google.com/apikey',
    },
    cerebras: {
        id: 'cerebras',
        label: 'Cerebras',
        baseUrl: 'https://api.cerebras.ai/v1',
        requiresApiKey: true,
        protocol: 'openai',
        modelsEndpoint: '/models',
        defaultModels: [
            { id: 'llama3.1-8b',                    label: 'Llama 3.1 8B' },
            { id: 'gpt-oss-120b',                   label: 'GPT OSS 120B' },
            { id: 'qwen-3-235b-a22b-instruct-2507', label: 'Qwen3 235B (preview)' },
        ],
        docsUrl: 'https://inference-docs.cerebras.ai',
        keySignupUrl: 'https://cloud.cerebras.ai',
    },
    mistral: {
        id: 'mistral',
        label: 'Mistral AI',
        baseUrl: 'https://api.mistral.ai/v1',
        requiresApiKey: true,
        protocol: 'openai',
        modelsEndpoint: '/models',
        defaultModels: [
            { id: 'mistral-small-latest',    label: 'Mistral Small' },
            { id: 'codestral-latest',        label: 'Codestral' },
            { id: 'mistral-medium-latest',   label: 'Mistral Medium' },
            { id: 'open-mistral-7b',         label: 'Mistral 7B (Free)' },
        ],
        docsUrl: 'https://docs.mistral.ai',
        keySignupUrl: 'https://console.mistral.ai',
    },
    custom: {
        id: 'custom',
        label: 'Custom / Self-hosted',
        baseUrl: 'http://localhost:8080/v1',
        requiresApiKey: false,
        protocol: 'openai',
        defaultModels: [],
        docsUrl: '',
        keySignupUrl: '',
    },
};

export const DEFAULT_PROVIDER: ProviderId = 'ollama';
