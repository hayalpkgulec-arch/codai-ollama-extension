import { useEffect, useRef } from 'react';
import { DEFAULT_PROVIDER, PROVIDERS, type ProviderId } from '../catalog/providerCatalog';
import { useChatRuntimeStore } from '../store/ChatRuntimeStore';
import { useExtensionStore } from '../store/ExtensionStore';
import {
  allToolsDone,
  newAssistantMessage,
  reconstructHistory,
  updateLast,
} from '../store/chatRuntimeHelpers';
import type {
  AgentMode,
  BrowserSessionState,
  ContextWindowStats,
  ModelDef,
  ProviderSavedConfig,
  ToolCall,
  Segment,
  TurnState,
} from '../types';
import { vscode } from '../vscode';

function isAgentMode(value: unknown): value is AgentMode {
  return value === 'code' || value === 'plan' || value === 'chat';
}

function toModelDef(id: string, label: string, isLocal: boolean): ModelDef {
  return {
    id,
    label,
    tag: isLocal ? 'local' : 'cloud',
  };
}

function normalizeTokenCount(value: any): ContextWindowStats {
  return {
    contextTokens: value?.contextTokens ?? 0,
    contextChars: value?.contextChars ?? 0,
    maxContextTokens: value?.maxContextTokens ?? 0,
    tokensLeft: value?.tokensLeft ?? 0,
    percentUsed: value?.percentUsed ?? 0,
    autoCompactEnabled: value?.autoCompactEnabled ?? true,
    lastCompactionAt: value?.lastCompactionAt ?? null,
    compactedMessageCount: value?.compactedMessageCount ?? 0,
  };
}

function normalizeProviderInfo(
  provider: any,
  current: {
    providerId: string;
    hasApiKey: boolean;
    baseUrl: string;
    configs: Record<string, ProviderSavedConfig>;
  },
) {
  if (!provider) return current;
  return {
    providerId: provider.providerId || current.providerId || DEFAULT_PROVIDER,
    hasApiKey: !!provider.hasApiKey,
    baseUrl: provider.baseUrl || current.baseUrl || 'http://localhost:11434',
    configs: typeof provider.configs === 'object' && provider.configs ? provider.configs : current.configs,
  };
}

function buildTurnState(
  requestId: string,
  providerId: string,
  model: string,
  tokenCount: ContextWindowStats | null,
  startedAt?: number,
): TurnState {
  return {
    turnId: requestId,
    requestId,
    providerId,
    model,
    phase: 'preflight',
    iteration: 0,
    startedAt: startedAt || Date.now(),
    activeToolCallIds: [],
    budgetState: tokenCount || normalizeTokenCount(null),
  };
}

function restoreSessionMessages(messages: any[]): Array<{ id: string; role: 'user' | 'assistant'; segments: Segment[]; error?: string; isStreaming?: boolean }> {
  return messages.map((message: any, index: number) => ({
    id: `r${index}-${Date.now()}`,
    role: message.role as 'user' | 'assistant',
    segments: Array.isArray(message.segments) ? message.segments : [],
    error: message.error,
    isStreaming: false,
  }));
}

