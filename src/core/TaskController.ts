import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { LLMService } from '../services/LLMService';
import { WorkspaceManager } from '../services/WorkspaceManager';
import { PROVIDER_DEFS } from '../services/providers';
import { globalToolRegistry } from '../tools/index';

export class TaskController {
    private _view?: vscode.Webview;
    private llmService: LLMService;
    private workspaceManager: WorkspaceManager;
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

    public async changeProvider(providerId: string, apiKey: string, baseUrl: string, apiKeys?: string[]) {
        const def = PROVIDER_DEFS[providerId as keyof typeof PROVIDER_DEFS];
        const resolvedUrl = baseUrl || (def?.baseUrl ?? 'http://localhost:11434');
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

    public async fetchProviderModels(): Promise<Array<{ id: string; label: string }>> {
        return this.llmService.fetchModels();
    }

    public getLLMKeyCount(): number { return this.llmService.getKeyCount(); }

    public postInitialState() {
        if (!this._view) return;
        // Include tool messages so the frontend can reconstruct tool-call segments on panel reload
        const historyForUi = this.workspaceManager.getConversationHistory().filter(
            (m) => m.role === 'user' || m.role === 'assistant' || (m.role as string) === 'tool'
        );
        const ps = this.workspaceManager.getProviderState();
        this._view.postMessage({
            type: 'initialState',
            history: historyForUi,
            mode: this.workspaceManager.getMode(),
            model: this.workspaceManager.getDefaultModel(),
            // Provider state — frontend settings panelini restore eder
            provider: {
                providerId: ps.providerId,
                apiKey: ps.apiKey ? '***' : '',   // güvenlik: gerçek key gönderme
                hasApiKey: !!ps.apiKey,
                baseUrl: ps.baseUrl,
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

    private parseToolArguments(rawArgs: any): any {
        if (rawArgs === undefined || rawArgs === null) return {};
        if (typeof rawArgs === 'string') {
            try { return JSON.parse(rawArgs); } catch { return { raw: rawArgs }; }
        }
        if (typeof rawArgs === 'object') return rawArgs;
        return { value: rawArgs };
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

    private normalizeToolResult(rawResult: string, toolName: string, summary: string, startedAt: number) {
        const finishedAt = Date.now();
        const base = { toolName, status: 'success' as 'success' | 'error', summary, rawResult, startedAt, finishedAt };
        if (typeof rawResult === 'string' && rawResult.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(rawResult);
                if (parsed && parsed.__tool === 'run_command') {
                    return { ...base, status: parsed.status === 'error' ? 'error' : 'success', summary: parsed.summary || summary, command: parsed.command || '', stdout: parsed.stdout || '', stderr: parsed.stderr || '', exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : -1, durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : (finishedAt - startedAt) };
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

        this.activeAbortController = new AbortController();

        try {
            this.emitTurnEvent(turnRequestId, 'turnStart', { userText: message, startedAt: Date.now() });

            this.workspaceManager.appendToHistory({ role: 'user', content: message });
            await this.workspaceManager.persistState();

            let continueLoop = true;
            // Plan modunda daha uzun iterasyon — her adım için ekstra tur gerekebilir
            const isPlanMode = this.workspaceManager.getMode() === 'plan';
            let maxIterations = isPlanMode ? 40 : 12;
            let iteration = 0;
            let activePhaseId = `pre-${turnRequestId}`;
            let taskNotesCalledThisLoop = false;  // plan devam tracking

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
                    this.emitTurnEvent(turnRequestId, 'turnDone', { finishedAt: Date.now() });
                    this.turnSequenceByRequestId.delete(turnRequestId);
                    return;
                }

                // ── Tool çağrıları ─────────────────────────────────────────────
                const toolCalls = response?.message?.tool_calls ?? response?.tool_calls ?? [];

                if (toolCalls.length > 0) {
                    this.workspaceManager.appendToHistory({
                        role: 'assistant',
                        content: response?.message?.content || '',
                        tool_calls: toolCalls
                    });

                    for (const toolCall of toolCalls) {
                        const rawToolName = toolCall?.function?.name;
                        const toolArgs = this.parseToolArguments(toolCall?.function?.arguments);
                        const toolName = this.normalizeToolName(rawToolName);

                        if (!toolName) continue;

                        const startedAt = Date.now();
                        const summary = this.buildToolSummary(toolName, toolArgs);
                        const toolPhaseId = `tool-${toolCall?.id || `${iteration}-${toolName}-${startedAt}-${Math.random().toString(36).slice(2, 6)}`}`;

                        this.emitTurnEvent(turnRequestId, 'toolActivityStart', {
                            phaseId: toolPhaseId, toolName, args: toolArgs,
                            status: 'running', summary, startedAt, toolCallId: toolCall?.id
                        });

                        const result = await globalToolRegistry.executeTool(toolName, toolArgs);
                        const normalizedResult = this.normalizeToolResult(result, toolName, summary, startedAt);

                        this.workspaceManager.appendToHistory({
                            role: 'tool',
                            content: typeof result === 'string' && result.length > 3000
                                ? `${result.slice(0, 3000)}\n...[truncated]` : result,
                            tool_call_id: toolCall?.id
                        });
                        await this.workspaceManager.persistState();

                        if (normalizedResult.status === 'error') {
                            this.emitTurnEvent(turnRequestId, 'toolActivityError', { phaseId: toolPhaseId, toolCallId: toolCall?.id, ...normalizedResult });
                        } else {
                            this.emitTurnEvent(turnRequestId, 'toolActivityDone', { phaseId: toolPhaseId, toolCallId: toolCall?.id, ...normalizedResult });
                        }

                        activePhaseId = toolPhaseId;

                        if (toolName === 'task_notes' && typeof toolArgs.todos === 'string') {
                            this.workspaceManager.updatePlanState(
                                toolArgs.todos,
                                typeof toolArgs.summary === 'string' ? toolArgs.summary : ''
                            );
                            taskNotesCalledThisLoop = true;
                            // Backend-driven todo update — frontend'e gönder
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

                        const STOP_TOOLS = ['ask_followup_question'];
                        if (STOP_TOOLS.includes(toolName)) {
                            continueLoop = false;
                            break;
                        }
                    }
                } else {
                    // ── Final yanıt ───────────────────────────────────────────
                    const finalContent = response?.message?.content || lastContentSnapshot || '';
                    this.workspaceManager.appendToHistory({ role: 'assistant', content: finalContent });
                    this.emitTurnEvent(turnRequestId, 'finalResponse', { content: finalContent });
                    await this.workspaceManager.persistState();

                    // Plan modunda: eğer todos'da hâlâ tamamlanmamış adım varsa → devam et
                    if (isPlanMode) {
                        const currentTodos = this.workspaceManager.getPlanTodos();
                        const hasUnfinished = currentTodos
                            .split('\n')
                            .some(line => line.trim().startsWith('- [ ]'));

                        if (hasUnfinished && taskNotesCalledThisLoop) {
                            // Tamamlanmamış adım var — modeli devam ettir
                            this.workspaceManager.appendToHistory({
                                role: 'user',
                                content: 'Continue with the next step in the plan.'
                            });
                            taskNotesCalledThisLoop = false;
                            // continueLoop = true kalır, bir sonraki iterasyona geç
                        } else {
                            continueLoop = false;
                        }
                    } else {
                        continueLoop = false;
                    }
                }
            }

            this.emitTurnEvent(turnRequestId, 'turnDone', { finishedAt: Date.now() });
            this.turnSequenceByRequestId.delete(turnRequestId);

        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            this.emitTurnEvent(turnRequestId, 'error', { message: msg });
            this.emitTurnEvent(turnRequestId, 'turnDone', { finishedAt: Date.now() });
            this.turnSequenceByRequestId.delete(turnRequestId);
        } finally {
            this.activeAbortController = undefined;
        }
    }
}
