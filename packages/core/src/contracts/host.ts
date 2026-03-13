export interface WorkspaceTreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: WorkspaceTreeNode[];
}

export interface ActiveSelectionContext {
  path: string;
  content: string;
  language?: string;
  startLine?: number;
  endLine?: number;
}

export interface WorkspaceHost {
  getWorkspaceRoot(): Promise<string | null>;
  openWorkspace(): Promise<string | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listTree(rootPath: string): Promise<WorkspaceTreeNode[]>;
}

export interface EditorHost {
  openFile(path: string): Promise<void>;
  revealRange(path: string, startLine: number, endLine?: number): Promise<void>;
  getActiveSelectionContext(): Promise<ActiveSelectionContext | null>;
}

export interface TerminalHost {
  run(command: string, cwd?: string): Promise<void>;
  mirror(command: string, cwd?: string): Promise<void>;
  stopActive(): Promise<void>;
}

export interface BrowserHost {
  ensureSession(): Promise<string>;
  closeSession(sessionId: string): Promise<void>;
}

export interface NotificationHost {
  info(message: string): Promise<void>;
  warning(message: string): Promise<void>;
  error(message: string): Promise<void>;
}
