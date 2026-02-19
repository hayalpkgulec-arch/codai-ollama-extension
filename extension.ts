import * as vscode from 'vscode';
import { ChatProvider } from './chatProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('CodAI Ollama extension activated');

    const config = vscode.workspace.getConfiguration('codai');
    const ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');
    const defaultModel = config.get<string>('model', 'qwen3-coder:480b-cloud');

    const chatProvider = new ChatProvider(context.extensionUri, ollamaUrl, defaultModel);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codai.chatView', chatProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('codai.chat', () => {
            vscode.commands.executeCommand('workbench.view.extension.codai-sidebar');
        })
    );
}

export function deactivate() {}
