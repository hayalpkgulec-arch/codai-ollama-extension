/**
 * DiffViewProvider — Cline-inspired VSCode diff integration.
 *
 * How it works (same pattern as Cline's VscodeDiffViewProvider):
 * 1. Register a custom TextDocumentContentProvider for "codai-diff" URI scheme
 * 2. Before content is stored in the URI query as base64
 * 3. vscode.diff() opens left (codai-diff:filename?<base64>) vs right (file:///actual/path)
 * 4. VSCode renders the red/green diff editor natively
 *
 * Usage:
 *   DiffViewProvider.registerProvider(context)   ← call once at activation
 *   await DiffViewProvider.showDiff(before, after, absolutePath, title?)
 *   await DiffViewProvider.closeDiff(absolutePath)
 */

import * as path from 'path';
import * as vscode from 'vscode';

export const CODAI_DIFF_SCHEME = 'codai-diff';

// ── TextDocumentContentProvider ──────────────────────────────────────────────
class CodaiDiffContentProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
        // Content is stored as base64 in the query string
        try {
            return Buffer.from(uri.query, 'base64').toString('utf8');
        } catch {
            return '';
        }
    }
}

const _provider = new CodaiDiffContentProvider();
let _registered = false;

export class DiffViewProvider {

    /**
     * Register the content provider.
     * Must be called once during extension activation.
     */
    static registerProvider(context: vscode.ExtensionContext): void {
        if (_registered) return;
        _registered = true;
        const disposable = vscode.workspace.registerTextDocumentContentProvider(
            CODAI_DIFF_SCHEME,
            _provider,
        );
        context.subscriptions.push(disposable);
    }

    /**
     * Open VSCode's native diff editor showing before ↔ after.
     * Left panel = original (read-only virtual document via codai-diff:// scheme)
     * Right panel = actual file (editable, shows red/green highlights natively)
     *
     * @param beforeContent  Original file content (empty string for new files)
     * @param afterContent   New file content after AI edit
     * @param absolutePath   Absolute path to the file on disk
     * @param isNewFile      Whether this is a newly created file
     */
    static async showDiff(
        beforeContent: string,
        afterContent: string,
        absolutePath: string,
        isNewFile: boolean = false,
    ): Promise<void> {
        if (!absolutePath) return;

        const fileName = path.basename(absolutePath);

        // ── Build left URI (virtual "before" document) ────────────────────────
        // Encode before content as base64 in the query string — same as Cline
        const base64Before = Buffer.from(beforeContent ?? '').toString('base64');

        // Sanitize filename for use in URI (percent-encode special chars)
        const safeFileName = fileName
            .replace(/%/g, '%25')
            .replace(/#/g, '%23')
            .replace(/\?/g, '%3F');

        const leftUri = vscode.Uri.parse(`${CODAI_DIFF_SCHEME}:${safeFileName}`).with({
            query: base64Before,
        });

        const rightUri = vscode.Uri.file(absolutePath);

        // ── Check if diff is already open — reuse if so ───────────────────────
        const existingDiffTab = vscode.window.tabGroups.all
            .flatMap((tg) => tg.tabs)
            .find((tab) =>
                tab.input instanceof vscode.TabInputTextDiff &&
                (tab.input as vscode.TabInputTextDiff).original?.scheme === CODAI_DIFF_SCHEME &&
                (tab.input as vscode.TabInputTextDiff).modified?.fsPath === rightUri.fsPath,
            );

        if (existingDiffTab) {
            // Already open — close to refresh
            try { await vscode.window.tabGroups.close(existingDiffTab); } catch { /* ignore */ }
        }

        const title = isNewFile
            ? `${fileName}: New File (AI Created)`
            : `${fileName}: Original ↔ CodAI Changes`;

        // ── Open the diff editor ──────────────────────────────────────────────
        await vscode.commands.executeCommand(
            'vscode.diff',
            leftUri,
            rightUri,
            title,
            { preview: true, preserveFocus: true },
        );
    }

    /**
     * Close any open diff views for a given file path.
     */
    static async closeDiff(absolutePath: string): Promise<void> {
        const tabs = vscode.window.tabGroups.all
            .flatMap((tg) => tg.tabs)
            .filter(
                (tab) =>
                    tab.input instanceof vscode.TabInputTextDiff &&
                    (tab.input as vscode.TabInputTextDiff).original?.scheme === CODAI_DIFF_SCHEME &&
                    (tab.input as vscode.TabInputTextDiff).modified?.fsPath ===
                        vscode.Uri.file(absolutePath).fsPath,
            );

        for (const tab of tabs) {
            if (!tab.isDirty) {
                try { await vscode.window.tabGroups.close(tab); } catch { /* ignore */ }
            }
        }
    }
}
