import { WorkspaceStorage } from './WorkspaceStorage';
import type { LatestTraceSummary, TurnPhase, TurnState, TurnTraceEvent } from './runtimeTypes';

export class TurnTraceService {
    private currentTurnState: TurnState | null;
    private latestSummary: LatestTraceSummary | null;
    private eventCountByTurn = new Map<string, number>();

    constructor(private readonly storage: WorkspaceStorage) {
        this.currentTurnState = this.storage.readTurnState<TurnState | null>(null);
        this.latestSummary = this.storage.readLatestTraceSummary<LatestTraceSummary | null>(null);
        if (this.currentTurnState && isInProgress(this.currentTurnState.phase)) {
            this.currentTurnState = {
                ...this.currentTurnState,
                phase: 'aborted',
                error: this.currentTurnState.error || 'Turn interrupted before completion.',
                finishedAt: Date.now(),
                recoveredFromPreviousRun: true,
            };
            void this.storage.writeTurnState(this.currentTurnState);
        }
    }

    public getCurrentTurnState(): TurnState | null {
        return this.currentTurnState ? { ...this.currentTurnState } : null;
    }

    public getLatestSummary(): LatestTraceSummary | null {
        return this.latestSummary ? { ...this.latestSummary } : null;
    }

    public async startTurn(state: TurnState): Promise<void> {
        this.currentTurnState = { ...state };
        this.eventCountByTurn.set(state.turnId, 0);
        await this.storage.writeTurnState(this.currentTurnState);
        await this.record(state.turnId, state.phase, 'turnStarted', {
            providerId: state.providerId,
            model: state.model,
            budgetState: state.budgetState,
        });
    }

    public async transition(turnId: string, phase: TurnPhase, patch: Partial<TurnState> = {}): Promise<void> {
        if (!this.currentTurnState || this.currentTurnState.turnId !== turnId) return;
        this.currentTurnState = {
            ...this.currentTurnState,
            ...patch,
            phase,
        };
        await this.storage.writeTurnState(this.currentTurnState);
    }

    public async record(turnId: string, phase: TurnPhase, type: string, payload: Record<string, unknown>): Promise<void> {
        const currentCount = (this.eventCountByTurn.get(turnId) ?? 0) + 1;
        this.eventCountByTurn.set(turnId, currentCount);
        const event: TurnTraceEvent = {
            at: Date.now(),
            turnId,
            phase,
            type,
            payload,
        };
        await this.storage.appendTraceEvent(turnId, event);
        if (this.currentTurnState && this.currentTurnState.turnId === turnId) {
            this.latestSummary = {
                turnId,
                providerId: this.currentTurnState.providerId,
                model: this.currentTurnState.model,
                phase,
                startedAt: this.currentTurnState.startedAt,
                finishedAt: this.currentTurnState.finishedAt,
                traceFilePath: this.storage.getTraceFilePath(turnId),
                eventCount: currentCount,
                error: this.currentTurnState.error,
            };
            await this.storage.writeLatestTraceSummary(this.latestSummary);
        }
    }

    public async finish(turnId: string, phase: Extract<TurnPhase, 'completed' | 'failed' | 'aborted'>, patch: Partial<TurnState> = {}): Promise<void> {
        if (!this.currentTurnState || this.currentTurnState.turnId !== turnId) return;
        this.currentTurnState = {
            ...this.currentTurnState,
            ...patch,
            phase,
            finishedAt: patch.finishedAt ?? Date.now(),
        };
        await this.storage.writeTurnState(this.currentTurnState);
        await this.record(turnId, phase, 'turnFinished', {
            error: this.currentTurnState.error,
            finishedAt: this.currentTurnState.finishedAt,
        });
    }
}

function isInProgress(phase: TurnPhase): boolean {
    return phase === 'preflight' || phase === 'llm_request' || phase === 'tool_execution' || phase === 'awaiting_user';
}
