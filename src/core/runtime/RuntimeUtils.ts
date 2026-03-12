import * as path from 'path';
import type { ToolArtifact, ToolManifest } from '../types';
import type { ToolControlState, ToolFailureClass, ToolResultEnvelope } from '../../services/runtimeTypes';

export function normalizeToolName(toolName: string): string {
    if (!toolName) return '';
    let normalized = toolName.trim().toLowerCase();

    const KNOWN = [
        'read_file', 'write_file', 'list_files', 'list_directory_tree',
        'read_multiple_files', 'write_multiple_files', 'delete_multiple_files',
        'search_files', 'grep_code', 'run_command', 'delete_file', 'rename_file',
        'get_diagnostics', 'web_fetch', 'web_search', 'create_directory', 'get_file_info',
        'find_and_replace', 'append_to_file', 'task_notes', 'ask_followup_question',
        'ask_followup_questions', 'attempt_completion', 'save_plan',
    ];

    for (const known of KNOWN) {
        if (normalized.startsWith(known) && normalized !== known) {
            const rest = normalized.slice(known.length);
            if (rest === '' || rest.startsWith('_') || KNOWN.some((entry) => rest.startsWith(entry))) {
                normalized = known;
                break;
            }
        }
    }

    const aliasMap: Record<string, string> = {
        get_file_text: 'read_file', getfiletext: 'read_file', readfile: 'read_file', getfile: 'read_file',
        view_file: 'read_file', open_file: 'read_file',
        browse: 'list_files', file_view: 'read_file', listdir: 'list_files', list_dir: 'list_files',
        file_tree: 'list_files', ls: 'list_files', dir: 'list_files',
        search: 'search_files', grep: 'grep_code', glob: 'search_files', find: 'search_files',
        create_file: 'write_file', createfile: 'write_file', edit_file: 'write_file',
        editfile: 'write_file', update_file: 'write_file', updatefile: 'write_file',
        overwrite_file: 'write_file', save_file: 'write_file', patch_file: 'write_file',
        bash: 'run_command', shell: 'run_command', sh: 'run_command',
        execute: 'run_command', exec: 'run_command', terminal: 'run_command',
        mkdir: 'create_directory', makedir: 'create_directory',
        rm: 'delete_file', remove_file: 'delete_file', unlink: 'delete_file',
        mv: 'rename_file', move_file: 'rename_file',
        fetch: 'web_fetch', http_get: 'web_fetch', curl: 'web_fetch',
    };

    return aliasMap[normalized] || normalized;
}

export function parseToolArguments(rawArgs: any): any {
    if (rawArgs === undefined || rawArgs === null) return {};
    if (typeof rawArgs === 'string') {
        try {
            return JSON.parse(rawArgs);
        } catch {
            return { raw: rawArgs };
        }
    }
    if (typeof rawArgs === 'object') return rawArgs;
    return { value: rawArgs };
}

