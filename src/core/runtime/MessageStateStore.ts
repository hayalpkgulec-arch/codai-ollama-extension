import * as vscode from 'vscode';
import type { AgentMode } from '../types';
import type {
    BrowserArtifactEntry,
    BrowserSessionState,
    LatestTraceSummary,
    RuntimeSnapshot,
    StoredSessionHistory,
    ToolControlState,
    TurnState,
} from '../../services/runtimeTypes';
import { WorkspaceStorage } from '../../services/WorkspaceStorage';
import { WorkspaceManager } from '../../services/WorkspaceManager';
import { TurnTraceService } from '../../services/TurnTraceService';

const SESSION_STATE_KEY = 'codai_sessions_v1';
const SESSION_SCHEMA_VERSION = 2;

export interface LoadedSession {
    sessionId: string;
    meta?: any;
    payload: StoredSessionHistory;
    messages: any[];
}

export class MessageStateStore {
    constructor(
        private readonly storage: WorkspaceStorage,
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly workspaceManager: WorkspaceManager,
        private readonly traceService: TurnTraceService,
        private readonly getToolControlState: () => ToolControlState | null,
        private readonly getBrowserSessionState: () => BrowserSessionState | null,
        private readonly getBrowserArtifactsIndex: () => BrowserArtifactEntry[],
    ) {}

    public async getSessions(): Promise<any[]> {
        return this.storage.readSessionIndex<any[]>(
            this.extensionContext.globalState.get<any[]>(SESSION_STATE_KEY) ?? []
        );
    }

    public async upsertSessionMeta(session: any): Promise<void> {
        const sessions = await this.getSessions();
        const index = sessions.findIndex((entry) => entry.id === session.id);
        if (index >= 0) sessions[index] = session;
        else sessions.unshift(session);
        const limited = sessions.slice(0, 100);
        await this.storage.writeSessionIndex(limited);
        await this.extensionContext.globalState.update(SESSION_STATE_KEY, limited);
    }

    public async updateSessionMeta(sessionId: string, updates: any): Promise<void> {
        const sessions = await this.getSessions();
        const index = sessions.findIndex((entry) => entry.id === sessionId);
        if (index >= 0) {
            sessions[index] = { ...sessions[index], ...updates, updatedAt: new Date().toISOString() };
            await this.storage.writeSessionIndex(sessions);
            await this.extensionContext.globalState.update(SESSION_STATE_KEY, sessions);
        }
    }

    public async renameSession(sessionId: string, title: string): Promise<void> {
        await this.updateSessionMeta(sessionId, { title });
    }

    public async saveSessionHistory(sessionId: string, messages: any[]): Promise<void> {
        const key = this.getSessionHistoryKey(sessionId);
        const payload = this.buildStoredSessionHistory(messages);
        await this.storage.writeSessionHistory(sessionId, payload);
        await this.extensionContext.globalState.update(key, payload);
    }

    public async loadSession(sessionId: string): Promise<LoadedSession> {
        const key = this.getSessionHistoryKey(sessionId);
        const stored = this.storage.readSessionHistory<any>(
            sessionId,
            this.extensionContext.globalState.get<any>(key) ?? []
        );
        const payload = this.normalizeStoredSessionHistory(stored);
        const sessions = await this.getSessions();
        const meta = sessions.find((entry) => entry.id === sessionId);

        this.workspaceManager.restoreSessionState({
            transcriptHistory: payload.messageState.transcriptHistory,
            conversationHistory: payload.messageState.conversationHistory,
            mode: (payload.messageState.mode || meta?.mode || 'code') as AgentMode,
            model: payload.messageState.model || meta?.model,
            planTodos: payload.messageState.planTodos,
            planSummary: payload.messageState.planSummary,
            compactedContextSummary: payload.messageState.compactedContextSummary,
            lastCompactionAt: payload.messageState.lastCompactionAt,
            compactedMessageCount: payload.messageState.compactedMessageCount,
            compactionSnapshots: payload.messageState.compactionSnapshots,
        });

        return {
            sessionId,
            meta,
            payload,
            messages: payload.messages,
        };
    }

    public async deleteSession(sessionId: string): Promise<void> {
        const sessions = await this.getSessions();
        const filtered = sessions.filter((entry: any) => entry.id !== sessionId);
        await this.storage.writeSessionIndex(filtered);
        await this.extensionContext.globalState.update(SESSION_STATE_KEY, filtered);
        await this.storage.deleteSessionHistory(sessionId);
        await this.extensionContext.globalState.update(this.getSessionHistoryKey(sessionId), undefined);
    }

    private getSessionHistoryKey(sessionId: string): string {
        return `codai_session_history_${sessionId}`;
    }

