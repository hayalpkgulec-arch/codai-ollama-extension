import test from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '../core/types';
import { normalizeToolCalls, toOpenAICompatibleMessages } from '../services/providerPayload';

test('normalizeToolCalls deduplicates duplicate tool call ids', () => {
    const normalized = normalizeToolCalls([
        {
            id: 'dup-call',
            type: 'function',
            function: { name: 'read_file', arguments: { path: 'src/a.ts' } },
        },
        {
            id: 'dup-call',
            type: 'function',
            function: { name: 'read_file', arguments: { path: 'src/b.ts' } },
        },
    ] as any);

    assert.ok(normalized);
    assert.deepEqual(normalized?.map((toolCall) => toolCall.id), ['dup-call', 'dup-call_2']);
});

test('toOpenAICompatibleMessages remaps queued tool_call_id values after dedupe', () => {
    const history: Message[] = [
        {
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: 'dup-call',
                    type: 'function',
                    function: { name: 'read_file', arguments: { path: 'src/a.ts' } },
                },
                {
                    id: 'dup-call',
                    type: 'function',
                    function: { name: 'read_file', arguments: { path: 'src/b.ts' } },
                },
            ] as any,
        },
        { role: 'tool', content: 'first result', tool_call_id: 'dup-call' },
        { role: 'tool', content: 'second result', tool_call_id: 'dup-call' },
    ];

    const normalized = toOpenAICompatibleMessages(history);

    assert.equal(normalized[0].tool_calls[0].id, 'dup-call');
    assert.equal(normalized[0].tool_calls[1].id, 'dup-call_2');
    assert.equal(normalized[1].tool_call_id, 'dup-call');
    assert.equal(normalized[2].tool_call_id, 'dup-call_2');
});
