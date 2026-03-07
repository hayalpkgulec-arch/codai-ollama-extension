import { Message, Tool } from '../core/types';
import { NdjsonParser } from '../core/ndjsonParser';
import { ProviderId, PROVIDER_DEFS } from './providers';

export interface LLMProviderConfig {
    providerId: ProviderId;
    baseUrl: string;
    apiKey?: string;
    apiKeys?: string[];  // multi-key rotation
    model: string;
}

export class LLMService {
    // Key rotation state — hangi key sırada
    private keyIndex = 0;
    // Tüm key'lerin rate-limit'e takıldığı zaman damgası (ms)
    private keyExhaustedUntil: number[] = [];

    constructor(private config: LLMProviderConfig) { }

    public updateConfig(config: LLMProviderConfig) {
        this.config = config;
        this.keyIndex = 0;
        this.keyExhaustedUntil = [];
    }

    /** Şu an kullanılabilir bir key döner. Tüm key'ler exhausted ise null döner. */
    private getActiveKey(): string | null {
        const keys = this.getAllKeys();
        if (keys.length === 0) return this.config.apiKey || null;

        const now = Date.now();
        // Exhausted olmayan ilk key'i bul (round-robin sırasıyla)
        for (let i = 0; i < keys.length; i++) {
            const idx = (this.keyIndex + i) % keys.length;
            if (!this.keyExhaustedUntil[idx] || now >= this.keyExhaustedUntil[idx]) {
                this.keyIndex = idx;
                return keys[idx];
            }
        }
        // Hepsi exhausted — en erken açılacak key'i kullan
        let minIdx = 0;
        let minUntil = Infinity;
        for (let i = 0; i < keys.length; i++) {
            if ((this.keyExhaustedUntil[i] || 0) < minUntil) {
                minUntil = this.keyExhaustedUntil[i] || 0;
                minIdx = i;
            }
        }
        this.keyIndex = minIdx;
        return keys[minIdx];
    }

    /** Aktif key'i rate-limited olarak işaretle, bir sonrakine geç. waitMs kadar bekletilecek. */
    public markActiveKeyRateLimited(waitMs: number): { rotated: boolean; nextKey: string | null } {
        const keys = this.getAllKeys();
        if (keys.length <= 1) return { rotated: false, nextKey: null };

        // Şu anki key'i exhausted olarak işaretle
        this.keyExhaustedUntil[this.keyIndex] = Date.now() + waitMs;
        // Bir sonraki key'e geç
        const prevIndex = this.keyIndex;
        this.keyIndex = (this.keyIndex + 1) % keys.length;

        // Sonraki key de exhausted mu?
        const now = Date.now();
        if (this.keyExhaustedUntil[this.keyIndex] && now < this.keyExhaustedUntil[this.keyIndex]) {
            // Hepsini dene
            for (let i = 0; i < keys.length; i++) {
                const idx = (prevIndex + 1 + i) % keys.length;
                if (!this.keyExhaustedUntil[idx] || now >= this.keyExhaustedUntil[idx]) {
                    this.keyIndex = idx;
                    return { rotated: true, nextKey: keys[idx] };
                }
            }
            return { rotated: false, nextKey: null }; // hepsi exhausted
        }
        return { rotated: true, nextKey: keys[this.keyIndex] };
    }

    public getAllKeys(): string[] {
        const keys: string[] = [];
        if (this.config.apiKeys && this.config.apiKeys.length > 0) {
            keys.push(...this.config.apiKeys.filter(k => k.trim()));
        } else if (this.config.apiKey) {
            keys.push(this.config.apiKey);
        }
        return keys;
    }

    public getKeyCount(): number { return this.getAllKeys().length; }
    public getActiveKeyIndex(): number { return this.keyIndex; }

    // ── Fetch available models from provider ───────────────────────────────
    public async fetchModels(): Promise<Array<{ id: string; label: string }>> {
        const def = PROVIDER_DEFS[this.config.providerId];
        if (!def.modelsEndpoint) return def.defaultModels;

        try {
            const url = `${this.config.baseUrl}${def.modelsEndpoint}`;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            const fetchKey = this.getActiveKey();
            if (fetchKey) headers['Authorization'] = `Bearer ${fetchKey}`;

            const ac = new AbortController();
            const fetchTimer = setTimeout(() => ac.abort(), 8000);
            let res: Response;
            try {
                res = await fetch(url, { headers, signal: ac.signal });
            } finally {
                clearTimeout(fetchTimer);
            }
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    throw new Error(`${def.label}: Invalid or missing API key (${res.status}). Enter a valid key in Provider Settings.`);
                }
                throw new Error(`${def.label}: Failed to fetch models (${res.status})`);
            }

