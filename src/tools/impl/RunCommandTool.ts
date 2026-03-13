import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import {
    runCommand,
    getCodaiTerminal,
    killBackgroundProcess,
    sendCtrlCToTerminal,
} from '../../integrations/terminal/CodaiTerminalManager';

// Re-export so WebviewMessageHandler can import from here (backwards compat)
export { getCodaiTerminal, killBackgroundProcess, sendCtrlCToTerminal };

export class RunCommandTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'run_command',
            description: `Execute a shell command in the workspace root directory.

IMPORTANT RULES:
- Short commands (npm install, tsc, git status, etc.) run synchronously and return full output.
- Long-running servers/watchers (npm run dev, vite, nodemon, etc.) are automatically detected and run in background — they return after 3 seconds of initial output. Do NOT set background:true for these, it is handled automatically.
- On Windows, use PowerShell-compatible commands. Do NOT use Unix-only commands like 'ls', 'cat', 'rm', 'grep'. Use 'dir', 'type', 'del', 'findstr' instead — OR use cross-platform npm scripts.
- Do NOT chain commands with && when targeting Windows PowerShell — run each command separately.
- Never block on a dev server. If you run one, treat it as started and continue with other tasks.`,
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'Shell command to execute in the workspace directory',
                    },
                    timeout: {
                        type: 'number',
                        description: 'Timeout in milliseconds (default: 60000, max: 300000). Ignored for background commands.',
                    },
                    background: {
                        type: 'boolean',
                        description: 'Force background mode (return immediately). Leave unset — dev servers are auto-detected.',
                    },
                },
                required: ['command'],
            },
        };
    }

    async execute(args: any): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            return JSON.stringify({
                __tool: 'run_command', status: 'error',
                command: '', stdout: '', stderr: 'No workspace folder open',
                exitCode: -1, signal: null, startedAt: Date.now(),
                finishedAt: Date.now(), durationMs: 0, background: false,
            });
        }

        const command = String(args.command || args.cmd || '').trim();
        if (!command) {
            return JSON.stringify({
                __tool: 'run_command', status: 'error',
                command: '', stdout: '', stderr: 'No command provided',
                exitCode: -1, signal: null, startedAt: Date.now(),
                finishedAt: Date.now(), durationMs: 0, background: false,
            });
        }

        const startedAt = Date.now();
        const result = await runCommand(command, workspaceRoot, {
            timeout:    args.timeout ? Number(args.timeout) : undefined,
            background: Boolean(args.background),
        });

        const finishedAt = Date.now();
        return JSON.stringify({
            __tool: 'run_command',
            status:       result.status,
            summary:      result.background
                ? `Started in background: ${command}`
                : result.status === 'success'
                    ? `Ran: ${command}`
                    : result.status === 'interrupted'
                        ? `Interrupted: ${command}`
                        : result.status === 'timeout'
                            ? `Timeout: ${command}`
                            : `Failed: ${command}`,
            command,
            stdout:       result.stdout,
            stderr:       result.stderr,
            exitCode:     result.exitCode,
            signal:       result.signal,
            startedAt,
            finishedAt,
            durationMs:   finishedAt - startedAt,
            background:   result.background,
            autoDetected: result.autoDetected,
            bgId:         result.bgId,
            pid:          result.pid,
            timedOut:     result.timedOut,
            truncated:    result.truncated,
            requestedCommand: result.shell.requestedCommand,
            adaptedCommand:   result.shell.adaptedCommand,
            shellKind:        result.shell.shellKind,
            shellPath:        result.shell.shell,
            shellArgs:        result.shell.shellArgs,
            mirrorMode:       result.shell.mirrorMode,
            executionPath:    result.shell.executionPath,
        });
    }
}
