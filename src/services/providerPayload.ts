import type { Message } from '../core/types';

export function mergeStream(current: string, incoming: string): string {
    if (!incoming) return current;
    if (!current) return incoming;
    if (incoming.startsWith(current)) return incoming;
    if (current.startsWith(incoming)) return current;
    return current + incoming;
}

export function sanitizeText(text: string): string {
    if (!text) return '';
    return text.replace(/<[^>]*(?:place[\s_-]*holder|placeholder)[^>]*>/giu, '');
}

export function normalizeMessageContent(content: Message['content']): string | null {
    if (content == null) return null;
    return typeof content === 'string' ? content : JSON.stringify(content);
}

export function normalizeToolCalls(
    toolCalls: Message['tool_calls'],
    toolIdQueues?: Map<string, string[]>
): Array<{
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}> | undefined {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

    const seenToolCallIds = new Set<string>();
    const normalized = toolCalls
        .map((toolCall, index) => {
            const name = typeof toolCall?.function?.name === 'string'
                ? toolCall.function.name.trim()
                : '';
            if (!name) return null;

            const rawArgs = toolCall?.function?.arguments;
            const serializedArgs = typeof rawArgs === 'string'
                ? rawArgs
                : JSON.stringify(rawArgs ?? {});
            const baseId = typeof toolCall?.id === 'string' && toolCall.id.trim()
                ? toolCall.id
                : `tool_call_${Date.now()}_${index}`;
            let uniqueId = baseId;
            let collisionIndex = 2;
            while (seenToolCallIds.has(uniqueId)) {
                uniqueId = `${baseId}_${collisionIndex++}`;
            }
            seenToolCallIds.add(uniqueId);
            if (toolIdQueues) {
                const queue = toolIdQueues.get(baseId) ?? [];
                queue.push(uniqueId);
                toolIdQueues.set(baseId, queue);
            }

            return {
                id: uniqueId,
                type: 'function' as const,
                function: {
                    name,
                    arguments: serializedArgs,
                },
            };
        })
        .filter((toolCall): toolCall is NonNullable<typeof toolCall> => Boolean(toolCall));

    return normalized.length > 0 ? normalized : undefined;
}

export function toOpenAICompatibleMessages(messages: Message[]): any[] {
    const pendingToolIds = new Set<string>();
    const pendingToolIdQueues = new Map<string, string[]>();
    const normalizedMessages: any[] = [];

    for (const message of messages) {
        const role = message.role;
        const content = normalizeMessageContent(message.content);
        const base: any = { role };

        if (role === 'assistant') {
            pendingToolIds.clear();
            pendingToolIdQueues.clear();
            const normalizedToolCalls = normalizeToolCalls(message.tool_calls, pendingToolIdQueues);
            base.content = normalizedToolCalls ? (content ?? null) : (content ?? '');
            if (normalizedToolCalls) {
                base.tool_calls = normalizedToolCalls;
                for (const toolCall of normalizedToolCalls) {
                    pendingToolIds.add(toolCall.id);
                }
            }
            if (typeof message.name === 'string' && message.name.trim()) base.name = message.name;
            normalizedMessages.push(base);
            continue;
        }

        if (role === 'tool') {
            if (typeof message.tool_call_id !== 'string') {
                continue;
            }
            const queue = pendingToolIdQueues.get(message.tool_call_id);
            const remappedToolCallId = queue?.length
                ? queue.shift()!
                : message.tool_call_id;
            if (queue && queue.length === 0) {
                pendingToolIdQueues.delete(message.tool_call_id);
            }
            if (!pendingToolIds.has(remappedToolCallId)) {
                continue;
            }
            base.content = content ?? '';
            base.tool_call_id = remappedToolCallId;
            pendingToolIds.delete(remappedToolCallId);
            if (typeof message.name === 'string' && message.name.trim()) base.name = message.name;
            normalizedMessages.push(base);
            continue;
        }

        pendingToolIds.clear();
        pendingToolIdQueues.clear();
        base.content = content ?? '';
        if (typeof message.name === 'string' && message.name.trim()) base.name = message.name;
        normalizedMessages.push(base);
    }

    return normalizedMessages;
}

export function extractInlineToolCalls(text: string): { calls: any[]; cleaned: string } {
    if (!text) return { calls: [], cleaned: '' };
    const callRegex =
        /[<＜][^>＞]*tool[\s_▁-]*call[\s_▁-]*begin[^>＞]*[>＞]\s*([a-zA-Z0-9_.:-]+)\s*[<＜][^>＞]*tool[\s_▁-]*sep[^>＞]*[>＞]\s*([\s\S]*?)\s*[<＜][^>＞]*tool[\s_▁-]*call[\s_▁-]*end[^>＞]*[>＞]/giu;

    const calls: any[] = [];
    let cleaned = text;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = callRegex.exec(text)) !== null) {
        const name = (match[1] || '').trim();
        const argsText = (match[2] || '').trim();
        if (!name) continue;
        calls.push({
            id: `inline_${Date.now()}_${index++}`,
            type: 'function',
            function: { name, arguments: argsText || '{}' }
        });
        cleaned = cleaned.replace(match[0], ' ');
    }
    cleaned = cleaned
        .replace(/[<＜][^>＞]*tool[\s_▁-]*calls[\s_▁-]*begin[^>＞]*[>＞]/giu, ' ')
        .replace(/[<＜][^>＞]*tool[\s_▁-]*calls[\s_▁-]*end[^>＞]*[>＞]/giu, ' ')
        .replace(/\{[^{}]*"name"\s*:\s*"[a-z_]+"[^{}]*"arguments"\s*:\s*\{[^{}]*\}\s*\}/g, '')
        .replace(/^\s*\[[\s\S]*?"name"\s*:\s*"[a-z_]+"[\s\S]*?\]\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n');

    cleaned = sanitizeText(cleaned);
    return { calls, cleaned };
}

export function classifyProviderError(label: string, status: number, errText: string): string {
    if (status === 401 || status === 403) {
        return `${label}: Invalid or missing API key. Go to Provider Settings and enter a valid key.`;
    }
    if (status === 429) {
        return `Rate limit exceeded (429): ${label}. Wait a moment and try again.`;
    }
    if (status === 402) {
        return `${label}: Insufficient credits. Check your account balance.`;
    }
    if (status === 503 && errText.includes('RESOURCE_EXHAUSTED')) {
        return `Rate limit exceeded (503 RESOURCE_EXHAUSTED): ${label}.`;
    }
    return `${label} API error: ${status} — ${errText.slice(0, 200)}`;
}
