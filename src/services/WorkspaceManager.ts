import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Message, AgentMode } from '../core/types';
import { getModeSystemPrompt } from '../core/SystemPrompts';
import {
    DEFAULT_PROVIDER,
    getContextWindowForModel,
    PROVIDER_DEFS,
    type ProviderId,
} from './providers';
import { buildRetrievedContextPrompt, buildWorkspaceMemory, compactConversation, estimateTokenCountForMessages } from './ContextEngine';
import { WorkspaceIndexService } from './WorkspaceIndexService';
import { WorkspaceStorage } from './WorkspaceStorage';
import type {
    CompactionSnapshot,
    ContextPreviewPayload,
    RetrievalHit,
    WorkspaceIndexState,
    WorkspaceMemoryEntry,
} from './runtimeTypes';

export interface ProviderState {
    providerId: ProviderId;
    apiKey: string;
    apiKeys: string[];
    baseUrl: string;
}

export interface ProviderConfig {
    apiKey: string;
    apiKeys: string[];
    baseUrl: string;
}

export interface ContextWindowStats {
    contextTokens: number;
    contextChars: number;
    maxContextTokens: number;
    tokensLeft: number;
    percentUsed: number;
    autoCompactEnabled: boolean;
    lastCompactionAt: number | null;
    compactedMessageCount: number;
}

interface PersistedWorkspaceState {
    conversationHistory: Message[];
    transcriptHistory: Message[];
    defaultModel: string;
    indexedProjectContext: string;
    workspaceIndex?: WorkspaceIndexState;
    settings: {
        autoIndexOnOpen: boolean;
    };
    agentMode: AgentMode;
    planTodos: string;
    planSummary: string;
    compactedContextSummary: string;
    lastCompactionAt: number | null;
    compactedMessageCount: number;
    compactionSnapshots: CompactionSnapshot[];
    workspaceMemory: WorkspaceMemoryEntry[];
    lastRetrievalHits: RetrievalHit[];
    lastContextPreview: ContextPreviewPayload | null;
    providerModelCatalogs: Partial<Record<ProviderId, Array<{ id: string; label: string }>>>;
}

export class WorkspaceManager {
    private conversationHistory: Message[] = [];
    private transcriptHistory: Message[] = [];
    private defaultModel: string;
    private indexedProjectContext = '';
    private workspaceIndex?: WorkspaceIndexState;
    private isIndexing = false;
    private agentMode: AgentMode = 'code';
    private settings = { autoIndexOnOpen: true };
    private compactedContextSummary = '';
    private lastCompactionAt: number | null = null;
    private compactedMessageCount = 0;
    private compactionSnapshots: CompactionSnapshot[] = [];
    private workspaceMemory: WorkspaceMemoryEntry[] = [];
    private lastRetrievalHits: RetrievalHit[] = [];
    private lastContextPreview: ContextPreviewPayload | null = null;
    private providerModelCatalogs: Partial<Record<ProviderId, Array<{ id: string; label: string }>>> = {};
    private planTodos = '';
    private planSummary = '';
    private readonly indexService = new WorkspaceIndexService();

