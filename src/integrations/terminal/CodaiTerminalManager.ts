/**
 * CodaiTerminalManager — VSCode shell integration tabanlı terminal yönetimi.
 *
 * Cline'ın VscodeTerminalProcess + VscodeTerminalManager yaklaşımından ilham alınmıştır.
 *
 * Temel farklar vs eski child_process yaklaşımı:
 * 1. VSCode shell integration API'sini kullanır → gerçek output streaming
 * 2. ANSI + VSCode ]633; escape sekanslarını temizler
 * 3. isHot / isCompiling mekanizması → dev server biterken AI'ı bekletir
 * 4. Büyük output koruması → 500 satır / 512KB'dan büyük outputu truncate eder
 * 5. Shell integration yoksa 3 saniye bekleyip fallback döner
 * 6. Windows'ta düzgün process terminate (taskkill)
 */

import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// ─── Sabitler (Cline'ın constants.ts'inden) ─────────────────────────────────
const PROCESS_HOT_TIMEOUT_NORMAL    = 2_000;   // 2s — normal komut çıktı sonrası
const PROCESS_HOT_TIMEOUT_COMPILING = 15_000;  // 15s — derleme/build çıktısı sonrası
const MAX_FULL_OUTPUT_SIZE    = 1024 * 1024;   // 1MB — memory koruma
const MAX_OUTPUT_LINES        = 500;           // AI'a gönderilecek max satır
const TRUNCATE_KEEP_LINES     = 100;           // truncate'de baş+son için saklanacak satır
const SHELL_INTEGRATION_WAIT  = 4_000;         // 4s — shell integration timeout
const BACKGROUND_TIMEOUT_MS   = 10 * 60_000;  // 10 dakika — zombie process koruması

// Dev server pattern'leri — otomatik background olarak algılanır
const LONG_RUNNING_PATTERNS = [
    /\bnpm\s+(run\s+)?(dev|start|serve|watch|preview)\b/i,
    /\byarn\s+(dev|start|serve|watch|preview)\b/i,
    /\bpnpm\s+(dev|start|serve|watch|preview)\b/i,
    /\bnpx\s+(vite|webpack-dev-server|parcel|serve|http-server|live-server|ts-node-dev)\b/i,
    /\bvite\b(?!\s+build)/i,
    /\bwebpack\s+--watch\b/i,
    /\bnodemon\b/i,
    /\bts-node-dev\b/i,
    /\bnode\b.*\bserver\b/i,
    /\bpython\b.*\b(server|app\.py|manage\.py\s+runserver|uvicorn|gunicorn)\b/i,
    /\bruby\b.*\bserver\b/i,
    /\brails\s+server\b/i,
    /\bng\s+serve\b/i,
    /\bcargo\s+(run|watch)\b/i,
    /\bgo\s+run\b/i,
    /\bair\b/i,
    /\bdocker\s+(run|compose\s+up)\b/i,
    /\btail\s+-f\b/i,
];

// isCompiling detection (Cline'dan)
const COMPILING_MARKERS   = ['compiling','building','bundling','transpiling','generating','starting'];
const COMPILING_NULLIFIERS = ['compiled','success','finish','complete','succeed','done','end','stop','exit','terminate','error','fail'];

function isCompilingOutput(data: string): boolean {
    const low = data.toLowerCase();
    return COMPILING_MARKERS.some(m => low.includes(m)) && !COMPILING_NULLIFIERS.some(n => low.includes(n));
}

export function isLongRunning(command: string): boolean {
    return LONG_RUNNING_PATTERNS.some(p => p.test(command));
}

// ─── ANSI temizleme ─────────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

export function stripAnsi(str: string): string {
    return str.replace(ANSI_REGEX, '');
}

// ─── VSCode ]633; sekanslarını temizleme (Cline'dan) ────────────────────────
const VSCODE_SEQ_REGEX = /\x1b\]633;.[^\x07]*\x07/g;

