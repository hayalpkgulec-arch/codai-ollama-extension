import type { ToolManifest } from '../core/types';
import type { ToolControlAlert, ToolControlDecision, ToolControlState } from './runtimeTypes';

type ExecutionStatus = 'success' | 'error' | 'blocked';

interface ToolControlBudgets {
    maxToolCalls: number;
    maxConsecutiveFailures: number;
    maxIdenticalCalls: number;
    maxWebFetchPerHost: number;
    maxRepeatedWebFetchUrl: number;
}

const DEFAULT_BUDGETS: ToolControlBudgets = {
    maxToolCalls: 14,
    maxConsecutiveFailures: 3,
    maxIdenticalCalls: 2,
    maxWebFetchPerHost: 3,
    maxRepeatedWebFetchUrl: 2,
};

export class ToolControlService {
    private readonly budgets: ToolControlBudgets;
    private readonly state: ToolControlState;
    private readonly perSignatureCounts = new Map<string, number>();
    private readonly perUrlCounts = new Map<string, number>();

    constructor(turnId: string, budgets?: Partial<ToolControlBudgets>) {
        this.budgets = { ...DEFAULT_BUDGETS, ...budgets };
        this.state = {
            turnId,
            totalCalls: 0,
            blockedCalls: 0,
            consecutiveFailures: 0,
            perToolCounts: {},
            webFetchHostCounts: {},
            repeatedCallCounts: {},
            recentActions: [],
            alerts: [],
            focus: 'Waiting for the next tool step.',
            recommendedAction: 'Proceed carefully and avoid repeating the same tool without new information.',
        };
    }

    public beforeToolExecution(toolName: string, args: any, manifest: ToolManifest): ToolControlDecision {
        const alerts: ToolControlAlert[] = [];
        const signature = `${toolName}:${stableStringify(args)}`;
        const nextToolCount = (this.state.perToolCounts[toolName] ?? 0) + 1;
        const nextSignatureCount = (this.perSignatureCounts.get(signature) ?? 0) + 1;

        if (this.state.totalCalls >= this.budgets.maxToolCalls) {
            alerts.push(this.createAlert('error', 'tool-budget-exceeded', `Tool budget reached for this turn. Stop using tools and summarize progress instead.`, toolName, 'Summarize findings or ask the user for direction.'));
        }

        if (nextSignatureCount > this.budgets.maxIdenticalCalls) {
            alerts.push(this.createAlert('error', 'duplicate-tool-call', `${toolName} is repeating the exact same arguments too many times.`, toolName, 'Use the latest result, change the query, or ask a follow-up question.'));
        } else if (nextToolCount > Math.max(3, this.budgets.maxIdenticalCalls + 1)) {
            alerts.push(this.createAlert('warning', 'repeated-tool-family', `${toolName} is being used repeatedly in this turn.`, toolName, 'Check whether the previous result already contains what you need.'));
        }

        if (toolName === 'web_fetch') {
            const normalizedUrl = normalizeUrl(args?.url);
            const host = getHost(normalizedUrl);
            if (normalizedUrl) {
                const nextUrlCount = (this.perUrlCounts.get(normalizedUrl) ?? 0) + 1;
                if (nextUrlCount > this.budgets.maxRepeatedWebFetchUrl) {
                    alerts.push(this.createAlert('error', 'duplicate-web-fetch', `The same URL is being fetched repeatedly: ${normalizedUrl}`, toolName, 'Reuse the earlier fetch, refine the question, or move on.'));
                }
            }
            if (host) {
                const nextHostCount = (this.state.webFetchHostCounts[host] ?? 0) + 1;
                if (nextHostCount > this.budgets.maxWebFetchPerHost) {
                    alerts.push(this.createAlert('warning', 'web-fetch-host-budget', `Browsing is over-focused on ${host}.`, toolName, 'Summarize what you learned before fetching more from the same host.'));
                }
            }
        }

        if (this.state.consecutiveFailures >= this.budgets.maxConsecutiveFailures) {
            alerts.push(this.createAlert('error', 'failure-streak', `The agent has hit ${this.state.consecutiveFailures} tool failures in a row.`, toolName, 'Stop and reassess instead of continuing the same pattern.'));
        }

        const blockingAlerts = alerts.filter((alert) => alert.severity === 'error');
        if (blockingAlerts.length > 0) {
            this.state.blockedCalls += 1;
            this.pushAlerts(blockingAlerts);
            this.recordAction(toolName, `${toolName} blocked`, 'blocked');
            this.state.focus = `Blocked ${toolName} to prevent repeated or unsafe tool usage.`;
            this.state.recommendedAction = blockingAlerts[0]?.suggestedAction || this.state.recommendedAction;
            return {
                allowed: false,
                stopTurn: blockingAlerts.some((alert) => alert.code === 'tool-budget-exceeded' || alert.code === 'failure-streak'),
                alerts: blockingAlerts,
                reason: blockingAlerts.map((alert) => alert.message).join(' '),
            };
        }

        this.state.totalCalls += 1;
        this.state.perToolCounts[toolName] = nextToolCount;
        this.perSignatureCounts.set(signature, nextSignatureCount);
        this.state.repeatedCallCounts[signature] = nextSignatureCount;

        if (toolName === 'web_fetch') {
            const normalizedUrl = normalizeUrl(args?.url);
            const host = getHost(normalizedUrl);
            if (normalizedUrl) {
                this.perUrlCounts.set(normalizedUrl, (this.perUrlCounts.get(normalizedUrl) ?? 0) + 1);
            }
            if (host) {
                this.state.webFetchHostCounts[host] = (this.state.webFetchHostCounts[host] ?? 0) + 1;
                this.state.focus = `Inspecting external source ${host}.`;
                this.state.recommendedAction = 'After this fetch, summarize the source before browsing further.';
            }
        } else {
            this.state.focus = describeFocus(toolName, args);
            this.state.recommendedAction = `Use the ${toolName} result to make the next step more specific.`;
        }

        const warningAlerts = alerts.filter((alert) => alert.severity !== 'error');
        if (warningAlerts.length > 0) {
            this.pushAlerts(warningAlerts);
        }

        return {
            allowed: true,
            stopTurn: false,
            alerts: warningAlerts,
        };
    }

