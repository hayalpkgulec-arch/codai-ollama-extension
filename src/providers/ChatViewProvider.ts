import * as vscode from 'vscode';
import { TaskController } from '../core/TaskController';
import { setupWebviewMessageHandler } from '../core/WebviewMessageHandler';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private controller: TaskController;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        ollamaUrl: string,
        defaultModel: string
    ) {
        this.controller = new TaskController(_extensionUri, _extensionContext, ollamaUrl, defaultModel);
    }

    public sendMessage(message: string) {
        this.controller._handleMessage(message);
        vscode.commands.executeCommand('workbench.view.extension.codai-sidebar');
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this.controller.setWebview(webviewView.webview);
        setupWebviewMessageHandler(webviewView.webview, this.controller);

        // Send initial state once the webview JS has loaded (~300ms is plenty)
        setTimeout(() => this.controller.postInitialState(), 300);

        // Re-send when the panel becomes visible again (e.g. user switches tabs)
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                setTimeout(() => this.controller.postInitialState(), 150);
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'build', 'assets', 'index.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview-ui', 'build', 'assets', 'index.css'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CodAI Chat</title>
    <link rel="stylesheet" type="text/css" href="${styleUri}">
</head>
<body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
