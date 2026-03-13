import type { ProviderId } from '../../services/providerCatalog';
import type { TurnPhase } from '../../services/runtimeTypes';
import { GoalControlService } from '../../services/GoalControlService';
import { ToolControlService } from '../../services/ToolControlService';
import { globalToolRegistry } from '../../tools/index';
import type { LLMService } from '../../services/LLMService';
import type { ProviderPreflight } from '../../services/ProviderPreflight';
import type { TurnTraceService } from '../../services/TurnTraceService';
import type { WorkspaceManager } from '../../services/WorkspaceManager';
import type { WorkspaceStorage } from '../../services/WorkspaceStorage';
import { RuntimeEventBus } from './RuntimeEventBus';
import { ToolExecutor } from './ToolExecutor';
import { normalizeToolCall, parseToolArguments } from './RuntimeUtils';

const MAX_RATE_LIMIT_RETRIES = 4;
const STOP_TOOLS = ['ask_followup_question', 'ask_followup_questions'];

interface TaskRuntimeOptions {
    storage: WorkspaceStorage;
    workspaceManager: WorkspaceManager;
    llmService: LLMService;
    preflight: ProviderPreflight;
    traceService: TurnTraceService;
    eventBus: RuntimeEventBus;
    toolExecutor: ToolExecutor;
    buildEnvDetails: () => string;
}

export class TaskRuntime {
    constructor(private readonly options: TaskRuntimeOptions) {}

