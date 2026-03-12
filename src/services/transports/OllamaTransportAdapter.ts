import type { ChatTransportAdapter, TransportRequest } from './types';
import { extractInlineToolCalls, mergeStream } from '../providerPayload';

export class OllamaTransportAdapter implements ChatTransportAdapter {
    public async chat(request: TransportRequest): Promise<any> {
        const formattedTools = request.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        }));

        const response = await fetch(`${request.baseUrl}/api/chat`, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify({ model: request.model, messages: request.messages, tools: formattedTools, think: true, stream: true }),
            signal: request.abortSignal
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.statusText} (${response.status})`);
        }

        return this.consumeStream(response, request.onThinking, request.onContent);
    }

    private async consumeStream(response: Response, onThinking?: (thinking: string) => void, onContent?: (content: string) => void): Promise<any> {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let fullThinking = '';
        let lastMessage: any = null;
        let lastToolCalls: any[] = [];
        const inlineSeen = new Set<string>();

        const handleJson = (json: any) => {
            lastMessage = json;
            const thinkingContent = json.message?.reasoning_content || json.message?.thinking;
            if (thinkingContent) {
                const parsed = extractInlineToolCalls(String(thinkingContent));
                for (const call of parsed.calls) {
                    const signature = `${call.function?.name}::${call.function?.arguments}`;
                    if (!inlineSeen.has(signature)) {
                        inlineSeen.add(signature);
                        lastToolCalls.push(call);
                    }
                }
                fullThinking = mergeStream(fullThinking, parsed.cleaned);
                onThinking?.(fullThinking);
            }
            if (json.message?.content) {
                const parsed = extractInlineToolCalls(String(json.message.content));
                for (const call of parsed.calls) {
                    const signature = `${call.function?.name}::${call.function?.arguments}`;
                    if (!inlineSeen.has(signature)) {
                        inlineSeen.add(signature);
                        lastToolCalls.push(call);
                    }
                }
                if (json.message && typeof json.message.content === 'string') {
                    json.message.content = parsed.cleaned;
                }
                fullContent = mergeStream(fullContent, parsed.cleaned);
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
                    if (buffer.trim()) {
                        for (const line of buffer.split('\n')) {
                            const trimmed = line.trim();
                            if (!trimmed) continue;
                            try {
                                handleJson(JSON.parse(trimmed));
                            } catch {
                                // Ignore malformed lines.
                            }
                        }
                    }
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        handleJson(JSON.parse(trimmed));
                    } catch {
                        // Ignore malformed lines.
                    }
                }
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
}
