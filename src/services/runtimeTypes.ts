import type { ProviderId } from './providerCatalog';
import type { Message, ToolArtifact, ToolExecutionResult, ToolManifest } from '../core/types';

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

export type TurnPhase =
    | 'idle'
    | 'preflight'
    | 'llm_request'
    | 'tool_execution'
    | 'awaiting_user'
    | 'completed'
    | 'failed'
    | 'aborted';

export interface TurnState {
    turnId: string;
    requestId: string;
    providerId: ProviderId;
    model: string;
    phase: TurnPhase;
    iteration: number;
    startedAt: number;
    finishedAt?: number;
    activeToolCallIds: string[];
    budgetState: ContextWindowStats;
    error?: string;
    traceFilePath?: string;
    recoveredFromPreviousRun?: boolean;
}

export interface TurnTraceEvent {
    at: number;
    turnId: string;
    phase: TurnPhase;
    type: string;
    payload: Record<string, unknown>;
}

export interface LatestTraceSummary {
    turnId: string;
    providerId: ProviderId;
    model: string;
    phase: TurnPhase;
    startedAt: number;
    finishedAt?: number;
    traceFilePath: string;
    eventCount: number;
    error?: string;
}

export interface CompactionSnapshot {
    id: string;
    createdAt: string;
    summary: string;
    tokenEstimate: number;
    messageCount: number;
}

export interface RetrievalHit {
    id: string;
    source: 'transcript' | 'snapshot' | 'memory' | 'workspace';
    title: string;
    preview: string;
    score: number;
}

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    sourceHost: string;
    rank: number;
    fetchedAt: string;
    queryIntent: string;
}

export interface WorkspaceMemoryEntry {
    id: string;
    scope: 'session' | 'workspace' | 'preference';
    title: string;
    value: string;
    source: string;
    updatedAt: string;
    reason: string;
}

export interface WorkspaceIndexEntry {
    path: string;
    language: string;
    symbols: string[];
    excerpt: string;
}

export interface WorkspaceIndexState {
    builtAt: string;
    entries: WorkspaceIndexEntry[];
}

export interface ContextArtifact {
    id: string;
    kind: 'system' | 'recent' | 'compacted' | 'retrieval' | 'memory' | 'workspace';
    title: string;
    preview: string;
    tokenEstimate: number;
    included: boolean;
}

export interface ContextPreviewPayload {
    artifacts: ContextArtifact[];
    retrievalHits: RetrievalHit[];
    compactionSnapshotCount: number;
    workspaceMemoryCount: number;
}

export interface ProviderPreflightResult {
    ok: boolean;
    providerId: ProviderId;
    model: string;
    resolvedModel: string;
    warnings: string[];
    errors: string[];
    supportsTools: boolean;
}

export interface ToolControlAlert {
    id: string;
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    toolName?: string;
    suggestedAction?: string;
    createdAt: number;
}

export interface ToolControlState {
    turnId: string;
    totalCalls: number;
    blockedCalls: number;
    consecutiveFailures: number;
    perToolCounts: Record<string, number>;
    webFetchHostCounts: Record<string, number>;
    repeatedCallCounts: Record<string, number>;
    recentActions: Array<{
        toolName: string;
        summary: string;
        status: 'success' | 'error' | 'blocked';
        at: number;
    }>;
    alerts: ToolControlAlert[];
    focus: string;
    recommendedAction: string;
}

export interface ToolControlDecision {
    allowed: boolean;
    stopTurn: boolean;
    alerts: ToolControlAlert[];
    reason?: string;
}

export interface ToolCatalogEntry {
    manifest: ToolManifest;
    description: string;
}

export type ToolFailureClass =
    | 'none'
    | 'validation'
    | 'approval'
    | 'blocked'
    | 'execution'
    | 'provider'
    | 'abort'
    | 'timeout';

export interface ToolApprovalRequest {
    turnId: string;
    toolCallId: string;
    toolName: string;
    args: any;
    manifest: ToolManifest;
    autoApproved: boolean;
}

export interface ToolPolicyDecision {
    manifest: ToolManifest;
    autoApproved: boolean;
    controlDecision: ToolControlDecision;
    requiresApproval: boolean;
}

export interface ToolRetryPolicy {
    maxAttempts: number;
    backoffMs: number;
    retryableFailures: ToolFailureClass[];
}

export interface ToolExecutionContext {
    turnId: string;
    toolCallId: string;
    toolName: string;
    args: any;
    manifest: ToolManifest;
    summary: string;
    startedAt: number;
    autoApproved: boolean;
    controlState: ToolControlState;
}

export interface ToolResultEnvelope extends ToolExecutionResult {
    toolCallId: string;
    historyContent: string;
    failureClass: ToolFailureClass;
    controlState?: ToolControlState | null;
    blocked?: boolean;
    stopTurn?: boolean;
    rawPayload?: unknown;
    [key: string]: unknown;
}

export interface ToolHandler {
    canHandle(toolName: string): boolean;
    validate?(context: ToolExecutionContext): string[];
    preview?(context: ToolExecutionContext): string;
    execute(context: ToolExecutionContext): Promise<string>;
    normalizeResult?(rawResult: string, context: ToolExecutionContext): ToolResultEnvelope;
    buildArtifacts?(rawResult: string, context: ToolExecutionContext): ToolArtifact[];
}

export interface GoalControlCheckpoint {
    id: string;
    label: string;
    done: boolean;
}

export interface GoalControlState {
    turnId?: string;
    activeGoal: string;
    checkpoints: GoalControlCheckpoint[];
    lastProgressAt?: number;
    driftWarnings: string[];
    recoveryHint?: string;
}

export type BrowserActionName =
    | 'navigate'
    | 'click'
    | 'type'
    | 'scroll'
    | 'wait_for_text'
    | 'screenshot'
    | 'console_logs'
    | 'close';

export interface BrowserArtifactEntry {
    id: string;
    sessionId: string;
    kind: 'screenshot' | 'console';
    label: string;
    path: string;
    createdAt: string;
    action: BrowserActionName;
}

export interface BrowserSessionState {
    active: boolean;
    sessionId?: string;
    currentUrl?: string;
    lastAction?: string;
    artifactCount: number;
    lastActionAt?: number;
    lastArtifactPath?: string;
    lastError?: string;
    consoleMessageCount?: number;
}

export interface MessageStateSnapshot {
    conversationHistory: Message[];
    transcriptHistory: Message[];
    mode: string;
    model: string;
    planTodos: string;
    planSummary: string;
    compactedContextSummary?: string;
    lastCompactionAt?: number | null;
    compactedMessageCount?: number;
    compactionSnapshots?: CompactionSnapshot[];
    savedAt: string;
}

export interface RuntimeSnapshot {
    capturedAt: string;
    turnState?: TurnState | null;
    latestTrace?: LatestTraceSummary | null;
    toolControlState?: ToolControlState | null;
    goalControlState?: GoalControlState | null;
    browserSessionState?: BrowserSessionState | null;
}

export interface StoredSessionHistory {
    schemaVersion: number;
    messages: any[];
    messageState: MessageStateSnapshot;
    runtimeSnapshots: RuntimeSnapshot[];
    browserArtifactsIndex: BrowserArtifactEntry[];
    goalSnapshots: GoalControlState[];
    savedAt: string;
}