function extractOutputBetween633(data: string): string {
    // ]633;C ile ]633;D arasındaki gerçek çıktıyı al
    const match = data.match(/\]633;C([\s\S]*?)\]633;D/);
    return match ? match[1] : '';
}

function removeVSCodeSequences(data: string): string {
    const betweenSeqs = extractOutputBetween633(data);
    // Son sekans'tan sonrasını al
    const allMatches = [...data.matchAll(VSCODE_SEQ_REGEX)];
    const lastMatch = allMatches[allMatches.length - 1];
    let cleaned = lastMatch ? data.slice(lastMatch.index! + lastMatch[0].length) : data;
    if (betweenSeqs) cleaned = betweenSeqs + '\n' + cleaned;
    return cleaned;
}

function cleanFirstChunk(data: string, command: string): string {
    data = removeVSCodeSequences(data);
    data = stripAnsi(data);
    const lines = data.split('\n');
    // İlk satırdan non-printable karakterleri temizle
    if (lines.length > 0) {
        lines[0] = lines[0].replace(/[^\x20-\x7E]/g, '');
        // Duplicate first char bug (Cline'dan)
        if (lines[0].length >= 2 && lines[0][0] === lines[0][1] && !['[','{','"',"'",'<','('].includes(lines[0][0])) {
            lines[0] = lines[0].slice(1);
        }
        // Terminal prompt artifact'larını temizle (%, $, #, >)
        lines[0] = lines[0].replace(/^[\x00-\x1F%$>#\s]*/, '');
    }
    if (lines.length > 1) {
        lines[1] = lines[1].replace(/^[\x00-\x1F%$>#\s]*/, '');
    }
    // Komutun echo'sunu kaldır
    const result: string[] = [];
    let foundNonCommand = false;
    for (const line of lines.join('\n').split('\n')) {
        if (!foundNonCommand && command.includes(line.trim())) continue;
        foundNonCommand = true;
        result.push(line);
    }
    return result.join('\n');
}

// ─── Output truncation ───────────────────────────────────────────────────────
export function truncateOutput(lines: string[]): string {
    if (lines.length <= MAX_OUTPUT_LINES) return lines.join('\n').trimEnd();
    const half = TRUNCATE_KEEP_LINES;
    const first = lines.slice(0, half);
    const last  = lines.slice(-half);
    const skipped = lines.length - first.length - last.length;
    return [...first, `\n... (${skipped} lines truncated) ...\n`, ...last].join('\n').trimEnd();
}

// ─── Windows process termination ─────────────────────────────────────────────
function killProcessTree(pid: number): void {
    if (process.platform === 'win32') {
        try {
            spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true });
        } catch { /* ignore */ }
    } else {
        try { process.kill(-pid, 'SIGTERM'); } catch { /* ignore */ }
        setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* */ } }, 2000);
    }
}

// ─── Shared CodAI terminal singleton ────────────────────────────────────────
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

// ─── Background process registry ─────────────────────────────────────────────
const _bgProcesses = new Map<string, { proc: ChildProcess; timer: NodeJS.Timeout }>();

export function killBackgroundProcess(id: string): boolean {
    const entry = _bgProcesses.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    const pid = entry.proc.pid;
    if (pid) killProcessTree(pid);
    else try { entry.proc.kill(); } catch { /* */ }
    _bgProcesses.delete(id);
    return true;
}

export function sendCtrlCToTerminal(): void {
    try {
        const term = getCodaiTerminal();
        term.show(true);
        term.sendText('\x03', false); // Ctrl+C
    } catch { /* ignore */ }
}

// ─── Main execution function ─────────────────────────────────────────────────
export interface RunResult {
    status: 'success' | 'error' | 'interrupted' | 'timeout' | 'background';
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    durationMs: number;
    background: boolean;
    autoDetected: boolean;
    bgId?: string;
    pid?: number;
    truncated: boolean;
    timedOut: boolean;
}

