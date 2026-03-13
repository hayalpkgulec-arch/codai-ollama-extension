import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageStateStore } from '../core/runtime/MessageStateStore';

function createGlobalState(initial: Record<string, unknown> = {}) {
    const store = new Map<string, unknown>(Object.entries(initial));
    return {
        get<T>(key: string): T | undefined {
            return store.get(key) as T | undefined;
        },
        async update(key: string, value: unknown) {
            if (value === undefined) {
                store.delete(key);
            } else {
                store.set(key, value);
            }
        },
    };
}

function createStorageStub() {
    const sessionIndex: any[] = [];
    const sessionHistories = new Map<string, any>();
    let browserArtifactsIndex: any[] = [];
    return {
        getWorkspaceHash() {
            return 'workspace-test';
        },
        readSessionIndex(fallback: any[]) {
            return sessionIndex.length > 0 ? sessionIndex : fallback;
        },
        async writeSessionIndex(value: any[]) {
            sessionIndex.splice(0, sessionIndex.length, ...value);
        },
        readSessionHistory(sessionId: string, fallback: any) {
            return sessionHistories.has(sessionId) ? sessionHistories.get(sessionId) : fallback;
        },
        async writeSessionHistory(sessionId: string, value: any) {
            sessionHistories.set(sessionId, value);
        },
        async deleteSessionHistory(sessionId: string) {
            sessionHistories.delete(sessionId);
        },
        readBrowserArtifactsIndex(fallback: any[]) {
            return browserArtifactsIndex.length > 0 ? browserArtifactsIndex : fallback;
        },
        async writeBrowserArtifactsIndex(value: any[]) {
            browserArtifactsIndex = [...value];
        },
        getWrittenIndex() {
            return [...sessionIndex];
        },
        getWrittenHistory(sessionId: string) {
            return sessionHistories.get(sessionId);
        },
    };
}

test('MessageStateStore saves schema-versioned runtime snapshots', async () => {
    const storage = createStorageStub();
    const globalState = createGlobalState();
    const workspaceManager = {
        getSessionSnapshot() {
            return {
                conversationHistory: [{ role: 'user', content: 'hi' }],
                transcriptHistory: [{ role: 'user', content: 'hi' }],
                mode: 'code',
                model: 'qwen3',
                planTodos: '',
                planSummary: 'Ship the runtime refactor',
                savedAt: '2026-03-13T10:00:00.000Z',
            };
        },
        getPlanSummary() {
            return 'Ship the runtime refactor';
        },
    };
    const traceService = {
        getCurrentTurnState() {
            return {
                turnId: 'turn-1',
                requestId: 'turn-1',
                providerId: 'openrouter',
                model: 'qwen3',
                phase: 'tool_execution',
                iteration: 2,
                startedAt: 1,
                activeToolCallIds: ['call-1'],
                budgetState: {
                    contextTokens: 1,
                    contextChars: 1,
                    maxContextTokens: 1000,
                    tokensLeft: 999,
                    percentUsed: 1,
                    autoCompactEnabled: true,
                    lastCompactionAt: null,
                    compactedMessageCount: 0,
                },
            };
        },
        getLatestSummary() {
            return {
                turnId: 'turn-1',
                providerId: 'openrouter',
                model: 'qwen3',
                phase: 'tool_execution',
                startedAt: 1,
                traceFilePath: '/tmp/turn-1.jsonl',
                eventCount: 4,
            };
        },
    };

    const store = new MessageStateStore(
        storage as any,
        { globalState } as any,
        workspaceManager as any,
        traceService as any,
        () => ({
            turnId: 'turn-1',
            totalCalls: 1,
            blockedCalls: 0,
            consecutiveFailures: 0,
            perToolCounts: { read_file: 1 },
            webFetchHostCounts: {},
            repeatedCallCounts: {},
            recentActions: [],
            alerts: [],
            focus: 'Reading files.',
            recommendedAction: 'Keep going.',
        }),
        () => ({
            turnId: 'turn-1',
            activeGoal: 'Ship the runtime refactor',
            checkpoints: [{ id: 'cp-1', label: 'Finish runtime split', done: false }],
            driftWarnings: [],
            recommendedNextStep: 'Keep the next action scoped.',
        }),
        () => ({
            active: true,
            sessionId: 'browser-1',
            currentUrl: 'https://example.com',
            lastAction: 'navigate',
            artifactCount: 1,
            consoleMessageCount: 2,
        }),
        () => [{
            id: 'artifact-1',
            sessionId: 'browser-1',
            kind: 'screenshot',
            label: 'Navigate screenshot',
            path: '/tmp/browser-1/artifact-1.png',
            createdAt: '2026-03-13T10:10:00.000Z',
            action: 'navigate',
        }],
    );

    await store.saveSessionHistory('session-1', [{ role: 'assistant', segments: [] }]);
    const written = storage.getWrittenHistory('session-1');

    assert.equal(written.schemaVersion, 2);
    assert.equal(written.messageState.model, 'qwen3');
    assert.equal(written.runtimeSnapshots[0].turnState.turnId, 'turn-1');
    assert.equal(written.runtimeSnapshots[0].toolControlState.turnId, 'turn-1');
    assert.equal(written.runtimeSnapshots[0].goalControlState.activeGoal, 'Ship the runtime refactor');
    assert.equal(written.runtimeSnapshots[0].browserSessionState.sessionId, 'browser-1');
    assert.equal(written.browserArtifactsIndex[0].kind, 'screenshot');
});

