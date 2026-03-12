import { PROVIDER_DEFS } from '../providerCatalog';
import { classifyProviderError, extractInlineToolCalls, mergeStream, toOpenAICompatibleMessages } from '../providerPayload';
import type { ChatTransportAdapter, TransportRequest } from './types';

export class OpenAITransportAdapter implements ChatTransportAdapter {
    public async chat(request: TransportRequest): Promise<any> {
        const formattedTools = request.tools.length > 0
            ? request.tools.map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters }
            }))
            : undefined;

        const body: any = {
            model: request.model,
            messages: toOpenAICompatibleMessages(request.messages),
            stream: true,
        };
        if (formattedTools) body.tools = formattedTools;

        const response = await fetch(`${request.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(body),
            signal: request.abortSignal
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => response.statusText);
            const label = PROVIDER_DEFS[request.providerId].label;
            throw new Error(classifyProviderError(label, response.status, errText));
        }

        return this.consumeStream(response, request.onThinking, request.onContent);
    }

    private async consumeStream(response: Response, onThinking?: (thinking: string) => void, onContent?: (content: string) => void): Promise<any> {
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

            const json = JSON.parse(data);
            if (json.error) {
                const code: string = json.error?.code || '';
                const msg: string = json.error?.message || '';
                if (code === 'RESOURCE_EXHAUSTED' || json.error?.status === 429 || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate limit')) {
                    throw new Error(`Rate limit exceeded (stream): ${msg}`);
                }
                throw new Error(`API stream error: ${msg}`);
            }

            const delta = json.choices?.[0]?.delta;
            if (!delta) return;

            const thinkingDelta = delta.reasoning_content || delta.thinking || json.choices?.[0]?.thinking;
            if (thinkingDelta) {
                fullThinking += thinkingDelta;
                onThinking?.(fullThinking);
            }

            if (delta.content) {
                const parsed = extractInlineToolCalls(delta.content);
                for (const call of parsed.calls) {
                    const signature = `${call.function?.name}::${call.function?.arguments}`;
                    if (!inlineSeen.has(signature)) {
                        inlineSeen.add(signature);
                        toolCallsMap.set(-(inlineSeen.size), call);
                    }
                }
                fullContent = mergeStream(fullContent, parsed.cleaned);
                onContent?.(fullContent);
            }

            if (Array.isArray(delta.tool_calls)) {
                for (const toolCall of delta.tool_calls) {
                    const index = toolCall.index ?? 0;
                    if (!toolCallsMap.has(index)) {
                        toolCallsMap.set(index, {
                            id: toolCall.id || `tc_${index}_${Date.now()}`,
                            type: 'function',
                            function: { name: toolCall.function?.name || '', arguments: '' }
                        });
                    }
                    const existing = toolCallsMap.get(index)!;
                    if (toolCall.id && !existing.id) existing.id = toolCall.id;
                    if (toolCall.function?.name && !existing.function.name) {
                        existing.function.name = toolCall.function.name;
                    }
                    if (toolCall.function?.arguments) {
                        existing.function.arguments += toolCall.function.arguments;
                    }
                }
            }
        };

        if (reader) {
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    parseLine(trimmed);
                }
            }
            if (buffer.trim()) parseLine(buffer.trim());
        }

        const toolCalls = Array.from(toolCallsMap.values()).filter((toolCall) => toolCall.function?.name);

        return {
            message: {
                role: 'assistant',
                content: fullContent || null,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            }
        };
    }
}
