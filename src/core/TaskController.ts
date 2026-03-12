import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { LLMService } from '../services/LLMService';
import { WorkspaceManager } from '../services/WorkspaceManager';
import { PROVIDER_DEFS } from '../services/providers';
import { globalToolRegistry } from '../tools/index';
import { buildEnvironmentDetails } from './SystemPrompts';
import { getCodaiTerminal, hasRunningBgProcesses, getRunningBgProcesses, killBackgroundProcess } from '../integrations/terminal/CodaiTerminalManager';
import { CheckpointManager } from '../integrations/checkpoints/CheckpointManager';

export class TaskController {
    private _view?: vscode.Webview;
    private llmService: LLMService;
    private workspaceManager: WorkspaceManager;
    private checkpointManager?: CheckpointManager;
    private turnSequenceByRequestId = new Map<string, number>();
    private pendingWriteProposals = new Map<string, any>();
    private activeAbortController?: AbortController;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        ollamaUrl: string,
        defaultModel: string
    ) {
        this.workspaceManager = new WorkspaceManager(_extensionContext, defaultModel, ollamaUrl);
        this.checkpointManager = new CheckpointManager(_extensionContext);
        const ps = this.workspaceManager.getProviderState();
        this.llmService = new LLMService({
            providerId: ps.providerId,
            baseUrl: ps.baseUrl,
            apiKey: ps.apiKey,
            apiKeys: ps.apiKeys,
            model: defaultModel,
        });
    }

    private rebuildLLMService() {
        const ps = this.workspaceManager.getProviderState();
        this.llmService.updateConfig({
            providerId: ps.providerId,
            baseUrl: ps.baseUrl,
            apiKey: ps.apiKey,
            apiKeys: ps.apiKeys,
            model: this.workspaceManager.getDefaultModel(),
        });
    }

    public setWebview(webview: vscode.Webview) {
        this._view = webview;
        // Expose webview globally so InteractionTools can emit events
        (globalThis as any).__codaiWebview = webview;
    }

    // Expose WorkspaceManager methods for the WebviewMessageHandler
    public getSettings() { return this.workspaceManager.getSettings(); }
    public clearHistory() { this.workspaceManager.clearHistory(); }
    public changeModel(model: string) { this.workspaceManager.changeModel(model); this.rebuildLLMService(); }
    public changeMode(mode: string) { this.workspaceManager.setMode(mode as any); }
    public getMode() { return this.workspaceManager.getMode(); }
    public updateSystemPrompt(prompt: string) { this.workspaceManager.updateSystemPrompt(prompt); }
    public updateSettings(settings: any) { this.workspaceManager.updateSettings(settings); }
    public async ensureProjectIndexed(force = false) { await this.workspaceManager.ensureProjectIndexed(force); }
    public async persistState() { await this.workspaceManager.persistState(); }
    public getProviderState() { return this.workspaceManager.getProviderState(); }
    public getProviderConfig(providerId: string) { return this.workspaceManager.getProviderConfig(providerId as any); }
    public getProviderConfigs() { return this.workspaceManager.getProviderConfigs(); }

    public async changeProvider(providerId: string, apiKey: string, baseUrl: string, apiKeys?: string[]) {
        const def = PROVIDER_DEFS[providerId as keyof typeof PROVIDER_DEFS];
        const resolvedUrl = (baseUrl || (def?.baseUrl ?? 'http://localhost:11434')).replace(/\/+$/, '');
        // apiKeys dizisi varsa kullan; yoksa apiKey'i tek elemanlı dizi yap
        const resolvedKeys = (apiKeys && apiKeys.length > 0)
            ? apiKeys.filter(k => k.trim())
            : (apiKey ? [apiKey] : []);
        await this.workspaceManager.updateProviderState({
            providerId: providerId as any,
            apiKey: resolvedKeys[0] || apiKey,
            apiKeys: resolvedKeys,
            baseUrl: resolvedUrl,
        });
        this.rebuildLLMService();
    }

    public async fetchProviderModels(options?: {
        providerId?: string;
        apiKey?: string;
        apiKeys?: string[];
        baseUrl?: string;
    }): Promise<Array<{ id: string; label: string }>> {
        if (!options?.providerId) {
            return this.llmService.fetchModels();
        }

        const providerId = options.providerId as keyof typeof PROVIDER_DEFS;
        const def = PROVIDER_DEFS[providerId];
        if (!def) {
            throw new Error(`Unknown provider: ${options.providerId}`);
        }

        const current = this.workspaceManager.getProviderState();
        const saved = this.workspaceManager.getProviderConfig(providerId);
        const isCurrentProvider = current.providerId === providerId;
        const sourceConfig = isCurrentProvider
            ? current
            : {
                providerId,
                apiKey: saved.apiKey,
                apiKeys: saved.apiKeys,
                baseUrl: saved.baseUrl,
            };
        const resolvedKeys = Array.isArray(options.apiKeys) && options.apiKeys.length > 0
            ? options.apiKeys.filter(k => typeof k === 'string' && k.trim())
            : (typeof options.apiKey === 'string' && options.apiKey.trim()
                ? [options.apiKey.trim()]
                : sourceConfig.apiKeys.filter(k => k.trim()));
        const resolvedApiKey = resolvedKeys[0]
            || (typeof options.apiKey === 'string' ? options.apiKey.trim() : '')
            || sourceConfig.apiKey;
        const resolvedBaseUrl = (options.baseUrl || sourceConfig.baseUrl || def.baseUrl).replace(/\/+$/, '');

        const previewService = new LLMService({
            providerId,
            baseUrl: resolvedBaseUrl,
            apiKey: resolvedApiKey,
            apiKeys: resolvedKeys,
            model: this.workspaceManager.getDefaultModel(),
        });

        return previewService.fetchModels();
    }

    public getLLMKeyCount(): number { return this.llmService.getKeyCount(); }

    // ── Auto-approve config ───────────────────────────────────────────────────
    private autoApproveConfig: {
        read_file: boolean;
        write_file: boolean;
        run_command: boolean;
        web_fetch: boolean;
        all: boolean;
    } = { read_file: true, write_file: false, run_command: false, web_fetch: false, all: false };

    public setAutoApproveConfig(cfg: typeof this.autoApproveConfig): void {
        this.autoApproveConfig = { ...this.autoApproveConfig, ...cfg };
    }

    public isAutoApproved(toolName: string): boolean {
        const c = this.autoApproveConfig;
        if (c.all) return true;
        const readTools  = ['read_file', 'read_multiple_files', 'list_directory', 'list_directory_tree', 'search_in_files', 'get_file_info'];
        const writeTools = ['write_file', 'delete_file', 'create_directory', 'move_file', 'write_multiple_files', 'delete_multiple_files'];
        const cmdTools   = ['run_command', 'kill_bg_process'];
        const webTools   = ['web_search', 'web_fetch'];
        if (c.read_file  && readTools.includes(toolName))  return true;
        if (c.write_file && writeTools.includes(toolName)) return true;
        if (c.run_command && cmdTools.includes(toolName))  return true;
        if (c.web_fetch  && webTools.includes(toolName))   return true;
        return false;
    }

    // ── Session / History management ─────────────────────────────────────────
    private readonly SESSION_STATE_KEY = 'codai_sessions_v1';

    public async getSessions(): Promise<any[]> {
        return this._extensionContext.globalState.get<any[]>(this.SESSION_STATE_KEY) ?? [];
    }

    public async upsertSessionMeta(session: any): Promise<void> {
        const sessions = await this.getSessions();
        const idx = sessions.findIndex(s => s.id === session.id);
        if (idx >= 0) sessions[idx] = session;
        else sessions.unshift(session);
        // Keep max 100
        await this._extensionContext.globalState.update(this.SESSION_STATE_KEY, sessions.slice(0, 100));
    }

    public async updateSessionMeta(sessionId: string, updates: any): Promise<void> {
        const sessions = await this.getSessions();
        const idx = sessions.findIndex(s => s.id === sessionId);
        if (idx >= 0) {
            sessions[idx] = { ...sessions[idx], ...updates, updatedAt: new Date().toISOString() };
            await this._extensionContext.globalState.update(this.SESSION_STATE_KEY, sessions);
        }
    }

    public async renameSession(sessionId: string, title: string): Promise<void> {
        await this.updateSessionMeta(sessionId, { title });
    }

    public async saveSessionHistory(sessionId: string, messages: any[]): Promise<void> {
        const key = `codai_session_history_${sessionId}`;
        await this._extensionContext.globalState.update(key, messages);
    }

    public async loadSession(sessionId: string): Promise<void> {
        if (!this._view) return;
        const key = `codai_session_history_${sessionId}`;
        const messages = this._extensionContext.globalState.get<any[]>(key) ?? [];
        const sessions = await this.getSessions();
        const meta = sessions.find(s => s.id === sessionId);
        this._view.postMessage({
            type: 'sessionLoaded',
            sessionId,
            messages,
            mode: meta?.mode ?? 'code',
            title: meta?.title ?? 'Chat',
        });
    }

    // ── Checkpoint public methods ─────────────────────────────────────────────
    public async revertCheckpoint(checkpointId: string): Promise<{ success: boolean; message: string }> {
        if (!this.checkpointManager) return { success: false, message: 'CheckpointManager not initialized' };
        return this.checkpointManager.revertToCheckpoint(checkpointId);
    }

    public getCheckpoints(): any[] {
        return this.checkpointManager?.getCheckpoints() ?? [];
    }

    public async getSlashCommands(): Promise<Array<{
        name: string;
        description: string;
        prompt: string;
        sourcePath: string;
    }>> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return [];

        const commandsRoot = path.join(workspaceRoot, '.codai', 'commands');
        try {
            const stat = await fs.stat(commandsRoot);
            if (!stat.isDirectory()) return [];
        } catch {
            return [];
        }

        const files = await this.collectSlashCommandFiles(commandsRoot);
        const commands = await Promise.all(files.map((filePath) => this.readSlashCommandFile(commandsRoot, workspaceRoot, filePath)));
        return commands
            .filter((cmd): cmd is {
                name: string;
                description: string;
                prompt: string;
                sourcePath: string;
            } => Boolean(cmd))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    public async deleteSession(sessionId: string): Promise<void> {
        const sessions = await this.getSessions();
        const filtered = sessions.filter((s: any) => s.id !== sessionId);
        await this._extensionContext.globalState.update(this.SESSION_STATE_KEY, filtered);
        // Also delete the history
        const histKey = `codai_session_history_${sessionId}`;
        await this._extensionContext.globalState.update(histKey, undefined);
    }

    public postInitialState() {
        if (!this._view) return;
        // Include tool messages so the frontend can reconstruct tool-call segments on panel reload
        const historyForUi = this.workspaceManager.getTranscriptHistory().filter(
            (m) => m.role === 'user' || m.role === 'assistant' || (m.role as string) === 'tool'
        );
        const ps = this.workspaceManager.getProviderState();
        const providerConfigs = this.workspaceManager.getProviderConfigs();
        const tokenInfo = this.workspaceManager.estimateTokenCount();
        this._view.postMessage({
            type: 'initialState',
            history: historyForUi,
            mode: this.workspaceManager.getMode(),
            model: this.workspaceManager.getDefaultModel(),
            tokenCount: tokenInfo,
            // Provider state — frontend settings panelini restore eder
            provider: {
                providerId: ps.providerId,
                hasApiKey: !!ps.apiKey,
                baseUrl: ps.baseUrl,
                configs: Object.fromEntries(
                    Object.entries(providerConfigs).map(([providerId, config]) => [
                        providerId,
                        {
                            ...config,
                            hasApiKey: !!config.apiKey || config.apiKeys.some((key) => key.trim().length > 0),
                        },
                    ])
                ),
            },
            settings: {
                ...this.workspaceManager.getSettings(),
                systemPrompt: this.workspaceManager.getSystemPrompt()
            },
            planTodos: this.workspaceManager.getPlanTodos(),
            planSummary: this.workspaceManager.getPlanSummary(),
        });
    }

    private nextTurnSeq(requestId: string): number {
        const next = (this.turnSequenceByRequestId.get(requestId) || 0) + 1;
        this.turnSequenceByRequestId.set(requestId, next);
        return next;
    }

    private emitTurnEvent(requestId: string, type: string, payload: any = {}) {
        if (!this._view) return;
        const safePayload = payload && typeof payload === 'object' ? { ...payload } : {};
        delete (safePayload as any).type;
        delete (safePayload as any).requestId;
        delete (safePayload as any).seq;
        delete (safePayload as any).ts;
        delete (safePayload as any).payload;
        this._view.postMessage({
            type,
            requestId,
            seq: this.nextTurnSeq(requestId),
            ts: Date.now(),
            payload: safePayload,
            ...safePayload
        });
    }

    // Utility methods for tool processing
    private normalizeToolName(toolName: string): string {
        if (!toolName) return '';
        let normalized = toolName.trim().toLowerCase();

        // Modelin duplicate tool adı göndermesini düzelt:
        // "list_fileslist_files" → "list_files"
        // "read_fileread_file"   → "read_file"
        const KNOWN = [
            'read_file','write_file','list_files','list_directory_tree',
            'read_multiple_files','write_multiple_files','delete_multiple_files',
            'search_files','grep_code','run_command','delete_file','rename_file',
            'get_diagnostics','web_fetch','create_directory','get_file_info',
            'find_and_replace','append_to_file','task_notes','ask_followup_question','attempt_completion'
        ];
        for (const known of KNOWN) {
            // "list_fileslist_files", "list_fileslist_files_extra" gibi pattern'ları yakala
            if (normalized.startsWith(known) && normalized !== known) {
                const rest = normalized.slice(known.length);
                // Sadece başka bir tool adı eklenmişse ya da karakter kalmışsa → kırp
                if (rest === '' || rest.startsWith('_') || KNOWN.some(k => rest.startsWith(k))) {
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

    private async collectSlashCommandFiles(dirPath: string): Promise<string[]> {
        const found: string[] = [];
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                found.push(...await this.collectSlashCommandFiles(fullPath));
                continue;
            }

            const ext = path.extname(entry.name).toLowerCase();
            if (['.md', '.txt', '.prompt', '.json'].includes(ext)) {
                found.push(fullPath);
            }
        }

        return found;
    }

    private async readSlashCommandFile(
        commandsRoot: string,
        workspaceRoot: string,
        filePath: string
    ): Promise<{
        name: string;
        description: string;
        prompt: string;
        sourcePath: string;
    } | null> {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            const ext = path.extname(filePath).toLowerCase();
            const relToCommands = path.relative(commandsRoot, filePath).replace(/\\/g, '/');
            const relToWorkspace = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');

            let name = relToCommands.replace(/\.[^.]+$/, '');
            let prompt = raw.trim();
            let description = '';

            if (ext === '.json') {
                const parsed = JSON.parse(raw);
                name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : name;
                prompt = typeof parsed.prompt === 'string'
                    ? parsed.prompt.trim()
                    : typeof parsed.content === 'string'
                        ? parsed.content.trim()
                        : '';
                description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
            }

            name = name
                .replace(/[\\/]+/g, '-')
                .replace(/\s+/g, '-')
                .replace(/[^a-zA-Z0-9:_-]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '')
                .toLowerCase();

            if (!name || !prompt) return null;

            if (!description) {
                const firstLine = prompt
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .find(Boolean) || '';
                description = firstLine
                    .replace(/^#+\s*/, '')
                    .replace(/^[-*]\s*/, '')
                    .slice(0, 90);
            }

            return {
                name,
                description: description || `Custom prompt from ${relToWorkspace}`,
                prompt,
                sourcePath: relToWorkspace,
            };
        } catch {
            return null;
        }
    }

    private parseToolArguments(rawArgs: any): any {
        if (rawArgs === undefined || rawArgs === null) return {};
        if (typeof rawArgs === 'string') {
            try { return JSON.parse(rawArgs); } catch { return { raw: rawArgs }; }
        }
        if (typeof rawArgs === 'object') return rawArgs;
        return { value: rawArgs };
    }

    private async createCheckpointsForTool(toolName: string, args: any): Promise<Array<{
        id: string;
        timestamp: string;
        filePath: string;
        originalPath: string;
        toolName: string;
    }>> {
        if (!this.checkpointManager) return [];
        if (!['write_file', 'write_multiple_files'].includes(toolName)) return [];

        const candidatePaths: string[] =
            toolName === 'write_multiple_files'
                ? (Array.isArray(args?.files)
                    ? args.files
                        .map((file: any) => typeof file?.path === 'string' ? file.path : '')
                        .filter(Boolean)
                    : [])
                : [args?.path || args?.file_path || ''].filter(Boolean);

        const savedIds: string[] = [];
        for (const candidatePath of candidatePaths) {
            const checkpointId = await this.checkpointManager.saveCheckpoint(candidatePath, toolName);
            if (checkpointId) {
                savedIds.push(checkpointId);
            }
        }

        if (savedIds.length === 0) return [];

        const checkpointMap = new Map(
            this.checkpointManager.getCheckpoints().map((entry) => [entry.id, entry])
        );

        return savedIds
            .map((checkpointId) => checkpointMap.get(checkpointId))
            .filter((entry): entry is {
                id: string;
                timestamp: string;
                filePath: string;
                originalPath: string;
                toolName: string;
            } => Boolean(entry));
    }

    private attachCheckpointsToToolResult(rawResult: string, checkpoints: Array<{
        id: string;
        timestamp: string;
        filePath: string;
        originalPath: string;
        toolName: string;
    }>): string {
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

    private buildToolSummary(toolName: string, args: any): string {
        const normalizedToolName = this.normalizeToolName(toolName);
        const pathText = args?.path || args?.oldPath || args?.newPath || args?.file_path || '';
        const pathName = pathText && typeof pathText === 'string' ? (path.basename(pathText) || pathText) : '';
        const cmd = args?.command || args?.cmd || '';
        const baseByTool: Record<string, string> = {
            read_file:            pathName ? `Read ${pathName}` : 'Read file',
            write_file:           pathName ? `Edit ${pathName}` : 'Edit file',
            list_files:           pathName ? `List ${pathName}` : 'List directory',
            list_directory_tree:  pathName ? `Tree ${pathName}` : 'List directory tree',
            read_multiple_files:  args?.paths ? `Read ${Array.isArray(args.paths) ? args.paths.length : '?'} files` : 'Read multiple files',
            write_multiple_files: args?.files ? `Write ${Array.isArray(args.files) ? args.files.length : '?'} files` : 'Write multiple files',
            delete_multiple_files: args?.paths ? `Delete ${Array.isArray(args.paths) ? args.paths.length : '?'} files` : 'Delete multiple files',
            search_files:         args?.pattern ? `Search "${args.pattern}"` : 'Search files',
            grep_code:            args?.pattern ? `Grep "${args.pattern}"` : 'Search code',
            run_command:          cmd ? `Run: ${String(cmd).slice(0, 40)}` : 'Run command',
            delete_file:          pathName ? `Delete ${pathName}` : 'Delete file',
            rename_file:          pathName ? `Rename ${pathName}` : 'Rename file',
            get_diagnostics:      pathName ? `Diagnose ${pathName}` : 'Diagnose workspace',
            web_fetch:            args?.url ? `Fetch ${args.url}` : 'Fetch URL',
            create_directory:     pathName ? `Create dir ${pathName}` : 'Create directory',
            get_file_info:        pathName ? `Info ${pathName}` : 'File info',
            find_and_replace:     pathName ? `Replace in ${pathName}` : 'Find & replace',
            append_to_file:       pathName ? `Append to ${pathName}` : 'Append to file',
            task_notes:           'Update task plan',
            ask_followup_question: args?.question ? String(args.question).slice(0, 60) : 'Ask user',
            attempt_completion:   'Task complete',
        };
        // Bilinen bir tool ise döndür, yoksa tool adını güzel formatla
        return baseByTool[normalizedToolName]
            || normalizedToolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    /**
     * Compact tool result for history — prevents context window overflow.
     * run_command: stdout+stderr truncated to 8000 chars total
     * write_file / large results: strip binary/preview data before storing
     */
    private normalizeToolCall(toolCall: any, iteration: number, index: number) {
        const rawArgs = toolCall?.function?.arguments;
        const stringArgs = typeof rawArgs === 'string'
            ? rawArgs
            : JSON.stringify(rawArgs ?? {});
        const toolName = this.normalizeToolName(
            typeof toolCall?.function?.name === 'string' ? toolCall.function.name : ''
        );

        return {
            id: typeof toolCall?.id === 'string' && toolCall.id.trim()
                ? toolCall.id
                : `tool_call_${iteration}_${index}_${Date.now()}`,
            type: 'function' as const,
            function: {
                name: toolName,
                arguments: stringArgs,
            },
        };
    }

    private compactToolResult(rawResult: string, toolName: string): string {
        const MAX_RESULT = 8000;
        if (!rawResult || typeof rawResult !== 'string') return String(rawResult ?? '');

        // run_command: strip large stdout from history, keep summary + exit code
        if (rawResult.trim().startsWith('{')) {
            try {
                const p = JSON.parse(rawResult);
                if (p.__tool === 'run_command') {
                    // B09 FIX: trim stderr before combining, cap each independently
                    const stdout = (p.stdout || '').trimEnd();
                    const stderr = (p.stderr || '').trimEnd();
                    const combined = [stdout, stderr].filter(Boolean).join('\n');
                    const truncated = combined.length > MAX_RESULT
                        ? combined.slice(0, MAX_RESULT) + `\n...[${combined.length - MAX_RESULT} chars truncated]`
                        : combined;
                    // background: give AI clear signal about process status
                    const statusLabel = p.background
                        ? `started in background (still running)`
                        : p.status === 'interrupted' ? 'interrupted by user'
                        : p.status === 'timeout' ? `timed out`
                        : p.status;
                    return JSON.stringify({
                        __tool: 'run_command',
                        status: p.status,
                        statusLabel,
                        command: p.command,
                        output: truncated || '(no output)',
                        exitCode: p.exitCode,
                        background: p.background,
                        timedOut: p.timedOut,
                    });
                }
                // write_file: strip hunks/preview from history (they're shown in UI)
                if (p.__tool === 'write_file') {
                    return JSON.stringify({
                        __tool: 'write_file',
                        status: p.status,
                        summary: p.summary,
                        path: p.path,
                        mode: p.mode,
                        addedCount: p.addedCount,
                        removedCount: p.removedCount,
                        errorMessage: p.errorMessage,
                        checkpointId: p.checkpointId,
                        checkpoints: Array.isArray(p.checkpoints) ? p.checkpoints : [],
                    });
                }
                if (p.__tool === 'write_multiple_files') {
                    return JSON.stringify({
                        __tool: 'write_multiple_files',
                        status: p.status,
                        summary: p.summary,
                        successCount: p.successCount,
                        errorCount: p.errorCount,
                        results: Array.isArray(p.results) ? p.results : [],
                        checkpoints: Array.isArray(p.checkpoints) ? p.checkpoints : [],
                    });
                }
            } catch { /* fallthrough */ }
        }

        // Generic: hard cap
        if (rawResult.length > MAX_RESULT) {
            return rawResult.slice(0, MAX_RESULT) + `\n...[${rawResult.length - MAX_RESULT} chars truncated]`;
        }
        return rawResult;
    }

    private normalizeToolResult(rawResult: string, toolName: string, summary: string, startedAt: number) {
        const finishedAt = Date.now();
        const base = { toolName, status: 'success' as 'success' | 'error', summary, rawResult, startedAt, finishedAt };
        if (typeof rawResult === 'string' && rawResult.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(rawResult);
                if (parsed && parsed.__tool === 'run_command') {
                    // B03 FIX: background/interrupted/timeout statuses map correctly
                    const cmdStatus: 'success' | 'error' =
                        parsed.status === 'success' || parsed.status === 'background' ? 'success' : 'error';
                    return {
                        ...base,
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
                        rawResult,
                    };
                }
                if (parsed && parsed.__tool === 'write_file') {
                    return { ...base, status: parsed.status === 'error' ? 'error' : 'success', summary: parsed.summary || summary, mode: parsed.mode === 'editing' ? 'editing' : 'creating', path: parsed.path || '', fileName: parsed.fileName || '', preview: parsed.preview || '', hunks: Array.isArray(parsed.hunks) ? parsed.hunks : [], addedCount: typeof parsed.addedCount === 'number' ? parsed.addedCount : 0, removedCount: typeof parsed.removedCount === 'number' ? parsed.removedCount : 0, errorMessage: parsed.errorMessage || '', durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : (finishedAt - startedAt), truncated: Boolean(parsed.truncated) };
                }
                if (parsed && parsed.__tool === 'write_multiple_files') {
                    return { ...base, status: parsed.status === 'error' ? 'error' : 'success', summary: parsed.summary || summary, successCount: parsed.successCount || 0, errorCount: parsed.errorCount || 0, results: Array.isArray(parsed.results) ? parsed.results : [], durationMs: finishedAt - startedAt };
                }
                if (parsed && parsed.__tool === 'delete_multiple_files') {
                    return { ...base, status: parsed.status === 'error' ? 'error' : 'success', summary: parsed.summary || summary, successCount: parsed.successCount || 0, errorCount: parsed.errorCount || 0, results: Array.isArray(parsed.results) ? parsed.results : [], durationMs: finishedAt - startedAt };
                }
            } catch { /* keep base format */ }
        }
        if (rawResult.startsWith('Error:') || rawResult.startsWith('Unknown tool:')) {
            return { ...base, status: 'error' as const, summary: `${summary} failed` };
        }
        return base;
    }

    public resolvePendingWriteProposal(proposalId: string, decision: 'approved' | 'rejected') {
        const pending = this.pendingWriteProposals.get(proposalId);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingWriteProposals.delete(proposalId);
        this.emitTurnEvent(pending.requestId, 'fileWriteProposalResolved', {
            proposalId, decision, message: decision === 'approved' ? 'Write approved.' : 'Write rejected.'
        });
        pending.resolve?.({ decision, candidate: pending.candidate });
    }

    /**
     * Build environment_details block for injection into each user message.
     * Cline injects this at the end of every user message so the AI always
     * has fresh context about running terminals and background processes.
     */
    private buildEnvDetails(): string {
        try {
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            // Collect active VSCode terminals
            const activeTerminals = vscode.window.terminals
                .filter(t => t.exitStatus === undefined)
                .map(t => ({ name: t.name }));

            return buildEnvironmentDetails({ cwd, activeTerminals });
        } catch {
            return '';
        }
    }

    public abortCurrentTask() {
        if (this.activeAbortController) {
            this.activeAbortController.abort();
            this.activeAbortController = undefined;
        }
    }

    public async _handleMessage(message: string, requestId?: string) {
        if (!this._view) return;
        const turnRequestId = requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.turnSequenceByRequestId.set(turnRequestId, 0);

        // T12 FIX: Her yeni görevden önce önceki abort controller'ı temizle
        // Önceki task abort edilmişse yeni AbortController fresh olmalı
        if (this.activeAbortController) {
            this.activeAbortController.abort();
            this.activeAbortController = undefined;
        }
        this.activeAbortController = new AbortController();

        try {
            this.emitTurnEvent(turnRequestId, 'turnStart', { userText: message, startedAt: Date.now() });

            // Build environment_details — Cline injects this at end of every user message
            const envDetails = this.buildEnvDetails();
            const messageWithEnv = envDetails
                ? `${message}\n\n${envDetails}`
                : message;

            this.workspaceManager.appendToHistory({ role: 'user', content: messageWithEnv });
            await this.workspaceManager.persistState();

            let continueLoop = true;
            const isPlanMode = this.workspaceManager.getMode() === 'plan';
            // Plan mode: max 6 iterations (explore + ask + write plan = done)
            // Code mode: 12 iterations
            let maxIterations = isPlanMode ? 6 : 12;
            let iteration = 0;
            let activePhaseId = `pre-${turnRequestId}`;
            let taskNotesCalledThisLoop = false;
            // P2 FIX: Detect duplicate task_notes — stop looping if same plan repeated
            let lastTaskNotesContent = '';

                    const MAX_RATE_LIMIT_RETRIES = 4;

            let rateLimitRetries = 0;

            while (continueLoop && iteration < maxIterations) {
                iteration++;
                let lastThinkingSnapshot = '';
                let lastContentSnapshot = '';

                // ── LLM isteği — rate limit retry ile ────────────────────────
                let response: any;
                try {
                    response = await this.llmService.chatWithTools(
                        this.workspaceManager.getDefaultModel(),
                        this.workspaceManager.getConversationHistory(),
                        globalToolRegistry.getAllToolDefinitions().filter(t => {
                            const allowed = this.workspaceManager.getAllowedToolNames();
                            if (allowed === null) return true;
                            return allowed.includes(t.name);
                        }),
                        (thinking) => {
                            const nextThinking = typeof thinking === 'string' ? thinking : '';
                            const delta = nextThinking.startsWith(lastThinkingSnapshot)
                                ? nextThinking.slice(lastThinkingSnapshot.length) : nextThinking;
                            lastThinkingSnapshot = nextThinking;
                            if (!delta) return;
                            this.emitTurnEvent(turnRequestId, 'thinking', { phaseId: activePhaseId, content: nextThinking });
                        },
                        (content) => {
                            const nextContent = typeof content === 'string' ? content : '';
                            lastContentSnapshot = nextContent;
                            this.emitTurnEvent(turnRequestId, 'contentChunk', { content: nextContent });
                        },
                        this.activeAbortController.signal
                    );
                    rateLimitRetries = 0; // başarılı istek → sıfırla
                } catch (llmError: any) {
                    const msg: string = llmError?.message || '';
                    const isAbort = llmError?.name === 'AbortError' || msg.includes('aborted');
                    const isRateLimit =
                        msg.includes('Rate limit') ||
                        msg.includes('rate limit') ||
                        msg.includes('429') ||
                        msg.includes('RESOURCE_EXHAUSTED') ||
                        msg.includes('quota') ||
                        msg.includes('too many requests') ||
                        msg.includes('Too Many Requests');

                    if (isAbort) {
                        continueLoop = false;
                        break;
                    }

                    if (isRateLimit && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
                        rateLimitRetries++;
                        // Exponential backoff: 15s, 30s, 60s, 120s
                        const waitMs = Math.min(15000 * Math.pow(2, rateLimitRetries - 1), 120000);

                        // Birden fazla key varsa → rotation dene (bekleme yok!)
                        const rotation = this.llmService.markActiveKeyRateLimited(waitMs);
                        if (rotation.rotated) {
                            const keyCount = this.llmService.getKeyCount();
                            const keyIdx = this.llmService.getActiveKeyIndex() + 1;
                            this.emitTurnEvent(turnRequestId, 'contentChunk', {
                                content: `\n\n🔄 Rate limit — key ${keyIdx}/${keyCount} deneniyor…`
                            });
                            iteration--; // sayma
                            continue;
                        }

                        // Tek key veya hepsi exhausted → bekle
                        const waitSec = Math.round(waitMs / 1000);
                        this.emitTurnEvent(turnRequestId, 'rateLimit', {
                            waitMs, waitSec, attempt: rateLimitRetries, maxAttempts: MAX_RATE_LIMIT_RETRIES
                        });
                        this.emitTurnEvent(turnRequestId, 'contentChunk', {
                            content: `\n\n⏳ Rate limit — ${waitSec}s bekleniyor… (${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`
                        });
                        await new Promise(res => setTimeout(res, waitMs));
                        iteration--; // bu iterasyonu sayma
                        continue;
                    }

                    // Kurtarılamaz hata
                    continueLoop = false;
                    this.emitTurnEvent(turnRequestId, 'error', { message: msg || 'LLM request failed' });
                    this.emitTurnEvent(turnRequestId, 'tokenCount', this.workspaceManager.estimateTokenCount());
                    this.emitTurnEvent(turnRequestId, 'turnDone', { finishedAt: Date.now() });
                    this.turnSequenceByRequestId.delete(turnRequestId);
                    return;
                }

                // ── Tool çağrıları ─────────────────────────────────────────────
                const rawToolCalls = response?.message?.tool_calls ?? response?.tool_calls ?? [];
                const toolCalls = Array.isArray(rawToolCalls)
                    ? rawToolCalls
                        .map((toolCall, index) => this.normalizeToolCall(toolCall, iteration, index))
                        .filter((toolCall) => toolCall.function.name)
                    : [];

                if (toolCalls.length > 0) {
                    this.workspaceManager.appendToHistory({
                        role: 'assistant',
                        content: response?.message?.content ?? null,
                        tool_calls: toolCalls
                    });

                    for (const toolCall of toolCalls) {
                        const toolArgs = this.parseToolArguments(toolCall.function.arguments);
                        const toolName = toolCall.function.name;

                        const startedAt = Date.now();
                        const summary = this.buildToolSummary(toolName, toolArgs);
                        const toolPhaseId = `tool-${toolCall.id || `${iteration}-${toolName}-${startedAt}-${Math.random().toString(36).slice(2, 6)}`}`;

                        const autoApproved = this.isAutoApproved(toolName);
                        this.emitTurnEvent(turnRequestId, 'toolActivityStart', {
                            phaseId: toolPhaseId, toolName, args: toolArgs,
                            status: 'running', summary, startedAt, toolCallId: toolCall.id,
                            autoApproved,
                        });

                        // ── Checkpoint before file writes ────────────────────
                        const checkpoints = await this.createCheckpointsForTool(toolName, toolArgs);
                        if (checkpoints.length > 0) {
                            this.emitTurnEvent(turnRequestId, 'checkpointSaved', {
                                phaseId: toolPhaseId,
                                checkpoints,
                                toolName
                            });
                        }

                        // P1 FIX: Warn AI if a bg process is already running before starting another
                        if (toolName === 'run_command' && hasRunningBgProcesses()) {
                            const running = getRunningBgProcesses();
                            const names = running.map(p => p.command || p.bgId).join(', ');
                            // Inject warning into history so AI sees it
                            this.workspaceManager.appendToHistory({
                                role: 'tool',
                                content: `WARNING: There is already a background process running (${names}). Stop it first with killBgProcess before starting a new long-running process. If this is a short command (npm install, tsc, etc.) it is safe to proceed.`,
                                tool_call_id: toolCall.id,
                            });
                        }

                        const result = await globalToolRegistry.executeTool(toolName, toolArgs);
                        const resultWithCheckpoints = this.attachCheckpointsToToolResult(result, checkpoints);
                        const normalizedResult = this.normalizeToolResult(resultWithCheckpoints, toolName, summary, startedAt);

                        // Tool result history'e compact olarak gönder
                        // run_command için stdout/stderr'i truncate et — context window'u korur
                        const historyContent = this.compactToolResult(resultWithCheckpoints, toolName);
                        this.workspaceManager.appendToHistory({
                            role: 'tool',
                            content: historyContent,
                            tool_call_id: toolCall.id
                        });
                        await this.workspaceManager.persistState();

                        if (normalizedResult.status === 'error') {
                            this.emitTurnEvent(turnRequestId, 'toolActivityError', { phaseId: toolPhaseId, toolCallId: toolCall.id, ...normalizedResult });
                        } else {
                            this.emitTurnEvent(turnRequestId, 'toolActivityDone', { phaseId: toolPhaseId, toolCallId: toolCall.id, ...normalizedResult });
                        }

                        activePhaseId = toolPhaseId;

                        if (toolName === 'task_notes' && typeof toolArgs.todos === 'string') {
                            // P2 FIX: Duplicate detection — same content = stop loop
                            const todosContent = toolArgs.todos.trim();
                            if (todosContent === lastTaskNotesContent) {
                                // AI is repeating same plan — force stop
                                continueLoop = false;
                                this.workspaceManager.appendToHistory({
                                    role: 'tool',
                                    content: 'task_notes: Duplicate plan detected. Use attempt_completion to finish.',
                                    tool_call_id: toolCall.id,
                                });
                                break;
                            }
                            lastTaskNotesContent = todosContent;

                            this.workspaceManager.updatePlanState(
                                toolArgs.todos,
                                typeof toolArgs.summary === 'string' ? toolArgs.summary : ''
                            );
                            taskNotesCalledThisLoop = true;
                            this.emitTurnEvent(turnRequestId, 'todoUpdate', {
                                todos: toolArgs.todos,
                                summary: toolArgs.summary || ''
                            });
                        }

                        if (toolName === 'attempt_completion') {
                            // Görev tamamlandı — frontend'e bildir
                            this.emitTurnEvent(turnRequestId, 'taskComplete', {
                                result: toolArgs.result || toolArgs.summary || 'Task complete.'
                            });
                            continueLoop = false;
                            break;
                        }

                        const STOP_TOOLS = ['ask_followup_question', 'ask_followup_questions'];
                        if (STOP_TOOLS.includes(toolName)) {
                            continueLoop = false;
                            break;
                        }
                    }
                } else {
                    // ── Final yanıt ───────────────────────────────────────────
                    const rawFinalContent = response?.message?.content;
                    const finalContent = typeof rawFinalContent === 'string'
                        ? rawFinalContent
                        : rawFinalContent == null
                            ? (lastContentSnapshot || '')
                            : JSON.stringify(rawFinalContent);
                    this.workspaceManager.appendToHistory({ role: 'assistant', content: finalContent });
                    this.emitTurnEvent(turnRequestId, 'finalResponse', { content: finalContent });
                    await this.workspaceManager.persistState();

                    // P2 FIX: Plan mode no longer auto-injects "Continue" messages.
                    // AI must use attempt_completion to signal plan is done.
                    // Both plan and code mode: finalResponse = stop.
                    continueLoop = false;
                }
            }

            this.emitTurnEvent(turnRequestId, 'tokenCount', this.workspaceManager.estimateTokenCount());
            this.emitTurnEvent(turnRequestId, 'turnDone', { finishedAt: Date.now() });
            this.turnSequenceByRequestId.delete(turnRequestId);

        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            this.emitTurnEvent(turnRequestId, 'error', { message: msg });
            this.emitTurnEvent(turnRequestId, 'tokenCount', this.workspaceManager.estimateTokenCount());
            this.emitTurnEvent(turnRequestId, 'turnDone', { finishedAt: Date.now() });
            this.turnSequenceByRequestId.delete(turnRequestId);
        } finally {
            this.activeAbortController = undefined;
        }
    }
}
