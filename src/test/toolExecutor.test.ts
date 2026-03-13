import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolExecutor } from '../core/runtime/ToolExecutor';
import { ToolPolicyService } from '../core/runtime/ToolPolicyService';
import { RuntimeEventBus } from '../core/runtime/RuntimeEventBus';
import { ToolControlService } from '../services/ToolControlService';

function createEventBus(events: Array<{ type: string; payload: any }>, controlStates: any[]) {
    return new RuntimeEventBus(
        (_turnId, type, payload) => {
            events.push({ type, payload });
        },
        (_turnId, state) => {
            controlStates.push(state);
        },
        () => undefined,
        (_turnId, message, severity) => {
            events.push({ type: 'toolControlNotice', payload: { message, severity } });
        },
    );
}

test('ToolExecutor returns validation envelope for unknown tools', async () => {
    const events: Array<{ type: string; payload: any }> = [];
    const controlStates: any[] = [];
    const policy = new ToolPolicyService(
        () => ({ read_file: true, write_file: false, run_command: false, web_fetch: false, all: false }),
        () => undefined,
    );
    const executor = new ToolExecutor({
        registry: {
            getTool() {
                return undefined;
            },
            executeTool() {
                return Promise.resolve('Error: Unknown tool');
            },
        } as any,
        policyService: policy,
        eventBus: createEventBus(events, controlStates),
        createCheckpoints: async () => [],
        hasRunningBgProcesses: () => false,
        getRunningBgProcesses: () => [],
    });

    const output = await executor.executeToolCall({
        turnId: 'turn-unknown',
        iteration: 1,
        toolCallId: 'call-1',
        toolName: 'totally_unknown',
        toolArgs: { foo: 'bar' },
        toolControl: new ToolControlService('turn-unknown'),
    });

    assert.equal(output.result.failureClass, 'validation');
    assert.equal(output.result.status, 'error');
    assert.ok(String(output.result.errorMessage).includes('Unknown tool'));
    assert.ok(events.some((event) => event.type === 'toolActivityError'));
});

test('ToolExecutor compacts structured tool results and preserves checkpoints', async () => {
    const events: Array<{ type: string; payload: any }> = [];
    const controlStates: any[] = [];
    const policy = new ToolPolicyService(
        () => ({ read_file: false, write_file: false, run_command: false, web_fetch: false, all: false }),
        (toolName) => ({
            name: toolName,
            category: 'write',
            riskLevel: 'high',
            requiresApproval: true,
            supportsAutoApprove: true,
            producesCheckpoint: true,
            idempotent: false,
            sideEffectScope: 'filesystem',
        }),
    );
    const executor = new ToolExecutor({
        registry: {
            getTool() {
                return { definition: { name: 'write_file' } };
            },
            async executeTool() {
                return JSON.stringify({
                    __tool: 'write_file',
                    status: 'success',
                    summary: 'Edited app.ts',
                    mode: 'editing',
                    path: 'src/app.ts',
                    fileName: 'app.ts',
                    preview: 'const value = 1;',
                    hunks: [],
                    addedCount: 1,
                    removedCount: 0,
                    durationMs: 12,
                });
            },
        } as any,
        policyService: policy,
        eventBus: createEventBus(events, controlStates),
        createCheckpoints: async () => [{
            id: 'checkpoint-1',
            timestamp: '2026-03-13T10:10:00.000Z',
            filePath: 'src/app.ts',
            originalPath: 'src/app.ts',
            toolName: 'write_file',
        }],
        hasRunningBgProcesses: () => false,
        getRunningBgProcesses: () => [],
    });

    const output = await executor.executeToolCall({
        turnId: 'turn-write',
        iteration: 1,
        toolCallId: 'call-write',
        toolName: 'write_file',
        toolArgs: { path: 'src/app.ts', content: 'const value = 1;' },
        toolControl: new ToolControlService('turn-write'),
    });

    assert.equal(output.result.status, 'success');
    assert.equal(output.result.checkpointRefs?.[0], 'checkpoint-1');
    assert.ok(String(output.result.historyContent).includes('"checkpointId":"checkpoint-1"'));
    assert.ok(events.some((event) => event.type === 'toolApprovalPreview'));
    assert.ok(events.some((event) => event.type === 'checkpointSaved'));
    assert.ok(events.some((event) => event.type === 'toolActivityDone'));
});
