import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskController } from './TaskController';

// ── Shared VSCode terminal used by AI commands ─────────────────────────────
let _sharedTerminal: vscode.Terminal | undefined;
function getSharedTerminal(): vscode.Terminal {
    if (!_sharedTerminal || _sharedTerminal.exitStatus !== undefined) {
        _sharedTerminal = vscode.window.createTerminal({
            name: 'CodAI',
            iconPath: new vscode.ThemeIcon('sparkle'),
        });
    }
    return _sharedTerminal;
}

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

            // ── Terminal: AI command → VSCode integrated terminal ─────────
            case 'runInTerminal': {
                if (typeof data.command === 'string' && data.command) {
                    const term = getSharedTerminal();
                    term.show(true); // preserveFocus=true
                    term.sendText(data.command, true);
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

            // ── Show VSCode diff view for a file ──────────────────────────
            case 'showDiff': {
                const workspaceRoot2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!workspaceRoot2 || !data.path) break;
                try {
                    const absPath2 = path.isAbsolute(data.path)
                        ? data.path
                        : path.join(workspaceRoot2, data.path);

                    // Write "before" content to a temp virtual document
                    const beforeContent: string = data.before ?? '';
                    const afterContent: string = data.after ?? '';

                    // Use the git diff scheme or a simple in-memory provider approach.
                    // We store before content in a temp file in /tmp and diff against current.
                    const os = require('os');
                    const crypto = require('crypto');
                    const hash = crypto.createHash('md5').update(absPath2).digest('hex').slice(0, 8);
                    const tmpDir = path.join(os.tmpdir(), 'codai-diff');
                    fs.mkdirSync(tmpDir, { recursive: true });
                    const tmpFile = path.join(tmpDir, `before-${hash}-${path.basename(absPath2)}`);
                    fs.writeFileSync(tmpFile, beforeContent, 'utf-8');

                    const leftUri = vscode.Uri.file(tmpFile).with({ scheme: 'file' });
                    const rightUri = vscode.Uri.file(absPath2);
                    const title = `${path.basename(absPath2)} (AI changes)`;

                    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
                        preview: true,
                    });
                } catch (e: any) {
                    // Silently ignore diff errors — not critical
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