export function buildToolSummary(toolName: string, args: any): string {
    const normalizedToolName = normalizeToolName(toolName);
    const pathText = args?.path || args?.oldPath || args?.newPath || args?.file_path || '';
    const pathName = pathText && typeof pathText === 'string' ? (path.basename(pathText) || pathText) : '';
    const cmd = args?.command || args?.cmd || '';
    const baseByTool: Record<string, string> = {
        read_file: pathName ? `Read ${pathName}` : 'Read file',
        write_file: pathName ? `Edit ${pathName}` : 'Edit file',
        list_files: pathName ? `List ${pathName}` : 'List directory',
        list_directory_tree: pathName ? `Tree ${pathName}` : 'List directory tree',
        read_multiple_files: args?.paths ? `Read ${Array.isArray(args.paths) ? args.paths.length : '?'} files` : 'Read multiple files',
        write_multiple_files: args?.files ? `Write ${Array.isArray(args.files) ? args.files.length : '?'} files` : 'Write multiple files',
        delete_multiple_files: args?.paths ? `Delete ${Array.isArray(args.paths) ? args.paths.length : '?'} files` : 'Delete multiple files',
        search_files: args?.pattern ? `Search "${args.pattern}"` : 'Search files',
        grep_code: args?.pattern ? `Grep "${args.pattern}"` : 'Search code',
        run_command: cmd ? `Run: ${String(cmd).slice(0, 40)}` : 'Run command',
        delete_file: pathName ? `Delete ${pathName}` : 'Delete file',
        rename_file: pathName ? `Rename ${pathName}` : 'Rename file',
        get_diagnostics: pathName ? `Diagnose ${pathName}` : 'Diagnose workspace',
        web_fetch: args?.url ? `Fetch ${args.url}` : 'Fetch URL',
        web_search: args?.query ? `Search web: ${String(args.query).slice(0, 40)}` : 'Search web',
        create_directory: pathName ? `Create dir ${pathName}` : 'Create directory',
        get_file_info: pathName ? `Info ${pathName}` : 'File info',
        find_and_replace: pathName ? `Replace in ${pathName}` : 'Find & replace',
        append_to_file: pathName ? `Append to ${pathName}` : 'Append to file',
        task_notes: 'Update task plan',
        ask_followup_question: args?.question ? String(args.question).slice(0, 60) : 'Ask user',
        ask_followup_questions: 'Ask user',
        attempt_completion: 'Task complete',
        save_plan: 'Save plan',
    };
    return baseByTool[normalizedToolName]
        || normalizedToolName.replace(/_/g, ' ').replace(/\b\w/g, (value) => value.toUpperCase());
}

export function normalizeToolCall(toolCall: any, iteration: number, index: number, usedIds?: Set<string>) {
    const rawArgs = toolCall?.function?.arguments;
    const stringArgs = typeof rawArgs === 'string'
        ? rawArgs
        : JSON.stringify(rawArgs ?? {});
    const toolName = normalizeToolName(
        typeof toolCall?.function?.name === 'string' ? toolCall.function.name : ''
    );
    const baseId = typeof toolCall?.id === 'string' && toolCall.id.trim()
        ? toolCall.id
        : `tool_call_${iteration}_${index}_${Date.now()}`;
    let uniqueId = baseId;
    if (usedIds) {
        let collisionIndex = 2;
        while (usedIds.has(uniqueId)) {
            uniqueId = `${baseId}_${collisionIndex++}`;
        }
        usedIds.add(uniqueId);
    }

    return {
        id: uniqueId,
        type: 'function' as const,
        function: {
            name: toolName,
            arguments: stringArgs,
        },
    };
}

export function attachCheckpointsToToolResult(
    rawResult: string,
    checkpoints: Array<{
        id: string;
        timestamp: string;
        filePath: string;
        originalPath: string;
        toolName: string;
    }>
): string {
    if (!checkpoints.length || typeof rawResult !== 'string' || !rawResult.trim().startsWith('{')) {
        return rawResult;
    }

    try {
        const parsed = JSON.parse(rawResult);
        parsed.checkpoints = checkpoints;

        if (parsed.__tool === 'write_file') {
            parsed.checkpointId = checkpoints[0]?.id;
        }

        if (parsed.__tool === 'write_multiple_files' && Array.isArray(parsed.results)) {
            const checkpointByPath = new Map(
                checkpoints.map((checkpoint) => [checkpoint.filePath.replace(/\\/g, '/'), checkpoint.id])
            );
            parsed.results = parsed.results.map((result: any) => {
                const resultPath = typeof result?.path === 'string' ? result.path.replace(/\\/g, '/') : '';
                const checkpointId = checkpointByPath.get(resultPath);
                return checkpointId ? { ...result, checkpointId } : result;
            });
        }

        return JSON.stringify(parsed);
    } catch {
        return rawResult;
    }
}

