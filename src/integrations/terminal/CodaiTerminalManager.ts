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

// Background komutlar için:
// - İlk çıktıdan sonra isHot=true, output gelmeye devam ettiği sürece bekle
// - Son çıktıdan bu kadar ms sonra "settled" sayılır ve dönülür
const BG_SETTLED_TIMEOUT_MS   = 2_000;   // 2s sessizlik → settled
// Hiç çıktı gelmezse bu kadar bekle
const BG_INITIAL_WAIT_MS      = 5_000;   // 5s initial wait
// Maksimum bekleme (sunucu hala başlıyorsa bile dön)
const BG_MAX_WAIT_MS          = 15_000;  // 15s hard max

// Interactive stdin bekleme pattern'leri — bunlar görülünce hemen "input needed" dön
const INTERACTIVE_PATTERNS = [
    /\(y\/n\)/i,
    /\(yes\/no\)/i,
    /Press any key/i,
    /press enter/i,
    /Enter your choice/i,
    /Enter a number/i,
    /\?\s*$/,             // soru işaretiyle biten satır (npm init vs)
    /:\s*$/,              // iki nokta üst üste ile biten prompt satırı
    /password:/i,
    /Username:/i,
    /Are you sure/i,
    /Proceed\?/i,
    /Continue\?/i,
    /Overwrite\?/i,
    /\[Y\/n\]/,
    /\[y\/N\]/,
];

// Hata belirten pattern'ler — bunlar görülünce hemen dön
const ERROR_PATTERNS = [
    /\b(error|Error|ERROR)\b.*:/,
    /\bFailed to\b/i,
    /\bCannot find\b/i,
    /\bModule not found\b/i,
    /\bSyntaxError\b/,
    /\bTypeError\b/,
    /\bReferenceError\b/,
    /\bfailed with exit code\b/i,
    /\[ERROR\]/,
    /✗.*error/i,
];

// Sunucunun başarıyla başladığını gösteren pattern'ler — görülünce dön
const SERVER_READY_PATTERNS = [
    /Local:\s+http/i,
    /localhost:\d+/i,
    /ready in \d+/i,
    /listening on/i,
    /server running/i,
    /started server/i,
    /running at/i,
    /available at/i,
    /\bready\b.*\bhttp/i,
];

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

export function getCodaiTerminal(cwd?: string): vscode.Terminal {
    if (!_codaiTerminal || _codaiTerminal.exitStatus !== undefined) {
        _codaiTerminal = vscode.window.createTerminal({
            name: 'CodAI',
            iconPath: new vscode.ThemeIcon('sparkle'),
            cwd,
        });
    }
    return _codaiTerminal;
}

// ─── Background process registry ─────────────────────────────────────────────
type BgEntry = {
    proc: ChildProcess;
    timer: NodeJS.Timeout;
    onDied?: (exitCode: number | null, signal: string | null) => void;
};
const _bgProcesses = new Map<string, BgEntry>();

/** Register a "process died" callback — called when the bg process exits naturally or via Ctrl+C */
export function onBgProcessDied(id: string, cb: (exitCode: number | null, signal: string | null) => void): void {
    const entry = _bgProcesses.get(id);
    if (entry) entry.onDied = cb;
}

export function isBgProcessAlive(id: string): boolean {
    return _bgProcesses.has(id);
}

/** Returns all currently running background processes — used to warn AI before starting new ones */
export function getRunningBgProcesses(): Array<{ bgId: string; command?: string }> {
    return Array.from(_bgProcesses.entries()).map(([bgId]) => ({ bgId }));
}

