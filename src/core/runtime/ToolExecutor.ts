import type { Message } from '../types';
import type { ToolRegistry } from '../../tools/core/ToolRegistry';
import { ToolControlService } from '../../services/ToolControlService';
import type { ToolExecutionContext, ToolHandler, ToolResultEnvelope } from '../../services/runtimeTypes';
import { RuntimeEventBus } from './RuntimeEventBus';
import { ToolPolicyService } from './ToolPolicyService';
import {
    attachCheckpointsToToolResult,
    buildToolSummary,
    classifyToolFailure,
    compactToolResult,
    createBlockedToolEnvelope,
    createValidationToolEnvelope,
    normalizeToolResult,
} from './RuntimeUtils';

type CheckpointEntry = {
    id: string;
    timestamp: string;
    filePath: string;
    originalPath: string;
    toolName: string;
};

export interface ExecuteToolCallInput {
    turnId: string;
    iteration: number;
    toolCallId: string;
    toolName: string;
    toolArgs: any;
    toolControl: ToolControlService;
}

export interface ExecuteToolCallOutput {
    phaseId: string;
    toolName: string;
    toolArgs: any;
    manifest: ToolExecutionContext['manifest'];
    preHistoryMessages: Message[];
    result: ToolResultEnvelope;
}

interface ToolExecutorOptions {
    registry: ToolRegistry;
    policyService: ToolPolicyService;
    eventBus: RuntimeEventBus;
    createCheckpoints: (toolName: string, args: any) => Promise<CheckpointEntry[]>;
    hasRunningBgProcesses: () => boolean;
    getRunningBgProcesses: () => Array<{ command?: string; bgId?: string }>;
}

class RegistryToolHandler implements ToolHandler {
    constructor(private readonly registry: ToolRegistry) {}

    public canHandle(_toolName: string): boolean {
        return true;
    }

    public validate(context: ToolExecutionContext): string[] {
        return this.registry.getTool(context.toolName) ? [] : [`Unknown tool: ${context.toolName}`];
    }

    public async execute(context: ToolExecutionContext): Promise<string> {
        return this.registry.executeTool(context.toolName, context.args);
    }
}

export class ToolExecutor {
    private readonly handlers: ToolHandler[];
    private readonly registry: ToolRegistry;

    constructor(private readonly options: ToolExecutorOptions) {
        this.registry = options.registry;
        this.handlers = [new RegistryToolHandler(this.registry)];
    }