export function compactToolResult(rawResult: string, toolName: string): string {
    const maxResult = 8000;
    if (!rawResult || typeof rawResult !== 'string') return String(rawResult ?? '');

    if (rawResult.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(rawResult);
            if (parsed.__tool === 'run_command') {
                const stdout = (parsed.stdout || '').trimEnd();
                const stderr = (parsed.stderr || '').trimEnd();
                const combined = [stdout, stderr].filter(Boolean).join('\n');
                const truncated = combined.length > maxResult
                    ? combined.slice(0, maxResult) + `\n...[${combined.length - maxResult} chars truncated]`
                    : combined;
                const statusLabel = parsed.background
                    ? 'started in background (still running)'
                    : parsed.status === 'interrupted' ? 'interrupted by user'
                    : parsed.status === 'timeout' ? 'timed out'
                    : parsed.status;
                return JSON.stringify({
                    __tool: 'run_command',
                    status: parsed.status,
                    statusLabel,
                    command: parsed.command,
                    output: truncated || '(no output)',
                    exitCode: parsed.exitCode,
                    background: parsed.background,
                    timedOut: parsed.timedOut,
                });
            }
            if (parsed.__tool === 'write_file') {
                return JSON.stringify({
                    __tool: 'write_file',
                    status: parsed.status,
                    summary: parsed.summary,
                    path: parsed.path,
                    mode: parsed.mode,
                    addedCount: parsed.addedCount,
                    removedCount: parsed.removedCount,
                    errorMessage: parsed.errorMessage,
                    checkpointId: parsed.checkpointId,
                    checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [],
                });
            }
            if (parsed.__tool === 'write_multiple_files') {
                return JSON.stringify({
                    __tool: 'write_multiple_files',
                    status: parsed.status,
                    summary: parsed.summary,
                    successCount: parsed.successCount,
                    errorCount: parsed.errorCount,
                    results: Array.isArray(parsed.results) ? parsed.results : [],
                    checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [],
                });
            }
            if (parsed.__tool === 'web_fetch') {
                return JSON.stringify({
                    __tool: 'web_fetch',
                    status: parsed.status,
                    summary: parsed.summary,
                    url: parsed.url,
                    finalUrl: parsed.finalUrl,
                    host: parsed.host,
                    statusCode: parsed.statusCode,
                    contentType: parsed.contentType,
                    title: parsed.title,
                    excerpt: parsed.excerpt,
                    links: Array.isArray(parsed.links) ? parsed.links.slice(0, 6) : [],
                    cached: Boolean(parsed.cached),
                    durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
                    errorMessage: parsed.errorMessage,
                });
            }
            if (parsed.__tool === 'web_search') {
                return JSON.stringify({
                    __tool: 'web_search',
                    status: parsed.status,
                    summary: parsed.summary,
                    query: parsed.query,
                    provider: parsed.provider,
                    results: Array.isArray(parsed.results) ? parsed.results.slice(0, 5) : [],
                    durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
                    errorMessage: parsed.errorMessage,
                });
            }
        } catch {
            // fallthrough to generic truncation
        }
    }

    if (rawResult.length > maxResult) {
        return rawResult.slice(0, maxResult) + `\n...[${rawResult.length - maxResult} chars truncated]`;
    }
    return rawResult;
}

export function buildToolArtifacts(toolName: string, rawResult: string): ToolArtifact[] {
    const artifacts: ToolArtifact[] = [];
    if (toolName === 'web_fetch' && typeof rawResult === 'string' && rawResult.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(rawResult);
            if (typeof parsed.finalUrl === 'string' && parsed.finalUrl) {
                artifacts.push({ kind: 'url', label: 'Final URL', value: parsed.finalUrl });
            }
            if (typeof parsed.host === 'string' && parsed.host) {
                artifacts.push({ kind: 'host', label: 'Host', value: parsed.host });
            }
            if (typeof parsed.title === 'string' && parsed.title) {
                artifacts.push({ kind: 'note', label: 'Title', value: parsed.title });
            }
            return artifacts;
        } catch {
            return artifacts;
        }
    }
    if (toolName === 'web_search' && typeof rawResult === 'string' && rawResult.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(rawResult);
            if (typeof parsed.query === 'string' && parsed.query) {
                artifacts.push({ kind: 'note', label: 'Query', value: parsed.query });
            }
            if (Array.isArray(parsed.results) && parsed.results[0]?.url) {
                artifacts.push({ kind: 'url', label: 'Top result', value: parsed.results[0].url });
            }
            return artifacts;
        } catch {
            return artifacts;
        }
    }
    return artifacts;
}

