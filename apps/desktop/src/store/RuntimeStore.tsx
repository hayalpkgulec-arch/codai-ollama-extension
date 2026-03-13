import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  useContext,
  useMemo,
  useReducer,
} from 'react';
import type {
  DesktopCommandTimelineItem,
  DesktopEventTimelineItem,
  DesktopThread,
  DesktopTimelineItem,
  DesktopTraceEntry,
} from './types';
import type {
  DesktopRuntimeEvent,
  DesktopTerminalRunResult,
  DesktopWorkspaceEvent,
} from '../types';

interface RuntimeState {
  threads: DesktopThread[];
  activeThreadId: string;
  timeline: DesktopTimelineItem[];
  trace: DesktopTraceEntry[];
  terminalRuns: DesktopTerminalRunResult[];
}

type RuntimeAction =
  | { type: 'createThread'; title?: string }
  | { type: 'setActiveThread'; threadId: string }
  | { type: 'addUserMessage'; text: string }
  | { type: 'addAssistantMessage'; text: string }
  | { type: 'addEventCard'; title: string; detail: string; tone: DesktopEventTimelineItem['tone'] }
  | { type: 'recordWorkspaceEvent'; event: DesktopWorkspaceEvent }
  | { type: 'recordRuntimeEvent'; event: DesktopRuntimeEvent };

interface RuntimeContextValue {
  state: RuntimeState;
  dispatch: Dispatch<RuntimeAction>;
  actions: {
    createThread: (title?: string) => void;
    setActiveThread: (threadId: string) => void;
    sendPrompt: (text: string, contextSummary: string) => void;
    recordWorkspaceEvent: (event: DesktopWorkspaceEvent) => void;
    recordRuntimeEvent: (event: DesktopRuntimeEvent) => void;
  };
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

const initialThread: DesktopThread = {
  id: 'thread-default',
  title: 'New thread',
  preview: 'Ask CodAI about the current workspace.',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const initialState: RuntimeState = {
  threads: [initialThread],
  activeThreadId: initialThread.id,
  timeline: [
    {
      id: 'system-welcome',
      type: 'message',
      role: 'system',
      text: 'Desktop runtime is ready. Open a workspace, edit files, run commands, and use the bottom composer to drive the flow.',
      createdAt: Date.now(),
      threadId: initialThread.id,
    },
  ],
  trace: [],
  terminalRuns: [],
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function reducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  switch (action.type) {
    case 'createThread': {
      const threadId = createId('thread');
      const thread: DesktopThread = {
        id: threadId,
        title: action.title || 'New thread',
        preview: 'Fresh CodAI task',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return {
        ...state,
        threads: [thread, ...state.threads],
        activeThreadId: threadId,
      };
    }
    case 'setActiveThread':
      return { ...state, activeThreadId: action.threadId };
    case 'addUserMessage': {
      const createdAt = Date.now();
      return {
        ...state,
        threads: state.threads.map((thread) =>
          thread.id === state.activeThreadId
            ? { ...thread, preview: action.text.slice(0, 90), updatedAt: createdAt }
            : thread
        ),
        timeline: [
          ...state.timeline,
          {
            id: createId('msg-user'),
            type: 'message',
            role: 'user',
            text: action.text,
            createdAt,
            threadId: state.activeThreadId,
          },
        ],
      };
    }
    case 'addAssistantMessage':
      return {
        ...state,
        timeline: [
          ...state.timeline,
          {
            id: createId('msg-assistant'),
            type: 'message',
            role: 'assistant',
            text: action.text,
            createdAt: Date.now(),
            threadId: state.activeThreadId,
          },
        ],
      };
    case 'addEventCard':
      return {
        ...state,
        timeline: [
          ...state.timeline,
          {
            id: createId('event'),
            type: 'event',
            title: action.title,
            detail: action.detail,
            tone: action.tone,
            createdAt: Date.now(),
            threadId: state.activeThreadId,
          },
        ],
      };
    case 'recordWorkspaceEvent': {
      const traceEntry: DesktopTraceEntry = {
        id: createId('trace-workspace'),
        channel: 'workspace',
        title: action.event.type,
        detail: action.event.path || action.event.rootPath || '',
        createdAt: action.event.at,
      };
      const eventCard: DesktopEventTimelineItem = {
        id: createId('workspace-event'),
        type: 'event',
        title: action.event.type === 'workspace-opened' ? 'Workspace opened' : action.event.type === 'file-saved' ? 'File saved' : 'File opened',
        detail: action.event.path || action.event.rootPath || '',
        tone: action.event.type === 'file-saved' ? 'success' : 'info',
        createdAt: action.event.at,
        threadId: state.activeThreadId,
      };
      return {
        ...state,
        trace: [...state.trace, traceEntry].slice(-80),
        timeline: [...state.timeline, eventCard],
      };
    }
    case 'recordRuntimeEvent': {
      const traceEntry: DesktopTraceEntry = {
        id: createId('trace-runtime'),
        channel: 'runtime',
        title: action.event.type,
        detail: action.event.command || action.event.summary || '',
        createdAt: action.event.at,
      };

      if (action.event.type === 'command-started') {
        const commandCard: DesktopCommandTimelineItem = {
          id: action.event.id,
          type: 'command',
          status: 'running',
          command: action.event.command,
          cwd: action.event.cwd,
          shellLabel: `${action.event.shell.shellKind} • ${action.event.shell.executionPath}`,
          createdAt: action.event.at,
          threadId: state.activeThreadId,
        };
        return {
          ...state,
          trace: [...state.trace, traceEntry].slice(-80),
          timeline: [...state.timeline, commandCard],
        };
      }

      if (action.event.type === 'command-finished') {
        const terminalRuns = [...state.terminalRuns, action.event.result].slice(-20);
        return {
          ...state,
          terminalRuns,
          trace: [...state.trace, traceEntry].slice(-80),
          timeline: state.timeline.map((item) =>
            item.type === 'command' && item.id === action.event.id
              ? {
                  ...item,
                  status: action.event.result.exitCode === 0 ? 'success' : 'error',
                  stdout: action.event.result.stdout,
                  stderr: action.event.result.stderr,
                  durationMs: action.event.result.durationMs,
                  exitCode: action.event.result.exitCode,
                  shellLabel: `${action.event.result.shell.shellKind} • ${action.event.result.shell.executionPath}`,
                }
              : item
          ),
        };
      }

      return {
        ...state,
        trace: [...state.trace, traceEntry].slice(-80),
      };
    }
    default:
      return state;
  }
}

export function RuntimeStoreProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const actions = useMemo(
    () => ({
      createThread: (title?: string) => dispatch({ type: 'createThread', title }),
      setActiveThread: (threadId: string) => dispatch({ type: 'setActiveThread', threadId }),
      sendPrompt: (text: string, contextSummary: string) => {
        dispatch({ type: 'addUserMessage', text });
        dispatch({
          type: 'addAssistantMessage',
          text: `Runtime bridge is wiring up. Current context: ${contextSummary}`,
        });
      },
      recordWorkspaceEvent: (event: DesktopWorkspaceEvent) => dispatch({ type: 'recordWorkspaceEvent', event }),
      recordRuntimeEvent: (event: DesktopRuntimeEvent) => dispatch({ type: 'recordRuntimeEvent', event }),
    }),
    [],
  );

  const value = useMemo(() => ({ state, dispatch, actions }), [actions, state]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntimeStore() {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error('useRuntimeStore must be used inside RuntimeStoreProvider');
  }
  return context;
}