    private buildStoredSessionHistory(messages: any[]): StoredSessionHistory {
        const runtimeSnapshots: RuntimeSnapshot[] = [{
            capturedAt: new Date().toISOString(),
            turnState: this.traceService.getCurrentTurnState(),
            latestTrace: this.traceService.getLatestSummary(),
            toolControlState: this.getToolControlState(),
            goalControlState: {
                turnId: this.traceService.getCurrentTurnState()?.turnId,
                activeGoal: this.workspaceManager.getPlanSummary() || 'Continue the current coding task.',
                checkpoints: [],
                driftWarnings: [],
            },
            browserSessionState: this.getBrowserSessionState() ?? {
                active: false,
                artifactCount: 0,
            },
        }];

        return {
            schemaVersion: SESSION_SCHEMA_VERSION,
            messages,
            messageState: this.workspaceManager.getSessionSnapshot(),
            runtimeSnapshots,
            browserArtifactsIndex: this.getBrowserArtifactsIndex(),
            goalSnapshots: runtimeSnapshots
                .map((snapshot) => snapshot.goalControlState)
                .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot)),
            savedAt: new Date().toISOString(),
        };
    }

    private normalizeStoredSessionHistory(stored: any): StoredSessionHistory {
        if (Array.isArray(stored)) {
            return this.fromLegacyArray(stored);
        }

        if (stored && typeof stored === 'object' && stored.messageState) {
            return {
                schemaVersion: typeof stored.schemaVersion === 'number' ? stored.schemaVersion : SESSION_SCHEMA_VERSION,
                messages: Array.isArray(stored.messages) ? stored.messages : [],
                messageState: {
                    conversationHistory: Array.isArray(stored.messageState.conversationHistory) ? stored.messageState.conversationHistory : [],
                    transcriptHistory: Array.isArray(stored.messageState.transcriptHistory) ? stored.messageState.transcriptHistory : [],
                    mode: typeof stored.messageState.mode === 'string' ? stored.messageState.mode : 'code',
                    model: typeof stored.messageState.model === 'string' ? stored.messageState.model : '',
                    planTodos: typeof stored.messageState.planTodos === 'string' ? stored.messageState.planTodos : '',
                    planSummary: typeof stored.messageState.planSummary === 'string' ? stored.messageState.planSummary : '',
                    compactedContextSummary: typeof stored.messageState.compactedContextSummary === 'string'
                        ? stored.messageState.compactedContextSummary
                        : '',
                    lastCompactionAt: typeof stored.messageState.lastCompactionAt === 'number' || stored.messageState.lastCompactionAt === null
                        ? stored.messageState.lastCompactionAt
                        : null,
                    compactedMessageCount: typeof stored.messageState.compactedMessageCount === 'number'
                        ? stored.messageState.compactedMessageCount
                        : 0,
                    compactionSnapshots: Array.isArray(stored.messageState.compactionSnapshots)
                        ? stored.messageState.compactionSnapshots
                        : [],
                    savedAt: typeof stored.messageState.savedAt === 'string' ? stored.messageState.savedAt : new Date().toISOString(),
                },
                runtimeSnapshots: Array.isArray(stored.runtimeSnapshots) ? stored.runtimeSnapshots : [],
                browserArtifactsIndex: Array.isArray(stored.browserArtifactsIndex) ? stored.browserArtifactsIndex : [],
                goalSnapshots: Array.isArray(stored.goalSnapshots) ? stored.goalSnapshots : [],
                savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : new Date().toISOString(),
            };
        }

        if (stored && typeof stored === 'object') {
            return {
                schemaVersion: 1,
                messages: Array.isArray(stored.messages) ? stored.messages : [],
                messageState: {
                    conversationHistory: Array.isArray(stored.conversationHistory) ? stored.conversationHistory : [],
                    transcriptHistory: Array.isArray(stored.transcriptHistory) ? stored.transcriptHistory : [],
                    mode: typeof stored.mode === 'string' ? stored.mode : '',
                    model: typeof stored.model === 'string' ? stored.model : '',
                    planTodos: typeof stored.planTodos === 'string' ? stored.planTodos : '',
                    planSummary: typeof stored.planSummary === 'string' ? stored.planSummary : '',
                    savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : new Date().toISOString(),
                },
                runtimeSnapshots: Array.isArray(stored.runtimeSnapshots) ? stored.runtimeSnapshots : [],
                browserArtifactsIndex: Array.isArray(stored.browserArtifactsIndex) ? stored.browserArtifactsIndex : [],
                goalSnapshots: Array.isArray(stored.goalSnapshots) ? stored.goalSnapshots : [],
                savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : new Date().toISOString(),
            };
        }

        return this.fromLegacyArray([]);
    }

    private fromLegacyArray(messages: any[]): StoredSessionHistory {
        return {
            schemaVersion: 1,
            messages,
            messageState: {
                conversationHistory: [],
                transcriptHistory: [],
                mode: '',
                model: '',
                planTodos: '',
                planSummary: '',
                savedAt: new Date().toISOString(),
            },
            runtimeSnapshots: [],
            browserArtifactsIndex: [],
            goalSnapshots: [],
            savedAt: new Date().toISOString(),
        };
    }
}
