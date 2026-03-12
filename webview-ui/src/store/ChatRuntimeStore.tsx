import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type PropsWithChildren,
} from 'react';
import type {
  BrowserSessionState,
  ChatMessage,
  ContextPreviewPayload,
  ContextWindowStats,
  LatestTraceSummary,
  PlanSavedPayload,
  ToolControlState,
  TurnState,
  WizardQuestion,
} from '../types';

export interface ChatRuntimeState {
  messages: ChatMessage[];
  isProcessing: boolean;
  scrollTick: number;
  todoItems: string;
  pendingQuestion: { question: string; options?: string[] } | null;
  pendingQuestions: WizardQuestion[] | null;
  planSaved: PlanSavedPayload | null;
  taskDone: string | null;
  tokenCount: ContextWindowStats | null;
  contextPreview: ContextPreviewPayload | null;
  latestTrace: LatestTraceSummary | null;
  turnState: TurnState | null;
  toolControlState: ToolControlState | null;
  browserSessionState: BrowserSessionState | null;
  toolControlNotice: { severity: 'info' | 'warning' | 'error'; message: string } | null;
  preflightNotice: { severity: 'warning' | 'error'; warnings: string[]; errors: string[] } | null;
  resumeNotice: string | null;
  contextCompactionNotice: string | null;
  isStreaming: boolean;
  iterationCount: number;
}

type ChatRuntimeAction =
  | { type: 'patch'; patch: Partial<ChatRuntimeState> }
  | { type: 'updateMessages'; updater: (messages: ChatMessage[]) => ChatMessage[] }
  | { type: 'clearMessages' }
  | { type: 'resetState' }
  | { type: 'bumpScroll' };

interface ChatRuntimeContextValue {
  state: ChatRuntimeState;
  dispatch: Dispatch<ChatRuntimeAction>;
  actions: {
    patch: (patch: Partial<ChatRuntimeState>) => void;
    updateMessages: (updater: (messages: ChatMessage[]) => ChatMessage[]) => void;
    clearMessages: () => void;
    resetState: () => void;
    bumpScroll: () => void;
  };
}

const initialState: ChatRuntimeState = {
  messages: [],
  isProcessing: false,
  scrollTick: 0,
  todoItems: '',
  pendingQuestion: null,
  pendingQuestions: null,
  planSaved: null,
  taskDone: null,
  tokenCount: null,
  contextPreview: null,
  latestTrace: null,
  turnState: null,
  toolControlState: null,
  browserSessionState: null,
  toolControlNotice: null,
  preflightNotice: null,
  resumeNotice: null,
  contextCompactionNotice: null,
  isStreaming: false,
  iterationCount: 0,
};

const ChatRuntimeStoreContext = createContext<ChatRuntimeContextValue | null>(null);

function chatRuntimeReducer(state: ChatRuntimeState, action: ChatRuntimeAction): ChatRuntimeState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'updateMessages':
      return { ...state, messages: action.updater(state.messages) };
    case 'clearMessages':
      return {
        ...state,
        messages: [],
        isProcessing: false,
        iterationCount: 0,
      };
    case 'resetState':
      return initialState;
    case 'bumpScroll':
      return { ...state, scrollTick: state.scrollTick + 1 };
    default:
      return state;
  }
}

export function ChatRuntimeStoreProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(chatRuntimeReducer, initialState);

  const actions = useMemo(
    () => ({
      patch: (patch: Partial<ChatRuntimeState>) => dispatch({ type: 'patch', patch }),
      updateMessages: (updater: (messages: ChatMessage[]) => ChatMessage[]) =>
        dispatch({ type: 'updateMessages', updater }),
      clearMessages: () => dispatch({ type: 'clearMessages' }),
      resetState: () => dispatch({ type: 'resetState' }),
      bumpScroll: () => dispatch({ type: 'bumpScroll' }),
    }),
    [],
  );

  const value = useMemo(() => ({ state, dispatch, actions }), [actions, state]);
  return <ChatRuntimeStoreContext.Provider value={value}>{children}</ChatRuntimeStoreContext.Provider>;
}

export function useChatRuntimeStore() {
  const context = useContext(ChatRuntimeStoreContext);
  if (!context) {
    throw new Error('useChatRuntimeStore must be used inside ChatRuntimeStoreProvider');
  }
  return context;
}

export function useChatRuntimeActions() {
  return useChatRuntimeStore().actions;
}
