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
}

export interface DesktopFilePayload {
  path: string;
  content: string;
}

declare global {
  interface Window {
    codaiDesktop: {
      openWorkspace(): Promise<DesktopWorkspaceSnapshot | null>;
      readFile(filePath: string): Promise<DesktopFilePayload>;
      getPlatform(): Promise<string>;
    };
  }
}

export {};
