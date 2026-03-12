import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Message, AgentMode } from '../core/types';
import { getModeSystemPrompt } from '../core/SystemPrompts';
import { ProviderId, DEFAULT_PROVIDER, PROVIDER_DEFS } from './providers';

export interface ProviderState {
    providerId: ProviderId;
    apiKey: string;
    apiKeys: string[];  // multi-key rotation için
    baseUrl: string;    // override (custom provider veya farklı ollama url)
}

export interface ProviderConfig {
    apiKey: string;
    apiKeys: string[];
    baseUrl: string;
}

interface ContextWindowStats {
    contextTokens: number;
    contextChars: number;
    maxContextTokens: number;
    tokensLeft: number;
    percentUsed: number;
    autoCompactEnabled: boolean;
    lastCompactionAt: number | null;
    compactedMessageCount: number;
}

export class WorkspaceManager {
    private conversationHistory: Message[] = [];
    private transcriptHistory: Message[] = [];
    private defaultModel: string;
    private indexedProjectContext = '';
    private isIndexing = false;
    private agentMode: AgentMode = 'code';
    private settings = { autoIndexOnOpen: true };
    private compactedContextSummary = '';
    private lastCompactionAt: number | null = null;
    private compactedMessageCount = 0;

    // ── Plan state ─────────────────────────────────────────────────────────────
    private planTodos = '';
    private planSummary = '';