export function useVSCodeBridge() {
  const { state: runtimeState, actions: runtime } = useChatRuntimeStore();
  const { state: extensionState, actions: extension } = useExtensionStore();
  const runtimeRef = useRef(runtimeState);
  const extensionRef = useRef(extensionState);
  const lastCompactionSeenRef = useRef<number | null>(null);

  useEffect(() => {
    runtimeRef.current = runtimeState;
  }, [runtimeState]);

  useEffect(() => {
    extensionRef.current = extensionState;
  }, [extensionState]);

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      const msg = event.data;

      switch (msg.type) {
        case 'initialState': {
          const providerInfo = normalizeProviderInfo(msg.provider, extensionRef.current.providerInfo);
          const providerDef = PROVIDERS.find((provider) => provider.id === providerInfo.providerId) ?? PROVIDERS[0];
          const nextModelId = typeof msg.model === 'string' && msg.model
            ? msg.model
            : extensionRef.current.selectedModel.id;
          const nextTokenCount = msg.tokenCount ? normalizeTokenCount(msg.tokenCount) : null;

          lastCompactionSeenRef.current = nextTokenCount?.lastCompactionAt ?? null;

          extension.patch({
            mode: isAgentMode(msg.mode) ? msg.mode : extensionRef.current.mode,
            initialModel: typeof msg.model === 'string' && msg.model ? msg.model : extensionRef.current.initialModel,
            selectedModel: toModelDef(nextModelId, nextModelId, !!providerDef?.isLocal),
            providerInfo,
            toolCatalog: Array.isArray(msg.toolCatalog) ? msg.toolCatalog : extensionRef.current.toolCatalog,
          });
          runtime.patch({
            messages: reconstructHistory(msg.history || []),
            tokenCount: nextTokenCount,
            contextPreview: msg.contextPreview || null,
            latestTrace: msg.latestTrace || null,
            turnState: msg.turnState || null,
            toolControlState: msg.toolControlState || null,
            goalControlState: msg.goalControlState || null,
            browserSessionState: msg.browserSessionState || null,
            approvalPreview: null,
            toolControlNotice: null,
            runtimeWarning: null,
            preflightNotice: null,
            resumeNotice: msg.turnState?.recoveredFromPreviousRun
              ? 'Previous turn was interrupted. Its state was recovered locally so you can inspect the trace safely.'
              : null,
            todoItems: typeof msg.planTodos === 'string' && msg.planTodos.trim()
              ? msg.planTodos
              : runtimeRef.current.todoItems,
          });
          runtime.bumpScroll();
          break;
        }

        case 'turnStart': {
          const requestId = (msg.requestId as string) || `turn-${Date.now()}`;
          runtime.patch({
            isProcessing: true,
            isStreaming: false,
            contextCompactionNotice: null,
            toolControlNotice: null,
            runtimeWarning: null,
            preflightNotice: null,
            resumeNotice: null,
            taskDone: null,
            pendingQuestion: null,
            pendingQuestions: null,
            approvalPreview: null,
            iterationCount: 0,
            turnState: buildTurnState(
              requestId,
              extensionRef.current.providerInfo.providerId,
              extensionRef.current.selectedModel.id,
              runtimeRef.current.tokenCount,
              msg.startedAt,
            ),
          });
          runtime.updateMessages((previous) => [
            ...previous,
            {
              id: `u${Date.now()}`,
              role: 'user',
              segments: [{ type: 'content', text: msg.userText as string }],
            },
            newAssistantMessage(),
          ]);
          break;
        }

        case 'thinking': {
          runtime.patch({ isStreaming: true });
          runtime.updateMessages((previous) => {
            const thinkingSegment: Segment = {
              type: 'thinking',
              text: msg.content as string,
              done: false,
              startedAt: Date.now(),
            };

            if (allToolsDone(previous)) {
              runtime.patch({ iterationCount: runtimeRef.current.iterationCount + 1 });
              return [...previous, newAssistantMessage({ segments: [thinkingSegment] })];
            }

            return updateLast(previous, (last) => {
              if (last.role !== 'assistant') return last;
              const segments = [...last.segments];
              const lastSegment = segments[segments.length - 1];
              if (lastSegment?.type === 'thinking' && !lastSegment.done) {
                segments[segments.length - 1] = { ...lastSegment, text: msg.content as string };
              } else {
                segments.push(thinkingSegment);
              }
              return { ...last, segments };
            });
          });
          break;
        }

        case 'contentChunk': {
          runtime.patch({ isStreaming: true });
          runtime.updateMessages((previous) => {
            const contentSegment: Segment = {
              type: 'content',
              text: msg.content as string,
            };

            if (allToolsDone(previous)) {
              runtime.patch({ iterationCount: runtimeRef.current.iterationCount + 1 });
              return [...previous, newAssistantMessage({ segments: [contentSegment] })];
            }

            return updateLast(previous, (last) => {
              if (last.role !== 'assistant') return last;
              const segments = [...last.segments];
              const lastSegment = segments[segments.length - 1];

              if (lastSegment?.type === 'thinking' && !lastSegment.done) {
                const finalMs = lastSegment.startedAt ? Date.now() - lastSegment.startedAt : undefined;
                segments[segments.length - 1] = { ...lastSegment, done: true, finalMs };
                segments.push(contentSegment);
              } else if (lastSegment?.type === 'content') {
                segments[segments.length - 1] = { ...lastSegment, text: msg.content as string };
              } else {
                segments.push(contentSegment);
              }

              return { ...last, segments };
            });
          });
          break;
        }

        case 'toolActivityStart': {
          const tool: ToolCall = {
            phaseId: msg.phaseId as string,
            name: (msg.toolName as string) || 'tool',
            summary: (msg.summary as string) || JSON.stringify(msg.args || {}),
            status: 'running',
            args: msg.args,
            startedAt: (msg.startedAt as number) || Date.now(),
            manifest: msg.manifest || undefined,
            controlState: msg.controlState || null,
            browserSessionState: msg.browserSessionState || null,
            retryPolicy: msg.retryPolicy || null,
            approvalPreview: msg.approvalPreview || null,
          };

          if (msg.controlState?.turnId) {
            runtime.patch({ toolControlState: msg.controlState });
          }
          if (msg.approvalPreview?.toolCallId) {
            runtime.patch({ approvalPreview: msg.approvalPreview });
          }
          if (msg.browserSessionState && typeof msg.browserSessionState.active === 'boolean') {
            runtime.patch({ browserSessionState: msg.browserSessionState as BrowserSessionState });
          }

          runtime.updateMessages((previous) => {
            const toolSegment: Segment = { type: 'tool', tool };
            const last = previous[previous.length - 1];
            if (last?.role === 'assistant') {
              return updateLast(previous, (entry) => {
                const segments = [...entry.segments];
                if (segments.some((segment) => segment.type === 'tool' && segment.tool.phaseId === tool.phaseId)) {
                  return entry;
                }
                const lastSegment = segments[segments.length - 1];
                if (lastSegment?.type === 'thinking' && !lastSegment.done) {
                  const finalMs = lastSegment.startedAt ? Date.now() - lastSegment.startedAt : undefined;
                  segments[segments.length - 1] = { ...lastSegment, done: true, finalMs };
                }
                segments.push(toolSegment);
                return { ...entry, segments };
              });
            }
            return [...previous, newAssistantMessage({ segments: [toolSegment] })];
          });
          break;
        }

        case 'toolActivityDone':
        case 'toolActivityError': {
          const ok = msg.type === 'toolActivityDone';
          const rawResult: string = msg.rawResult || '';
          if (rawResult.includes('"background":true') || rawResult.includes('"bgId":')) {
            try {
              const parsed = JSON.parse(rawResult);
              if (parsed?.bgId) {
                vscode.postMessage({ type: 'watchBgProcess', bgId: parsed.bgId });
              }
            } catch {
              // Ignore malformed background payloads.
            }
          }

          if (msg.controlState?.turnId) {
            runtime.patch({ toolControlState: msg.controlState });
          }
          if (msg.browserSessionState && typeof msg.browserSessionState.active === 'boolean') {
            runtime.patch({ browserSessionState: msg.browserSessionState as BrowserSessionState });
          }

          runtime.updateMessages((previous) =>
            updateLast(previous, (last) => {
              if (last.role !== 'assistant') return last;
              const segments = last.segments.map((segment) => {
                if (segment.type !== 'tool' || segment.tool.phaseId !== msg.phaseId) {
                  return segment;
                }
                return {
                  ...segment,
                  tool: {
                    ...segment.tool,
                    status: ok ? ('done' as const) : ('error' as const),
                    result: msg.rawResult || msg.errorMessage || msg.summary,
                    finishedAt: (msg.finishedAt as number) || Date.now(),
                    manifest: msg.manifest || segment.tool.manifest,
                    controlState: msg.controlState || segment.tool.controlState || null,
                    browserSessionState: msg.browserSessionState || segment.tool.browserSessionState || null,
                    retryPolicy: msg.retryPolicy || segment.tool.retryPolicy || null,
                    approvalPreview: msg.approvalPreview || segment.tool.approvalPreview || null,
                    ...(msg.hunks !== undefined
                      ? {
                          hunks: msg.hunks,
                          addedCount: msg.addedCount,
                          removedCount: msg.removedCount,
                          mode: msg.mode,
                          fileName: msg.fileName,
                          path: msg.path,
                        }
                      : {}),
                  },
                };
              });
              return { ...last, segments };
            }),
          );
          break;
        }

        case 'bgProcessDied': {
          const bgId = msg.bgId as string;
          const exitCode = msg.exitCode as number | null;
          const signal = msg.signal as string | null;
          const isInterrupted = signal === 'SIGINT' || signal === 'SIGTERM' || signal === '^C';

          runtime.updateMessages((previous) =>
            previous.map((message) => {
              if (message.role !== 'assistant') return message;
              const segments = message.segments.map((segment) => {
                if (segment.type !== 'tool') return segment;
                let parsed: any = null;
                try {
                  if (segment.tool.result?.trim().startsWith('{')) {
                    parsed = JSON.parse(segment.tool.result);
                  }
                } catch {
                  parsed = null;
                }
                if (!parsed || parsed.bgId !== bgId) return segment;

                const updatedResult = JSON.stringify({
                  ...parsed,
                  status: isInterrupted ? 'interrupted' : (exitCode === 0 ? 'success' : 'error'),
                  background: false,
                  exitCode,
                  signal,
                  bgId: undefined,
                });
                return {
                  ...segment,
                  tool: {
                    ...segment.tool,
                    status: 'done' as const,
                    result: updatedResult,
                    finishedAt: Date.now(),
                  },
                };
              });
              return { ...message, segments };
            }),
          );
          break;
        }

        case 'finalResponse': {
          runtime.patch({
            isProcessing: false,
            isStreaming: false,
          });
          runtime.updateMessages((previous) => {
            const reverseIndex = [...previous].reverse().findIndex((message) => message.role === 'assistant');
            if (reverseIndex === -1) return previous;
            const index = previous.length - 1 - reverseIndex;
            const updated = [...previous];
            const last = updated[index];
            let segments = [...last.segments];

            if (msg.content && !segments.some((segment) => segment.type === 'content')) {
              segments.push({ type: 'content', text: msg.content as string });
            }
            segments = segments.map((segment) =>
              segment.type === 'thinking' && !segment.done
                ? { ...segment, done: true, finalMs: segment.startedAt ? Date.now() - segment.startedAt : undefined }
                : segment,
            );
            updated[index] = { ...last, segments, isStreaming: false };
            return updated;
          });
          runtime.bumpScroll();
          break;
        }

        case 'turnDone': {
          runtime.patch({
            isProcessing: false,
            isStreaming: false,
            toolControlNotice: null,
            turnState: runtimeRef.current.turnState
              ? {
                  ...runtimeRef.current.turnState,
                  phase: runtimeRef.current.turnState.phase === 'failed'
                    || runtimeRef.current.turnState.phase === 'aborted'
                    || runtimeRef.current.turnState.phase === 'awaiting_user'
                    ? runtimeRef.current.turnState.phase
                    : 'completed',
                  finishedAt: msg.finishedAt || Date.now(),
                }
              : runtimeRef.current.turnState,
            approvalPreview: null,
          });
          runtime.updateMessages((previous) =>
            previous.map((message) => ({
              ...message,
              isStreaming: false,
              segments: message.segments.map((segment) =>
                segment.type === 'thinking' && !segment.done
                  ? { ...segment, done: true }
                  : segment,
              ),
            })),
          );
          break;
        }

        case 'error': {
          runtime.patch({
            isProcessing: false,
            isStreaming: false,
            turnState: runtimeRef.current.turnState
              ? {
                  ...runtimeRef.current.turnState,
                  phase: 'failed',
                  error: msg.message as string,
                  finishedAt: Date.now(),
                }
              : runtimeRef.current.turnState,
          });
          runtime.updateMessages((previous) => {
            const last = previous[previous.length - 1];
            if (last?.role === 'assistant') {
              return updateLast(previous, (entry) => ({
                ...entry,
                error: msg.message as string,
                isStreaming: false,
              }));
            }
            return [
              ...previous,
              {
                id: `e${Date.now()}`,
                role: 'assistant',
                segments: [],
                error: msg.message as string,
              },
            ];
          });
          break;
        }

        case 'sessionLoaded': {
          if (isAgentMode(msg.mode)) {
            extension.patch({ mode: msg.mode });
          }
          runtime.patch({
            messages: Array.isArray(msg.messages) && msg.messages.length > 0
              ? restoreSessionMessages(msg.messages)
              : [],
            contextCompactionNotice: null,
            preflightNotice: null,
            resumeNotice: null,
            toolControlNotice: null,
            isProcessing: false,
            isStreaming: false,
            taskDone: null,
            pendingQuestion: null,
            pendingQuestions: null,
            planSaved: null,
            turnState: null,
            toolControlState: msg.toolControlState || null,
            goalControlState: msg.goalControlState || null,
            browserSessionState: msg.browserSessionState || null,
            approvalPreview: null,
            runtimeWarning: null,
            iterationCount: 0,
          });
          runtime.bumpScroll();
          break;
        }

        case 'clearHistory':
          runtime.resetState();
          extension.patch({ activeFileContext: null });
          break;

        case 'todoUpdate':
          runtime.patch({ todoItems: msg.todos || '' });
          break;

        case 'clarificationRequest':
          runtime.patch({ pendingQuestion: { question: msg.question, options: msg.options } });
          break;

        case 'questionsRequest':
          runtime.patch({
            pendingQuestions: Array.isArray(msg.questions) ? msg.questions : null,
            pendingQuestion: null,
          });
          break;

        case 'planSaved':
          runtime.patch({
            planSaved: {
              title: msg.title || '',
              slug: msg.slug || '',
              planDir: msg.planDir || '',
              files: {
                requirements: msg.files?.requirements || '',
                design: msg.files?.design || '',
                tasks: msg.files?.tasks || '',
              },
            },
          });
          break;

        case 'taskComplete':
          runtime.patch({
            taskDone: msg.result || 'Task complete.',
            isProcessing: false,
            isStreaming: false,
          });
          break;

        case 'mentionResolved':
          window.dispatchEvent(new CustomEvent('codai:mentionResolved', { detail: msg }));
          break;

        case 'tokenCount': {
          const nextTokenCount = normalizeTokenCount(msg);
          if (
            typeof msg.lastCompactionAt === 'number'
            && msg.lastCompactionAt > 0
            && msg.lastCompactionAt !== lastCompactionSeenRef.current
          ) {
            lastCompactionSeenRef.current = msg.lastCompactionAt;
            runtime.patch({ contextCompactionNotice: 'Automatically compacting context' });
          }
          runtime.patch({
            tokenCount: nextTokenCount,
            turnState: runtimeRef.current.turnState
              ? {
                  ...runtimeRef.current.turnState,
                  budgetState: nextTokenCount,
                }
              : runtimeRef.current.turnState,
          });
          break;
        }

        case 'contextPreview':
          runtime.patch({ contextPreview: msg?.artifacts ? msg : null });
          break;

        case 'turnTraceAvailable':
          if (msg?.traceFilePath) {
            runtime.patch({ latestTrace: msg });
          }
          break;

        case 'turnState':
          if (msg?.turnId) {
            runtime.patch({ turnState: msg });
          }
          break;

        case 'toolControlState':
          if (msg?.turnId) {
            runtime.patch({ toolControlState: msg });
          }
          break;

        case 'goalControlState':
          if (msg?.activeGoal) {
            runtime.patch({ goalControlState: msg });
          }
          break;

        case 'browserSessionState':
          if (typeof msg?.active === 'boolean') {
            runtime.patch({ browserSessionState: msg });
          }
          break;

        case 'toolApprovalPreview':
          if (msg?.toolCallId) {
            runtime.patch({ approvalPreview: msg });
          }
          break;

        case 'toolControlNotice':
          if (typeof msg?.message === 'string' && msg.message.trim()) {
            runtime.patch({
              toolControlNotice: {
                severity: msg.severity === 'error' ? 'error' : msg.severity === 'info' ? 'info' : 'warning',
                message: msg.message,
              },
            });
          }
          break;

        case 'runtimeWarning':
          if (typeof msg?.message === 'string' && msg.message.trim()) {
            runtime.patch({
              runtimeWarning: {
                severity: msg.severity === 'error' ? 'error' : msg.severity === 'info' ? 'info' : 'warning',
                message: msg.message,
              },
            });
          }
          break;

        case 'preflightWarning':
          runtime.patch({
            preflightNotice: {
              severity: msg.severity === 'error' ? 'error' : 'warning',
              warnings: Array.isArray(msg.warnings) ? msg.warnings : [],
              errors: Array.isArray(msg.errors) ? msg.errors : [],
            },
          });
          break;

        case 'turnResumed':
          runtime.patch({
            resumeNotice: typeof msg.message === 'string' && msg.message.trim() ? msg.message : null,
            turnState: msg.turnState?.turnId ? msg.turnState : runtimeRef.current.turnState,
          });
          break;

        case 'activeFileResult':
          extension.patch({ activeFileContext: msg.file || null });
          break;

        case 'ollamaModels':
          if (Array.isArray(msg.models) && msg.models.length > 0) {
            extension.patch({
              ollamaModels: msg.models.map((model: any) =>
                toModelDef(model.id, model.label || model.id, true),
              ),
            });
          }
          break;

        case 'providerModels': {
          const providerId = (msg.providerId as ProviderId) || DEFAULT_PROVIDER;
          const expectedFetch = extensionRef.current.providerModelFetchStateById[providerId];
          if (msg.requestId && expectedFetch?.requestId && msg.requestId !== expectedFetch.requestId) {
            return;
          }

          if (msg.error) {
            extension.setProviderModelFetchState(providerId, {
              loading: false,
              error: msg.error,
              requestId: null,
              lastFetchedAt: Date.now(),
            });
            return;
          }

          const providerDef = PROVIDERS.find((provider) => provider.id === providerId) ?? PROVIDERS[0];
          const models = Array.isArray(msg.models)
            ? msg.models.map((model: any) => toModelDef(model.id, model.label || model.id, providerDef.isLocal))
            : [];
          extension.setProviderModels(providerId, models);
          extension.setProviderModelFetchState(providerId, {
            loading: false,
            error: null,
            requestId: null,
            lastFetchedAt: Date.now(),
          });
          if (providerId === 'ollama' && models.length > 0) {
            extension.patch({ ollamaModels: models });
          }
          break;
        }

        case 'providerChanged':
          if (msg.providerId) {
            extension.patch({
              providerInfo: {
                ...extensionRef.current.providerInfo,
                providerId: msg.providerId,
                hasApiKey: typeof msg.hasApiKey === 'boolean' ? msg.hasApiKey : extensionRef.current.providerInfo.hasApiKey,
                baseUrl: typeof msg.baseUrl === 'string' && msg.baseUrl
                  ? msg.baseUrl
                  : extensionRef.current.providerInfo.baseUrl,
                configs: msg.config
                  ? {
                      ...extensionRef.current.providerInfo.configs,
                      [msg.providerId]: msg.config,
                    }
                  : extensionRef.current.providerInfo.configs,
              },
            });
          }
          break;
      }
    };

    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [extension, runtime]);
}
