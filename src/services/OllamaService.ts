import { Message, Tool } from '../core/types';
import { NdjsonParser } from '../core/ndjsonParser';

export class OllamaService {
    constructor(public baseUrl: string) { }

    private mergeStream(current: string, incoming: string): string {
        const next = incoming || '';
        if (!next) return current;
        if (!current) return next;
        // Support both delta-style and snapshot-style streams.
        if (next.startsWith(current)) return next;
        if (current.startsWith(next)) return current;
        return current + next;
    }

    private sanitizeVisibleText(text: string): string {
        if (!text) return '';
        // Drop leaked placeholder control tokens from some models.
        return text
            .replace(/<[^>]*(?:place[\s_▁-]*holder|placeholder)[^>]*>/giu, ' ')
            .replace(/[ 	]+/g, ' ');
    }

    private extractInlineToolCalls(text: string): { calls: any[]; cleaned: string } {
        if (!text) return { calls: [], cleaned: '' };

        // Handles model-emitted inline tool blocks
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
                function: {
                    name,
                    arguments: argsText || '{}'
                }
            });

            cleaned = cleaned.replace(match[0], ' ');
        }

        cleaned = cleaned
            .replace(/[<＜][^>＞]*tool[\s_▁-]*calls[\s_▁-]*begin[^>＞]*[>＞]/giu, ' ')
            .replace(/[<＜][^>＞]*tool[\s_▁-]*calls[\s_▁-]*end[^>＞]*[>＞]/giu, ' ');

        cleaned = this.sanitizeVisibleText(cleaned);
        return { calls, cleaned };
    }

    async chatWithTools(
        model: string,
        messages: Message[],
        tools: Tool[],
        onThinking?: (thinking: string) => void,
        onContent?: (content: string) => void,
        abortSignal?: AbortSignal
    ): Promise<any> {
        const formattedTools = tools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));

        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages,
                    tools: formattedTools,
                    think: true,
                    stream: true
                }),
                signal: abortSignal
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText} (${response.status})`);
            }

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

                const thinkingContent =
                    json.message?.reasoning_content ||
                    json.message?.thinking ||
                    json.reasoning_content ||
                    json.thinking;

                if (thinkingContent) {
                    const parsed = this.extractInlineToolCalls(String(thinkingContent));
                    for (const call of parsed.calls) {
                        const sig = `${call.function?.name || ''}::${call.function?.arguments || ''}`;
                        if (!inlineSeen.has(sig)) {
                            inlineSeen.add(sig);
                            lastToolCalls.push(call);
                        }
                    }
                    if (json?.message && typeof json.message === 'object') {
                        if (typeof json.message.reasoning_content === 'string') json.message.reasoning_content = parsed.cleaned;
                        if (typeof json.message.thinking === 'string') json.message.thinking = parsed.cleaned;
                    }
                    fullThinking = this.mergeStream(fullThinking, parsed.cleaned);
                    onThinking?.(fullThinking);
                }

                if (json.message?.content) {
                    const parsed = this.extractInlineToolCalls(String(json.message.content));
                    for (const call of parsed.calls) {
                        const sig = `${call.function?.name || ''}::${call.function?.arguments || ''}`;
                        if (!inlineSeen.has(sig)) {
                            inlineSeen.add(sig);
                            lastToolCalls.push(call);
                        }
                    }
                    if (json?.message && typeof json.message === 'object' && typeof json.message.content === 'string') {
                        json.message.content = parsed.cleaned;
                    }
                    fullContent = this.mergeStream(fullContent, parsed.cleaned);
                    onContent?.(fullContent);
                }

                const toolCalls = json.message?.tool_calls ?? json.tool_calls;
                if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                    lastToolCalls = toolCalls;
                }
            };

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        const tail = parser.push(decoder.decode());
                        for (const json of tail) {
                            handleJson(json);
                        }
                        for (const json of parser.flush()) {
                            handleJson(json);
                        }
                        break;
                    }

                    const chunk = decoder.decode(value, { stream: true });
                    for (const json of parser.push(chunk)) {
                        handleJson(json);
                    }
                }
            }

            if (lastMessage?.message) {
                if ((!lastMessage.message.content || lastMessage.message.content.length === 0) && fullContent) {
                    lastMessage.message.content = fullContent;
                }
                if ((!Array.isArray(lastMessage.message.tool_calls) || lastMessage.message.tool_calls.length === 0) && lastToolCalls.length > 0) {
                    lastMessage.message.tool_calls = lastToolCalls;
                }
                return lastMessage;
            }

            return {
                message: {
                    content: fullContent,
                    tool_calls: lastToolCalls
                }
            };
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('Ollama stream aborted by user.');
                throw new Error('İşlem kullanıcı tarafından iptal edildi.');
            }
            throw error;
        }
    }
}
