export interface DesktopShellExecutionEnvelope {
  requestedCommand: string;
  adaptedCommand: string;
  shellKind: 'powershell' | 'pwsh' | 'cmd' | 'sh';
  cwd: string;
  mirrorMode: 'adapted';
  executionPath: 'spawn';
  shell: string;
  shellArgs: string[];
}

export interface DesktopTreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: DesktopTreeNode[];
}

export interface DesktopWorkspaceSnapshot {
  rootPath: string;
  openedAt: number;
  nodes: DesktopTreeNode[];
  recentFiles?: string[];
  branch?: string | null;
}

export interface DesktopFilePayload {
  path: string;
  content: string;
  language?: string;
  openedAt?: number;
}

export interface DesktopTerminalRunResult {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  cwd: string;
  shell: DesktopShellExecutionEnvelope;
}

export type DesktopWorkspaceEvent =
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

export type DesktopRuntimeEvent =
  | {
      type: 'command-started';
      id: string;
      command: string;
      cwd: string;
      shell: DesktopShellExecutionEnvelope;
      at: number;
    }
  | {
      type: 'command-finished';
      id: string;
      command: string;
      result: DesktopTerminalRunResult;
      summary: string;
      at: number;
    };

export interface DesktopIpcApi {
  openWorkspace(): Promise<DesktopWorkspaceSnapshot | null>;
  readFile(filePath: string): Promise<DesktopFilePayload>;
  writeFile(filePath: string, content: string): Promise<{ path: string; savedAt: number }>;
  runCommand(command: string, cwd?: string): Promise<DesktopTerminalRunResult>;
  getPlatform(): Promise<string>;
  onRuntimeEvent(callback: (event: DesktopRuntimeEvent) => void): () => void;
  onWorkspaceEvent(callback: (event: DesktopWorkspaceEvent) => void): () => void;
}

declare global {
  interface Window {
    codaiDesktop: DesktopIpcApi;
  }
}

export {};
