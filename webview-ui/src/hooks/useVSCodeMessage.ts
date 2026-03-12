import { useEffect } from 'react';
import { useVSCodeBridge } from './useVSCodeBridge';
import { useChatRuntimeStore } from '../store/ChatRuntimeStore';
import { useExtensionStore } from '../store/ExtensionStore';
import { MODES } from '../components/chat/ModeSelector';
import type {
  AgentMode,
  ModelDef,
  ProviderModelsFetchState,
  WizardQuestion,
} from '../types';
import type { ProviderId } from '../catalog/providerCatalog';

export function useVSCodeMessage() {
  useVSCodeBridge();

  const { state: runtimeState, actions: runtime } = useChatRuntimeStore();
  const { state: extensionState, actions: extension } = useExtensionStore();

  useEffect(() => {
    if (!runtimeState.contextCompactionNotice) return;
    const timer = window.setTimeout(() => runtime.patch({ contextCompactionNotice: null }), 4200);
    return () => window.clearTimeout(timer);
  }, [runtime, runtimeState.contextCompactionNotice]);

  useEffect(() => {
    if (extensionState.mode !== 'plan') return;
    if (runtimeState.todoItems) return;
    const assistantMessages = runtimeState.messages.filter((message) => message.role === 'assistant');
    if (!assistantMessages.length) return;
    const last = assistantMessages[assistantMessages.length - 1];
    if (last.isStreaming) return;
    const allText = last.segments
      .filter((segment) => segment.type === 'content')
      .map((segment: any) => segment.text ?? '')
      .join('');
    const lines = allText.split('\n').filter((line: string) => /^\s*-\s*\[[ x]\]/i.test(line));
    if (lines.length >= 2) {
      runtime.patch({ todoItems: lines.join('\n') });
    }
  }, [extensionState.mode, runtime, runtimeState.messages, runtimeState.todoItems]);

  const setMode = (mode: AgentMode) => extension.patch({ mode });
  const setModel = (selectedModel: ModelDef) => extension.patch({ selectedModel });
  const setActiveFileContext = (activeFileContext: any) => extension.patch({ activeFileContext });
  const setProviderModels = (providerId: ProviderId, models: ModelDef[]) => extension.setProviderModels(providerId, models);
  const setProviderModelFetchState = (providerId: ProviderId, fetchState: ProviderModelsFetchState) =>
    extension.setProviderModelFetchState(providerId, fetchState);

  return {
    ...runtimeState,
    mode: extensionState.mode,
    setMode,
    clearMessages: runtime.clearMessages,
    setTodoItems: (todoItems: string) => runtime.patch({ todoItems }),
    pendingQuestion: runtimeState.pendingQuestion,
    setPendingQuestion: (pendingQuestion: { question: string; options?: string[] } | null) => runtime.patch({ pendingQuestion }),
    pendingQuestions: runtimeState.pendingQuestions,
    setPendingQuestions: (pendingQuestions: WizardQuestion[] | null) => runtime.patch({ pendingQuestions }),
    planSaved: runtimeState.planSaved,
    setPlanSaved: (planSaved: typeof runtimeState.planSaved) => runtime.patch({ planSaved }),
    taskDone: runtimeState.taskDone,
    setTaskDone: (taskDone: string | null) => runtime.patch({ taskDone }),
    initialModel: extensionState.initialModel,
    model: extensionState.selectedModel,
    setModel,
    activeFileContext: extensionState.activeFileContext,
    setActiveFileContext,
    ollamaModels: extensionState.ollamaModels,
    providerInfo: extensionState.providerInfo,
    providerModelsById: extensionState.providerModelsById,
    providerModelFetchStateById: extensionState.providerModelFetchStateById,
    setProviderModels,
    setProviderModelFetchState,
    selectedMode: MODES.find((entry) => entry.id === extensionState.mode) ?? MODES[0],
  };
}
