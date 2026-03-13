import * as vscode from 'vscode';
import type { AgentMode } from '../types';
import type {
    BrowserArtifactEntry,
    BrowserSessionState,
    GoalControlState,
    LatestTraceSummary,
    RuntimeSnapshot,
    StoredSessionExport,
    StoredSessionHistory,
    StoredSessionMeta,
    ToolControlState,
    TurnState,
} from '../../services/runtimeTypes';
import { WorkspaceStorage } from '../../services/WorkspaceStorage';
import { WorkspaceManager } from '../../services/WorkspaceManager';
import { TurnTraceService } from '../../services/TurnTraceService';

const SESSION_STATE_KEY = 'codai_sessions_v1';
const SESSION_SCHEMA_VERSION = 2;
const SESSION_EXPORT_SCHEMA_VERSION = 1;

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
        private readonly getGoalControlState: () => GoalControlState | null,
        private readonly getBrowserSessionState: () => BrowserSessionState | null,
        private readonly getBrowserArtifactsIndex: () => BrowserArtifactEntry[],
    ) {}

    public async getSessions(): Promise<StoredSessionMeta[]> {
        const sessions = this.storage.readSessionIndex<StoredSessionMeta[]>(
            this.extensionContext.globalState.get<StoredSessionMeta[]>(SESSION_STATE_KEY) ?? []
        );
        return this.sortSessions(sessions.map((session) => this.normalizeSessionMeta(session)));
    }

    public async upsertSessionMeta(session: Partial<StoredSessionMeta> & { id: string }): Promise<void> {
        const sessions = await this.getSessions();
        const index = sessions.findIndex((entry) => entry.id === session.id);
        const normalized = this.normalizeSessionMeta({
            ...(index >= 0 ? sessions[index] : {}),
            ...session,
        });
        if (index >= 0) sessions[index] = normalized;
        else sessions.unshift(normalized);
        const limited = this.sortSessions(sessions).slice(0, 100);
        await this.storage.writeSessionIndex(limited);
        await this.extensionContext.globalState.update(SESSION_STATE_KEY, limited);
    }

    public async updateSessionMeta(sessionId: string, updates: Partial<StoredSessionMeta>): Promise<StoredSessionMeta | undefined> {
        const sessions = await this.getSessions();
        const index = sessions.findIndex((entry) => entry.id === sessionId);
        if (index >= 0) {
            sessions[index] = this.normalizeSessionMeta({
                ...sessions[index],
                ...updates,
                updatedAt: new Date().toISOString(),
            });
            const nextSessions = this.sortSessions(sessions);
            await this.storage.writeSessionIndex(nextSessions);
            await this.extensionContext.globalState.update(SESSION_STATE_KEY, nextSessions);
            return nextSessions.find((entry) => entry.id === sessionId);
        }
        return undefined;
    }

    public async renameSession(sessionId: string, title: string): Promise<StoredSessionMeta | undefined> {
        return this.updateSessionMeta(sessionId, { title });
    }

    public async setSessionPinned(sessionId: string, pinned: boolean): Promise<StoredSessionMeta | undefined> {
        return this.updateSessionMeta(sessionId, { pinned });
    }

    public async setSessionArchived(sessionId: string, archived: boolean): Promise<StoredSessionMeta | undefined> {
        return this.updateSessionMeta(sessionId, {
            archived,
            archivedAt: archived ? new Date().toISOString() : null,
        });
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

    public async exportSession(sessionId: string): Promise<StoredSessionExport | null> {
        const sessions = await this.getSessions();
        const meta = sessions.find((entry) => entry.id === sessionId);
        if (!meta) return null;

        const key = this.getSessionHistoryKey(sessionId);
        const stored = this.storage.readSessionHistory<any>(
            sessionId,
            this.extensionContext.globalState.get<any>(key) ?? []
        );
        const payload = this.normalizeStoredSessionHistory(stored);

        return {
            schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            workspaceHash: this.storage.getWorkspaceHash(),
            meta,
            payload,
        };
    }

    public async importSession(rawBundle: any): Promise<StoredSessionMeta> {
        const bundle = rawBundle && typeof rawBundle === 'object' && rawBundle.payload
            ? rawBundle
            : { meta: rawBundle?.meta ?? rawBundle, payload: rawBundle?.payload ?? rawBundle };
        const payload = this.normalizeStoredSessionHistory(bundle.payload);
        const sessions = await this.getSessions();
        const existingIds = new Set(sessions.map((session) => session.id));
        const requestedId = typeof bundle?.meta?.id === 'string' && bundle.meta.id.trim()
            ? bundle.meta.id.trim()
            : `session-${Date.now()}`;
        const sessionId = this.ensureUniqueSessionId(requestedId, existingIds);
        const importedMeta = this.normalizeSessionMeta({
            ...bundle?.meta,
            id: sessionId,
            archived: false,
            archivedAt: null,
            updatedAt: new Date().toISOString(),
            createdAt: typeof bundle?.meta?.createdAt === 'string' && bundle.meta.createdAt
                ? bundle.meta.createdAt
                : new Date().toISOString(),
            messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
            mode: typeof bundle?.meta?.mode === 'string' && bundle.meta.mode
                ? bundle.meta.mode
                : payload.messageState.mode || 'code',
            model: typeof bundle?.meta?.model === 'string' && bundle.meta.model
                ? bundle.meta.model
                : payload.messageState.model,
            preview: typeof bundle?.meta?.preview === 'string' && bundle.meta.preview
                ? bundle.meta.preview
                : this.derivePreviewFromMessages(payload.messages),
            title: typeof bundle?.meta?.title === 'string' && bundle.meta.title.trim()
                ? bundle.meta.title.trim()
                : this.deriveTitleFromMessages(payload.messages),
        }, payload);

        await this.storage.writeSessionHistory(sessionId, payload);
        await this.extensionContext.globalState.update(this.getSessionHistoryKey(sessionId), payload);
        await this.upsertSessionMeta(importedMeta);
        return importedMeta;
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

    private normalizeSessionMeta(meta: Partial<StoredSessionMeta> | null | undefined, payload?: StoredSessionHistory): StoredSessionMeta {
        const now = new Date().toISOString();
        const messages = Array.isArray(payload?.messages) ? payload!.messages : [];
        const preview = typeof meta?.preview === 'string' && meta.preview.trim()
            ? meta.preview.trim()
            : this.derivePreviewFromMessages(messages);
        const title = typeof meta?.title === 'string' && meta.title.trim()
            ? meta.title.trim()
            : this.deriveTitleFromMessages(messages);

        return {
            id: typeof meta?.id === 'string' && meta.id.trim() ? meta.id.trim() : `session-${Date.now()}`,
            title,
            createdAt: typeof meta?.createdAt === 'string' && meta.createdAt ? meta.createdAt : now,
            updatedAt: typeof meta?.updatedAt === 'string' && meta.updatedAt ? meta.updatedAt : now,
            messageCount: typeof meta?.messageCount === 'number'
                ? meta.messageCount
                : messages.length,
            mode: typeof meta?.mode === 'string' && meta.mode
                ? meta.mode
                : payload?.messageState.mode || 'code',
            model: typeof meta?.model === 'string' ? meta.model : payload?.messageState.model || '',
            preview: preview || undefined,
            pinned: Boolean(meta?.pinned),
            archived: Boolean(meta?.archived),
            archivedAt: typeof meta?.archivedAt === 'string'
                ? meta.archivedAt
                : meta?.archived
                    ? now
                    : null,
        };
    }

    private buildStoredSessionHistory(messages: any[]): StoredSessionHistory {
        const goalControlState = this.getGoalControlState() ?? {
            turnId: this.traceService.getCurrentTurnState()?.turnId,
            activeGoal: this.workspaceManager.getPlanSummary() || 'Continue the current coding task.',
            checkpoints: [],
            driftWarnings: [],
        };
        const runtimeSnapshots: RuntimeSnapshot[] = [{
            capturedAt: new Date().toISOString(),
            turnState: this.traceService.getCurrentTurnState(),
            latestTrace: this.traceService.getLatestSummary(),
            toolControlState: this.getToolControlState(),
            goalControlState,
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
                goalSnapshots: Array.isArray(stored.goalSnapshots)
                    ? stored.goalSnapshots
                    : Array.isArray(stored.runtimeSnapshots)
                        ? stored.runtimeSnapshots
                            .map((snapshot: any) => snapshot?.goalControlState)
                            .filter((snapshot: unknown) => Boolean(snapshot))
                        : [],
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
                goalSnapshots: Array.isArray(stored.goalSnapshots)
                    ? stored.goalSnapshots
                    : Array.isArray(stored.runtimeSnapshots)
                        ? stored.runtimeSnapshots
                            .map((snapshot: any) => snapshot?.goalControlState)
                            .filter((snapshot: unknown) => Boolean(snapshot))
                        : [],
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

    private derivePreviewFromMessages(messages: any[]): string {
        for (const message of messages) {
            if (message?.role !== 'user') continue;
            const text = this.extractTextFromMessage(message);
            if (text) {
                return text.replace(/\s+/g, ' ').trim().slice(0, 120);
            }
        }
        return '';
    }

    private deriveTitleFromMessages(messages: any[]): string {
        const preview = this.derivePreviewFromMessages(messages);
        if (!preview) return 'Imported Chat';
        return preview.length <= 52 ? preview : `${preview.slice(0, 49)}...`;
    }

    private extractTextFromMessage(message: any): string {
        if (typeof message?.content === 'string') {
            return message.content;
        }
        if (Array.isArray(message?.segments)) {
            return message.segments
                .filter((segment: any) => segment?.type === 'content' && typeof segment?.text === 'string')
                .map((segment: any) => segment.text)
                .join(' ')
                .trim();
        }
        return '';
    }

    private sortSessions(sessions: StoredSessionMeta[]): StoredSessionMeta[] {
        return [...sessions].sort((left, right) => {
            if (Boolean(left.archived) !== Boolean(right.archived)) {
                return left.archived ? 1 : -1;
            }
            if (Boolean(left.pinned) !== Boolean(right.pinned)) {
                return left.pinned ? -1 : 1;
            }
            return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        });
    }

    private ensureUniqueSessionId(baseId: string, existingIds: Set<string>): string {
        if (!existingIds.has(baseId)) return baseId;
        let suffix = 2;
        let nextId = `${baseId}-${suffix}`;
        while (existingIds.has(nextId)) {
            suffix += 1;
            nextId = `${baseId}-${suffix}`;
        }
        return nextId;
    }
}
