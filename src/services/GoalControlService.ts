import type { GoalControlCheckpoint, GoalControlState, ToolControlState, ToolResultEnvelope } from './runtimeTypes';

type GoalNoticeSeverity = 'info' | 'warning' | 'error';

interface GoalNotice {
    severity: GoalNoticeSeverity;
    message: string;
}

interface GoalControlInit {
    turnId: string;
    userText: string;
    planSummary?: string;
    planTodos?: string;
    previousState?: GoalControlState | null;
}

const MAX_WARNINGS = 6;

export class GoalControlService {
    private readonly state: GoalControlState;
    private readonly toolCounts = new Map<string, number>();
    private readonly hostCounts = new Map<string, number>();
    private readonly failurePatternCounts = new Map<string, number>();
    private readonly pendingNotices: GoalNotice[] = [];
    private readonly warningKeys = new Set<string>();

    constructor(init: GoalControlInit) {
        const activeGoal = deriveGoal(init.planSummary, init.userText, init.previousState?.activeGoal);
        const checkpoints = init.previousState?.checkpoints?.length
            ? cloneCheckpoints(init.previousState.checkpoints)
            : parseCheckpoints(init.planTodos || '');
        this.state = {
            turnId: init.turnId,
            activeGoal,
            checkpoints,
            lastProgressAt: init.previousState?.lastProgressAt,
            lastProgressNote: init.previousState?.lastProgressNote,
            driftWarnings: Array.isArray(init.previousState?.driftWarnings)
                ? [...init.previousState!.driftWarnings].slice(-MAX_WARNINGS)
                : [],
            recoveryHint: init.previousState?.recoveryHint,
            recommendedNextStep: init.previousState?.recommendedNextStep || 'Keep the next action specific and grounded in the latest tool result.',
            driftScore: init.previousState?.driftScore ?? 0,
        };
        for (const warning of this.state.driftWarnings) {
            this.warningKeys.add(warning.toLowerCase());
        }
    }

    public getState(): GoalControlState {
        return {
            ...this.state,
            checkpoints: cloneCheckpoints(this.state.checkpoints),
            driftWarnings: [...this.state.driftWarnings],
        };
    }

    public recordToolStart(toolName: string, args: any, controlState?: ToolControlState | null): GoalControlState {
        const nextToolCount = (this.toolCounts.get(toolName) ?? 0) + 1;
        this.toolCounts.set(toolName, nextToolCount);

        if (nextToolCount >= 3) {
            this.pushWarning(
                `${toolName} has been used ${nextToolCount} times in this turn. Check whether we are drifting instead of making progress.`,
                'warning'
            );
        }

        const host = extractHost(args?.url);
        if (host) {
            const nextHostCount = (this.hostCounts.get(host) ?? 0) + 1;
            this.hostCounts.set(host, nextHostCount);
            if (nextHostCount >= 3) {
                this.pushWarning(
                    `The runtime is over-focusing on ${host}. Summarize what we learned before browsing the same host again.`,
                    'warning'
                );
            }
        }

        this.state.recommendedNextStep = controlState?.recommendedAction
            || `Use the ${toolName} result to decide the next concrete step.`;
        return this.getState();
    }

    public recordToolResult(input: {
        toolName: string;
        args: any;
        result: Pick<ToolResultEnvelope, 'status' | 'summary' | 'failureClass' | 'blocked'>;
        controlState?: ToolControlState | null;
    }): GoalControlState {
        const { toolName, result, controlState } = input;
        const now = Date.now();

        if (result.status === 'success') {
            this.state.lastProgressAt = now;
            this.state.lastProgressNote = result.summary;
            this.state.driftScore = Math.max(0, (this.state.driftScore ?? 0) - 1);
            this.state.recoveryHint = undefined;
            this.state.recommendedNextStep = controlState?.recommendedAction
                || 'Use the newest successful result to narrow the next step.';
            if (toolName === 'attempt_completion') {
                this.state.checkpoints = this.state.checkpoints.map((checkpoint) => ({ ...checkpoint, done: true }));
                this.state.recommendedNextStep = 'Wait for user feedback or the next task.';
            }
            return this.getState();
        }

        const failureKey = `${toolName}:${result.failureClass || 'execution'}`;
        const failureCount = (this.failurePatternCounts.get(failureKey) ?? 0) + 1;
        this.failurePatternCounts.set(failureKey, failureCount);
        this.state.driftScore = Math.min(10, (this.state.driftScore ?? 0) + 2);

        if (failureCount >= 2) {
            this.pushWarning(
                `${toolName} has failed with ${result.failureClass || 'execution'} errors ${failureCount} times. Change strategy instead of repeating the same pattern.`,
                result.blocked ? 'error' : 'warning'
            );
        }

        const latestAlert = controlState?.alerts?.slice(-1)[0];
        if (latestAlert?.message) {
            this.pushWarning(latestAlert.message, latestAlert.severity === 'error' ? 'error' : 'warning');
        }

        this.state.recoveryHint = latestAlert?.suggestedAction
            || controlState?.recommendedAction
            || deriveRecoveryHint(toolName, result.failureClass || 'execution');
        this.state.recommendedNextStep = this.state.recoveryHint;
        this.state.lastProgressNote = result.summary;
        return this.getState();
    }

