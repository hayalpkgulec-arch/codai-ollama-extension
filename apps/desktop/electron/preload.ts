import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('codaiDesktop', {
  openWorkspace: () => ipcRenderer.invoke('workspace:open-folder'),
  readFile: (filePath: string) => ipcRenderer.invoke('workspace:read-file', filePath),
  getPlatform: () => ipcRenderer.invoke('system:platform'),
});
