import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adaptCommandForShell,
    createShellExecutionEnvelope,
    prependWorkspaceCwd,
    type ShellConfig,
} from '../services/ShellExecutionContracts';

const powershellConfig: ShellConfig = {
    shell: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command'],
    shellKind: 'powershell',
    isPowerShell: true,
};

const cmdConfig: ShellConfig = {
    shell: 'cmd.exe',
    args: ['/c'],
    shellKind: 'cmd',
    isPowerShell: false,
};

test('adaptCommandForShell rewrites PowerShell command chaining', () => {
    assert.equal(
        adaptCommandForShell('echo hi && echo bye', powershellConfig),
        'echo hi; echo bye',
    );
    assert.equal(
        adaptCommandForShell('echo hi && echo bye', cmdConfig),
        'echo hi && echo bye',
    );
});

test('prependWorkspaceCwd uses shell-specific cwd prologue', () => {
    assert.equal(
        prependWorkspaceCwd('npm run dev', 'C:\\repo', powershellConfig),
        "Set-Location -LiteralPath 'C:\\repo'; npm run dev",
    );
    assert.equal(
        prependWorkspaceCwd('npm run dev', 'C:\\repo', cmdConfig),
        'cd /d "C:\\repo" && npm run dev',
    );
});

test('createShellExecutionEnvelope preserves request and adapted execution metadata', () => {
    const envelope = createShellExecutionEnvelope(
        'echo hi && echo bye',
        'C:\\repo',
        powershellConfig,
        'spawn',
    );

    assert.deepEqual(envelope, {
        requestedCommand: 'echo hi && echo bye',
        adaptedCommand: 'echo hi; echo bye',
        shellKind: 'powershell',
        cwd: 'C:\\repo',
        mirrorMode: 'adapted',
        executionPath: 'spawn',
        shell: 'powershell.exe',
        shellArgs: ['-NoProfile', '-NonInteractive', '-Command'],
    });
});