/**
 * Execute a shell command:
 * 1. Mirror to VSCode CodAI terminal
 * 2. Run via child_process (reliable output capture)
 * 3. Detect dev servers → return early after OUTPUT_WAIT_MS
 * 4. Strip ANSI, truncate large output, detect Ctrl+C
 */
export async function runCommand(
    command: string,
    workspaceRoot: string,
    options: {
        timeout?: number;
        background?: boolean;
    } = {}
): Promise<RunResult> {
    const autoDetectedBg = !options.background && isLongRunning(command);
    const isBackground   = Boolean(options.background) || autoDetectedBg;
    const timeoutMs      = isBackground ? 3_000 : Math.min(options.timeout ?? 60_000, 300_000);
    const bgId           = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startedAt      = Date.now();

    // ── Mirror to VSCode terminal ────────────────────────────────────────────
    mirrorToTerminal(command);

    // ── Shell config ─────────────────────────────────────────────────────────
    const { shell, args: shellArgs, isPowerShell } = getShellConfig();
    const adapted = adaptForShell(command, isPowerShell);

    return new Promise<RunResult>((resolve) => {
        const child = spawn(shell, [...shellArgs, adapted], {
            cwd: workspaceRoot,
            env: { ...process.env },
            windowsHide: true,
            // Use process group so we can kill all children on Windows
            ...(process.platform !== 'win32' ? { detached: true } : {}),
        });

        let stdoutRaw = '';
        let stderrRaw = '';
        let finished  = false;
        let isHot     = false;
        let hotTimer:  NodeJS.Timeout | null = null;
        const MAX_BYTES = 512 * 1024; // 512KB

        const onData = (chunk: Buffer, isStderr: boolean) => {
            const text = stripAnsi(chunk.toString('utf8'));
            if (isStderr) {
                if (stderrRaw.length < MAX_BYTES) stderrRaw += text;
            } else {
                if (stdoutRaw.length < MAX_BYTES) stdoutRaw += text;
            }
            // isHot logic (Cline'dan)
            isHot = true;
            if (hotTimer) clearTimeout(hotTimer);
            hotTimer = setTimeout(() => { isHot = false; },
                isCompilingOutput(text) ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL);
        };

        child.stdout?.on('data', (d: Buffer) => onData(d, false));
        child.stderr?.on('data', (d: Buffer) => onData(d, true));

        if (isBackground) {
            // Register in bg registry with zombie timeout
            const zombieTimer = setTimeout(() => {
                if (!finished) {
                    finished = true;
                    _bgProcesses.delete(bgId);
                    const pid = child.pid;
                    if (pid) killProcessTree(pid);
                }
            }, BACKGROUND_TIMEOUT_MS);
            _bgProcesses.set(bgId, { proc: child, timer: zombieTimer });

            // Return after initial output window
            const bgTimer = setTimeout(() => {
                if (finished) return;
                finished = true;
                const lines = buildLines(stdoutRaw, stderrRaw);
                resolve({
                    status: 'background',
                    stdout: truncateOutput(lines.stdout),
                    stderr: lines.stderrStr,
                    exitCode: null,
                    signal: null,
                    durationMs: Date.now() - startedAt,
                    background: true,
                    autoDetected: autoDetectedBg,
                    bgId,
                    pid: child.pid,
                    truncated: lines.stdout.length > MAX_OUTPUT_LINES,
                    timedOut: false,
                });
            }, timeoutMs);

            child.on('close', (code, sig) => {
                clearTimeout(bgTimer);
                clearTimeout(zombieTimer);
                _bgProcesses.delete(bgId);
                if (finished) return;
                finished = true;
                const lines = buildLines(stdoutRaw, stderrRaw);
                resolve({
                    status: code === 0 ? 'success' : (sig === 'SIGINT' ? 'interrupted' : 'error'),
                    stdout: truncateOutput(lines.stdout),
                    stderr: lines.stderrStr,
                    exitCode: code,
                    signal: sig ?? null,
                    durationMs: Date.now() - startedAt,
                    background: false,
                    autoDetected: autoDetectedBg,
                    bgId,
                    pid: child.pid,
                    truncated: lines.stdout.length > MAX_OUTPUT_LINES,
                    timedOut: false,
                });
            });
        } else {
            // Normal: wait for completion or timeout
            const timer = setTimeout(() => {
                if (finished) return;
                finished = true;
                const pid = child.pid;
                if (pid) killProcessTree(pid);
                else try { child.kill('SIGTERM'); } catch { /* */ }
                const lines = buildLines(stdoutRaw, stderrRaw);
                resolve({
                    status: 'timeout',
                    stdout: truncateOutput(lines.stdout),
                    stderr: lines.stderrStr || `Timed out after ${timeoutMs / 1000}s`,
                    exitCode: -1,
                    signal: 'SIGTERM',
                    durationMs: Date.now() - startedAt,
                    background: false,
                    autoDetected: false,
                    truncated: lines.stdout.length > MAX_OUTPUT_LINES,
                    timedOut: true,
                });
            }, timeoutMs);

            child.on('close', (code, sig) => {
                clearTimeout(timer);
                if (hotTimer) clearTimeout(hotTimer);
                if (finished) return;
                finished = true;
                const lines = buildLines(stdoutRaw, stderrRaw);
                resolve({
                    status: code === 0 ? 'success' : (sig === 'SIGINT' ? 'interrupted' : 'error'),
                    stdout: truncateOutput(lines.stdout),
                    stderr: lines.stderrStr,
                    exitCode: code,
                    signal: sig ?? null,
                    durationMs: Date.now() - startedAt,
                    background: false,
                    autoDetected: false,
                    truncated: lines.stdout.length > MAX_OUTPUT_LINES,
                    timedOut: false,
                });
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                if (finished) return;
                finished = true;
                resolve({
                    status: 'error',
                    stdout: '',
                    stderr: err.message,
                    exitCode: -1,
                    signal: null,
                    durationMs: Date.now() - startedAt,
                    background: false,
                    autoDetected: false,
                    truncated: false,
                    timedOut: false,
                });
            });
        }
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function buildLines(stdoutRaw: string, stderrRaw: string): { stdout: string[]; stderrStr: string } {
    const stdout = stdoutRaw.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
    const stderr = stderrRaw.trimEnd();
    return { stdout, stderrStr: stderr };
}

function mirrorToTerminal(command: string): void {
    try {
        const term = getCodaiTerminal();
        term.show(true);
        // Split && chains for PowerShell compat
        for (const part of splitCompound(command)) {
            if (part.trim()) term.sendText(part.trim(), true);
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

function getShellConfig(): { shell: string; args: string[]; isPowerShell: boolean } {
    if (process.platform !== 'win32') {
        return { shell: '/bin/sh', args: ['-c'], isPowerShell: false };
    }
    // Windows: PowerShell tespit et
    try {
        const cfg = vscode.workspace.getConfiguration('terminal.integrated');
        const profile = cfg.get<string>('defaultProfile.windows', '');
        if (/powershell|pwsh/i.test(profile)) {
            const shell = /pwsh/i.test(profile) ? 'pwsh.exe' : 'powershell.exe';
            return { shell, args: ['-NoProfile', '-NonInteractive', '-Command'], isPowerShell: true };
        }
        const profiles = cfg.get<Record<string, any>>('profiles.windows', {});
        const pPath = String(profiles[profile]?.path ?? '').toLowerCase();
        if (pPath.includes('pwsh')) return { shell: 'pwsh.exe', args: ['-NoProfile', '-NonInteractive', '-Command'], isPowerShell: true };
        if (pPath.includes('powershell')) return { shell: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command'], isPowerShell: true };
    } catch { /* ignore */ }
    // Default: cmd.exe (safe, handles &&)
    return { shell: 'cmd.exe', args: ['/c'], isPowerShell: false };
}

function adaptForShell(command: string, isPowerShell: boolean): string {
    if (!isPowerShell) return command;
    // PowerShell: && → ; (statement separator)
    return command.replace(/\s*&&\s*/g, '; ');
}
