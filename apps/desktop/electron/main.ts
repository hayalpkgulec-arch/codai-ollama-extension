import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';

type TreeNode = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: TreeNode[];
};

const DIRECTORY_IGNORES = new Set(['.git', 'node_modules', 'dist', 'out']);

async function buildTree(rootPath: string, depth = 0): Promise<TreeNode[]> {
  if (depth > 3) {
    return [];
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const trimmedEntries = entries
    .filter((entry) => !DIRECTORY_IGNORES.has(entry.name))
    .slice(0, 120);

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

function createWindow() {
  const window = new BrowserWindow({
    width: 1580,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0c0d10',
    title: 'CodAI Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.CODAI_DESKTOP_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
    return;
  }

  window.loadFile(path.join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('workspace:open-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const rootPath = result.filePaths[0];
  return {
    rootPath,
    openedAt: Date.now(),
    nodes: await buildTree(rootPath),
  };
});

ipcMain.handle('workspace:read-file', async (_event, filePath: string) => {
  const content = await fs.readFile(filePath, 'utf8');
  return {
    path: filePath,
    content,
  };
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