test('MessageStateStore migrates legacy session payloads and restores meta fallback', async () => {
    const storage = createStorageStub();
    const globalState = createGlobalState({
        codai_sessions_v1: [
            { id: 'legacy-session', mode: 'plan', model: 'gemini-2.5-pro' },
        ],
    });
    await storage.writeSessionHistory('legacy-session', {
        messages: [{ role: 'assistant', segments: [] }],
        transcriptHistory: [{ role: 'user', content: 'legacy transcript' }],
        conversationHistory: [{ role: 'user', content: 'legacy conversation' }],
        planTodos: '- [ ] migrate',
        planSummary: 'Migrate old payload',
        savedAt: '2026-03-13T10:05:00.000Z',
    });

    let restoredState: any = null;
    const workspaceManager = {
        restoreSessionState(state: any) {
            restoredState = state;
        },
        getPlanSummary() {
            return '';
        },
    };
    const traceService = {
        getCurrentTurnState() {
            return null;
        },
        getLatestSummary() {
            return null;
        },
    };

    const store = new MessageStateStore(
        storage as any,
        { globalState } as any,
        workspaceManager as any,
        traceService as any,
        () => null,
        () => null,
        () => null,
        () => [],
    );

    const loaded = await store.loadSession('legacy-session');

    assert.equal(loaded.payload.schemaVersion, 1);
    assert.equal(loaded.payload.messageState.planSummary, 'Migrate old payload');
    assert.equal(restoredState.mode, 'plan');
    assert.equal(restoredState.model, 'gemini-2.5-pro');
    assert.equal(loaded.messages.length, 1);
});

test('MessageStateStore pins active sessions first and keeps archived sessions at the end', async () => {
    const storage = createStorageStub();
    const globalState = createGlobalState();
    const store = new MessageStateStore(
        storage as any,
        { globalState } as any,
        {
            getSessionSnapshot() {
                return {
                    conversationHistory: [],
                    transcriptHistory: [],
                    mode: 'code',
                    model: 'qwen3',
                    planTodos: '',
                    planSummary: '',
                    savedAt: '2026-03-13T10:00:00.000Z',
                };
            },
            getPlanSummary() {
                return '';
            },
        } as any,
        {
            getCurrentTurnState() {
                return null;
            },
            getLatestSummary() {
                return null;
            },
        } as any,
        () => null,
        () => null,
        () => null,
        () => [],
    );

    await store.upsertSessionMeta({
        id: 'recent-session',
        title: 'Recent session',
        createdAt: '2026-03-13T10:00:00.000Z',
        updatedAt: '2026-03-13T10:10:00.000Z',
        messageCount: 2,
        mode: 'code',
    });
    await store.upsertSessionMeta({
        id: 'pinned-session',
        title: 'Pinned session',
        createdAt: '2026-03-13T09:00:00.000Z',
        updatedAt: '2026-03-13T09:10:00.000Z',
        messageCount: 1,
        mode: 'chat',
        pinned: true,
    });
    await store.upsertSessionMeta({
        id: 'archived-session',
        title: 'Archived session',
        createdAt: '2026-03-13T08:00:00.000Z',
        updatedAt: '2026-03-13T08:10:00.000Z',
        messageCount: 4,
        mode: 'plan',
        archived: true,
        archivedAt: '2026-03-13T08:15:00.000Z',
    });

    const sessions = await store.getSessions();

    assert.equal(sessions[0].id, 'pinned-session');
    assert.equal(sessions[1].id, 'recent-session');
    assert.equal(sessions[2].id, 'archived-session');
    assert.equal(storage.getWrittenIndex()[0].id, 'pinned-session');
});

test('MessageStateStore exports bundles and imports them with unique ids', async () => {
    const storage = createStorageStub();
    const globalState = createGlobalState();
    const workspaceManager = {
        getSessionSnapshot() {
            return {
                conversationHistory: [{ role: 'user', content: 'ship it' }],
                transcriptHistory: [{ role: 'user', content: 'ship it' }],
                mode: 'code',
                model: 'qwen3',
                planTodos: '',
                planSummary: '',
                savedAt: '2026-03-13T10:00:00.000Z',
            };
        },
        getPlanSummary() {
            return '';
        },
        restoreSessionState() {
            return undefined;
        },
    };
    const traceService = {
        getCurrentTurnState() {
            return null;
        },
        getLatestSummary() {
            return null;
        },
    };

    const store = new MessageStateStore(
        storage as any,
        { globalState } as any,
        workspaceManager as any,
        traceService as any,
        () => null,
        () => null,
        () => null,
        () => [],
    );

    await store.upsertSessionMeta({
        id: 'session-1',
        title: 'Build release',
        createdAt: '2026-03-13T10:00:00.000Z',
        updatedAt: '2026-03-13T10:10:00.000Z',
        messageCount: 1,
        mode: 'code',
        preview: 'Build the release',
    });
    await store.saveSessionHistory('session-1', [{
        role: 'user',
        segments: [{ type: 'content', text: 'Build the release and ship it.' }],
    }]);

    const exported = await store.exportSession('session-1');
    const imported = await store.importSession(exported);

    assert.ok(exported);
    assert.equal(exported?.meta.id, 'session-1');
    assert.equal(exported?.workspaceHash, 'workspace-test');
    assert.equal(imported.id, 'session-1-2');
    assert.equal(imported.title, 'Build release');
    assert.equal(storage.getWrittenHistory(imported.id).messages[0].role, 'user');
});
