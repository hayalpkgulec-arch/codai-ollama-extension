import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────────────────────
// Shared CodAI terminal — singleton, recreated if closed
// ─────────────────────────────────────────────────────────────────────────────
let _codaiTerminal: vscode.Terminal | undefined;

export function getCodaiTerminal(): vscode.Terminal {
    if (!_codaiTerminal || _codaiTerminal.exitStatus !== undefined) {
        _codaiTerminal = vscode.window.createTerminal({
            name: 'CodAI',
            iconPath: new vscode.ThemeIcon('sparkle'),
        });
    }
    return _codaiTerminal;
}

// Track running background processes so we can send SIGINT on demand
const _bgProcesses = new Map<string, ChildProcess>();

export function killBackgroundProcess(id: string): boolean {
    const proc = _bgProcesses.get(id);
    if (!proc) return false;
    try {
        if (process.platform === 'win32') {
            proc.kill();
        } else {
            proc.kill('SIGINT');
        }
    } catch { /* ignore */ }
    _bgProcesses.delete(id);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patterns that indicate a long-running / server-like command
// → auto-promoted to background, returned within OUTPUT_WAIT_MS
// ─────────────────────────────────────────────────────────────────────────────
const LONG_RUNNING_PATTERNS = [
    /\bnpm\s+(?:run\s+)?(?:dev|start|serve|watch|preview)\b/i,
    /\byarn\s+(?:dev|start|serve|watch|preview)\b/i,
    /\bpnpm\s+(?:dev|start|serve|watch|preview)\b/i,
    /\bnpx\s+(?:vite|webpack-dev-server|parcel|serve|http-server|live-server)\b/i,
    /\bvite\b/i,
    /\bwebpack\s+--watch\b/i,
    /\bnodemon\b/i,
    /\bnode\s+.*server\b/i,
    /\bpython\s+.*(?:server|app\.py|manage\.py\s+runserver)\b/i,
    /\bruby\s+.*server\b/i,
    /\brails\s+server\b/i,
    /\bng\s+serve\b/i,
    /\bcargo\s+(?:run|watch)\b/i,
    /\bgo\s+run\b/i,
    /\bair\b/i,
    /\bdocker\s+(?:run|compose\s+up)\b/i,
    /\bwatchexec\b/i,
    /\btail\s+-f\b/i,
];

const OUTPUT_WAIT_MS = 3000; // wait this long for initial output before returning

function isLongRunning(command: string): boolean {
    return LONG_RUNNING_PATTERNS.some(p => p.test(command));
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell detection
// ─────────────────────────────────────────────────────────────────────────────
function getShellConfig(): { shell: string; shellFlag: string; isPowerShell: boolean } {
    if (process.platform !== 'win32') {
        return { shell: '/bin/sh', shellFlag: '-c', isPowerShell: false };
    }
    try {
        const cfg = vscode.workspace.getConfiguration('terminal.integrated');
        const profile = cfg.get<string>('defaultProfile.windows', '');
        if (/powershell|pwsh/i.test(profile)) {
            return { shell: /pwsh/i.test(profile) ? 'pwsh.exe' : 'powershell.exe', shellFlag: '-Command', isPowerShell: true };
        }
        const profiles = cfg.get<Record<string, any>>('profiles.windows', {});
        const path = String(profiles[profile]?.path ?? '').toLowerCase();
        if (path.includes('powershell') || path.includes('pwsh')) {
            return { shell: path.includes('pwsh') ? 'pwsh.exe' : 'powershell.exe', shellFlag: '-Command', isPowerShell: true };
        }
    } catch { /* ignore */ }
    return { shell: 'cmd.exe', shellFlag: '/c', isPowerShell: false };
}

function adaptCommand(command: string, isPowerShell: boolean): string {
    if (!isPowerShell) return command;
    return command.replace(/\s*&&\s*/g, '; ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Mirror to VSCode terminal — split && chains for PowerShell compat
// ─────────────────────────────────────────────────────────────────────────────
function mirrorToTerminal(command: string): void {
    try {
        const term = getCodaiTerminal();
        term.show(true);
        // Split compound commands
        const parts = splitCompound(command);
        for (const p of parts) {
            if (p.trim()) term.sendText(p.trim(), true);
        }
    } catch { /* non-critical */ }
}

function splitCompound(cmd: string): string[] {
    const parts: string[] = [];
    let cur = '', inSQ = false, inDQ = false, depth = 0;
    for (let i = 0; i < cmd.length; i++) {
        const c = cmd[i], n = cmd[i + 1];
        if (c === "'" && !inDQ) { inSQ = !inSQ; cur += c; continue; }
        if (c === '"' && !inSQ) { inDQ = !inDQ; cur += c; continue; }
        if (inSQ || inDQ) { cur += c; continue; }
        if (c === '(') { depth++; cur += c; continue; }
        if (c === ')') { depth--; cur += c; continue; }
        if (depth === 0 && c === '&' && n === '&') { if (cur.trim()) parts.push(cur.trim()); cur = ''; i++; continue; }
        cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.length ? parts : [cmd];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool
// ─────────────────────────────────────────────────────────────────────────────
export class RunCommandTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'run_command',
            description: `Execute a shell command in the workspace directory.
- Short commands (ls, npm install, tsc, etc.) run synchronously and return output.
- Long-running servers/watchers (npm run dev, vite, nodemon, etc.) auto-run in background and return after initial output.
- Set background:true explicitly for any command you want to detach immediately.`,
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command to execute' },
                    timeout:  { type: 'number', description: 'Timeout ms (default 60000, max 300000)' },
                    background: { type: 'boolean', description: 'Detach immediately (auto-set for dev servers)' },
                },
                required: ['command'],
            },
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return this.err('No workspace folder open', '');

        const command = String(args.command || args.cmd || '').trim();
        if (!command) return this.err('No command provided', '');

        // Auto-detect long-running commands
        const forcedBg: boolean = Boolean(args.background);
        const autoDetectedBg = !forcedBg && isLongRunning(command);
        const isBackground = forcedBg || autoDetectedBg;

        const timeoutMs = isBackground ? OUTPUT_WAIT_MS : Math.min(Number(args.timeout) || 60000, 300000);
        const startedAt = Date.now();
        const bgId = `bg-${startedAt}-${Math.random().toString(36).slice(2, 6)}`;

        // Mirror to VSCode terminal (non-blocking)
        mirrorToTerminal(command);

        const { shell, shellFlag, isPowerShell } = getShellConfig();
        const adapted = adaptCommand(command, isPowerShell);

        return new Promise<string>((resolve) => {
            const child = spawn(shell, [shellFlag, adapted], {
                cwd: workspaceRoot,
                env: { ...process.env },
                windowsHide: true,
            });

            if (isBackground) _bgProcesses.set(bgId, child);

            let stdout = '', stderr = '';
            let finished = false;
            const MAX = 50_000;

            child.stdout?.on('data', (d: Buffer) => { if (stdout.length < MAX) stdout += d.toString('utf8'); });
            child.stderr?.on('data', (d: Buffer) => { if (stderr.length < MAX) stderr += d.toString('utf8'); });

            const done = (exitCode: number | null, signal?: string, timedOut = false, wasBackground = false) => {
                if (finished) return;
                finished = true;
                if (isBackground) _bgProcesses.delete(bgId);
                const finishedAt = Date.now();
                const code = exitCode ?? (signal ? -1 : 0);
                const ok = code === 0;
                resolve(JSON.stringify({
                    __tool: 'run_command',
                    status: ok ? 'success' : (signal === 'SIGINT' || signal === '^C' ? 'interrupted' : 'error'),
                    summary: wasBackground
                        ? `Started in background: ${command}`
                        : ok ? `Ran: ${command}` : `Failed: ${command}`,
                    command,
                    stdout: stdout.trimEnd(),
                    stderr: stderr.trimEnd(),
                    exitCode: code,
                    signal: signal || null,
                    startedAt,
                    finishedAt,
                    durationMs: finishedAt - startedAt,
                    background: wasBackground,
                    timedOut,
                    bgId: wasBackground ? bgId : undefined,
                    pid: wasBackground ? child.pid : undefined,
                    truncated: stdout.length >= MAX || stderr.length >= MAX,
                    autoDetected: autoDetectedBg,
                }));
            };

            if (isBackground) {
                // Return after OUTPUT_WAIT_MS with initial output
                const bgTimer = setTimeout(() => done(null, undefined, false, true), timeoutMs);
                child.on('close', (code, sig) => { clearTimeout(bgTimer); done(code, sig ?? undefined, false, false); });
                child.on('error', (e) => { clearTimeout(bgTimer); stderr += e.message; done(-1, undefined, false, false); });
            } else {
                // Normal: wait for completion or timeout
                const timer = setTimeout(() => {
                    try { child.kill('SIGTERM'); } catch { /* */ }
                    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, 2000);
                    done(-1, 'SIGTERM', true, false);
                }, timeoutMs);
                child.on('close', (code, sig) => { clearTimeout(timer); done(code, sig ?? undefined, false, false); });
                child.on('error', (e) => { clearTimeout(timer); stderr += e.message; done(-1, undefined, false, false); });
            }
        });
    }

    private err(msg: string, command: string): string {
        return JSON.stringify({
            __tool: 'run_command', status: 'error', command,
            stdout: '', stderr: msg, exitCode: -1, signal: null,
            startedAt: Date.now(), finishedAt: Date.now(), durationMs: 0, background: false,
        });
    }
}
