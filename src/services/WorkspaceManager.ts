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

export class WorkspaceManager {
    private conversationHistory: Message[] = [];
    private defaultModel: string;
    private indexedProjectContext = '';
    private isIndexing = false;
    private agentMode: AgentMode = 'code';
    private settings = { autoIndexOnOpen: true };

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
    }

    private getWorkspaceKey(suffix: string): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'no-workspace';
        return `codai.${suffix}.${root}`;
    }

    private getEffectiveSystemPrompt(): string {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return getModeSystemPrompt(this.agentMode, this.indexedProjectContext || undefined, cwd);
    }

    public syncSystemMessage() {
        const effective = this.getEffectiveSystemPrompt();
        if (!this.conversationHistory.length || this.conversationHistory[0].role !== 'system') {
            this.conversationHistory.unshift({ role: 'system', content: effective });
            return;
        }
        this.conversationHistory[0].content = effective;
    }

    private loadPersistedState() {
        // Workspace-specific state
        const state = this._extensionContext.workspaceState.get<any>(this.getWorkspaceKey('state'));
        if (state) {
            if (Array.isArray(state.conversationHistory)) this.conversationHistory = state.conversationHistory;
            if (typeof state.defaultModel === 'string') this.defaultModel = state.defaultModel;
            if (typeof state.indexedProjectContext === 'string') this.indexedProjectContext = state.indexedProjectContext;
            if (state.settings?.autoIndexOnOpen != null) this.settings.autoIndexOnOpen = state.settings.autoIndexOnOpen;
            if (state.agentMode) this.agentMode = state.agentMode as AgentMode;
            if (typeof state.planTodos === 'string') this.planTodos = state.planTodos;
            if (typeof state.planSummary === 'string') this.planSummary = state.planSummary;
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
            defaultModel: this.defaultModel,
            indexedProjectContext: this.indexedProjectContext,
            settings: this.settings,
            agentMode: this.agentMode,
            planTodos: this.planTodos,
            planSummary: this.planSummary,
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
    public estimateTokenCount(): { contextTokens: number; contextChars: number } {
        const historyText = this.conversationHistory
            .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
            .join(' ');
        const contextChars = historyText.length;
        const contextTokens = Math.round(contextChars / 4);
        return { contextTokens, contextChars };
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
    public getSystemPrompt(): string { return this.conversationHistory[0]?.content || ''; }
    public getConversationHistory() { return this.conversationHistory; }
    public getDefaultModel() { return this.defaultModel; }

    public clearHistory() {
        this.conversationHistory = [];
        this.clearPlanState();
        this.syncSystemMessage();
        this.persistState();
    }

    public changeModel(model: string) {
        this.defaultModel = model;
        this.persistState();
    }

    public updateSystemPrompt(prompt: string) {
        // When user manually overrides, use it directly (don't re-apply mode template)
        if (this.conversationHistory.length && this.conversationHistory[0].role === 'system') {
            this.conversationHistory[0].content = prompt;
        } else {
            this.conversationHistory.unshift({ role: 'system', content: prompt });
        }
        this.persistState();
    }

    public updateSettings(newSettings: any) {
        if (typeof newSettings.autoIndexOnOpen === 'boolean') {
            this.settings.autoIndexOnOpen = newSettings.autoIndexOnOpen;
            if (this.settings.autoIndexOnOpen) this.ensureProjectIndexed();
            this.persistState();
        }
    }

    public appendToHistory(message: Message) {
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
