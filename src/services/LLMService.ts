import type { Message, Tool } from '../core/types';
import { getProviderCapability, PROVIDER_DEFS, type ProviderId } from './providerCatalog';
import { OllamaTransportAdapter } from './transports/OllamaTransportAdapter';
import { OpenAITransportAdapter } from './transports/OpenAITransportAdapter';

export interface LLMProviderConfig {
    providerId: ProviderId;
    baseUrl: string;
    apiKey?: string;
    apiKeys?: string[];
    model: string;
}

export class LLMService {
    private keyIndex = 0;
    private keyExhaustedUntil: number[] = [];
    private readonly ollamaAdapter = new OllamaTransportAdapter();
    private readonly openAIAdapter = new OpenAITransportAdapter();

    constructor(private config: LLMProviderConfig) { }

    public updateConfig(config: LLMProviderConfig) {
        this.config = config;
        this.keyIndex = 0;
        this.keyExhaustedUntil = [];
    }

    private getActiveKey(): string | null {
        const keys = this.getAllKeys();
        if (keys.length === 0) return this.config.apiKey || null;

        const now = Date.now();
        for (let i = 0; i < keys.length; i++) {
            const index = (this.keyIndex + i) % keys.length;
            if (!this.keyExhaustedUntil[index] || now >= this.keyExhaustedUntil[index]) {
                this.keyIndex = index;
                return keys[index];
            }
        }

        let minIndex = 0;
        let minUntil = Infinity;
        for (let i = 0; i < keys.length; i++) {
            if ((this.keyExhaustedUntil[i] || 0) < minUntil) {
                minUntil = this.keyExhaustedUntil[i] || 0;
                minIndex = i;
            }
        }
        this.keyIndex = minIndex;
        return keys[minIndex];
    }

    public markActiveKeyRateLimited(waitMs: number): { rotated: boolean; nextKey: string | null } {
        const keys = this.getAllKeys();
        if (keys.length <= 1) return { rotated: false, nextKey: null };

        this.keyExhaustedUntil[this.keyIndex] = Date.now() + waitMs;
        const previousIndex = this.keyIndex;
        this.keyIndex = (this.keyIndex + 1) % keys.length;

        const now = Date.now();
        if (this.keyExhaustedUntil[this.keyIndex] && now < this.keyExhaustedUntil[this.keyIndex]) {
            for (let i = 0; i < keys.length; i++) {
                const index = (previousIndex + 1 + i) % keys.length;
                if (!this.keyExhaustedUntil[index] || now >= this.keyExhaustedUntil[index]) {
                    this.keyIndex = index;
                    return { rotated: true, nextKey: keys[index] };
                }
            }
            return { rotated: false, nextKey: null };
        }

        return { rotated: true, nextKey: keys[this.keyIndex] };
    }

    public getAllKeys(): string[] {
        if (this.config.apiKeys && this.config.apiKeys.length > 0) {
            return this.config.apiKeys.filter((key) => key.trim());
        }
        return this.config.apiKey ? [this.config.apiKey] : [];
    }

    public getKeyCount(): number {
        return this.getAllKeys().length;
    }

    public getActiveKeyIndex(): number {
        return this.keyIndex;
    }

    private getBaseUrl(): string {
        return (this.config.baseUrl || '').replace(/\/+$/, '');
    }

    public async fetchModels(): Promise<Array<{ id: string; label: string }>> {
        const provider = getProviderCapability(this.config.providerId);
        if (!provider.modelsEndpoint) {
            return provider.defaultModels.map((model) => ({ id: model.id, label: model.label }));
        }

        const url = `${this.getBaseUrl()}${provider.modelsEndpoint}`;
        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            const fetchKey = this.getActiveKey();
            if (fetchKey) headers['Authorization'] = `Bearer ${fetchKey}`;

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            let response: Response;
            try {
                response = await fetch(url, { headers, signal: controller.signal });
            } finally {
                clearTimeout(timer);
            }

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error(`${provider.label}: Invalid or missing API key (${response.status}). Enter a valid key in Provider Settings.`);
                }
                throw new Error(`${provider.label}: Failed to fetch models (${response.status})`);
            }

            const json: any = await response.json();
            if (this.config.providerId === 'ollama') {
                const models = json.models ?? [];
                if (!Array.isArray(models)) {
                    throw new Error(`Ollama: invalid model payload from ${url}`);
                }
                return models.map((model: any) => ({ id: model.name, label: model.name }));
            }

            const data: any[] = json.data ?? json.models ?? [];
            return data
                .filter((model: any) => model.id && (
                    this.config.providerId !== 'openrouter' || !model.id.includes(':nitro')
                ))
                .map((model: any) => ({
                    id: model.id,
                    label: model.name || model.id,
                }))
                .sort((a, b) => a.id.localeCompare(b.id));
        } catch (error: any) {
            if (error?.message?.includes('API key') || error?.message?.includes('401') || error?.message?.includes('403')) {
                throw error;
            }
            if (error?.name === 'AbortError') {
                throw new Error(`${provider.label}: models request timed out at ${url}.`);
            }
            if (this.config.providerId === 'ollama') {
                throw new Error(`Ollama: unable to reach ${url}. Start Ollama or update the base URL.`);
            }
            throw new Error(`${provider.label}: unable to fetch models from ${url}. ${error?.message || 'Unknown error'}`);
        }
    }

    public async chatWithTools(
        model: string,
        messages: Message[],
        tools: Tool[],
        onThinking?: (thinking: string) => void,
        onContent?: (content: string) => void,
        abortSignal?: AbortSignal
    ): Promise<any> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const activeKey = this.getActiveKey();
        if (activeKey) headers['Authorization'] = `Bearer ${activeKey}`;

        if (this.config.providerId === 'openrouter') {
            headers['HTTP-Referer'] = 'https://github.com/codai-ollama';
            headers['X-Title'] = 'CodAI';
        }

        const provider = getProviderCapability(this.config.providerId);
        const request = {
            providerId: this.config.providerId,
            baseUrl: this.getBaseUrl(),
            headers,
            model,
            messages,
            tools,
            onThinking,
            onContent,
            abortSignal,
        };

        if (provider.protocol === 'ollama') {
            return this.ollamaAdapter.chat(request);
        }
        return this.openAIAdapter.chat(request);
    }
}

export { classifyProviderError, normalizeToolCalls, toOpenAICompatibleMessages } from './providerPayload';