    public async executeToolCall(input: ExecuteToolCallInput): Promise<ExecuteToolCallOutput> {
        const { turnId, iteration, toolCallId, toolName, toolArgs, toolControl } = input;
        const policy = this.options.policyService.evaluate(toolControl, toolName, toolArgs);
        const manifest = policy.manifest;
        const startedAt = Date.now();
        const summary = buildToolSummary(toolName, toolArgs);
        const phaseId = `tool-${toolCallId || `${iteration}-${toolName}-${startedAt}-${Math.random().toString(36).slice(2, 6)}`}`;
        const controlStateBeforeExecution = toolControl.getState();

        this.options.eventBus.emitToolControlState(turnId, controlStateBeforeExecution);
        if (policy.controlDecision.alerts.length > 0) {
            this.options.eventBus.emitToolControlNotice(
                turnId,
                policy.controlDecision.alerts.map((alert) => alert.message).join(' '),
                policy.controlDecision.alerts.some((alert) => alert.severity === 'error') ? 'error' : 'warning'
            );
        }

        this.options.eventBus.emit(turnId, 'toolActivityStart', {
            phaseId,
            toolName,
            args: toolArgs,
            status: 'running',
            summary,
            startedAt,
            toolCallId,
            autoApproved: policy.autoApproved,
            manifest,
            controlState: controlStateBeforeExecution,
            approval: {
                requiresApproval: policy.requiresApproval,
                autoApproved: policy.autoApproved,
            },
        });

        if (!policy.controlDecision.allowed) {
            const blockedReason = policy.controlDecision.reason || `${toolName} was blocked by tool controls.`;
            const blockedResult = JSON.stringify({
                __tool: 'tool_control',
                status: 'error',
                summary: `Blocked ${toolName}`,
                toolName,
                reason: blockedReason,
                alerts: policy.controlDecision.alerts,
                recommendedAction: controlStateBeforeExecution.recommendedAction,
            });
            const blockedState = toolControl.afterToolExecution(toolName, toolArgs, 'blocked', blockedReason);
            const envelope = createBlockedToolEnvelope({
                toolCallId,
                toolName,
                summary,
                startedAt,
                manifest,
                rawResult: blockedResult,
                reason: blockedReason,
                controlState: blockedState,
                stopTurn: policy.controlDecision.stopTurn,
            });
            this.options.eventBus.emitToolControlState(turnId, blockedState);
            this.options.eventBus.emit(turnId, 'toolActivityError', {
                phaseId,
                toolCallId,
                toolName,
                status: 'error',
                summary: envelope.summary,
                rawResult: envelope.rawResult,
                startedAt,
                finishedAt: envelope.finishedAt,
                durationMs: envelope.durationMs,
                manifest,
                controlState: blockedState,
                errorMessage: blockedReason,
            });
            return {
                phaseId,
                toolName,
                toolArgs,
                manifest,
                preHistoryMessages: [],
                result: envelope,
            };
        }

        const handler = this.handlers.find((candidate) => candidate.canHandle(toolName));
        const executionContext: ToolExecutionContext = {
            turnId,
            toolCallId,
            toolName,
            args: toolArgs,
            manifest,
            summary,
            startedAt,
            autoApproved: policy.autoApproved,
            controlState: controlStateBeforeExecution,
        };
        const validationErrors = handler?.validate?.(executionContext) ?? [];
        if (validationErrors.length > 0) {
            const message = validationErrors.join(' ');
            const validationEnvelope = createValidationToolEnvelope({
                toolCallId,
                toolName,
                summary,
                startedAt,
                manifest,
                message,
                controlState: toolControl.afterToolExecution(toolName, toolArgs, 'error', message),
            });
            this.options.eventBus.emit(turnId, 'toolActivityError', {
                phaseId,
                toolCallId,
                ...validationEnvelope,
                manifest,
                controlState: validationEnvelope.controlState,
            });
            this.options.eventBus.emitToolControlState(turnId, validationEnvelope.controlState ?? null);
            return {
                phaseId,
                toolName,
                toolArgs,
                manifest,
                preHistoryMessages: [],
                result: validationEnvelope,
            };
        }

        const checkpoints = await this.options.createCheckpoints(toolName, toolArgs);
        if (checkpoints.length > 0) {
            this.options.eventBus.emit(turnId, 'checkpointSaved', {
                phaseId,
                checkpoints,
                toolName,
            });
        }

        const preHistoryMessages: Message[] = [];
        if (toolName === 'run_command' && this.options.hasRunningBgProcesses()) {
            const running = this.options.getRunningBgProcesses();
            const names = running.map((entry) => entry.command || entry.bgId).join(', ');
            preHistoryMessages.push({
                role: 'tool',
                content: `WARNING: There is already a background process running (${names}). Stop it first with killBgProcess before starting a new long-running process. If this is a short command (npm install, tsc, etc.) it is safe to proceed.`,
                tool_call_id: toolCallId,
            });
        }

        const rawResult = await (handler?.execute(executionContext) ?? this.registry.executeTool(toolName, toolArgs));
        const resultWithCheckpoints = attachCheckpointsToToolResult(rawResult, checkpoints);
        const normalized = (handler?.normalizeResult?.(resultWithCheckpoints, executionContext)
            ?? normalizeToolResult(resultWithCheckpoints, toolName, summary, startedAt, manifest));
        normalized.toolCallId = toolCallId;
        normalized.historyContent = compactToolResult(resultWithCheckpoints, toolName);
        normalized.checkpointRefs = normalized.checkpointRefs
            ?? checkpoints.map((checkpoint) => checkpoint.id).filter(Boolean);
        normalized.failureClass = classifyToolFailure(normalized);

        const toolControlState = toolControl.afterToolExecution(
            toolName,
            toolArgs,
            normalized.status === 'error' ? 'error' : 'success',
            normalized.summary,
        );
        normalized.controlState = toolControlState;
        this.options.eventBus.emitToolControlState(turnId, toolControlState);

        if (normalized.status === 'error') {
            this.options.eventBus.emit(turnId, 'toolActivityError', {
                phaseId,
                toolCallId,
                ...normalized,
                manifest,
                controlState: toolControlState,
            });
        } else {
            this.options.eventBus.emit(turnId, 'toolActivityDone', {
                phaseId,
                toolCallId,
                ...normalized,
                manifest,
                controlState: toolControlState,
            });
        }

        if (normalized.browserSessionState) {
            this.options.eventBus.emit(turnId, 'browserSessionState', normalized.browserSessionState);
        }

        return {
            phaseId,
            toolName,
            toolArgs,
            manifest,
            preHistoryMessages,
            result: normalized,
        };
    }
}