    // ── Provider state (global — tüm workspace'lerde ortak) ───────────────────
    private providerState: ProviderState = {
        providerId: DEFAULT_PROVIDER,
        apiKey: '',
        apiKeys: [],
        baseUrl: 'http://localhost:11434',
    };
    private providerConfigs: Record<ProviderId, ProviderConfig>;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        defaultModel: string,
        ollamaUrl: string
    ) {
        this.defaultModel = defaultModel;
        this.providerState.baseUrl = ollamaUrl;
        this.providerConfigs = this.createDefaultProviderConfigs(ollamaUrl);
        this.loadPersistedState();
        this.syncCurrentProviderState();
        this.syncSystemMessage();
        return;
    }

    private getWorkspaceKey(suffix: string): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'no-workspace';
        return `codai.${suffix}.${root}`;
    }

    private getEffectiveSystemPrompt(): string {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return getModeSystemPrompt(this.agentMode, this.indexedProjectContext || undefined, cwd);
    }

    private getCompactedContextPrompt(): string {
        if (!this.compactedContextSummary.trim()) return '';
        return `\n\n<compacted_context>\nOlder conversation was compacted to stay within the context budget. Full raw chat history is still preserved locally.\nUse this summary as the canonical reference for earlier turns.\n\n${this.compactedContextSummary.trim()}\n</compacted_context>`;
    }

    private upsertSystemMessage(history: Message[], content: string): Message[] {
        const next = [...history];
        if (!next.length || next[0].role !== 'system') {
            next.unshift({ role: 'system', content });
            return next;
        }
        next[0] = { ...next[0], content };
        return next;
    }

    public syncSystemMessage() {
        const effective = this.getEffectiveSystemPrompt();
        const activeSystemPrompt = `${effective}${this.getCompactedContextPrompt()}`;
        this.conversationHistory = this.upsertSystemMessage(this.conversationHistory, activeSystemPrompt);
        this.transcriptHistory = this.upsertSystemMessage(this.transcriptHistory, effective);
    }

    private normalizeHistory(history: Message[]): Message[] {
        if (!Array.isArray(history)) return [];
        return history
            .map((message) => this.normalizeMessage(message))
            .filter((message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant' || message.role === 'tool');
    }

    private loadPersistedState() {
        // Workspace-specific state
        const state = this._extensionContext.workspaceState.get<any>(this.getWorkspaceKey('state'));
        if (state) {
            if (Array.isArray(state.conversationHistory)) this.conversationHistory = this.normalizeHistory(state.conversationHistory);
            if (Array.isArray(state.transcriptHistory)) this.transcriptHistory = this.normalizeHistory(state.transcriptHistory);
            if (typeof state.defaultModel === 'string') this.defaultModel = state.defaultModel;
            if (typeof state.indexedProjectContext === 'string') this.indexedProjectContext = state.indexedProjectContext;
            if (state.settings?.autoIndexOnOpen != null) this.settings.autoIndexOnOpen = state.settings.autoIndexOnOpen;
            if (state.agentMode) this.agentMode = state.agentMode as AgentMode;
            if (typeof state.planTodos === 'string') this.planTodos = state.planTodos;
            if (typeof state.planSummary === 'string') this.planSummary = state.planSummary;
            if (typeof state.compactedContextSummary === 'string') this.compactedContextSummary = state.compactedContextSummary;
            if (typeof state.lastCompactionAt === 'number') this.lastCompactionAt = state.lastCompactionAt;
            if (typeof state.compactedMessageCount === 'number') this.compactedMessageCount = state.compactedMessageCount;
        }

        if (!this.transcriptHistory.length && this.conversationHistory.length) {
            this.transcriptHistory = this.normalizeHistory(this.conversationHistory);
        }

        // Global provider state (tüm workspace'lerde ortak — globalState)
        const global = this._extensionContext.globalState.get<any>('codai.providerState');
        if (global) {
            if (global.providerId) this.providerState.providerId = global.providerId;
            if (global.providers && typeof global.providers === 'object') {
                for (const providerId of Object.keys(PROVIDER_DEFS) as ProviderId[]) {
                    this.providerConfigs[providerId] = this.normalizeProviderConfig(
                        providerId,
                        global.providers[providerId],
                        this.providerConfigs[providerId]
                    );
                }
            } else {
                const providerId = this.providerState.providerId;
                this.providerConfigs[providerId] = this.normalizeProviderConfig(
                    providerId,
                    global,
                    this.providerConfigs[providerId]
                );
            }
        }
    }

    public async persistState() {
        await this._extensionContext.workspaceState.update(this.getWorkspaceKey('state'), {
            conversationHistory: this.conversationHistory,
            transcriptHistory: this.transcriptHistory,
            defaultModel: this.defaultModel,
            indexedProjectContext: this.indexedProjectContext,
            settings: this.settings,
            agentMode: this.agentMode,
            planTodos: this.planTodos,
            planSummary: this.planSummary,
            compactedContextSummary: this.compactedContextSummary,
            lastCompactionAt: this.lastCompactionAt,
            compactedMessageCount: this.compactedMessageCount,
        });
    }

    public async persistProviderState() {
        const current = this.providerConfigs[this.providerState.providerId];
        await this._extensionContext.globalState.update('codai.providerState', {
            providerId: this.providerState.providerId,
            apiKey: current.apiKey,
            apiKeys: current.apiKeys,
            baseUrl: current.baseUrl,
            providers: this.providerConfigs,
        });
    }

    // ── Plan state accessors ──────────────────────────────────────────────────
    public getPlanTodos(): string { return this.planTodos; }
    public getPlanSummary(): string { return this.planSummary; }

    public updatePlanState(todos: string, summary: string) {
        this.planTodos = todos;
        this.planSummary = summary;
        // Fire and forget — persist non-blocking
        void this.persistState();
    }

    public clearPlanState() {
        this.planTodos = '';
        this.planSummary = '';
    }

    // ── Token estimation ──────────────────────────────────────────────────────
    /**
     * Rough token count estimate: characters / 4 (standard heuristic).
     * Good enough for display purposes without a real tokenizer.
     */
    public estimateTokenCount(): ContextWindowStats {
        const maxContextTokens = 80_000;
        const historyText = this.conversationHistory
            .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
            .join(' ');
        const contextChars = historyText.length;
        const contextTokens = Math.round(contextChars / 4);
        const tokensLeft = Math.max(0, maxContextTokens - contextTokens);
        const percentUsed = maxContextTokens > 0
            ? Math.min(100, Math.round((contextTokens / maxContextTokens) * 100))
            : 0;
        return {
            contextTokens,
            contextChars,
            maxContextTokens,
            tokensLeft,
            percentUsed,
            autoCompactEnabled: true,
            lastCompactionAt: this.lastCompactionAt,
            compactedMessageCount: this.compactedMessageCount,
        };
    }

    /**
     * Build a basic project summary without the old analyze_project tool.
     * Reads package.json / pyproject.toml / Cargo.toml etc. directly.
     */
    public async ensureProjectIndexed(force = false) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;
        if (!force && this.indexedProjectContext) return;
        if (this.isIndexing) return;
        this.isIndexing = true;
        try {
            const summary = await this.buildProjectSummary(workspaceRoot);
            this.indexedProjectContext = summary;
            this.syncSystemMessage();
            await this.persistState();
        } finally {
            this.isIndexing = false;
        }
    }

    private async buildProjectSummary(root: string): Promise<string> {
        const lines: string[] = [`Root: ${root}`];
        const probe = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'tsconfig.json', '.gitignore', 'README.md'];
        for (const file of probe) {
            const p = path.join(root, file);
            if (fs.existsSync(p)) {
                lines.push(`Found: ${file}`);
                if (file === 'package.json') {
                    try {
                        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
                        lines.push(`Name: ${pkg.name || 'unknown'}, Version: ${pkg.version || '?'}`);
                        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
                        if (deps.length) lines.push(`Key deps: ${deps.slice(0, 10).join(', ')}`);
                    } catch { /* ignore */ }
                }
            }
        }
        return lines.join('\n');
    }

    // ── Mode management ───────────────────────────────────────────────────────
    public getMode(): AgentMode { return this.agentMode; }

    public setMode(mode: AgentMode) {
        this.agentMode = mode;
        this.syncSystemMessage();
        this.persistState();
    }

    // ── Mode-based tool filter ────────────────────────────────────────────────
    // Returns allowed tool names for the current mode.
    // task_notes is ONLY allowed in plan mode — code mode never creates plans.
    public getAllowedToolNames(): string[] | null {
        if (this.agentMode === 'chat') return []; // no tools in chat mode

        if (this.agentMode === 'plan') return [
            // Read-only exploration
            'read_file', 'read_multiple_files', 'list_files', 'list_directory_tree',
            'search_files', 'grep_code', 'get_diagnostics', 'get_file_info', 'web_fetch',
            // Plan-specific interaction
            'task_notes', 'ask_followup_questions', 'ask_followup_question',
            'save_plan', 'attempt_completion',
        ];

        // code mode — task_notes hariç tüm tool'lar (batch tool'lar dahil)
        return [
            'read_file', 'read_multiple_files',
            'list_files', 'list_directory_tree',
            'write_file', 'search_files', 'grep_code',
            'run_command', 'delete_file', 'rename_file', 'get_diagnostics',
            'web_fetch', 'create_directory', 'get_file_info',
            'find_and_replace', 'append_to_file',
            'ask_followup_question', 'attempt_completion',
        ];
    }

    // ── Provider accessors ────────────────────────────────────────────────────
    public getProviderState(): ProviderState {
        this.syncCurrentProviderState();
        return { ...this.providerState };
    }

    public getProviderConfig(providerId: ProviderId): ProviderConfig {
        return { ...this.providerConfigs[providerId] };
    }

    public getProviderConfigs(): Record<ProviderId, ProviderConfig> {
        return Object.fromEntries(
            (Object.keys(this.providerConfigs) as ProviderId[]).map((providerId) => [
                providerId,
                { ...this.providerConfigs[providerId] },
            ])
        ) as Record<ProviderId, ProviderConfig>;
    }

    public async updateProviderState(partial: Partial<ProviderState>) {
        const targetProviderId = partial.providerId || this.providerState.providerId;
        this.providerConfigs[targetProviderId] = this.normalizeProviderConfig(
            targetProviderId,
            partial,
            this.providerConfigs[targetProviderId]
        );
        if (partial.providerId) this.providerState.providerId = partial.providerId;
        this.syncCurrentProviderState();
        await this.persistProviderState();
    }

    // ── Getters ───────────────────────────────────────────────────────────────
    public getSettings() { return this.settings; }
    public getSystemPrompt(): string { return this.transcriptHistory[0]?.content || this.conversationHistory[0]?.content || ''; }
    public getConversationHistory() { return this.conversationHistory; }
    public getTranscriptHistory() { return this.transcriptHistory; }
    public getDefaultModel() { return this.defaultModel; }

    public clearHistory() {
        this.conversationHistory = [];
        this.transcriptHistory = [];
        this.compactedContextSummary = '';
        this.lastCompactionAt = null;
        this.compactedMessageCount = 0;
        this.clearPlanState();
        this.syncSystemMessage();
        this.persistState();
    }

    public changeModel(model: string) {
        this.defaultModel = model;
        this.persistState();
    }

    public updateSystemPrompt(prompt: string) {
        // When user manually overrides, keep transcript and active context aligned.
        this.conversationHistory = this.upsertSystemMessage(this.conversationHistory, prompt);
        this.transcriptHistory = this.upsertSystemMessage(this.transcriptHistory, prompt);
        this.persistState();
    }

    public updateSettings(newSettings: any) {
        if (typeof newSettings.autoIndexOnOpen === 'boolean') {
            this.settings.autoIndexOnOpen = newSettings.autoIndexOnOpen;
            if (this.settings.autoIndexOnOpen) this.ensureProjectIndexed();
            this.persistState();
        }
    }

    private normalizeMessage(message: Message): Message {
        const normalizedContent = message.content == null
            ? null
            : typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content);
        const seenToolCallIds = new Set<string>();

        const normalizedToolCalls = Array.isArray(message.tool_calls)
            ? message.tool_calls
                .map((toolCall, index) => {
                    const rawArgs = toolCall?.function?.arguments;
                    const stringArgs = typeof rawArgs === 'string'
                        ? rawArgs
                        : JSON.stringify(rawArgs ?? {});
                    const name = typeof toolCall?.function?.name === 'string' ? toolCall.function.name : '';
                    if (!name) return null;
                    const baseId = typeof toolCall?.id === 'string' && toolCall.id.trim()
                        ? toolCall.id
                        : `tool_call_${Date.now()}_${index}`;
                    let uniqueId = baseId;
                    let collisionIndex = 2;
                    while (seenToolCallIds.has(uniqueId)) {
                        uniqueId = `${baseId}_${collisionIndex++}`;
                    }
                    seenToolCallIds.add(uniqueId);
                    return {
                        id: uniqueId,
                        type: 'function' as const,
                        function: {
                            name,
                            arguments: stringArgs,
                        },
                    };
                })
                .filter((toolCall): toolCall is NonNullable<typeof toolCall> => Boolean(toolCall))
            : undefined;

        return {
            role: message.role,
            content: normalizedContent,
            tool_calls: normalizedToolCalls,
            tool_call_id: typeof message.tool_call_id === 'string' ? message.tool_call_id : undefined,
            name: typeof message.name === 'string' ? message.name : undefined,
        };
    }

    private stripEnvironmentDetails(history: Message[]): Message[] {
        return history.map((message) => {
            if (message.role !== 'user' || typeof message.content !== 'string') return message;
            const stripped = message.content.replace(/\n\n<environment_details>[\s\S]*?<\/environment_details>/g, '').trim();
            return stripped === message.content ? message : { ...message, content: stripped };
        });
    }

    private messageSize(message: Message): number {
        let total = typeof message.content === 'string' ? message.content.length : 0;
        if (Array.isArray(message.tool_calls)) total += JSON.stringify(message.tool_calls).length;
        if (typeof message.tool_call_id === 'string') total += message.tool_call_id.length;
        if (typeof message.name === 'string') total += message.name.length;
        return total;
    }

    private summarizeCompactedMessage(message: Message): string {
        const role = message.role.toUpperCase();
        const content = typeof message.content === 'string'
            ? message.content.replace(/\s+/g, ' ').trim()
            : '';
        const contentPreview = content
            ? content.slice(0, 240) + (content.length > 240 ? '…' : '')
            : '(no text content)';
        const toolCallPreview = Array.isArray(message.tool_calls) && message.tool_calls.length > 0
            ? ` tools=${message.tool_calls
                .map((toolCall) => `${toolCall.function.name}(${String(toolCall.function.arguments).slice(0, 80)})`)
                .join(', ')}`
            : '';
        return `- ${role}: ${contentPreview}${toolCallPreview}`;
    }

    private appendCompactionSummary(messages: Message[]): void {
        if (messages.length === 0) return;
        const batchHeader = `Batch ${new Date().toISOString()} · ${messages.length} message${messages.length === 1 ? '' : 's'}`;
        const batchBody = messages.map((message) => this.summarizeCompactedMessage(message)).join('\n');
        const nextSummary = [this.compactedContextSummary.trim(), `${batchHeader}\n${batchBody}`]
            .filter(Boolean)
            .join('\n\n');

        const MAX_SUMMARY_CHARS = 48_000;
        this.compactedContextSummary = nextSummary.length > MAX_SUMMARY_CHARS
            ? `Earlier compacted batches are preserved in the raw transcript. Recent compacted summary follows.\n\n${nextSummary.slice(-MAX_SUMMARY_CHARS)}`
            : nextSummary;
    }

    public appendToHistory(message: Message) {
        const normalizedMessage = this.normalizeMessage(message);
        this.transcriptHistory.push(normalizedMessage);
        this.conversationHistory = this.stripEnvironmentDetails(this.conversationHistory);
        this.conversationHistory.push(normalizedMessage);
        this.compactHistory();
        this.syncSystemMessage();
        return;
        // B07 FIX: Strip environment_details from old user messages before adding new one.
        // environment_details is only useful for the CURRENT message — old ones waste tokens.
        this.conversationHistory = this.conversationHistory.map(m => {
            if (m.role !== 'user' || typeof m.content !== 'string') return m;
            const stripped = m.content.replace(/\n\n<environment_details>[\s\S]*?<\/environment_details>/g, '').trim();
            return stripped === m.content ? m : { ...m, content: stripped };
        });

        this.conversationHistory.push(message);
        // T14 FIX: Context window koruması — geçmişi trim et
        this.trimHistory();
    }

    private compactHistory(): void {
        const MAX_HISTORY_CHARS = 320_000; // ~80k tokens
        const TARGET_HISTORY_CHARS = 240_000;
        const MIN_MESSAGES_TO_KEEP = 8;

        let totalChars = 0;
        for (const message of this.conversationHistory) {
            totalChars += this.messageSize(message);
        }

        if (totalChars <= MAX_HISTORY_CHARS) return;

        const systemMsg = this.conversationHistory[0]?.role === 'system'
            ? this.conversationHistory[0]
            : null;
        let nonSystem = systemMsg
            ? this.conversationHistory.slice(1)
            : [...this.conversationHistory];
        const compactedBatch: Message[] = [];

        while (nonSystem.length > MIN_MESSAGES_TO_KEEP && totalChars > TARGET_HISTORY_CHARS) {
            const removed = nonSystem.shift()!;
            compactedBatch.push(removed);
            totalChars -= this.messageSize(removed);
        }

        if (compactedBatch.length > 0) {
            this.appendCompactionSummary(compactedBatch);
            this.lastCompactionAt = Date.now();
            this.compactedMessageCount += compactedBatch.length;
        }

        this.conversationHistory = systemMsg
            ? [systemMsg, ...nonSystem]
            : nonSystem;
    }

    /**
     * Context window overflow protection.
     * Rough estimate: 1 token ≈ 4 chars. Most models: 32k–128k tokens.
     * We target a safe 80k token budget (320k chars).
     * Strategy: system message always kept; oldest non-system messages dropped first.
     */
    private trimHistory(): void {
        const MAX_HISTORY_CHARS = 320_000; // ~80k tokens
        const MIN_MESSAGES_TO_KEEP = 6;     // En az son N mesaj kalır

        let totalChars = 0;
        for (const m of this.conversationHistory) {
            totalChars += (m.content || '').length;
            if (Array.isArray((m as any).tool_calls)) {
                totalChars += JSON.stringify((m as any).tool_calls).length;
            }
        }

        if (totalChars <= MAX_HISTORY_CHARS) return;

        // system mesajını koru, geriden itibaren sil
        const systemMsg = this.conversationHistory[0]?.role === 'system'
            ? this.conversationHistory[0] : null;

        let nonSystem = systemMsg
            ? this.conversationHistory.slice(1)
            : [...this.conversationHistory];

        // En eskilerden sil, MIN_MESSAGES_TO_KEEP kadar bırak
        while (nonSystem.length > MIN_MESSAGES_TO_KEEP) {
            const removed = nonSystem.shift()!;
            totalChars -= (removed.content || '').length;
            if (totalChars <= MAX_HISTORY_CHARS) break;
        }

        this.conversationHistory = systemMsg
            ? [systemMsg, ...nonSystem]
            : nonSystem;
    }

    private createDefaultProviderConfigs(ollamaUrl: string): Record<ProviderId, ProviderConfig> {
        return Object.fromEntries(
            (Object.keys(PROVIDER_DEFS) as ProviderId[]).map((providerId) => [
                providerId,
                {
                    apiKey: '',
                    apiKeys: [],
                    baseUrl: providerId === 'ollama' ? ollamaUrl : PROVIDER_DEFS[providerId].baseUrl,
                },
            ])
        ) as Record<ProviderId, ProviderConfig>;
    }

    private normalizeProviderConfig(
        providerId: ProviderId,
        partial: Partial<ProviderState> | Partial<ProviderConfig> | undefined,
        fallback?: ProviderConfig
    ): ProviderConfig {
        const base = fallback ?? this.providerConfigs[providerId] ?? {
            apiKey: '',
            apiKeys: [],
            baseUrl: PROVIDER_DEFS[providerId].baseUrl,
        };
        const trimmedKeys = Array.isArray(partial?.apiKeys)
            ? partial.apiKeys
                .filter((key): key is string => typeof key === 'string')
                .map((key) => key.trim())
                .filter(Boolean)
            : [];
        const primaryKey = trimmedKeys[0]
            || (typeof partial?.apiKey === 'string' ? partial.apiKey.trim() : base.apiKey);
        const apiKeys = trimmedKeys.length > 0
            ? trimmedKeys
            : (primaryKey ? [primaryKey] : []);
        const nextBaseUrl = typeof partial?.baseUrl === 'string' && partial.baseUrl.trim()
            ? partial.baseUrl.trim().replace(/\/+$/, '')
            : base.baseUrl;

        return {
            apiKey: primaryKey || '',
            apiKeys,
            baseUrl: nextBaseUrl || PROVIDER_DEFS[providerId].baseUrl,
        };
    }

    private syncCurrentProviderState() {
        const current = this.providerConfigs[this.providerState.providerId];
        this.providerState.apiKey = current.apiKey;
        this.providerState.apiKeys = [...current.apiKeys];
        this.providerState.baseUrl = current.baseUrl;
    }
}
