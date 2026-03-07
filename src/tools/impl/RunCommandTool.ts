import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { spawn } from 'child_process';

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

        return new Promise((resolve) => {
            const isWin = process.platform === 'win32';
            const shell = isWin ? 'cmd.exe' : '/bin/sh';
            const shellFlag = isWin ? '/c' : '-c';

            const child = spawn(shell, [shellFlag, command], {
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

            // Background mode: return early after 800ms with initial output
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
                }, 800);

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