export function normalizeToolResult(
    rawResult: string,
    toolName: string,
    summary: string,
    startedAt: number,
    manifest?: ToolManifest,
): ToolResultEnvelope {
    const finishedAt = Date.now();
    const base = {
        toolName,
        status: 'success' as const,
        summary,
        rawResult,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        manifest,
        artifacts: buildToolArtifacts(toolName, rawResult),
    };

    if (typeof rawResult === 'string' && rawResult.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(rawResult);
            if (parsed && parsed.__tool === 'run_command') {
                const cmdStatus: 'success' | 'error' =
                    parsed.status === 'success' || parsed.status === 'background' ? 'success' : 'error';
                return {
                    ...base,
                    toolCallId: '',
                    historyContent: rawResult,
                    failureClass: parsed.timedOut ? 'timeout' : (cmdStatus === 'error' ? 'execution' : 'none'),
                    status: cmdStatus,
                    summary: parsed.summary || summary,
                    command: parsed.command || '',
                    stdout: parsed.stdout || '',
                    stderr: parsed.stderr || '',
                    exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : null,
                    background: Boolean(parsed.background),
                    bgId: parsed.bgId || undefined,
                    pid: parsed.pid || undefined,
                    autoDetected: Boolean(parsed.autoDetected),
                    timedOut: Boolean(parsed.timedOut),
                    truncated: Boolean(parsed.truncated),
                    durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : (finishedAt - startedAt),
                };
            }
            if (parsed && parsed.__tool === 'write_file') {
                return {
                    ...base,
                    toolCallId: '',
                    historyContent: rawResult,
                    failureClass: parsed.status === 'error' ? 'execution' : 'none',
                    status: parsed.status === 'error' ? 'error' : 'success',
                    summary: parsed.summary || summary,
                    mode: parsed.mode === 'editing' ? 'editing' : 'creating',
                    path: parsed.path || '',
                    fileName: parsed.fileName || '',
                    preview: parsed.preview || '',
                    hunks: Array.isArray(parsed.hunks) ? parsed.hunks : [],
                    addedCount: typeof parsed.addedCount === 'number' ? parsed.addedCount : 0,
                    removedCount: typeof parsed.removedCount === 'number' ? parsed.removedCount : 0,
                    errorMessage: parsed.errorMessage || '',
                    durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : (finishedAt - startedAt),
                    truncated: Boolean(parsed.truncated),
                    checkpointRefs: Array.isArray(parsed.checkpoints) ? parsed.checkpoints.map((checkpoint: any) => checkpoint?.id).filter(Boolean) : undefined,
                };
            }
            if (parsed && parsed.__tool === 'write_multiple_files') {
                return {
                    ...base,
                    toolCallId: '',
                    historyContent: rawResult,
                    failureClass: parsed.status === 'error' ? 'execution' : 'none',
                    status: parsed.status === 'error' ? 'error' : 'success',
                    summary: parsed.summary || summary,
                    successCount: parsed.successCount || 0,
                    errorCount: parsed.errorCount || 0,
                    results: Array.isArray(parsed.results) ? parsed.results : [],
                    checkpointRefs: Array.isArray(parsed.checkpoints) ? parsed.checkpoints.map((checkpoint: any) => checkpoint?.id).filter(Boolean) : undefined,
                };
            }
            if (parsed && parsed.__tool === 'delete_multiple_files') {
                return {
                    ...base,
                    toolCallId: '',
                    historyContent: rawResult,
                    failureClass: parsed.status === 'error' ? 'execution' : 'none',
                    status: parsed.status === 'error' ? 'error' : 'success',
                    summary: parsed.summary || summary,
                    successCount: parsed.successCount || 0,
                    errorCount: parsed.errorCount || 0,
                    results: Array.isArray(parsed.results) ? parsed.results : [],
                };
            }
            if (parsed && parsed.__tool === 'web_fetch') {
                return {
                    ...base,
                    toolCallId: '',
                    historyContent: rawResult,
                    failureClass: parsed.status === 'error' ? 'execution' : 'none',
                    status: parsed.status === 'error' ? 'error' : 'success',
                    summary: parsed.summary || summary,
                    durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : finishedAt - startedAt,
                    errorMessage: parsed.errorMessage || '',
                };
            }
            if (parsed && parsed.__tool === 'web_search') {
                return {
                    ...base,
                    toolCallId: '',
                    historyContent: rawResult,
                    failureClass: parsed.status === 'error' ? 'execution' : 'none',
                    status: parsed.status === 'error' ? 'error' : 'success',
                    summary: parsed.summary || summary,
                    results: Array.isArray(parsed.results) ? parsed.results : [],
                    errorMessage: parsed.errorMessage || '',
                    durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : finishedAt - startedAt,
                };
            }
        } catch {
            // Keep base format for generic string tool outputs.
        }
    }

    if (rawResult.startsWith('Error:') || rawResult.startsWith('Unknown tool:')) {
        return {
            ...base,
            toolCallId: '',
            historyContent: rawResult,
            failureClass: 'execution',
            status: 'error',
            summary: `${summary} failed`,
            errorMessage: rawResult,
        };
    }

    return {
        ...base,
        toolCallId: '',
        historyContent: rawResult,
        failureClass: 'none',
    };
}

