export type ShellKind = 'powershell' | 'pwsh' | 'cmd' | 'sh';
export type ExecutionPath = 'shell_integration' | 'spawn';
export type MirrorMode = 'adapted';

export interface ShellExecutionEnvelope {
  requestedCommand: string;
  adaptedCommand: string;
  shellKind: ShellKind;
  cwd: string;
  mirrorMode: MirrorMode;
  executionPath: ExecutionPath;
  shell: string;
  shellArgs: string[];
}

export interface ModelCatalogState {
  status: 'idle' | 'connecting' | 'loaded' | 'error';
  providerId: string;
  requestOwner: 'app' | 'settings' | 'runtime';
  reachable: boolean;
  lastSuccessAt?: number;
  lastError?: string;
}

export interface ProviderConnectionState {
  reachable: boolean;
  authValid: boolean;
  modelsAvailable: boolean;
  warnings: string[];
}

export interface BrowserArtifactIndexEntry {
  id: string;
  sessionId: string;
  type: 'screenshot' | 'console' | 'dom';
  path: string;
  createdAt: number;
}

export interface RuntimeSnapshot {
  turnId: string;
  phase: 'idle' | 'preflight' | 'llm_request' | 'tool_execution' | 'awaiting_user' | 'completed' | 'failed' | 'aborted';
  model: string;
  providerId: string;
  startedAt: number;
  finishedAt?: number;
  traceFilePath?: string;
}

export interface SessionExportBundleMeta {
  schemaVersion: number;
  sessionId: string;
  exportedAt: number;
  runtimeSnapshots: number;
  browserArtifacts: number;
}
