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

export interface WorkspaceSnapshotNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: WorkspaceSnapshotNode[];
}

export interface WorkspaceSnapshot {
  rootPath: string;
  openedAt: number;
  nodes: WorkspaceSnapshotNode[];
  recentFiles?: string[];
  branch?: string | null;
}

export interface TerminalRunResult {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  cwd: string;
  shell: ShellExecutionEnvelope;
}

export type RuntimeEvent =
  | {
      type: 'command-started';
      id: string;
      command: string;
      cwd: string;
      shell: ShellExecutionEnvelope;
      at: number;
    }
  | {
      type: 'command-finished';
      id: string;
      command: string;
      result: TerminalRunResult;
      summary: string;
      at: number;
    };

export type WorkspaceEvent =
  | {
      type: 'workspace-opened';
      rootPath: string;
      branch?: string | null;
      at: number;
    }
  | {
      type: 'file-opened';
      path: string;
      at: number;
    }
  | {
      type: 'file-saved';
      path: string;
      at: number;
    };

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