    public recordTaskNotes(todos: string, summary: string): GoalControlState {
        this.state.checkpoints = parseCheckpoints(todos);
        if (summary.trim()) {
            this.state.activeGoal = summary.trim();
            this.state.lastProgressNote = summary.trim();
        }
        this.state.lastProgressAt = Date.now();
        this.state.recoveryHint = undefined;
        this.state.recommendedNextStep = this.state.checkpoints.some((checkpoint) => !checkpoint.done)
            ? 'Work through the remaining checkpoints in order.'
            : 'Plan is updated. Keep the next action tightly scoped.';
        return this.getState();
    }

    public recordAssistantResponse(summary: string): GoalControlState {
        if (summary.trim()) {
            this.state.lastProgressAt = Date.now();
            this.state.lastProgressNote = summary.trim().slice(0, 180);
        }
        this.state.recoveryHint = undefined;
        this.state.recommendedNextStep = 'Wait for user feedback or continue from the latest response.';
        return this.getState();
    }

    public recordRuntimeFailure(message: string): GoalControlState {
        this.state.driftScore = Math.min(10, (this.state.driftScore ?? 0) + 3);
        this.state.recoveryHint = message;
        this.state.recommendedNextStep = 'Inspect the latest failure, then pick a simpler next step or ask the user for direction.';
        this.pushWarning(message, 'error');
        return this.getState();
    }

    public recordAwaitingUser(reason: string): GoalControlState {
        this.state.recoveryHint = reason;
        this.state.recommendedNextStep = 'Wait for the user response before continuing.';
        return this.getState();
    }

    public flushNotices(): GoalNotice[] {
        const notices = [...this.pendingNotices];
        this.pendingNotices.length = 0;
        return notices;
    }

    private pushWarning(message: string, severity: GoalNoticeSeverity) {
        const normalized = message.trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (!this.warningKeys.has(key)) {
            this.warningKeys.add(key);
            this.state.driftWarnings = [...this.state.driftWarnings, normalized].slice(-MAX_WARNINGS);
        }
        this.pendingNotices.push({ severity, message: normalized });
    }
}

function deriveGoal(planSummary: string | undefined, userText: string, previousGoal?: string): string {
    const summary = (planSummary || '').trim();
    if (summary) return summary;
    const trimmedUserText = userText.trim();
    if (trimmedUserText) {
        const firstSentence = trimmedUserText.split(/[\n.!?]/).map((part) => part.trim()).find(Boolean);
        if (firstSentence) return firstSentence.slice(0, 180);
        return trimmedUserText.slice(0, 180);
    }
    return previousGoal || 'Continue the current coding task.';
}

function parseCheckpoints(todos: string): GoalControlCheckpoint[] {
    if (!todos.trim()) return [];
    const checkpoints = todos
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            const todoMatch = line.match(/^[-*]\s*\[( |x|X)\]\s*(.+)$/);
            if (todoMatch) {
                return {
                    id: `checkpoint-${index + 1}`,
                    label: todoMatch[2].trim(),
                    done: todoMatch[1].toLowerCase() === 'x',
                };
            }
            const numbered = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
            if (numbered) {
                return {
                    id: `checkpoint-${index + 1}`,
                    label: numbered[1].trim(),
                    done: false,
                };
            }
            return null;
        })
        .filter((checkpoint): checkpoint is GoalControlCheckpoint => Boolean(checkpoint));

    return checkpoints.slice(0, 8);
}

function cloneCheckpoints(checkpoints: GoalControlCheckpoint[]): GoalControlCheckpoint[] {
    return checkpoints.map((checkpoint) => ({ ...checkpoint }));
}

function extractHost(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        return new URL(value.trim()).host;
    } catch {
        return '';
    }
}

function deriveRecoveryHint(toolName: string, failureClass: string): string {
    if (failureClass === 'blocked') {
        return 'The current tool path was blocked. Use the latest state to pick a safer or more specific next step.';
    }
    if (toolName.startsWith('browser_')) {
        return 'Browser actions are failing. Re-check the selector, page state, or switch to web_fetch/web_search for a narrower step.';
    }
    if (toolName.startsWith('web_')) {
        return 'The web path is unstable. Reuse the strongest source already fetched or refine the query before trying again.';
    }
    if (toolName === 'run_command') {
        return 'The command path failed. Inspect the output and simplify the command before retrying.';
    }
    return 'The current path is not progressing. Change approach instead of repeating the same tool call.';
}
