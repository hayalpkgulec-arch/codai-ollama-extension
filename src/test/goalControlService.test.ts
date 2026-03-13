import test from 'node:test';
import assert from 'node:assert/strict';
import { GoalControlService } from '../services/GoalControlService';

test('GoalControlService tracks checkpoints and emits drift warnings for repeated failing patterns', () => {
    const service = new GoalControlService({
        turnId: 'turn-goal',
        userText: 'Investigate the provider regression and ship a safe fix.',
        planSummary: 'Fix the provider regression',
        planTodos: '- [ ] Inspect the failing provider payload\n- [ ] Patch the runtime\n- [ ] Verify with tests',
    });

    let state = service.recordToolStart('web_fetch', { url: 'https://docs.example.com/runtime' });
    state = service.recordToolStart('web_fetch', { url: 'https://docs.example.com/runtime' });
    state = service.recordToolStart('web_fetch', { url: 'https://docs.example.com/runtime' });

    assert.equal(state.activeGoal, 'Fix the provider regression');
    assert.equal(state.checkpoints.length, 3);
    assert.ok(state.driftWarnings.some((warning) => warning.includes('docs.example.com')));

    state = service.recordToolResult({
        toolName: 'web_fetch',
        args: { url: 'https://docs.example.com/runtime' },
        result: {
            status: 'error',
            summary: 'Fetch failed',
            failureClass: 'execution',
            blocked: false,
        },
        controlState: {
            turnId: 'turn-goal',
            totalCalls: 3,
            blockedCalls: 0,
            consecutiveFailures: 2,
            perToolCounts: { web_fetch: 3 },
            webFetchHostCounts: { 'docs.example.com': 3 },
            repeatedCallCounts: {},
            recentActions: [],
            alerts: [],
            focus: 'Recovering after web_fetch failed.',
            recommendedAction: 'Switch to a narrower query.',
        },
    });
    state = service.recordToolResult({
        toolName: 'web_fetch',
        args: { url: 'https://docs.example.com/runtime' },
        result: {
            status: 'error',
            summary: 'Fetch failed again',
            failureClass: 'execution',
            blocked: false,
        },
        controlState: {
            turnId: 'turn-goal',
            totalCalls: 3,
            blockedCalls: 0,
            consecutiveFailures: 3,
            perToolCounts: { web_fetch: 3 },
            webFetchHostCounts: { 'docs.example.com': 3 },
            repeatedCallCounts: {},
            recentActions: [],
            alerts: [],
            focus: 'Recovering after web_fetch failed.',
            recommendedAction: 'Switch to a narrower query.',
        },
    });

    assert.ok(state.driftWarnings.some((warning) => warning.includes('failed with execution errors')));
    assert.equal(state.recoveryHint, 'Switch to a narrower query.');
    assert.ok(service.flushNotices().length > 0);
});
