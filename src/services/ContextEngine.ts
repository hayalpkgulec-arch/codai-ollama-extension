import type { Message } from '../core/types';
import type {
    CompactionSnapshot,
    ContextArtifact,
    ContextWindowStats,
    ContextPreviewPayload,
    RetrievalHit,
    WorkspaceIndexState,
    WorkspaceMemoryEntry,
} from './runtimeTypes';
import { WorkspaceIndexService } from './WorkspaceIndexService';

const MAX_SUMMARY_CHARS = 48_000;
const MIN_MESSAGES_TO_KEEP = 8;
const indexService = new WorkspaceIndexService();

type CompactParams = {
    conversationHistory: Message[];
    transcriptHistory: Message[];
    compactedContextSummary: string;
    snapshots: CompactionSnapshot[];
    workspaceMemory: WorkspaceMemoryEntry[];
    workspaceIndex?: WorkspaceIndexState;
    maxContextTokens: number;
    query?: string;
    lastCompactionAt: number | null;
    compactedMessageCount: number;
};

export interface ContextEngineResult {
    conversationHistory: Message[];
    compactedContextSummary: string;
    snapshots: CompactionSnapshot[];
    retrievalHits: RetrievalHit[];
    preview: ContextPreviewPayload;
    stats: ContextWindowStats;
    lastCompactionAt: number | null;
    compactedMessageCount: number;
}

export function estimateTokenCountForMessages(messages: Message[], maxContextTokens: number, lastCompactionAt: number | null, compactedMessageCount: number): ContextWindowStats {
    const contextChars = messages.reduce((acc, message) => acc + messageSize(message), 0);
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
        lastCompactionAt,
        compactedMessageCount,
    };
}

export function buildWorkspaceMemory(indexedProjectContext: string, planSummary: string): WorkspaceMemoryEntry[] {
    const now = new Date().toISOString();
    const memories: WorkspaceMemoryEntry[] = [];
    if (indexedProjectContext.trim()) {
        memories.push({
            id: 'workspace:project-summary',
            scope: 'workspace',
            title: 'Project summary',
            value: indexedProjectContext.trim(),
            source: 'project-index',
            updatedAt: now,
            reason: 'Keeps the agent aware of project structure.',
        });
    }
    if (planSummary.trim()) {
        memories.push({
            id: 'workspace:plan-summary',
            scope: 'session',
            title: 'Latest plan summary',
            value: planSummary.trim(),
            source: 'plan-mode',
            updatedAt: now,
            reason: 'Carries recent planning decisions into long-running tasks.',
        });
    }
    return memories;
}

export function compactConversation(params: CompactParams): ContextEngineResult {
    const maxContextTokens = Math.max(32_000, params.maxContextTokens || 80_000);
    const hardLimitChars = Math.floor(maxContextTokens * 4 * 0.82);
    const targetChars = Math.floor(maxContextTokens * 4 * 0.68);

    let conversationHistory = [...params.conversationHistory];
    let compactedContextSummary = params.compactedContextSummary;
    let snapshots = [...params.snapshots];
    let compactedMessageCount = params.compactedMessageCount;
    let lastCompactionAt = params.lastCompactionAt;

    let totalChars = conversationHistory.reduce((acc, message) => acc + messageSize(message), 0);
    if (totalChars > hardLimitChars) {
        const systemMessage = conversationHistory[0]?.role === 'system' ? conversationHistory[0] : null;
        const nonSystem = systemMessage ? conversationHistory.slice(1) : [...conversationHistory];
        const removedBatch: Message[] = [];

        while (nonSystem.length > MIN_MESSAGES_TO_KEEP && totalChars > targetChars) {
            const removed = nonSystem.shift();
            if (!removed) break;
            removedBatch.push(removed);
            totalChars -= messageSize(removed);
        }

        if (removedBatch.length > 0) {
            const snapshot = buildSnapshot(removedBatch);
            snapshots = [...snapshots.slice(-24), snapshot];
            compactedContextSummary = appendCompactedSummary(compactedContextSummary, snapshot.summary);
            lastCompactionAt = Date.now();
            compactedMessageCount += removedBatch.length;
            conversationHistory = systemMessage ? [systemMessage, ...nonSystem] : nonSystem;
        }
    }

    const retrievalHits = buildRetrievalHits(
        params.query || '',
        params.transcriptHistory,
        snapshots,
        params.workspaceMemory,
        params.workspaceIndex
    );
    const stats = estimateTokenCountForMessages(
        conversationHistory,
        maxContextTokens,
        lastCompactionAt,
        compactedMessageCount
    );
    const preview = buildContextPreview(
        conversationHistory,
        compactedContextSummary,
        retrievalHits,
        params.workspaceMemory,
        stats
    );

    return {
        conversationHistory,
        compactedContextSummary,
        snapshots,
        retrievalHits,
        preview,
        stats,
        lastCompactionAt,
        compactedMessageCount,
    };
}

export function buildRetrievedContextPrompt(retrievalHits: RetrievalHit[]): string {
    if (retrievalHits.length === 0) return '';
    const body = retrievalHits
        .map((hit) => `- [${hit.source}] ${hit.title}: ${hit.preview}`)
        .join('\n');
    return `\n\n<retrieved_context>\nRelevant earlier context recovered for the current turn:\n${body}\n</retrieved_context>`;
}

