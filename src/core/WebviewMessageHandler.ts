import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskController } from './TaskController';

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
