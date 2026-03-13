import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  useContext,
  useMemo,
  useReducer,
} from 'react';
import type { DesktopFilePayload, DesktopWorkspaceSnapshot } from '../types';
import type { ActivityTab, DesktopTabState, RightPaneTab, SidebarMode } from './types';
import { inferLanguageFromPath } from '../lib/diff';

interface WorkbenchState {
  workspace: DesktopWorkspaceSnapshot | null;
  tabs: DesktopTabState[];
  activeTabPath: string | null;
  sidebarMode: SidebarMode;
  rightPaneTab: RightPaneTab;
  activityTab: ActivityTab;
}

type WorkbenchAction =
  | { type: 'hydrateWorkspace'; workspace: DesktopWorkspaceSnapshot }
  | { type: 'openTab'; payload: DesktopFilePayload }
  | { type: 'setActiveTab'; path: string | null }
  | { type: 'updateTabContent'; path: string; content: string }
  | { type: 'markTabSaved'; path: string; content: string }
  | { type: 'setSidebarMode'; mode: SidebarMode }
  | { type: 'setRightPaneTab'; tab: RightPaneTab }
  | { type: 'setActivityTab'; tab: ActivityTab };

interface WorkbenchContextValue {
  state: WorkbenchState;
  dispatch: Dispatch<WorkbenchAction>;
  actions: {
    hydrateWorkspace: (workspace: DesktopWorkspaceSnapshot) => void;
    openTab: (payload: DesktopFilePayload) => void;
    setActiveTab: (path: string | null) => void;
    updateTabContent: (path: string, content: string) => void;
    markTabSaved: (path: string, content: string) => void;
    setSidebarMode: (mode: SidebarMode) => void;
    setRightPaneTab: (tab: RightPaneTab) => void;
    setActivityTab: (tab: ActivityTab) => void;
  };
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

const initialState: WorkbenchState = {
  workspace: null,
  tabs: [],
  activeTabPath: null,
  sidebarMode: 'threads',
  rightPaneTab: 'review',
  activityTab: 'agent',
};

function reducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'hydrateWorkspace':
      return {
        ...state,
        workspace: action.workspace,
        tabs: [],
        activeTabPath: null,
      };
    case 'openTab': {
      const existingTab = state.tabs.find((tab) => tab.path === action.payload.path);
      if (existingTab) {
        return {
          ...state,
          activeTabPath: existingTab.path,
        };
      }

      const nextTab: DesktopTabState = {
        path: action.payload.path,
        title: action.payload.path.split(/[\\/]/).pop() || action.payload.path,
        language: action.payload.language || inferLanguageFromPath(action.payload.path),
        originalContent: action.payload.content,
        currentContent: action.payload.content,
        openedAt: action.payload.openedAt || Date.now(),
        updatedAt: action.payload.openedAt || Date.now(),
      };

      const recentFiles = state.workspace?.recentFiles ?? [];
      const nextRecentFiles = [action.payload.path, ...recentFiles.filter((path) => path !== action.payload.path)].slice(0, 8);

      return {
        ...state,
        workspace: state.workspace ? { ...state.workspace, recentFiles: nextRecentFiles } : state.workspace,
        tabs: [...state.tabs, nextTab],
        activeTabPath: nextTab.path,
      };
    }
    case 'setActiveTab':
      return { ...state, activeTabPath: action.path };
    case 'updateTabContent':
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.path === action.path
            ? { ...tab, currentContent: action.content, updatedAt: Date.now() }
            : tab
        ),
      };
    case 'markTabSaved':
      return {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.path === action.path
            ? {
                ...tab,
                originalContent: action.content,
                currentContent: action.content,
                updatedAt: Date.now(),
              }
            : tab
        ),
      };
    case 'setSidebarMode':
      return { ...state, sidebarMode: action.mode };
    case 'setRightPaneTab':
      return { ...state, rightPaneTab: action.tab };
    case 'setActivityTab':
      return { ...state, activityTab: action.tab };
    default:
      return state;
  }
}

export function WorkbenchStoreProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const actions = useMemo(
    () => ({
      hydrateWorkspace: (workspace: DesktopWorkspaceSnapshot) => dispatch({ type: 'hydrateWorkspace', workspace }),
      openTab: (payload: DesktopFilePayload) => dispatch({ type: 'openTab', payload }),
      setActiveTab: (path: string | null) => dispatch({ type: 'setActiveTab', path }),
      updateTabContent: (path: string, content: string) => dispatch({ type: 'updateTabContent', path, content }),
      markTabSaved: (path: string, content: string) => dispatch({ type: 'markTabSaved', path, content }),
      setSidebarMode: (mode: SidebarMode) => dispatch({ type: 'setSidebarMode', mode }),
      setRightPaneTab: (tab: RightPaneTab) => dispatch({ type: 'setRightPaneTab', tab }),
      setActivityTab: (tab: ActivityTab) => dispatch({ type: 'setActivityTab', tab }),
    }),
    [],
  );

  const value = useMemo(() => ({ state, dispatch, actions }), [actions, state]);
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbenchStore() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error('useWorkbenchStore must be used inside WorkbenchStoreProvider');
  }
  return context;
}
