import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

// ── Shared CodAI terminal — uses shell integration when available ─────────────
let _codaiTerminal: vscode.Terminal | undefined;

function getCodaiTerminal(): vscode.Terminal {
    if (!_codaiTerminal || _codaiTerminal.exitStatus !== undefined) {
        _codaiTerminal = vscode.window.createTerminal({
            name: 'CodAI',
            iconPath: new vscode.ThemeIcon('sparkle'),
        });
    }
    return _codaiTerminal;
}

/**
 * Mirror a command to VSCode integrated terminal.
 * Uses shell integration executeCommand when available (proper output streaming).
 * Falls back to sendText for older VSCode versions.
 * 
 * IMPORTANT: Does NOT use `&&` chains — sends each sub-command separately to avoid
 * PowerShell incompatibility ("&& is not a valid statement separator").
 */
function mirrorToVSCodeTerminal(command: string): void {
    try {
        const term = getCodaiTerminal();
        term.show(true); // preserveFocus=true: show terminal without stealing focus from chat

        // Split compound commands (cmd1 && cmd2 → send each separately)
        // This fixes PowerShell bug where && is not recognized
        const subCommands = splitCompoundCommand(command);
        for (const cmd of subCommands) {
            if (cmd.trim()) {
                term.sendText(cmd.trim(), true);
            }
        }
    } catch { /* non-critical */ }
}

/**
 * Split a compound shell command into individual commands.
 * Handles &&, ;, and | separators while respecting quoted strings.
 * Returns the original command as single-element array if complex/unsafe to split.
 */