export function hasRunningBgProcesses(): boolean {
    return _bgProcesses.size > 0;
}

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

    // ── Preferred path: VSCode shell integration for foreground commands ─────
    // This avoids the "preview terminal != real process" mismatch when available.
    if (!isBackground) {
        const shellResult = await tryRunViaShellIntegration(command, workspaceRoot, timeoutMs, startedAt);
        if (shellResult) return shellResult;
    }

    // ── Mirror to VSCode terminal ────────────────────────────────────────────
    mirrorToTerminal(command);

    // ── Shell config ─────────────────────────────────────────────────────────
    const { shell, args: shellArgs, isPowerShell } = getShellConfig();
    const adapted = adaptForShell(command, isPowerShell);

    // B04 FIX: Validate cwd exists before spawning
    // If command starts with "cd X && ..." and X doesn't exist, spawn will silently
    // use workspaceRoot anyway. Detect early and return clear error.
    const cdMatch = command.match(/^\s*cd\s+["']?([^"';&]+?)["']?\s*(?:&&|;|\n|$)/);
    if (cdMatch) {
        const targetDir = cdMatch[1].trim();
        const resolvedDir = require('path').isAbsolute(targetDir)
            ? targetDir
            : require('path').join(workspaceRoot, targetDir);
        if (!require('fs').existsSync(resolvedDir)) {
            return {
                status: 'error',
                stdout: '',
                stderr: `cd: Cannot find path '${resolvedDir}' — directory does not exist`,
                exitCode: 1,
                signal: null,
                durationMs: 0,
                background: false,
                autoDetected: false,
                truncated: false,
                timedOut: false,
            };
        }
    }

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

        let interactiveResolve: (() => void) | null = null;

        // Get terminal reference for live output streaming
        const term = getCodaiTerminal();

        const onData = (chunk: Buffer, isStderr: boolean) => {
            const text = stripAnsi(chunk.toString('utf8'));
            if (isStderr) {
                if (stderrRaw.length < MAX_BYTES) stderrRaw += text;
            } else {
                if (stdoutRaw.length < MAX_BYTES) stdoutRaw += text;
            }

            // ── BF-2: Pipe child_process output → VSCode terminal ────────────
            // This keeps the VSCode terminal in sync with actual process output.
            // Each chunk is written with sendText(text, false) to avoid newline duplication.
            if (text.trim()) {
                try { term.sendText(text.trimEnd(), false); } catch { /* terminal closed */ }
            }

            // isHot logic (Cline'dan)
            isHot = true;
            if (hotTimer) clearTimeout(hotTimer);
            hotTimer = setTimeout(() => { isHot = false; },
                isCompilingOutput(text) ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL);

            // Interactive pattern detect — process is waiting for user input
            const lastLines = text.split('\n').slice(-3).join('\n');
            if (!finished && INTERACTIVE_PATTERNS.some(p => p.test(lastLines))) {
                if (interactiveResolve) interactiveResolve();
            }
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

            // onDied callback is fired from the close handler above — no separate exit listener needed

            let settledTimer: NodeJS.Timeout | null = null;
            let hasReceivedOutput = false;
            let hasError = false;

            // ── Adaptive settled detection ────────────────────────────────
            // Cline'ın isHot yaklaşımını genişlettik:
            // Output geldikçe settled timer'ı sıfırla.
            // Hata görülünce veya server ready olunca hemen dön.
            // 2s sessizlik veya 15s max sonra dön.
            const scheduleSettle = (immediate = false) => {
                if (settledTimer) clearTimeout(settledTimer);
                settledTimer = setTimeout(() => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(maxTimer);
                    const lines = buildLines(stdoutRaw, stderrRaw);
                    // Hata varsa error status döndür — AI görsün
                    const status = hasError ? 'error' : 'background';
                    resolve({
                        status,
                        stdout: truncateOutput(lines.stdout),
                        stderr: lines.stderrStr,
                        exitCode: hasError ? 1 : null,
                        signal: null,
                        durationMs: Date.now() - startedAt,
                        background: !hasError,
                        autoDetected: autoDetectedBg,
                        bgId,
                        pid: child.pid,
                        truncated: lines.stdout.length > MAX_OUTPUT_LINES,
                        timedOut: false,
                    });
                }, immediate ? 200 : BG_SETTLED_TIMEOUT_MS);
            };

            // Override onData to trigger settle logic
            const origOnData = onData;
            const bgOnData = (chunk: Buffer, isStderr: boolean) => {
                origOnData(chunk, isStderr);
                const text = stripAnsi(chunk.toString('utf8'));
                hasReceivedOutput = true;

                // Hata pattern'i görüldü mü?
                if (ERROR_PATTERNS.some(p => p.test(text))) {
                    hasError = true;
                    scheduleSettle(true); // hemen dön
                    return;
                }
                // Server ready pattern'i görüldü mü?
                if (SERVER_READY_PATTERNS.some(p => p.test(text))) {
                    scheduleSettle(true); // hemen dön
                    return;
                }
                // Normal çıktı: settled timer'ı sıfırla
                scheduleSettle(false);
            };

            // Re-attach listeners with bg-aware version
            child.stdout?.removeAllListeners('data');
            child.stderr?.removeAllListeners('data');
            child.stdout?.on('data', (d: Buffer) => bgOnData(d, false));
            child.stderr?.on('data', (d: Buffer) => bgOnData(d, true));

            // Initial wait: eğer hiç çıktı gelmezse BG_INITIAL_WAIT_MS sonra başlat
            const initialTimer = setTimeout(() => {
                if (!hasReceivedOutput && !finished) {
                    scheduleSettle(false);
                }
            }, BG_INITIAL_WAIT_MS);

            // Hard max: her halükarda BG_MAX_WAIT_MS sonra dön
            const maxTimer = setTimeout(() => {
                if (finished) return;
                finished = true;
                clearTimeout(settledTimer ?? undefined);
                clearTimeout(initialTimer);
                const lines = buildLines(stdoutRaw, stderrRaw);
                resolve({
                    status: hasError ? 'error' : 'background',
                    stdout: truncateOutput(lines.stdout),
                    stderr: lines.stderrStr,
                    exitCode: null,
                    signal: null,
                    durationMs: Date.now() - startedAt,
                    background: !hasError,
                    autoDetected: autoDetectedBg,
                    bgId,
                    pid: child.pid,
                    truncated: lines.stdout.length > MAX_OUTPUT_LINES,
                    timedOut: false,
                });
            }, BG_MAX_WAIT_MS);

            child.on('close', (code, sig) => {
                clearTimeout(zombieTimer);
                clearTimeout(settledTimer ?? undefined);
                clearTimeout(initialTimer);
                clearTimeout(maxTimer);
                // B06 FIX: Fire onDied callback from close (not exit) for cleanup reliability
                const entry = _bgProcesses.get(bgId);
                if (entry?.onDied) entry.onDied(code, sig ?? null);
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

            // Interactive input detect — resolve early with current output + hint
            interactiveResolve = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                // Kill the waiting process so it doesn't linger
                try { child.kill(); } catch { /* */ }
                const lines = buildLines(stdoutRaw, stderrRaw);
                const hint = '\n[Process is waiting for user input — cannot proceed automatically. Use ask_followup_question to get the needed value from the user, then run the command again with the answer.]';
                resolve({
                    status: 'error',
                    stdout: truncateOutput(lines.stdout) + hint,
                    stderr: lines.stderrStr,
                    exitCode: -1,
                    signal: null,
                    durationMs: Date.now() - startedAt,
                    background: false,
                    autoDetected: false,
                    truncated: false,
                    timedOut: false,
                });
            };

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

async function tryRunViaShellIntegration(
    command: string,
    workspaceRoot: string,
    timeoutMs: number,
    startedAt: number,
): Promise<RunResult | null> {
    try {
        const term = getCodaiTerminal(workspaceRoot) as any;
        term.show(true);

        const integration = term.shellIntegration;
        if (!integration || typeof integration.executeCommand !== 'function') return null;

        const { isPowerShell } = getShellConfig();
        const fullCommand = prependWorkspaceCwd(command, workspaceRoot, isPowerShell);
        const execution = integration.executeCommand(fullCommand);
        if (!execution || typeof execution.read !== 'function') return null;

        let stdoutRaw = '';
        let stderrRaw = '';
        let firstChunk = true;
        let interactive = false;
        let hasError = false;
        const maxBytes = 512 * 1024;

        const timeoutPromise = new Promise<'timeout'>((resolve) => {
            setTimeout(() => resolve('timeout'), timeoutMs);
        });

        const readPromise = (async () => {
            for await (const chunk of execution.read()) {
                let text = String(chunk ?? '');
                text = firstChunk ? cleanFirstChunk(text, command) : removeVSCodeSequences(stripAnsi(text));
                firstChunk = false;
                if (!text) continue;
                if (stdoutRaw.length < maxBytes) stdoutRaw += text;
                const lastLines = text.split('\n').slice(-3).join('\n');
                if (INTERACTIVE_PATTERNS.some(p => p.test(lastLines))) interactive = true;
                if (ERROR_PATTERNS.some(p => p.test(text))) hasError = true;
                if (interactive) break;
            }
            return 'done' as const;
        })();

        const winner = await Promise.race([readPromise, timeoutPromise]);
        const lines = buildLines(stdoutRaw, stderrRaw);

        if (winner === 'timeout') {
            return {
                status: 'timeout',
                stdout: truncateOutput(lines.stdout),
                stderr: lines.stderrStr || `Timed out after ${Math.round(timeoutMs / 1000)}s`,
                exitCode: -1,
                signal: 'SIGTERM',
                durationMs: Date.now() - startedAt,
                background: false,
                autoDetected: false,
                truncated: lines.stdout.length > MAX_OUTPUT_LINES,
                timedOut: true,
            };
        }

        if (interactive) {
            return {
                status: 'error',
                stdout: truncateOutput(lines.stdout) + '\n[Process is waiting for user input — ask the user the needed value, then rerun the command.]',
                stderr: lines.stderrStr,
                exitCode: -1,
                signal: null,
                durationMs: Date.now() - startedAt,
                background: false,
                autoDetected: false,
                truncated: lines.stdout.length > MAX_OUTPUT_LINES,
                timedOut: false,
            };
        }

        return {
            status: hasError ? 'error' : 'success',
            stdout: truncateOutput(lines.stdout),
            stderr: lines.stderrStr,
            exitCode: hasError ? 1 : 0,
            signal: null,
            durationMs: Date.now() - startedAt,
            background: false,
            autoDetected: false,
            truncated: lines.stdout.length > MAX_OUTPUT_LINES,
            timedOut: false,
        };
    } catch {
        return null;
    }
}

function prependWorkspaceCwd(command: string, workspaceRoot: string, isPowerShell: boolean): string {
    if (!workspaceRoot) return adaptForShell(command, isPowerShell);
    if (isPowerShell) {
        const escaped = workspaceRoot.replace(/'/g, "''");
        return `Set-Location -LiteralPath '${escaped}'; ${adaptForShell(command, true)}`;
    }
    return `cd /d "${workspaceRoot}" && ${command}`;
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
        const { isPowerShell } = getShellConfig();
        // B05 FIX: Mirror must match what child_process executes.
        // adaptForShell converts && → ; for PowerShell — mirror the same adapted command.
        const mirrored = adaptForShell(command, isPowerShell);
        term.sendText(mirrored, true);
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