            const json: any = await res.json();

            if (this.config.providerId === 'ollama') {
                // Ollama: { models: [{ name, size }] }
                const models = json.models ?? [];
                return models.map((m: any) => ({ id: m.name, label: m.name }));
            }

            // OpenAI-compat: { data: [{ id }] } or { data: [{ id, name }] }
            const data: any[] = json.data ?? json.models ?? [];
            return data
                .filter((m: any) => m.id && (
                    this.config.providerId !== 'openrouter' || !m.id.includes(':nitro')
                ))
                .map((m: any) => ({
                    id: m.id,
                    label: m.name || m.id,
                }))
                .sort((a: any, b: any) => a.id.localeCompare(b.id));
        } catch (e: any) {
            // 401/403 gibi anlamlı hatalar frontend'e iletilsin
            if (e?.message?.includes('API key') || e?.message?.includes('401') || e?.message?.includes('403')) {
                throw e;
            }
            // Ağ hatası, timeout vb. → static listeye düş
            return def.defaultModels;
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    private mergeStream(current: string, incoming: string): string {
        if (!incoming) return current;
        if (!current) return incoming;
        if (incoming.startsWith(current)) return incoming;
        if (current.startsWith(incoming)) return current;
        return current + incoming;
    }

    private sanitizeText(text: string): string {
        if (!text) return '';
        // Sadece sahte placeholder tag'lerini temizle, başka bir şeye dokunma
        return text.replace(/<[^>]*(?:place[\s_▁-]*holder|placeholder)[^>]*>/giu, '');
    }

    // Artık kullanılmıyor — raw stream text olduğu gibi kullanılıyor
    static fixSpacing(text: string): string {
        return text;
    }

    private extractInlineToolCalls(text: string): { calls: any[]; cleaned: string } {
        if (!text) return { calls: [], cleaned: '' };
        const callRegex =
            /[<＜][^>＞]*tool[\s_▁-]*call[\s_▁-]*begin[^>＞]*[>＞]\s*([a-zA-Z0-9_.:-]+)\s*[<＜][^>＞]*tool[\s_▁-]*sep[^>＞]*[>＞]\s*([\s\S]*?)\s*[<＜][^>＞]*tool[\s_▁-]*call[\s_▁-]*end[^>＞]*[>＞]/giu;

        const calls: any[] = [];
        let cleaned = text;
        let match: RegExpExecArray | null;
        let idx = 0;
        while ((match = callRegex.exec(text)) !== null) {
            const name = (match[1] || '').trim();
            const argsText = (match[2] || '').trim();
            if (!name) continue;
            calls.push({
                id: `inline_${Date.now()}_${idx++}`,
                type: 'function',
                function: { name, arguments: argsText || '{}' }
            });
            cleaned = cleaned.replace(match[0], ' ');
        }
        cleaned = cleaned
            .replace(/[<＜][^>＞]*tool[\s_▁-]*calls[\s_▁-]*begin[^>＞]*[>＞]/giu, ' ')
            .replace(/[<＜][^>＞]*tool[\s_▁-]*calls[\s_▁-]*end[^>＞]*[>＞]/giu, ' ');

        // Groq/Qwen'ın content içine yazdığı düz JSON tool call'ları temizle
        // Örn: {"name":"list_files","arguments":{"path":"."}}
        cleaned = cleaned
            .replace(/\{[^{}]*"name"\s*:\s*"[a-z_]+"[^{}]*"arguments"\s*:\s*\{[^{}]*\}\s*\}/g, '')
            .replace(/^\s*\[[\s\S]*?"name"\s*:\s*"[a-z_]+"[\s\S]*?\]\s*$/gm, '')
            .replace(/\n{3,}/g, '\n\n');
        // NOT: .trim() kaldırıldı — token sonlarındaki boşluklar kelime sınırı için gerekli

        cleaned = this.sanitizeText(cleaned);
        return { calls, cleaned };
    }

    // ── Main chat method ───────────────────────────────────────────────────
    public async chatWithTools(
        model: string,
        messages: Message[],
        tools: Tool[],
        onThinking?: (thinking: string) => void,
        onContent?: (content: string) => void,
        abortSignal?: AbortSignal
    ): Promise<any> {
        const def = PROVIDER_DEFS[this.config.providerId];
        if (def.protocol === 'ollama') {
            return this.chatOllama(model, messages, tools, onThinking, onContent, abortSignal);
        }
        return this.chatOpenAI(model, messages, tools, onThinking, onContent, abortSignal);
    }

    // ── Ollama protocol ────────────────────────────────────────────────────
    private async chatOllama(
        model: string,
        messages: Message[],
        tools: Tool[],
        onThinking?: (thinking: string) => void,
        onContent?: (content: string) => void,
        abortSignal?: AbortSignal
    ): Promise<any> {
        const formattedTools = tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters }
        }));

        const activeKey = this.getActiveKey();
        const ollamaHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (activeKey) ollamaHeaders['Authorization'] = `Bearer ${activeKey}`;

        const response = await fetch(`${this.config.baseUrl}/api/chat`, {
            method: 'POST',
            headers: ollamaHeaders,
            body: JSON.stringify({ model, messages, tools: formattedTools, think: true, stream: true }),
            signal: abortSignal
        });

        if (!response.ok) throw new Error(`Ollama error: ${response.statusText} (${response.status})`);

        return this.consumeOllamaStream(response, onThinking, onContent);
    }

    private async consumeOllamaStream(
        response: Response,
        onThinking?: (t: string) => void,
        onContent?: (c: string) => void
    ): Promise<any> {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const parser = new NdjsonParser();
        let fullContent = '';
        let fullThinking = '';
        let lastMessage: any = null;
        let lastToolCalls: any[] = [];
        const inlineSeen = new Set<string>();

        const handleJson = (json: any) => {
            lastMessage = json;
            const thinkingContent = json.message?.reasoning_content || json.message?.thinking;
            if (thinkingContent) {
                const parsed = this.extractInlineToolCalls(String(thinkingContent));
                for (const call of parsed.calls) {
                    const sig = `${call.function?.name}::${call.function?.arguments}`;
                    if (!inlineSeen.has(sig)) { inlineSeen.add(sig); lastToolCalls.push(call); }
                }
                fullThinking = this.mergeStream(fullThinking, parsed.cleaned);
                onThinking?.(fullThinking);
            }
            if (json.message?.content) {
                const parsed = this.extractInlineToolCalls(String(json.message.content));
                for (const call of parsed.calls) {
                    const sig = `${call.function?.name}::${call.function?.arguments}`;
                    if (!inlineSeen.has(sig)) { inlineSeen.add(sig); lastToolCalls.push(call); }
                }
                if (json.message && typeof json.message.content === 'string') {
                    json.message.content = parsed.cleaned;
                }
                fullContent = this.mergeStream(fullContent, parsed.cleaned);
                onContent?.(fullContent);
            }
            const toolCalls = json.message?.tool_calls ?? json.tool_calls;
            if (Array.isArray(toolCalls) && toolCalls.length > 0) lastToolCalls = toolCalls;
        };

        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    for (const json of parser.push(decoder.decode())) handleJson(json);
                    for (const json of parser.flush()) handleJson(json);
                    break;
                }
                for (const json of parser.push(decoder.decode(value, { stream: true }))) handleJson(json);
            }
        }

        if (lastMessage?.message) {
            if (!lastMessage.message.content && fullContent) lastMessage.message.content = fullContent;
            if ((!Array.isArray(lastMessage.message.tool_calls) || !lastMessage.message.tool_calls.length) && lastToolCalls.length) {
                lastMessage.message.tool_calls = lastToolCalls;
            }
            return lastMessage;
        }
        return { message: { content: fullContent, tool_calls: lastToolCalls } };
    }

    // ── OpenAI-compat protocol ─────────────────────────────────────────────
    private async chatOpenAI(
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
        // OpenRouter requires HTTP-Referer
        if (this.config.providerId === 'openrouter') {
            headers['HTTP-Referer'] = 'https://github.com/codai-ollama';
            headers['X-Title'] = 'CodAI';
        }

        const formattedTools = tools.length > 0 ? tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters }
        })) : undefined;

        // Convert Ollama-style messages to OpenAI format
        const openAIMessages = messages.map(m => {
            const base: any = { role: m.role, content: m.content };
            if (m.tool_calls) base.tool_calls = m.tool_calls;
            if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
            if (m.name) base.name = m.name;
            return base;
        });

        const body: any = {
            model,
            messages: openAIMessages,
            stream: true,
        };
        if (formattedTools) body.tools = formattedTools;

        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: abortSignal
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => response.statusText);
            const label = PROVIDER_DEFS[this.config.providerId].label;
            // Kullanıcı dostu hata mesajları
            if (response.status === 401 || response.status === 403) {
                throw new Error(`${label}: Invalid or missing API key. Go to Provider Settings and enter a valid key.`);
            }
            if (response.status === 429) {
                throw new Error(`Rate limit exceeded (429): ${label}. Wait a moment and try again.`);
            }
            if (response.status === 402) {
                throw new Error(`${label}: Insufficient credits. Check your account balance.`);
            }
            // Gemini: 503 RESOURCE_EXHAUSTED veya 200 ama body'de quota error
            if (response.status === 503 && errText.includes('RESOURCE_EXHAUSTED')) {
                throw new Error(`Rate limit exceeded (503 RESOURCE_EXHAUSTED): ${label}.`);
            }
            throw new Error(`${label} API error: ${response.status} — ${errText.slice(0, 200)}`);
        }

        return this.consumeOpenAIStream(response, onThinking, onContent);
    }

    private async consumeOpenAIStream(
        response: Response,
        onThinking?: (t: string) => void,
        onContent?: (c: string) => void
    ): Promise<any> {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let fullThinking = '';
        const toolCallsMap: Map<number, any> = new Map();
        const inlineSeen = new Set<string>();

        const parseLine = (line: string) => {
            if (!line.startsWith('data:')) return;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
                const json = JSON.parse(data);
                // Gemini stream içinde gelen quota/rate-limit hataları
                if (json.error) {
                    const code: string = json.error?.code || '';
                    const msg: string  = json.error?.message || '';
                    if (code === 'RESOURCE_EXHAUSTED' || json.error?.status === 429 || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')) {
                        throw new Error(`Rate limit exceeded (stream): ${msg}`);
                    }
                    throw new Error(`API stream error: ${msg}`);
                }
                const delta = json.choices?.[0]?.delta;
                if (!delta) return;

                // Thinking / reasoning (Gemini, DeepSeek, etc.)
                const thinkingDelta =
                    delta.reasoning_content ||
                    delta.thinking ||
                    (json.choices?.[0]?.thinking);
                if (thinkingDelta) {
                    fullThinking += thinkingDelta;
                    onThinking?.(fullThinking);
                }

                // Content delta
                if (delta.content) {
                    const parsed = this.extractInlineToolCalls(delta.content);
                    for (const call of parsed.calls) {
                        const sig = `${call.function?.name}::${call.function?.arguments}`;
                        if (!inlineSeen.has(sig)) {
                            inlineSeen.add(sig);
                            const idx = toolCallsMap.size;
                            toolCallsMap.set(idx, call);
                        }
                    }
                    fullContent += parsed.cleaned;
                    onContent?.(fullContent);
                }

                // Tool call deltas (streaming accumulation)
                if (Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                        const idx: number = tc.index ?? 0;
                        if (!toolCallsMap.has(idx)) {
                            toolCallsMap.set(idx, {
                                id: tc.id || `tc_${idx}_${Date.now()}`,
                                type: 'function',
                                function: { name: tc.function?.name || '', arguments: '' }
                            });
                        }
                        const existing = toolCallsMap.get(idx)!;
                        if (tc.id && !existing.id) existing.id = tc.id;
                        if (tc.function?.name) existing.function.name += tc.function.name;
                        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                    }
                }
            } catch { /* skip malformed */ }
        };

        if (reader) {
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) parseLine(line.trim());
            }
            if (buffer.trim()) parseLine(buffer.trim());
        }

        const toolCalls = Array.from(toolCallsMap.values()).filter(tc => tc.function?.name);

        return {
            message: {
                role: 'assistant',
                content: fullContent || null,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            }
        };
    }
}
