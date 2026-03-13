import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('codaiDesktop', {
  openWorkspace: () => ipcRenderer.invoke('workspace:open-folder'),
  readFile: (filePath: string) => ipcRenderer.invoke('workspace:read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('workspace:write-file', filePath, content),
  runCommand: (command: string, cwd?: string) => ipcRenderer.invoke('runtime:run-command', command, cwd),
  getPlatform: () => ipcRenderer.invoke('system:platform'),
  onRuntimeEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('runtime:event', listener);
    return () => ipcRenderer.removeListener('runtime:event', listener);
  },
  onWorkspaceEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('workspace:event', listener);
    return () => ipcRenderer.removeListener('workspace:event', listener);
  },
});
