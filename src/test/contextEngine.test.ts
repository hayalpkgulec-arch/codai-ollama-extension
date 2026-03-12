import test from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from '../core/types';
import { compactConversation } from '../services/ContextEngine';

test('compactConversation snapshots older turns without losing retrieval anchors', () => {
    const history: Message[] = [
        { role: 'system', content: 'You are CodAI.' },
        ...Array.from({ length: 40 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `Turn ${index} build pipeline notes and compile validation details `.repeat(110),
        })) as Message[],
    ];

    const result = compactConversation({
        conversationHistory: history,
        transcriptHistory: history,
        compactedContextSummary: '',
        snapshots: [],
        workspaceMemory: [
            {
                id: 'workspace:build-command',
                scope: 'workspace',
                title: 'Build command',
                value: 'Run npm run compile before packaging a release.',
                source: 'manual',
                updatedAt: new Date().toISOString(),
                reason: 'Regression guard for the coding agent.',
            },
        ],
        maxContextTokens: 64,
        query: 'build compile release',
        lastCompactionAt: null,
        compactedMessageCount: 0,
    });

    assert.ok(result.snapshots.length > 0);
    assert.ok(result.compactedContextSummary.length > 0);
    assert.ok(result.compactedMessageCount > 0);
    assert.ok(result.retrievalHits.some((hit) => hit.source === 'memory' || hit.source === 'snapshot'));
});