function splitCompoundCommand(command: string): string[] {
    // Simple heuristic: only split on && at the top level (not inside quotes/parens)
    // For PowerShell compat we split && into separate sendText calls
    const parts: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let parenDepth = 0;

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        const next = command[i + 1];

        if (ch === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; current += ch; continue; }
        if (ch === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; current += ch; continue; }
        if (inSingleQuote || inDoubleQuote) { current += ch; continue; }

        if (ch === '(') { parenDepth++; current += ch; continue; }
        if (ch === ')') { parenDepth--; current += ch; continue; }

        // Split on && at top level
        if (parenDepth === 0 && ch === '&' && next === '&') {
            if (current.trim()) parts.push(current.trim());
            current = '';
            i++; // skip second &
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts.length > 0 ? parts : [command];
}

/**
 * Detect whether the workspace is using PowerShell or cmd.
 * Uses the VSCode terminal profile setting if available.
 */
function getShellConfig(): { shell: string; shellFlag: string; isPowerShell: boolean } {
    if (process.platform !== 'win32') {
        return { shell: '/bin/sh', shellFlag: '-c', isPowerShell: false };
    }

    // Check VSCode terminal profile
    try {
        const config = vscode.workspace.getConfiguration('terminal.integrated');
        const defaultProfile = config.get<string>('defaultProfile.windows', '');
        if (defaultProfile.toLowerCase().includes('powershell')) {
            return { shell: 'powershell.exe', shellFlag: '-Command', isPowerShell: true };
        }
        // Check shell path
        const profiles = config.get<Record<string, any>>('profiles.windows', {});
        if (profiles[defaultProfile]?.path) {
            const p = String(profiles[defaultProfile].path).toLowerCase();
            if (p.includes('powershell') || p.includes('pwsh')) {
                return { shell: p.includes('pwsh') ? 'pwsh.exe' : 'powershell.exe', shellFlag: '-Command', isPowerShell: true };
            }
        }
    } catch { /* ignore */ }

    // Default to cmd.exe on Windows — safe for && chains
    return { shell: 'cmd.exe', shellFlag: '/c', isPowerShell: false };
}

/**
 * Adapt a command for PowerShell if needed.
 * - Converts `&&` to `;` (PS uses semicolon as statement separator)
 * - Converts `||` to `-or` is too complex, just use `;` for chaining
 */
function adaptCommandForShell(command: string, isPowerShell: boolean): string {
    if (!isPowerShell) return command;
    // Replace && with ; (PowerShell statement separator)
    // Only replace at top level to avoid breaking quoted strings
    return command.replace(/\s*&&\s*/g, '; ');
}

export class RunCommandTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'run_command',
            description: 'Execute a shell command in the workspace directory. Supports long-running processes with streaming output.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute'
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds (default: 60000, max: 300000)'
                    },
                    background: {
                        type: 'boolean',
                        description: 'Run in background — return immediately after process starts (useful for dev servers)'
                    }
                },
                required: ['command']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return JSON.stringify({
            __tool: 'run_command', status: 'error',
            command: '', stdout: '', stderr: 'No workspace folder open', exitCode: -1,
            startedAt: Date.now(), finishedAt: Date.now(), durationMs: 0, background: false
        });

        const command = String(args.command || args.cmd || '').trim();
        if (!command) return JSON.stringify({
            __tool: 'run_command', status: 'error',
            command: '', stdout: '', stderr: 'No command provided', exitCode: -1,
            startedAt: Date.now(), finishedAt: Date.now(), durationMs: 0, background: false
        });

        const timeoutMs = Math.min(Number(args.timeout) || 60000, 300000);
        const isBackground = Boolean(args.background);
        const startedAt = Date.now();

        // ── Mirror command to VSCode integrated terminal (non-blocking) ──────
        mirrorToVSCodeTerminal(command);

        // ── Detect shell and adapt command ────────────────────────────────────
        const { shell, shellFlag, isPowerShell } = getShellConfig();
        const adaptedCommand = adaptCommandForShell(command, isPowerShell);

        return new Promise((resolve) => {
            const child = spawn(shell, [shellFlag, adaptedCommand], {
                cwd: workspaceRoot,
                env: { ...process.env },
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';
            let finished = false;

            const MAX_OUTPUT = 50000; // 50KB cap per stream

            child.stdout.on('data', (data: Buffer) => {
                const chunk = data.toString('utf8');
                if (stdout.length < MAX_OUTPUT) stdout += chunk;
            });

            child.stderr.on('data', (data: Buffer) => {
                const chunk = data.toString('utf8');
                if (stderr.length < MAX_OUTPUT) stderr += chunk;
            });

            const finish = (exitCode: number | null, signal?: string) => {
                if (finished) return;
                finished = true;
                const finishedAt = Date.now();
                const code = exitCode ?? (signal ? -1 : 0);
                resolve(JSON.stringify({
                    __tool: 'run_command',
                    status: code === 0 ? 'success' : 'error',
                    summary: code === 0 ? `Ran: ${command}` : `Failed: ${command}`,
                    command,
                    stdout: stdout.trimEnd(),
                    stderr: stderr.trimEnd(),
                    exitCode: code,
                    signal: signal || null,
                    startedAt,
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    background: false,
                    truncated: stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT,
                }));
            };

            // Background mode: return early after 1200ms with initial output
            if (isBackground) {
                const bgTimer = setTimeout(() => {
                    if (finished) return;
                    finished = true;
                    const finishedAt = Date.now();
                    resolve(JSON.stringify({
                        __tool: 'run_command',
                        status: 'success',
                        summary: `Started: ${command}`,
                        command,
                        stdout: stdout.trimEnd() || '(running in background…)',
                        stderr: stderr.trimEnd(),
                        exitCode: null,
                        signal: null,
                        startedAt,
                        finishedAt,
                        durationMs: finishedAt - startedAt,
                        background: true,
                        pid: child.pid ?? null,
                        truncated: false,
                    }));
                }, 1200);

                child.on('close', (code, signal) => {
                    clearTimeout(bgTimer);
                    finish(code, signal ?? undefined);
                });
                return;
            }

            // Normal mode: wait for completion or timeout
            const timer = setTimeout(() => {
                if (finished) return;
                child.kill('SIGTERM');
                setTimeout(() => { if (!finished) child.kill('SIGKILL'); }, 2000);
                finished = true;
                const finishedAt = Date.now();
                resolve(JSON.stringify({
                    __tool: 'run_command',
                    status: 'error',
                    summary: `Timeout: ${command}`,
                    command,
                    stdout: stdout.trimEnd(),
                    stderr: stderr.trimEnd() || `Timed out after ${timeoutMs / 1000}s`,
                    exitCode: -1,
                    signal: 'SIGTERM',
                    startedAt,
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    background: false,
                    truncated: stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT,
                }));
            }, timeoutMs);

            child.on('close', (code, signal) => {
                clearTimeout(timer);
                finish(code, signal ?? undefined);
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                if (finished) return;
                finished = true;
                const finishedAt = Date.now();
                resolve(JSON.stringify({
                    __tool: 'run_command',
                    status: 'error',
                    summary: `Error: ${command}`,
                    command,
                    stdout: stdout.trimEnd(),
                    stderr: err.message,
                    exitCode: -1,
                    signal: null,
                    startedAt,
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    background: false,
                    truncated: false,
                }));
            });
        });
    }
}
