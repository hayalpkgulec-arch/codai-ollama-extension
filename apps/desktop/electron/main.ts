import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

type TreeNode = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: TreeNode[];
};

type ShellKind = 'powershell' | 'pwsh' | 'cmd' | 'sh';

type ShellConfig = {
  shell: string;
  args: string[];
  shellKind: ShellKind;
  isPowerShell: boolean;
};

type ShellExecutionEnvelope = {
  requestedCommand: string;
  adaptedCommand: string;
  shellKind: ShellKind;
  cwd: string;
  mirrorMode: 'adapted';
  executionPath: 'spawn';
  shell: string;
  shellArgs: string[];
};

type TerminalRunResult = {
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
};

type WorkspaceSnapshot = {
  rootPath: string;
  openedAt: number;
  nodes: TreeNode[];
  recentFiles: string[];
  branch: string | null;
};

type WorkspaceEvent =
  | { type: 'workspace-opened'; rootPath: string; branch: string | null; at: number }
  | { type: 'file-opened'; path: string; at: number }
  | { type: 'file-saved'; path: string; at: number };

type RuntimeEvent =
  | { type: 'command-started'; id: string; command: string; cwd: string; shell: ShellExecutionEnvelope; at: number }
  | { type: 'command-finished'; id: string; command: string; result: TerminalRunResult; summary: string; at: number };

const DIRECTORY_IGNORES = new Set(['.git', 'node_modules', 'dist', 'out']);
const MAX_TREE_DEPTH = 3;
const MAX_TREE_ENTRIES = 140;
const MAX_OUTPUT_BYTES = 512 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;

let mainWindow: BrowserWindow | null = null;
let currentWorkspaceRoot: string | null = null;

function emitWorkspaceEvent(event: WorkspaceEvent) {
  mainWindow?.webContents.send('workspace:event', event);
}

function emitRuntimeEvent(event: RuntimeEvent) {
  mainWindow?.webContents.send('runtime:event', event);
}

function createShellConfig(shell: string, args: string[], shellKind: ShellKind): ShellConfig {
  return {
    shell,
    args,
    shellKind,
    isPowerShell: shellKind === 'powershell' || shellKind === 'pwsh',
  };
}

function resolveDesktopShellConfig(): ShellConfig {
  if (process.platform !== 'win32') {
    return createShellConfig('/bin/sh', ['-c'], 'sh');
  }
  return createShellConfig('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command'], 'powershell');
}

function adaptCommandForShell(command: string, config: ShellConfig): string {
  if (!config.isPowerShell) {
    return command;
  }
  return command.replace(/\s*&&\s*/g, '; ');
}

