export type ShellKind = 'powershell' | 'pwsh' | 'cmd' | 'sh';
export type ExecutionPath = 'shell_integration' | 'spawn';
export type MirrorMode = 'adapted';

export interface ShellConfig {
    shell: string;
    args: string[];
    shellKind: ShellKind;
    isPowerShell: boolean;
}

export interface ShellExecutionEnvelope {
    requestedCommand: string;
    adaptedCommand: string;
    shellKind: ShellKind;
    cwd: string;
    mirrorMode: MirrorMode;
    executionPath: ExecutionPath;
    shell: string;
    shellArgs: string[];
}

export function buildShellConfig(shell: string, args: string[], shellKind: ShellKind): ShellConfig {
    return {
        shell,
        args,
        shellKind,
        isPowerShell: shellKind === 'powershell' || shellKind === 'pwsh',
    };
}

export function adaptCommandForShell(command: string, config: ShellConfig): string {
    if (!config.isPowerShell) return command;
    return command.replace(/\s*&&\s*/g, '; ');
}

export function prependWorkspaceCwd(command: string, workspaceRoot: string, config: ShellConfig): string {
    const adaptedCommand = adaptCommandForShell(command, config);
    if (!workspaceRoot) return adaptedCommand;
    if (config.isPowerShell) {
        const escaped = workspaceRoot.replace(/'/g, "''");
        return `Set-Location -LiteralPath '${escaped}'; ${adaptedCommand}`;
    }
    if (config.shellKind === 'cmd') {
        return `cd /d "${workspaceRoot}" && ${adaptedCommand}`;
    }
    return `cd "${workspaceRoot}" && ${adaptedCommand}`;
}

export function createShellExecutionEnvelope(
    command: string,
    workspaceRoot: string,
    config: ShellConfig,
    executionPath: ExecutionPath,
): ShellExecutionEnvelope {
    return {
        requestedCommand: command,
        adaptedCommand: adaptCommandForShell(command, config),
        shellKind: config.shellKind,
        cwd: workspaceRoot,
        mirrorMode: 'adapted',
        executionPath,
        shell: config.shell,
        shellArgs: [...config.args],
    };
}
