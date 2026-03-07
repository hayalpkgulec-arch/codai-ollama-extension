import * as vscode from 'vscode';
import { ChatViewProvider } from './providers/ChatViewProvider';
import { UpdaterService } from './services/UpdaterService';
import { DiffViewProvider } from './integrations/DiffViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('CodAI Ollama extension activated');

    // ── Register diff content provider (codai-diff:// URI scheme) ────────────
    DiffViewProvider.registerProvider(context);

    // ── Auto-updater ──────────────────────────────────────────────────────────
    const updater = new UpdaterService(context);
    updater.start();

    const config = vscode.workspace.getConfiguration('codai');
    const ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
    const defaultModel = config.get<string>('model', 'minimax-m2:cloud');

    const chatProvider = new ChatViewProvider(context.extensionUri, context, ollamaUrl, defaultModel);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codai.chatView', chatProvider)
    );

    // Sidebar açma komutu
    context.subscriptions.push(
        vscode.commands.registerCommand('codai.chat', () => {
            vscode.commands.executeCommand('workbench.view.extension.codai-sidebar');
        })
    );

    // Durum Çubuğu (Status Bar)
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = `$(sparkle) CodAI`;
    statusBarItem.tooltip = "CodAI: AI Asistanını Aç";
    statusBarItem.command = 'codai.chat';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Sağ Tık: Kodu Açıkla
    context.subscriptions.push(
        vscode.commands.registerCommand('codai.explainCode', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.document.getText(editor.selection);
                if (selection) {
                    const message = `Lütfen şu kodu açıkla:\n\`\`\`${editor.document.languageId}\n${selection}\n\`\`\``;
                    chatProvider.sendMessage(message);
                }
            }
        })
    );

    // Sağ Tık: Refaktör Et
    context.subscriptions.push(
        vscode.commands.registerCommand('codai.refactorCode', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.document.getText(editor.selection);
                if (selection) {
                    const message = `Lütfen şu kodu daha temiz, okunabilir ve performanslı olacak şekilde refaktör et:\n\`\`\`${editor.document.languageId}\n${selection}\n\`\`\``;
                    chatProvider.sendMessage(message);
                }
            }
        })
    );
}

export function deactivate() {}