    public async runTurn(message: string, turnRequestId: string, abortSignal?: AbortSignal): Promise<void> {
        const startedAt = Date.now();
        const providerState = this.options.workspaceManager.getProviderState();
        this.options.eventBus.emit(turnRequestId, 'turnStart', { userText: message, startedAt });
        await this.options.traceService.startTurn({
            turnId: turnRequestId,
            requestId: turnRequestId,
            providerId: providerState.providerId as ProviderId,
            model: this.options.workspaceManager.getDefaultModel(),
            phase: 'preflight',
            iteration: 0,
            startedAt,
            activeToolCallIds: [],
            budgetState: this.options.workspaceManager.estimateTokenCount(),
            traceFilePath: this.options.storage.getTraceFilePath(turnRequestId),
        });
        this.emitCurrentTurnState(turnRequestId);
        const goalControl = new GoalControlService({
            turnId: turnRequestId,
            userText: message,
            planSummary: this.options.workspaceManager.getPlanSummary(),
            planTodos: this.options.workspaceManager.getPlanTodos(),
        });
        this.emitGoalControlUpdate(turnRequestId, goalControl);

        try {
            const envDetails = this.options.buildEnvDetails();
            const messageWithEnv = envDetails ? `${message}\n\n${envDetails}` : message;

            const allowedTools = globalToolRegistry.getAllToolDefinitions().filter((tool) => {
                const allowed = this.options.workspaceManager.getAllowedToolNames();
                if (allowed === null) return true;
                return allowed.includes(tool.name);
            });
            const preflight = this.options.preflight.validateRequest({
                providerId: providerState.providerId as ProviderId,
                model: this.options.workspaceManager.getDefaultModel(),
                baseUrl: providerState.baseUrl,
                apiKey: providerState.apiKey,
                apiKeys: providerState.apiKeys,
                requiresTools: allowedTools.length > 0 && this.options.workspaceManager.getMode() !== 'chat',
                dynamicModels: this.options.workspaceManager.getProviderModelCatalog(providerState.providerId as ProviderId),
            });

            if (!preflight.ok) {
                goalControl.recordRuntimeFailure(preflight.errors.join(' '));
                this.emitGoalControlUpdate(turnRequestId, goalControl);
                this.options.eventBus.emit(turnRequestId, 'preflightWarning', {
                    severity: 'error',
                    warnings: preflight.warnings,
                    errors: preflight.errors,
                    model: preflight.resolvedModel,
                });
                await this.options.traceService.finish(turnRequestId, 'failed', {
                    error: preflight.errors.join(' '),
                    budgetState: this.options.workspaceManager.estimateTokenCount(),
                });
                this.emitCurrentTurnState(turnRequestId);
                this.options.eventBus.emit(turnRequestId, 'error', { message: preflight.errors.join(' ') });
                await this.emitTerminalTurnUpdates(turnRequestId);
                return;
            }

            if (preflight.warnings.length > 0) {
                this.options.eventBus.emit(turnRequestId, 'preflightWarning', {
                    severity: 'warning',
                    warnings: preflight.warnings,
                    errors: [],
                    model: preflight.resolvedModel,
                });
            }

            this.options.workspaceManager.appendToHistory({ role: 'user', content: messageWithEnv });
            await this.options.workspaceManager.persistState();

            const toolControl = new ToolControlService(turnRequestId);
            this.options.eventBus.emitToolControlState(turnRequestId, toolControl.getState());

            let continueLoop = true;
            let iteration = 0;
            let activePhaseId = `pre-${turnRequestId}`;
            const maxIterations = this.options.workspaceManager.getMode() === 'plan' ? 6 : 12;
            let lastTaskNotesContent = '';
            let rateLimitRetries = 0;

            while (continueLoop && iteration < maxIterations) {
                iteration += 1;
                let lastThinkingSnapshot = '';
                let lastContentSnapshot = '';
                let response: any;

                try {
                    await this.transitionTurnPhase(turnRequestId, 'llm_request', {
                        iteration,
                        budgetState: this.options.workspaceManager.estimateTokenCount(),
                        activeToolCallIds: [],
                    });
                    response = await this.options.llmService.chatWithTools(
                        this.options.workspaceManager.getDefaultModel(),
                        this.options.workspaceManager.getConversationHistory(),
                        allowedTools,
                        (thinking) => {
                            const nextThinking = typeof thinking === 'string' ? thinking : '';
                            const delta = nextThinking.startsWith(lastThinkingSnapshot)
                                ? nextThinking.slice(lastThinkingSnapshot.length)
                                : nextThinking;
                            lastThinkingSnapshot = nextThinking;
                            if (!delta) return;
                            this.options.eventBus.emit(turnRequestId, 'thinking', {
                                phaseId: activePhaseId,
                                content: nextThinking,
                            });
                        },
                        (content) => {
                            const nextContent = typeof content === 'string' ? content : '';
                            lastContentSnapshot = nextContent;
                            this.options.eventBus.emit(turnRequestId, 'contentChunk', { content: nextContent });
                        },
                        abortSignal
                    );
                    rateLimitRetries = 0;
                } catch (llmError: any) {
                    const messageText = llmError?.message || '';
                    const isAbort = llmError?.name === 'AbortError' || messageText.includes('aborted');
                    const isRateLimit = isRateLimitError(messageText);

                    if (isAbort) {
                        goalControl.recordRuntimeFailure(messageText || 'Task aborted');
                        this.emitGoalControlUpdate(turnRequestId, goalControl);
                        await this.options.traceService.finish(turnRequestId, 'aborted', {
                            error: messageText || 'Task aborted',
                            budgetState: this.options.workspaceManager.estimateTokenCount(),
                        });
                        this.emitCurrentTurnState(turnRequestId);
                        continueLoop = false;
                        break;
                    }

                    if (isRateLimit && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
                        rateLimitRetries += 1;
                        const waitMs = Math.min(15000 * Math.pow(2, rateLimitRetries - 1), 120000);
                        const rotation = this.options.llmService.markActiveKeyRateLimited(waitMs);
                        if (rotation.rotated) {
                            const keyCount = this.options.llmService.getKeyCount();
                            const keyIdx = this.options.llmService.getActiveKeyIndex() + 1;
                            this.options.eventBus.emit(turnRequestId, 'contentChunk', {
                                content: `\n\n🔄 Rate limit — key ${keyIdx}/${keyCount} deneniyor…`,
                            });
                            iteration -= 1;
                            continue;
                        }

                        const waitSec = Math.round(waitMs / 1000);
                        this.options.eventBus.emit(turnRequestId, 'rateLimit', {
                            waitMs,
                            waitSec,
                            attempt: rateLimitRetries,
                            maxAttempts: MAX_RATE_LIMIT_RETRIES,
                        });
                        this.options.eventBus.emit(turnRequestId, 'contentChunk', {
                            content: `\n\n⏳ Rate limit — ${waitSec}s bekleniyor… (${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`,
                        });
                        await delay(waitMs);
                        iteration -= 1;
                        continue;
                    }

                    continueLoop = false;
                    goalControl.recordRuntimeFailure(messageText || 'LLM request failed');
                    this.emitGoalControlUpdate(turnRequestId, goalControl);
                    await this.options.traceService.finish(turnRequestId, 'failed', {
                        error: messageText || 'LLM request failed',
                        budgetState: this.options.workspaceManager.estimateTokenCount(),
                    });
                    this.emitCurrentTurnState(turnRequestId);
                    this.options.eventBus.emit(turnRequestId, 'error', { message: messageText || 'LLM request failed' });
                    await this.emitTerminalTurnUpdates(turnRequestId);
                    return;
                }

                const rawToolCalls = response?.message?.tool_calls ?? response?.tool_calls ?? [];
                const usedToolCallIds = new Set<string>();
                const toolCalls = Array.isArray(rawToolCalls)
                    ? rawToolCalls
                        .map((toolCall, index) => normalizeToolCall(toolCall, iteration, index, usedToolCallIds))
                        .filter((toolCall) => toolCall.function.name)
                    : [];

                if (toolCalls.length > 0) {
                    await this.transitionTurnPhase(turnRequestId, 'tool_execution', {
                        iteration,
                        activeToolCallIds: toolCalls.map((toolCall) => toolCall.id),
                        budgetState: this.options.workspaceManager.estimateTokenCount(),
                    });
                    this.options.workspaceManager.appendToHistory({
                        role: 'assistant',
                        content: response?.message?.content ?? null,
                        tool_calls: toolCalls,
                    });

                    for (const toolCall of toolCalls) {
                        const toolArgs = parseToolArguments(toolCall.function.arguments);
                        goalControl.recordToolStart(toolCall.function.name, toolArgs, toolControl.getState());
                        this.emitGoalControlUpdate(turnRequestId, goalControl);
                        const execution = await this.options.toolExecutor.executeToolCall({
                            turnId: turnRequestId,
                            iteration,
                            toolCallId: toolCall.id,
                            toolName: toolCall.function.name,
                            toolArgs,
                            toolControl,
                        });

                        for (const preHistoryMessage of execution.preHistoryMessages) {
                            this.options.workspaceManager.appendToHistory(preHistoryMessage);
                        }

                        this.options.workspaceManager.appendToHistory({
                            role: 'tool',
                            content: execution.result.historyContent,
                            tool_call_id: toolCall.id,
                        });
                        await this.options.workspaceManager.persistState();
                        activePhaseId = execution.phaseId;
                        goalControl.recordToolResult({
                            toolName: execution.toolName,
                            args: toolArgs,
                            result: execution.result,
                            controlState: execution.result.controlState ?? toolControl.getState(),
                        });
                        this.emitGoalControlUpdate(turnRequestId, goalControl);

                        if (execution.result.blocked && execution.result.stopTurn) {
                            goalControl.recordAwaitingUser(execution.result.errorMessage || 'Tool execution was blocked and needs user direction.');
                            this.emitGoalControlUpdate(turnRequestId, goalControl);
                            await this.transitionTurnPhase(turnRequestId, 'awaiting_user', {
                                budgetState: this.options.workspaceManager.estimateTokenCount(),
                                activeToolCallIds: [],
                            });
                            continueLoop = false;
                            break;
                        }

                        if (execution.toolName === 'task_notes' && typeof toolArgs.todos === 'string') {
                            const todosContent = toolArgs.todos.trim();
                            if (todosContent === lastTaskNotesContent) {
                                continueLoop = false;
                                this.options.workspaceManager.appendToHistory({
                                    role: 'tool',
                                    content: 'task_notes: Duplicate plan detected. Use attempt_completion to finish.',
                                    tool_call_id: toolCall.id,
                                });
                                break;
                            }
                            lastTaskNotesContent = todosContent;
                            this.options.workspaceManager.updatePlanState(
                                toolArgs.todos,
                                typeof toolArgs.summary === 'string' ? toolArgs.summary : ''
                            );
                            goalControl.recordTaskNotes(
                                toolArgs.todos,
                                typeof toolArgs.summary === 'string' ? toolArgs.summary : ''
                            );
                            this.emitGoalControlUpdate(turnRequestId, goalControl);
                            this.options.eventBus.emit(turnRequestId, 'todoUpdate', {
                                todos: toolArgs.todos,
                                summary: toolArgs.summary || '',
                            });
                        }

                        if (execution.toolName === 'attempt_completion') {
                            await this.options.traceService.finish(turnRequestId, 'completed', {
                                budgetState: this.options.workspaceManager.estimateTokenCount(),
                            });
                            this.emitCurrentTurnState(turnRequestId);
                            this.options.eventBus.emit(turnRequestId, 'taskComplete', {
                                result: toolArgs.result || toolArgs.summary || 'Task complete.',
                            });
                            continueLoop = false;
                            break;
                        }

                        if (STOP_TOOLS.includes(execution.toolName)) {
                            goalControl.recordAwaitingUser('The runtime is waiting for user input before continuing.');
                            this.emitGoalControlUpdate(turnRequestId, goalControl);
                            await this.transitionTurnPhase(turnRequestId, 'awaiting_user', {
                                budgetState: this.options.workspaceManager.estimateTokenCount(),
                            });
                            continueLoop = false;
                            break;
                        }
                    }
                } else {
                    const rawFinalContent = response?.message?.content;
                    const finalContent = typeof rawFinalContent === 'string'
                        ? rawFinalContent
                        : rawFinalContent == null
                            ? (lastContentSnapshot || '')
                            : JSON.stringify(rawFinalContent);
                    this.options.workspaceManager.appendToHistory({ role: 'assistant', content: finalContent });
                    goalControl.recordAssistantResponse(finalContent);
                    this.emitGoalControlUpdate(turnRequestId, goalControl);
                    this.options.eventBus.emit(turnRequestId, 'finalResponse', { content: finalContent });
                    await this.options.workspaceManager.persistState();
                    await this.options.traceService.finish(turnRequestId, 'completed', {
                        budgetState: this.options.workspaceManager.estimateTokenCount(),
                    });
                    this.emitCurrentTurnState(turnRequestId);
                    continueLoop = false;
                }
            }

            await this.emitTerminalTurnUpdates(turnRequestId);
        } catch (error) {
            const messageText = error instanceof Error ? error.message : 'Unknown error';
            goalControl.recordRuntimeFailure(messageText);
            this.emitGoalControlUpdate(turnRequestId, goalControl);
            await this.options.traceService.finish(turnRequestId, 'failed', {
                error: messageText,
                budgetState: this.options.workspaceManager.estimateTokenCount(),
            });
            this.emitCurrentTurnState(turnRequestId);
            this.options.eventBus.emit(turnRequestId, 'error', { message: messageText });
            await this.emitTerminalTurnUpdates(turnRequestId);
        }
    }

