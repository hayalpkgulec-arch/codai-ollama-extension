import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskController } from './TaskController';
import { DiffViewProvider } from '../integrations/DiffViewProvider';
import { getCodaiTerminal, killBackgroundProcess } from '../tools/impl/RunCommandTool';
import { onBgProcessDied, isBgProcessAlive } from '../integrations/terminal/CodaiTerminalManager';

export function setupWebviewMessageHandler(webview: vscode.Webview, controller: TaskController) {
    webview.onDidReceiveMessage(async (data) => {
        switch (data.type) {
            case 'ready':
                controller.postInitialState();
                if (controller.getSettings().autoIndexOnOpen) {
                    await controller.ensureProjectIndexed();
                }
                break;
            case 'sendMessage':
                await controller._handleMessage(data.message, data.requestId);
                break;
            case 'clearHistory':
                controller.clearHistory();
                break;
            case 'changeModel':
                controller.changeModel(data.model);
                break;
            case 'changeMode':
                if (data.mode) controller.changeMode(data.mode);
                break;
            case 'saveConversation':
                await controller.persistState();
                break;
            case 'updateSystemPrompt':
                if (data.prompt) controller.updateSystemPrompt(data.prompt);
                break;
            case 'updateSettings':
                if (typeof data.autoIndexOnOpen === 'boolean') {
                    controller.updateSettings({ autoIndexOnOpen: data.autoIndexOnOpen });
                }
                break;
            case 'reindexProject':
                await controller.ensureProjectIndexed(true);
                break;
            case 'applyWriteProposal':
                if (typeof data.proposalId === 'string' && data.proposalId) {
                    controller.resolvePendingWriteProposal(data.proposalId, 'approved');
                }
                break;
            case 'rejectWriteProposal':
                if (typeof data.proposalId === 'string' && data.proposalId) {
                    controller.resolvePendingWriteProposal(data.proposalId, 'rejected');
                }
                break;
            case 'abortTask':
                controller.abortCurrentTask();
                break;

            // ── Terminal: open/run in VSCode integrated terminal ──────────
            case 'runInTerminal': {
                const term = getCodaiTerminal();
                term.show(true);
                if (typeof data.command === 'string' && data.command) {
                    term.sendText(data.command, true);
                }
                break;
            }

            // ── Kill background process (e.g. dev server) ─────────────────
            case 'killBgProcess': {
                if (typeof data.bgId === 'string') {
                    killBackgroundProcess(data.bgId);
                    // Immediately notify webview — process is gone
                    webview.postMessage({ type: 'bgProcessDied', bgId: data.bgId, exitCode: null, signal: 'SIGTERM' });
                }
                // Also send Ctrl+C to the shared terminal
                try {
                    const term = getCodaiTerminal();
                    term.show(true);
                    term.sendText('\x03', false); // Ctrl+C
                } catch { /* ignore */ }
                break;
            }

            // ── Register bg process death watcher ─────────────────────────
            // Called by webview when it receives a tool result with a bgId
            case 'watchBgProcess': {
                const bgId = data.bgId;
                if (typeof bgId === 'string' && isBgProcessAlive(bgId)) {
                    onBgProcessDied(bgId, (exitCode, signal) => {
                        // Notify webview when the background process exits naturally
                        webview.postMessage({ type: 'bgProcessDied', bgId, exitCode, signal });
                    });
                }
                break;
            }

            // ── Send text input to running terminal (interactive) ─────────
            case 'sendTerminalInput': {
                if (typeof data.text === 'string' && data.text) {
                    try {
                        const term = getCodaiTerminal();
                        term.show(true);
                        term.sendText(data.text, true); // addNewLine=true → Enter
                    } catch { /* ignore */ }
                }
                break;
            }

            // ── Open file in VSCode editor ────────────────────────────────
            case 'openFile': {
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspaceRoot || !data.path) break;
                try {
                    const absPath = path.isAbsolute(data.path)
                        ? data.path
                        : path.join(workspaceRoot, data.path);
                    const fileUri = vscode.Uri.file(absPath);
                    await vscode.window.showTextDocument(fileUri, {
                        preview: false,
                        preserveFocus: false,
                    });
                } catch (e: any) {
                    vscode.window.showWarningMessage(`CodAI: Cannot open ${data.path}: ${e.message}`);
                }
                break;
            }

            // ── Show VSCode diff view for a file (Cline-style) ───────────
            case 'showDiff': {
                const workspaceRoot2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspaceRoot2) break;
                try {
                    // If path not provided, try to open diff for the active editor
                    const filePath = data.path
                        ? (path.isAbsolute(data.path) ? data.path : path.join(workspaceRoot2, data.path))
                        : vscode.window.activeTextEditor?.document.uri.fsPath;

                    if (!filePath) break;

                    const beforeContent: string = data.before ?? '';
                    const afterContent: string = data.after ?? '';

                    // Use the proper Cline-style diff provider
                    await DiffViewProvider.showDiff(
                        beforeContent,
                        afterContent,
                        filePath,
                        data.mode === 'creating',
                    );
                } catch (e: any) {
                    console.error('CodAI diff error:', e);
                }
                break;
            }
            // BUG 10 FIX: Aktif editördeki dosyayı context olarak gönder
            case 'requestActiveFile': {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    webview.postMessage({ type: 'activeFileResult', file: null });
                    break;
                }
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const filePath = editor.document.uri.fsPath;
                const relativePath = workspaceRoot ? path.relative(workspaceRoot, filePath) : filePath;
                const content = editor.document.getText();
                const selection = editor.selection.isEmpty ? null : editor.document.getText(editor.selection);
                webview.postMessage({
                    type: 'activeFileResult',
                    file: {
                        path: relativePath,
                        language: editor.document.languageId,
                        content: content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content,
                        selection,
                    }
                });
                break;
            }
            // Provider değiştir
            case 'changeProvider': {
                if (data.providerId) {
                    await controller.changeProvider(
                        data.providerId,
                        data.apiKey || '',
                        data.baseUrl || '',
                        Array.isArray(data.apiKeys) ? data.apiKeys : undefined
                    );
                    const keyCount = controller.getLLMKeyCount();
                    webview.postMessage({ type: 'providerChanged', providerId: data.providerId, keyCount });
                }
                break;
            }

            // Provider modellerini çek
            case 'fetchProviderModels': {
                try {
                    const models = await controller.fetchProviderModels();
                    webview.postMessage({ type: 'providerModels', models, error: null });
                } catch (e: any) {
                    webview.postMessage({ type: 'providerModels', models: [], error: e.message });
                }
                break;
            }

            // (eski) Ollama model listesini çek — geriye dönük uyum
            case 'fetchOllamaModels': {
                try {
                    const models = await controller.fetchProviderModels();
                    webview.postMessage({ type: 'ollamaModels', models });
                } catch (e: any) {
                    webview.postMessage({ type: 'ollamaModels', models: [], error: e.message });
                }
                break;
            }
        }
    });
}