function buildContextPreview(
    conversationHistory: Message[],
    compactedContextSummary: string,
    retrievalHits: RetrievalHit[],
    workspaceMemory: WorkspaceMemoryEntry[],
    stats: ContextWindowStats
): ContextPreviewPayload {
    const artifacts: ContextArtifact[] = [];

    const systemMessage = conversationHistory.find((message) => message.role === 'system');
    if (systemMessage?.content) {
        artifacts.push({
            id: 'context:system',
            kind: 'system',
            title: 'System prompt',
            preview: systemMessage.content.slice(0, 180),
            tokenEstimate: Math.round(systemMessage.content.length / 4),
            included: true,
        });
    }

    const recentPreview = conversationHistory
        .filter((message) => message.role !== 'system')
        .slice(-6)
        .map((message) => `${message.role}: ${typeof message.content === 'string' ? message.content.replace(/\s+/g, ' ').slice(0, 80) : '(structured)'}`)
        .join('\n');
    if (recentPreview) {
        artifacts.push({
            id: 'context:recent',
            kind: 'recent',
            title: 'Recent conversation window',
            preview: recentPreview,
            tokenEstimate: Math.round(recentPreview.length / 4),
            included: true,
        });
    }

    if (compactedContextSummary.trim()) {
        artifacts.push({
            id: 'context:compacted',
            kind: 'compacted',
            title: 'Compacted summary',
            preview: compactedContextSummary.slice(0, 220),
            tokenEstimate: Math.round(compactedContextSummary.length / 4),
            included: true,
        });
    }

    for (const hit of retrievalHits.slice(0, 4)) {
        artifacts.push({
            id: `context:retrieval:${hit.id}`,
            kind: 'retrieval',
            title: hit.title,
            preview: hit.preview,
            tokenEstimate: Math.round(hit.preview.length / 4),
            included: true,
        });
    }

    for (const memory of workspaceMemory.slice(0, 4)) {
        artifacts.push({
            id: `context:memory:${memory.id}`,
            kind: 'memory',
            title: memory.title,
            preview: memory.value.slice(0, 180),
            tokenEstimate: Math.round(memory.value.length / 4),
            included: true,
        });
    }

    return {
        artifacts: artifacts.slice(0, 12),
        retrievalHits,
        compactionSnapshotCount: compactedContextSummary.trim() ? 1 : 0,
        workspaceMemoryCount: workspaceMemory.length,
    };
}

function buildRetrievalHits(
    query: string,
    transcriptHistory: Message[],
    snapshots: CompactionSnapshot[],
    workspaceMemory: WorkspaceMemoryEntry[],
    workspaceIndex?: WorkspaceIndexState
): RetrievalHit[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const hits: RetrievalHit[] = [];
    for (const message of transcriptHistory.slice(0, -8)) {
        const text = `${message.role} ${typeof message.content === 'string' ? message.content : ''}`.replace(/\s+/g, ' ');
        const score = scoreTerms(terms, text);
        if (score > 0) {
            hits.push({
                id: `transcript:${hits.length}`,
                source: 'transcript',
                title: `${message.role} turn`,
                preview: text.slice(0, 180),
                score,
            });
        }
    }

    for (const snapshot of snapshots.slice(-6)) {
        const score = scoreTerms(terms, snapshot.summary);
        if (score > 0) {
            hits.push({
                id: snapshot.id,
                source: 'snapshot',
                title: `Compaction snapshot ${snapshot.createdAt.slice(11, 19)}`,
                preview: snapshot.summary.slice(0, 180),
                score,
            });
        }
    }

    for (const memory of workspaceMemory) {
        const score = scoreTerms(terms, `${memory.title} ${memory.value}`);
        if (score > 0) {
            hits.push({
                id: memory.id,
                source: 'memory',
                title: memory.title,
                preview: memory.value.slice(0, 180),
                score,
            });
        }
    }

    hits.push(...indexService.search(workspaceIndex, query, 3));

    return hits
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);
}

function buildSnapshot(messages: Message[]): CompactionSnapshot {
    const createdAt = new Date().toISOString();
    const summary = messages
        .map((message) => `- ${message.role.toUpperCase()}: ${typeof message.content === 'string' ? message.content.replace(/\s+/g, ' ').slice(0, 220) : '(structured)'}`)
        .join('\n');
    return {
        id: `snapshot:${Date.now()}`,
        createdAt,
        summary,
        tokenEstimate: Math.round(summary.length / 4),
        messageCount: messages.length,
    };
}

function appendCompactedSummary(current: string, nextSnapshotSummary: string): string {
    const merged = [current.trim(), nextSnapshotSummary.trim()].filter(Boolean).join('\n\n');
    return merged.length > MAX_SUMMARY_CHARS
        ? merged.slice(-MAX_SUMMARY_CHARS)
        : merged;
}

function messageSize(message: Message): number {
    let total = typeof message.content === 'string' ? message.content.length : 0;
    if (Array.isArray(message.tool_calls)) total += JSON.stringify(message.tool_calls).length;
    if (typeof message.tool_call_id === 'string') total += message.tool_call_id.length;
    if (typeof message.name === 'string') total += message.name.length;
    return total;
}

function tokenize(text: string): string[] {
    return Array.from(new Set(text
        .toLowerCase()
        .split(/[^a-z0-9_./:-]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3)));
}

function scoreTerms(terms: string[], haystack: string): number {
    const normalized = haystack.toLowerCase();
    return terms.reduce((acc, term) => acc + (normalized.includes(term) ? 1 : 0), 0);
}
