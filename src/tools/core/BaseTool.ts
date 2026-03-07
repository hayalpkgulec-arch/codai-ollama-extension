import { Tool } from '../../core/types';
import * as vscode from 'vscode';

export interface ITool {
    definition: Tool;
    execute(args: any): Promise<any>;
}

export abstract class BaseTool implements ITool {
    abstract get definition(): Tool;
    abstract execute(args: any): Promise<any>;

    /** Aktif çalışma alanı dizinini döndürür */
    protected getWorkspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    /**
     * Centralised webview message emitter.
     * Uses the globally-registered webview handle set by extension.ts.
     * All tools should use this instead of duplicating the logic.
     */
    protected emitToWebview(type: string, payload: Record<string, unknown>): void {
        const view = (globalThis as any).__codaiWebview as vscode.Webview | undefined;
        if (view) {
            view.postMessage({ type, ...payload });
        }
    }
}