    private providerState: ProviderState = {
        providerId: DEFAULT_PROVIDER,
        apiKey: '',
        apiKeys: [],
        baseUrl: 'http://localhost:11434',
    };
    private providerConfigs: Record<ProviderId, ProviderConfig>;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly storage: WorkspaceStorage,
        defaultModel: string,
        ollamaUrl: string
    ) {
        this.defaultModel = defaultModel;
        this.providerState.baseUrl = ollamaUrl;
        this.providerConfigs = this.createDefaultProviderConfigs(ollamaUrl);
        this.loadPersistedState();
        this.syncCurrentProviderState();
        this.refreshWorkspaceMemory();
        this.refreshContextState();
        this.syncSystemMessage();
    }

    private getLegacyWorkspaceKey(suffix: string): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'no-workspace';
        return `codai.${suffix}.${root}`;
    }

    private buildPersistedState(): PersistedWorkspaceState {
        return {
            conversationHistory: this.conversationHistory,
            transcriptHistory: this.transcriptHistory,
            defaultModel: this.defaultModel,
            indexedProjectContext: this.indexedProjectContext,
            workspaceIndex: this.workspaceIndex,
            settings: this.settings,
            agentMode: this.agentMode,
            planTodos: this.planTodos,
            planSummary: this.planSummary,
            compactedContextSummary: this.compactedContextSummary,
            lastCompactionAt: this.lastCompactionAt,
            compactedMessageCount: this.compactedMessageCount,
            compactionSnapshots: this.compactionSnapshots,
            workspaceMemory: this.workspaceMemory,
            lastRetrievalHits: this.lastRetrievalHits,
            lastContextPreview: this.lastContextPreview,
            providerModelCatalogs: this.providerModelCatalogs,
        };
    }

    private loadPersistedState() {
        const legacyWorkspaceState = this.extensionContext.workspaceState.get<any>(this.getLegacyWorkspaceKey('state')) ?? null;
        const state = this.storage.readWorkspaceState<PersistedWorkspaceState | null>(
            legacyWorkspaceState
                ? this.normalizeLegacyWorkspaceState(legacyWorkspaceState)
                : null
        );

        if (state) {
            this.conversationHistory = this.normalizeHistory(state.conversationHistory);
            this.transcriptHistory = this.normalizeHistory(state.transcriptHistory);
            this.defaultModel = typeof state.defaultModel === 'string' ? state.defaultModel : this.defaultModel;
            this.indexedProjectContext = typeof state.indexedProjectContext === 'string' ? state.indexedProjectContext : '';
            this.workspaceIndex = state.workspaceIndex;
            if (typeof state.settings?.autoIndexOnOpen === 'boolean') {
                this.settings.autoIndexOnOpen = state.settings.autoIndexOnOpen;
            }
            if (state.agentMode) this.agentMode = state.agentMode;
            if (typeof state.planTodos === 'string') this.planTodos = state.planTodos;
            if (typeof state.planSummary === 'string') this.planSummary = state.planSummary;
            if (typeof state.compactedContextSummary === 'string') this.compactedContextSummary = state.compactedContextSummary;
            if (typeof state.lastCompactionAt === 'number') this.lastCompactionAt = state.lastCompactionAt;
            if (typeof state.compactedMessageCount === 'number') this.compactedMessageCount = state.compactedMessageCount;
            this.compactionSnapshots = Array.isArray(state.compactionSnapshots) ? state.compactionSnapshots : [];
            this.workspaceMemory = Array.isArray(state.workspaceMemory) ? state.workspaceMemory : [];
            this.lastRetrievalHits = Array.isArray(state.lastRetrievalHits) ? state.lastRetrievalHits : [];
            this.lastContextPreview = state.lastContextPreview ?? null;
            if (state.providerModelCatalogs && typeof state.providerModelCatalogs === 'object') {
                this.providerModelCatalogs = state.providerModelCatalogs;
            }
        }

        if (!this.transcriptHistory.length && this.conversationHistory.length) {
            this.transcriptHistory = this.normalizeHistory(this.conversationHistory);
        }

        const legacyProviderState = this.extensionContext.globalState.get<any>('codai.providerState') ?? null;
        const globalProviderState = this.storage.readProviderState<any | null>(legacyProviderState);
        if (globalProviderState) {
            if (globalProviderState.providerId) this.providerState.providerId = globalProviderState.providerId;
            if (globalProviderState.providers && typeof globalProviderState.providers === 'object') {
                for (const providerId of Object.keys(PROVIDER_DEFS) as ProviderId[]) {
                    this.providerConfigs[providerId] = this.normalizeProviderConfig(
                        providerId,
                        globalProviderState.providers[providerId],
                        this.providerConfigs[providerId]
                    );
                }
            } else {
                const providerId = this.providerState.providerId;
                this.providerConfigs[providerId] = this.normalizeProviderConfig(
                    providerId,
                    globalProviderState,
                    this.providerConfigs[providerId]
                );
            }
        }
    }

    private normalizeLegacyWorkspaceState(state: any): PersistedWorkspaceState {
        return {
            conversationHistory: Array.isArray(state?.conversationHistory) ? state.conversationHistory : [],
            transcriptHistory: Array.isArray(state?.transcriptHistory) ? state.transcriptHistory : [],
            defaultModel: typeof state?.defaultModel === 'string' ? state.defaultModel : this.defaultModel,
            indexedProjectContext: typeof state?.indexedProjectContext === 'string' ? state.indexedProjectContext : '',
            workspaceIndex: state?.workspaceIndex,
            settings: {
                autoIndexOnOpen: typeof state?.settings?.autoIndexOnOpen === 'boolean' ? state.settings.autoIndexOnOpen : true,
            },
            agentMode: (state?.agentMode as AgentMode) || 'code',
            planTodos: typeof state?.planTodos === 'string' ? state.planTodos : '',
            planSummary: typeof state?.planSummary === 'string' ? state.planSummary : '',
            compactedContextSummary: typeof state?.compactedContextSummary === 'string' ? state.compactedContextSummary : '',
            lastCompactionAt: typeof state?.lastCompactionAt === 'number' ? state.lastCompactionAt : null,
            compactedMessageCount: typeof state?.compactedMessageCount === 'number' ? state.compactedMessageCount : 0,
            compactionSnapshots: Array.isArray(state?.compactionSnapshots) ? state.compactionSnapshots : [],
            workspaceMemory: Array.isArray(state?.workspaceMemory) ? state.workspaceMemory : [],
            lastRetrievalHits: Array.isArray(state?.lastRetrievalHits) ? state.lastRetrievalHits : [],
            lastContextPreview: state?.lastContextPreview ?? null,
            providerModelCatalogs: state?.providerModelCatalogs ?? {},
        };
    }

    private getEffectiveSystemPrompt(): string {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        return getModeSystemPrompt(this.agentMode, this.indexedProjectContext || undefined, cwd);
    }

    private getCompactedContextPrompt(): string {
        if (!this.compactedContextSummary.trim()) return '';
        return `\n\n<compacted_context>\nOlder conversation was compacted to stay within the context budget. Full raw chat history is still preserved locally.\nUse this summary as the canonical reference for earlier turns.\n\n${this.compactedContextSummary.trim()}\n</compacted_context>`;
    }

    private getWorkspaceMemoryPrompt(): string {
        if (this.workspaceMemory.length === 0) return '';
        const lines = this.workspaceMemory
            .slice(0, 6)
            .map((memory) => `- ${memory.title}: ${memory.value.slice(0, 220)}`);
        return `\n\n<workspace_memory>\n${lines.join('\n')}\n</workspace_memory>`;
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
        const activeSystemPrompt = `${effective}${this.getCompactedContextPrompt()}${buildRetrievedContextPrompt(this.lastRetrievalHits)}${this.getWorkspaceMemoryPrompt()}`;
        this.conversationHistory = this.upsertSystemMessage(this.conversationHistory, activeSystemPrompt);
        this.transcriptHistory = this.upsertSystemMessage(this.transcriptHistory, effective);
    }

    private normalizeHistory(history: Message[]): Message[] {
        if (!Array.isArray(history)) return [];
        return history
            .map((message) => this.normalizeMessage(message))
            .filter((message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant' || message.role === 'tool');
    }

    public async persistState() {
        const state = this.buildPersistedState();
        await this.storage.writeWorkspaceState(state);
        await this.extensionContext.workspaceState.update(this.getLegacyWorkspaceKey('state'), state);
    }

    public async persistProviderState() {
        const current = this.providerConfigs[this.providerState.providerId];
        const state = {
            providerId: this.providerState.providerId,
            apiKey: current.apiKey,
            apiKeys: current.apiKeys,
            baseUrl: current.baseUrl,
            providers: this.providerConfigs,
        };
        await this.storage.writeProviderState(state);
        await this.extensionContext.globalState.update('codai.providerState', state);
    }

    public getPlanTodos(): string { return this.planTodos; }
    public getPlanSummary(): string { return this.planSummary; }

    public updatePlanState(todos: string, summary: string) {
        this.planTodos = todos;
        this.planSummary = summary;
        this.refreshWorkspaceMemory();
        this.refreshContextState();
        void this.persistState();
    }

    public clearPlanState() {
        this.planTodos = '';
        this.planSummary = '';
        this.refreshWorkspaceMemory();
        this.refreshContextState();
    }

    public estimateTokenCount(): ContextWindowStats {
        return estimateTokenCountForMessages(
            this.conversationHistory,
            this.getMaxContextTokens(),
            this.lastCompactionAt,
            this.compactedMessageCount
        );
    }

    public async ensureProjectIndexed(force = false) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;
        if (!force && this.workspaceIndex && this.workspaceIndex.entries.length > 0) return;
        if (this.isIndexing) return;
        this.isIndexing = true;
        try {
            const index = await this.indexService.buildIndex(workspaceRoot);
            this.workspaceIndex = index;
            this.indexedProjectContext = this.indexService.buildSummary(index, workspaceRoot);
            this.refreshWorkspaceMemory();
            this.refreshContextState();
            await this.persistState();
        } finally {
            this.isIndexing = false;
        }
    }

    public getMode(): AgentMode { return this.agentMode; }

    public setMode(mode: AgentMode) {
        this.agentMode = mode;
        this.refreshContextState();
        void this.persistState();
    }

    public getAllowedToolNames(): string[] | null {
        if (this.agentMode === 'chat') return [];

        if (this.agentMode === 'plan') return [
            'read_file', 'read_multiple_files', 'list_files', 'list_directory_tree',
            'search_files', 'grep_code', 'get_diagnostics', 'get_file_info', 'web_fetch',
            'task_notes', 'ask_followup_questions', 'ask_followup_question',
            'save_plan', 'attempt_completion',
        ];

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
        this.refreshContextState();
        await this.persistProviderState();
        await this.persistState();
    }

    public getSettings() { return this.settings; }
    public getSystemPrompt(): string { return this.transcriptHistory[0]?.content || this.conversationHistory[0]?.content || ''; }
    public getConversationHistory() { return this.conversationHistory; }
    public getTranscriptHistory() { return this.transcriptHistory; }
    public getDefaultModel() { return this.defaultModel; }
    public getContextPreview() { return this.lastContextPreview; }
    public getLatestRetrievalHits() { return [...this.lastRetrievalHits]; }
    public getProviderModelCatalog(providerId: ProviderId) { return [...(this.providerModelCatalogs[providerId] ?? [])]; }
    public getWorkspaceIndex() { return this.workspaceIndex; }

    public restoreSessionState(state: Partial<PersistedWorkspaceState> & {
        mode?: AgentMode;
        model?: string;
    }) {
        this.transcriptHistory = this.normalizeHistory(
            Array.isArray(state.transcriptHistory) && state.transcriptHistory.length > 0
                ? state.transcriptHistory
                : Array.isArray(state.conversationHistory)
                    ? state.conversationHistory
                    : []
        );
        this.conversationHistory = this.normalizeHistory(
            Array.isArray(state.conversationHistory) && state.conversationHistory.length > 0
                ? state.conversationHistory
                : this.transcriptHistory
        );
        if (typeof state.model === 'string' && state.model.trim()) {
            this.defaultModel = state.model;
        }
        if (state.mode) {
            this.agentMode = state.mode;
        }
        if (typeof state.planTodos === 'string') {
            this.planTodos = state.planTodos;
        }
        if (typeof state.planSummary === 'string') {
            this.planSummary = state.planSummary;
        }
        if (typeof state.compactedContextSummary === 'string') {
            this.compactedContextSummary = state.compactedContextSummary;
        }
        if (typeof state.lastCompactionAt === 'number' || state.lastCompactionAt === null) {
            this.lastCompactionAt = state.lastCompactionAt ?? null;
        }
        if (typeof state.compactedMessageCount === 'number') {
            this.compactedMessageCount = state.compactedMessageCount;
        }
        if (Array.isArray(state.compactionSnapshots)) {
            this.compactionSnapshots = state.compactionSnapshots;
        }
        this.refreshWorkspaceMemory();
        this.refreshContextState();
        void this.persistState();
    }

    public clearHistory() {
        this.conversationHistory = [];
        this.transcriptHistory = [];
        this.compactedContextSummary = '';
        this.lastCompactionAt = null;
        this.compactedMessageCount = 0;
        this.compactionSnapshots = [];
        this.lastRetrievalHits = [];
        this.lastContextPreview = null;
        this.clearPlanState();
        this.syncSystemMessage();
        void this.persistState();
    }

    public changeModel(model: string) {
        this.defaultModel = model;
        this.refreshContextState();
        void this.persistState();
    }

    public updateSystemPrompt(prompt: string) {
        this.conversationHistory = this.upsertSystemMessage(this.conversationHistory, prompt);
        this.transcriptHistory = this.upsertSystemMessage(this.transcriptHistory, prompt);
        void this.persistState();
    }

    public updateSettings(newSettings: any) {
        if (typeof newSettings.autoIndexOnOpen === 'boolean') {
            this.settings.autoIndexOnOpen = newSettings.autoIndexOnOpen;
            if (this.settings.autoIndexOnOpen) void this.ensureProjectIndexed();
            void this.persistState();
        }
    }

    public setProviderModelCatalog(providerId: ProviderId, models: Array<{ id: string; label: string }>) {
        this.providerModelCatalogs[providerId] = models;
        this.refreshContextState();
        void this.persistState();
    }

    public appendToHistory(message: Message) {
        const normalizedMessage = this.normalizeMessage(message);
        this.transcriptHistory.push(normalizedMessage);
        this.conversationHistory = this.stripEnvironmentDetails(this.conversationHistory);
        this.conversationHistory.push(normalizedMessage);
        this.refreshWorkspaceMemory();
        this.refreshContextState(normalizedMessage.role === 'user' && typeof normalizedMessage.content === 'string' ? normalizedMessage.content : '');
    }

    private refreshWorkspaceMemory() {
        this.workspaceMemory = buildWorkspaceMemory(this.indexedProjectContext, this.planSummary);
    }

    private refreshContextState(query = '') {
        const result = compactConversation({
            conversationHistory: this.conversationHistory,
            transcriptHistory: this.transcriptHistory,
            compactedContextSummary: this.compactedContextSummary,
            snapshots: this.compactionSnapshots,
            workspaceMemory: this.workspaceMemory,
            workspaceIndex: this.workspaceIndex,
            maxContextTokens: this.getMaxContextTokens(),
            query,
            lastCompactionAt: this.lastCompactionAt,
            compactedMessageCount: this.compactedMessageCount,
        });
        this.conversationHistory = result.conversationHistory;
        this.compactedContextSummary = result.compactedContextSummary;
        this.compactionSnapshots = result.snapshots;
        this.lastRetrievalHits = result.retrievalHits;
        this.lastContextPreview = result.preview;
        this.lastCompactionAt = result.lastCompactionAt;
        this.compactedMessageCount = result.compactedMessageCount;
        this.syncSystemMessage();
    }

    private getMaxContextTokens(): number {
        return getContextWindowForModel(
            this.providerState.providerId,
            this.defaultModel,
            this.providerModelCatalogs[this.providerState.providerId]
        );
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
