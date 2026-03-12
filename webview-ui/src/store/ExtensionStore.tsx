import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type PropsWithChildren,
} from 'react';
import { DEFAULT_PROVIDER, PROVIDERS, type ProviderId } from '../catalog/providerCatalog';
import type {
  AgentMode,
  ModelDef,
  ProviderModelsFetchState,
  ProviderSavedConfig,
} from '../types';

interface ProviderInfoState {
  providerId: string;
  hasApiKey: boolean;
  baseUrl: string;
  configs: Record<string, ProviderSavedConfig>;
}

export interface ExtensionState {
  mode: AgentMode;
  initialModel: string | null;
  selectedModel: ModelDef;
  activeFileContext: any | null;
  ollamaModels: ModelDef[];
  providerModelsById: Partial<Record<ProviderId, ModelDef[]>>;
  providerModelFetchStateById: Partial<Record<ProviderId, ProviderModelsFetchState>>;
  providerInfo: ProviderInfoState;
}

type ExtensionAction =
  | { type: 'patch'; patch: Partial<ExtensionState> }
  | { type: 'setProviderModels'; providerId: ProviderId; models: ModelDef[] }
  | { type: 'setProviderModelFetchState'; providerId: ProviderId; fetchState: ProviderModelsFetchState }
  | { type: 'clearProviderModelFetchState'; providerId: ProviderId };

interface ExtensionContextValue {
  state: ExtensionState;
  dispatch: Dispatch<ExtensionAction>;
  actions: {
    patch: (patch: Partial<ExtensionState>) => void;
    setProviderModels: (providerId: ProviderId, models: ModelDef[]) => void;
    setProviderModelFetchState: (providerId: ProviderId, fetchState: ProviderModelsFetchState) => void;
    clearProviderModelFetchState: (providerId: ProviderId) => void;
  };
}

const defaultProvider = PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER) ?? PROVIDERS[0];
const defaultModel: ModelDef = {
  id: defaultProvider?.defaultModels[0]?.id || 'qwen2.5-coder:32b',
  label: defaultProvider?.defaultModels[0]?.label || 'Qwen2.5 Coder 32B',
  tag: defaultProvider?.isLocal ? 'local' : 'cloud',
};

const initialState: ExtensionState = {
  mode: 'code',
  initialModel: null,
  selectedModel: defaultModel,
  activeFileContext: null,
  ollamaModels: [],
  providerModelsById: {},
  providerModelFetchStateById: {},
  providerInfo: {
    providerId: DEFAULT_PROVIDER,
    hasApiKey: false,
    baseUrl: defaultProvider?.baseUrl || 'http://localhost:11434',
    configs: {},
  },
};

const ExtensionStoreContext = createContext<ExtensionContextValue | null>(null);

function extensionReducer(state: ExtensionState, action: ExtensionAction): ExtensionState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'setProviderModels':
      return {
        ...state,
        providerModelsById: {
          ...state.providerModelsById,
          [action.providerId]: action.models,
        },
      };
    case 'setProviderModelFetchState':
      return {
        ...state,
        providerModelFetchStateById: {
          ...state.providerModelFetchStateById,
          [action.providerId]: action.fetchState,
        },
      };
    case 'clearProviderModelFetchState': {
      const next = { ...state.providerModelFetchStateById };
      delete next[action.providerId];
      return {
        ...state,
        providerModelFetchStateById: next,
      };
    }
    default:
      return state;
  }
}

export function ExtensionStoreProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(extensionReducer, initialState);

  const actions = useMemo(
    () => ({
      patch: (patch: Partial<ExtensionState>) => dispatch({ type: 'patch', patch }),
      setProviderModels: (providerId: ProviderId, models: ModelDef[]) =>
        dispatch({ type: 'setProviderModels', providerId, models }),
      setProviderModelFetchState: (providerId: ProviderId, fetchState: ProviderModelsFetchState) =>
        dispatch({ type: 'setProviderModelFetchState', providerId, fetchState }),
      clearProviderModelFetchState: (providerId: ProviderId) =>
        dispatch({ type: 'clearProviderModelFetchState', providerId }),
    }),
    [],
  );

  const value = useMemo(() => ({ state, dispatch, actions }), [actions, state]);
  return <ExtensionStoreContext.Provider value={value}>{children}</ExtensionStoreContext.Provider>;
}

export function useExtensionStore() {
  const context = useContext(ExtensionStoreContext);
  if (!context) {
    throw new Error('useExtensionStore must be used inside ExtensionStoreProvider');
  }
  return context;
}

export function useExtensionActions() {
  return useExtensionStore().actions;
}