export function createFallbackToolManifest(toolName: string): ToolManifest {
    return {
        name: toolName,
        category: 'read',
        riskLevel: 'medium',
        requiresApproval: true,
        supportsAutoApprove: false,
        producesCheckpoint: false,
        idempotent: false,
        sideEffectScope: 'workspace',
    };
}

export function createBlockedToolEnvelope(input: {
    toolCallId: string;
    toolName: string;
    summary: string;
    startedAt: number;
    manifest?: ToolManifest;
    rawResult: string;
    reason: string;
    controlState?: ToolControlState | null;
    stopTurn?: boolean;
}): ToolResultEnvelope {
    const finishedAt = Date.now();
    return {
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        status: 'error',
        summary: `Blocked ${input.toolName}`,
        rawResult: input.rawResult,
        historyContent: input.rawResult,
        startedAt: input.startedAt,
        finishedAt,
        durationMs: finishedAt - input.startedAt,
        manifest: input.manifest,
        artifacts: [],
        errorMessage: input.reason,
        failureClass: 'blocked',
        blocked: true,
        stopTurn: input.stopTurn,
        controlState: input.controlState ?? null,
    };
}

export function createValidationToolEnvelope(input: {
    toolCallId: string;
    toolName: string;
    summary: string;
    startedAt: number;
    manifest?: ToolManifest;
    message: string;
    controlState?: ToolControlState | null;
}): ToolResultEnvelope {
    const finishedAt = Date.now();
    const rawResult = JSON.stringify({
        __tool: 'tool_validation',
        status: 'error',
        summary: `Validation failed for ${input.toolName}`,
        toolName: input.toolName,
        errorMessage: input.message,
    });
    return {
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        status: 'error',
        summary: `Validation failed for ${input.toolName}`,
        rawResult,
        historyContent: rawResult,
        startedAt: input.startedAt,
        finishedAt,
        durationMs: finishedAt - input.startedAt,
        manifest: input.manifest,
        artifacts: [],
        errorMessage: input.message,
        failureClass: 'validation',
        controlState: input.controlState ?? null,
    };
}

export function classifyToolFailure(result: ToolResultEnvelope): ToolFailureClass {
    if (result.failureClass && result.failureClass !== 'none') return result.failureClass;
    if (result.status !== 'error') return 'none';
    const raw = `${result.errorMessage || ''} ${result.rawResult || ''}`.toLowerCase();
    if (raw.includes('abort')) return 'abort';
    if (raw.includes('timeout') || raw.includes('timed out')) return 'timeout';
    if (result.blocked) return 'blocked';
    return 'execution';
}
