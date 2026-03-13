import * as vscode from 'vscode';
import {
    adaptCommandForShell,
    buildShellConfig,
    createShellExecutionEnvelope,
    prependWorkspaceCwd,
    type ShellConfig,
} from './ShellExecutionContracts';

export * from './ShellExecutionContracts';

export function resolveShellConfig(): ShellConfig {
    if (process.platform !== 'win32') {
        return buildShellConfig('/bin/sh', ['-c'], 'sh');
    }

    try {
        const cfg = vscode.workspace.getConfiguration('terminal.integrated');
        const profile = cfg.get<string>('defaultProfile.windows', '');
        if (/pwsh/i.test(profile)) {
            return buildShellConfig('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command'], 'pwsh');
        }
        if (/powershell/i.test(profile)) {
            return buildShellConfig('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command'], 'powershell');
        }
        if (/command prompt|cmd/i.test(profile)) {
            return buildShellConfig('cmd.exe', ['/c'], 'cmd');
        }

        const profiles = cfg.get<Record<string, any>>('profiles.windows', {});
        const selectedProfile = profiles[profile];
        const profilePath = Array.isArray(selectedProfile?.path)
            ? String(selectedProfile.path[0] ?? '').toLowerCase()
            : String(selectedProfile?.path ?? '').toLowerCase();
        if (profilePath.includes('pwsh')) {
            return buildShellConfig('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command'], 'pwsh');
        }
        if (profilePath.includes('powershell')) {
            return buildShellConfig('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command'], 'powershell');
        }
        if (profilePath.includes('cmd')) {
            return buildShellConfig('cmd.exe', ['/c'], 'cmd');
        }
    } catch {
        // Fall through to a safe default.
    }

    return buildShellConfig('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command'], 'powershell');
}
