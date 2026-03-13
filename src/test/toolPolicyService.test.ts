import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolPolicyService } from '../core/runtime/ToolPolicyService';
import { ToolControlService } from '../services/ToolControlService';

test('ToolPolicyService emits approval preview and retry policy for high-risk tools', () => {
    const service = new ToolPolicyService(
        () => ({ read_file: false, write_file: false, run_command: false, web_fetch: false, all: false }),
        (toolName) => ({
            name: toolName,
            category: 'run',
            riskLevel: 'high',
            requiresApproval: true,
            supportsAutoApprove: true,
            producesCheckpoint: false,
            idempotent: false,
            sideEffectScope: 'process',
            commandProfile: 'interactive',
            source: 'builtin',
        }),
    );

    const decision = service.evaluate(new ToolControlService('turn-policy'), {
        turnId: 'turn-policy',
        toolCallId: 'call-policy',
        toolName: 'run_command',
        args: { command: 'npm test' },
    });

    assert.equal(decision.requiresApproval, true);
    assert.equal(decision.retryPolicy.maxAttempts, 2);
    assert.equal(decision.approvalPreview?.toolName, 'run_command');
    assert.ok(decision.approvalPreview?.preview.includes('npm test'));
});
