import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolControlService } from '../services/ToolControlService';
import { getToolManifest } from '../tools/core/toolMetadata';

test('ToolControlService blocks repeated web_fetch calls for the same URL', () => {
    const service = new ToolControlService('turn-web-fetch');
    const manifest = getToolManifest('web_fetch');
    const args = { url: 'https://docs.example.com/reference' };

    const first = service.beforeToolExecution('web_fetch', args, manifest);
    assert.equal(first.allowed, true);
    service.afterToolExecution('web_fetch', args, 'success', 'Fetched docs.example.com');

    const second = service.beforeToolExecution('web_fetch', args, manifest);
    assert.equal(second.allowed, true);
    service.afterToolExecution('web_fetch', args, 'success', 'Fetched docs.example.com');

    const third = service.beforeToolExecution('web_fetch', args, manifest);
    assert.equal(third.allowed, false);
    assert.ok(third.reason?.includes('URL'));
    assert.equal(service.getState().blockedCalls, 1);
});

test('ToolControlService stops the turn after a failure streak', () => {
    const service = new ToolControlService('turn-failure-streak');
    const manifest = getToolManifest('run_command');

    for (let index = 0; index < 3; index += 1) {
        const args = { command: `broken-${index}` };
        const decision = service.beforeToolExecution('run_command', args, manifest);
        assert.equal(decision.allowed, true);
        service.afterToolExecution('run_command', args, 'error', 'command failed');
    }

    const blocked = service.beforeToolExecution('run_command', { command: 'broken-3' }, manifest);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.stopTurn, true);
    assert.ok(blocked.reason?.includes('failures in a row'));
});