    private async transitionTurnPhase(turnId: string, phase: TurnPhase, patch: Record<string, unknown> = {}) {
        await this.options.traceService.transition(turnId, phase, patch as any);
        this.emitCurrentTurnState(turnId);
    }

    private emitCurrentTurnState(turnId: string) {
        const state = this.options.traceService.getCurrentTurnState();
        if (!state || state.turnId !== turnId) return;
        this.options.eventBus.emit(turnId, 'turnState', state);
    }

    private emitGoalControlUpdate(turnId: string, goalControl: GoalControlService) {
        this.options.eventBus.emitGoalControlState(turnId, goalControl.getState());
        for (const notice of goalControl.flushNotices()) {
            this.options.eventBus.emit(turnId, 'runtimeWarning', notice);
        }
    }

    private async emitTerminalTurnUpdates(turnId: string) {
        this.options.eventBus.emit(turnId, 'tokenCount', this.options.workspaceManager.estimateTokenCount());
        this.options.eventBus.emit(turnId, 'contextPreview', this.options.workspaceManager.getContextPreview() ?? {});
        this.options.eventBus.emit(turnId, 'turnTraceAvailable', this.options.traceService.getLatestSummary() ?? {});
        this.options.eventBus.emit(turnId, 'turnDone', { finishedAt: Date.now() });
    }
}

function isRateLimitError(message: string): boolean {
    return message.includes('Rate limit')
        || message.includes('rate limit')
        || message.includes('429')
        || message.includes('RESOURCE_EXHAUSTED')
        || message.includes('quota')
        || message.includes('too many requests')
        || message.includes('Too Many Requests');
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