function prependWorkspaceCwd(command: string, cwd: string, config: ShellConfig): string {
  const adapted = adaptCommandForShell(command, config);
  if (!cwd) {
    return adapted;
  }
  if (config.isPowerShell) {
    const escaped = cwd.replace(/'/g, "''");
    return `Set-Location -LiteralPath '${escaped}'; ${adapted}`;
  }
  if (config.shellKind === 'cmd') {
    return `cd /d "${cwd}" && ${adapted}`;
  }
  return `cd "${cwd}" && ${adapted}`;
}

function createShellExecutionEnvelope(command: string, cwd: string, config: ShellConfig): ShellExecutionEnvelope {
  return {
    requestedCommand: command,
    adaptedCommand: adaptCommandForShell(command, config),
    shellKind: config.shellKind,
    cwd,
    mirrorMode: 'adapted',
    executionPath: 'spawn',
    shell: config.shell,
    shellArgs: [...config.args],
  };
}

async function detectGitBranch(rootPath: string): Promise<string | null> {
  try {
    const headPath = path.join(rootPath, '.git', 'HEAD');
    const headValue = await fs.readFile(headPath, 'utf8');
    const match = headValue.match(/ref:\s+refs\/heads\/(.+)\s*$/);
    if (match) {
      return match[1];
    }
    return headValue.trim().slice(0, 8) || null;
  } catch {
    return null;
  }
}

async function buildTree(rootPath: string, depth = 0): Promise<TreeNode[]> {
  if (depth > MAX_TREE_DEPTH) {
    return [];
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const trimmedEntries = entries
    .filter((entry) => !DIRECTORY_IGNORES.has(entry.name))
    .slice(0, MAX_TREE_ENTRIES);

  return Promise.all(trimmedEntries.map(async (entry) => {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      return {
        name: entry.name,
        path: entryPath,
        kind: 'directory' as const,
        children: await buildTree(entryPath, depth + 1),
      };
    }

    return {
      name: entry.name,
      path: entryPath,
      kind: 'file' as const,
    };
  }));
}

async function runShellCommand(command: string, cwd: string): Promise<TerminalRunResult> {
  const startedAt = Date.now();
  const id = `cmd-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const shellConfig = resolveDesktopShellConfig();
  const shellEnvelope = createShellExecutionEnvelope(command, cwd, shellConfig);
  const shellCommand = prependWorkspaceCwd(command, cwd, shellConfig);

  emitRuntimeEvent({
    type: 'command-started',
    id,
    command,
    cwd,
    shell: shellEnvelope,
    at: startedAt,
  });

  return new Promise<TerminalRunResult>((resolve) => {
    const child = spawn(shellConfig.shell, [...shellConfig.args, shellCommand], {
      cwd,
      windowsHide: true,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill();
      } catch {
        // Ignore termination errors.
      }
      const result: TerminalRunResult = {
        id,
        command,
        stdout,
        stderr: stderr || `Timed out after ${Math.round(COMMAND_TIMEOUT_MS / 1000)}s`,
        exitCode: -1,
        durationMs: Date.now() - startedAt,
        startedAt,
        finishedAt: Date.now(),
        cwd,
        shell: shellEnvelope,
      };
      emitRuntimeEvent({
        type: 'command-finished',
        id,
        command,
        result,
        summary: `Command timed out: ${command}`,
        at: Date.now(),
      });
      resolve(result);
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += String(chunk);
      }
    });

    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += String(chunk);
      }
    });

    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      const finishedAt = Date.now();
      const result: TerminalRunResult = {
        id,
        command,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode,
        durationMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
        cwd,
        shell: shellEnvelope,
      };
      emitRuntimeEvent({
        type: 'command-finished',
        id,
        command,
        result,
        summary: exitCode === 0 ? `Command succeeded: ${command}` : `Command failed: ${command}`,
        at: finishedAt,
      });
      resolve(result);
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      const finishedAt = Date.now();
      const result: TerminalRunResult = {
        id,
        command,
        stdout: stdout.trimEnd(),
        stderr: error.message,
        exitCode: -1,
        durationMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
        cwd,
        shell: shellEnvelope,
      };
      emitRuntimeEvent({
        type: 'command-finished',
        id,
        command,
        result,
        summary: `Command errored: ${command}`,
        at: finishedAt,
      });
      resolve(result);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1220,
    minHeight: 760,
    backgroundColor: '#111215',
    title: 'CodAI Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.CODAI_DESKTOP_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('workspace:open-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const rootPath = result.filePaths[0];
  currentWorkspaceRoot = rootPath;
  const snapshot: WorkspaceSnapshot = {
    rootPath,
    openedAt: Date.now(),
    nodes: await buildTree(rootPath),
    recentFiles: [],
    branch: await detectGitBranch(rootPath),
  };

  emitWorkspaceEvent({
    type: 'workspace-opened',
    rootPath,
    branch: snapshot.branch,
    at: snapshot.openedAt,
  });

  return snapshot;
});

ipcMain.handle('workspace:read-file', async (_event, filePath: string) => {
  const content = await fs.readFile(filePath, 'utf8');
  emitWorkspaceEvent({
    type: 'file-opened',
    path: filePath,
    at: Date.now(),
  });
  return {
    path: filePath,
    content,
    openedAt: Date.now(),
  };
});

ipcMain.handle('workspace:write-file', async (_event, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf8');
  const savedAt = Date.now();
  emitWorkspaceEvent({
    type: 'file-saved',
    path: filePath,
    at: savedAt,
  });
  return {
    path: filePath,
    savedAt,
  };
});

ipcMain.handle('runtime:run-command', async (_event, command: string, cwd?: string) => {
  const resolvedCwd = cwd || currentWorkspaceRoot || process.cwd();
  return runShellCommand(command, resolvedCwd);
});

ipcMain.handle('system:platform', async () => process.platform);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