    public afterToolExecution(toolName: string, args: any, status: ExecutionStatus, summary: string): ToolControlState {
        this.recordAction(toolName, summary, status);
        if (status === 'error' || status === 'blocked') {
            this.state.consecutiveFailures += 1;
            this.state.focus = `Recovering after ${toolName} failed.`;
            this.state.recommendedAction = 'Change approach, inspect the last error, or ask the user instead of repeating the same step.';
        } else {
            this.state.consecutiveFailures = 0;
            if (toolName === 'web_fetch') {
                const host = getHost(normalizeUrl(args?.url));
                this.state.focus = host
                    ? `External source ${host} fetched successfully.`
                    : 'External source fetched successfully.';
                this.state.recommendedAction = 'Use the fetched source to answer or decide the next concrete action.';
            } else {
                this.state.focus = `${toolName} completed successfully.`;
                this.state.recommendedAction = 'Build the next step from the newest tool output.';
            }
        }

        return this.getState();
    }

    public getState(): ToolControlState {
        return {
            ...this.state,
            perToolCounts: { ...this.state.perToolCounts },
            webFetchHostCounts: { ...this.state.webFetchHostCounts },
            repeatedCallCounts: { ...this.state.repeatedCallCounts },
            recentActions: [...this.state.recentActions],
            alerts: [...this.state.alerts],
        };
    }

    private createAlert(
        severity: ToolControlAlert['severity'],
        code: string,
        message: string,
        toolName?: string,
        suggestedAction?: string,
    ): ToolControlAlert {
        return {
            id: `${code}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            severity,
            code,
            message,
            toolName,
            suggestedAction,
            createdAt: Date.now(),
        };
    }

    private pushAlerts(alerts: ToolControlAlert[]) {
        this.state.alerts = [...this.state.alerts, ...alerts].slice(-8);
    }

    private recordAction(toolName: string, summary: string, status: ExecutionStatus) {
        this.state.recentActions = [
            ...this.state.recentActions,
            { toolName, summary, status, at: Date.now() },
        ].slice(-8);
    }
}

function normalizeUrl(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        return new URL(value.trim()).toString();
    } catch {
        return '';
    }
}

function getHost(value: string): string {
    if (!value) return '';
    try {
        return new URL(value).host;
    } catch {
        return '';
    }
}

function describeFocus(toolName: string, args: any): string {
    if (toolName === 'run_command') {
        return `Running ${String(args?.command || '').slice(0, 48) || 'workspace command'}.`;
    }
    if (typeof args?.path === 'string' && args.path) {
        return `${toolName} on ${args.path}.`;
    }
    return `Working through ${toolName}.`;
}

function stableStringify(value: unknown): string {
    if (value == null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
        .join(',')}}`;
}
