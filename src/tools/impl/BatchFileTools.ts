import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { promises as fs } from 'fs';
import * as path from 'path';
import { buildUnifiedLineDiff } from '../../core/diff/lineDiff';

// ── write_multiple_files ────────────────────────────────────────────────────
export class WriteMultipleFilesTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'write_multiple_files',
            description: 'Write or create multiple files in a single operation. Use this instead of calling write_file repeatedly. Each file is written atomically; if one fails the others still complete.',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        description: 'Array of files to write',
                        items: {
                            type: 'object',
                            properties: {
                                path:    { type: 'string', description: 'File path relative to workspace root' },
                                content: { type: 'string', description: 'Content to write' },
                            },
                            required: ['path', 'content']
                        }
                    }
                },
                required: ['files']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return JSON.stringify({ __tool: 'write_multiple_files', status: 'error', error: 'No workspace open', results: [] });

        const files: Array<{ path: string; content: string }> = Array.isArray(args.files) ? args.files : [];
        if (files.length === 0) return JSON.stringify({ __tool: 'write_multiple_files', status: 'error', error: 'No files provided', results: [] });

        const results: Array<{
            path: string; fileName: string; mode: string; status: string;
            addedCount: number; removedCount: number; hunks: any[];
            preview: string; durationMs: number; error?: string;
        }> = [];

        for (const file of files) {
            const inputPath = file.path;
            const contentArg = file.content ?? '';
            const startedAt = Date.now();

            try {
                const resolved = path.isAbsolute(inputPath)
                    ? path.normalize(inputPath)
                    : path.resolve(workspaceRoot, inputPath);
                const relativePath = path.relative(workspaceRoot, resolved);

                if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                    results.push({ path: inputPath, fileName: path.basename(inputPath), mode: 'unknown', status: 'error', addedCount: 0, removedCount: 0, hunks: [], preview: '', durationMs: Date.now() - startedAt, error: 'Path outside workspace' });
                    continue;
                }

                const filePath = path.join(workspaceRoot, relativePath);
                const fileName = path.basename(relativePath);
                let mode = 'creating';
                let beforeContent = '';

                try {
                    const stat = await fs.stat(filePath);
                    if (stat.isDirectory()) throw new Error('Path is a directory');
                    mode = 'editing';
                    beforeContent = await fs.readFile(filePath, 'utf-8');
                } catch (e: any) {
                    if (e.code !== 'ENOENT') throw e;
                    mode = 'creating';
                }

                const afterContent = String(contentArg);
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await fs.writeFile(filePath, afterContent, 'utf-8');
                const finishedAt = Date.now();

                const diff = buildUnifiedLineDiff(beforeContent, afterContent, { maxEntries: 200, contextRadius: 2 });
                const preview = afterContent.split(/\r?\n/).slice(0, 8).join('\n');

                results.push({ path: relativePath, fileName, mode, status: 'success', addedCount: diff.addedCount, removedCount: diff.removedCount, hunks: diff.entries, preview, durationMs: finishedAt - startedAt });
            } catch (err: any) {
                results.push({ path: inputPath, fileName: path.basename(inputPath), mode: 'unknown', status: 'error', addedCount: 0, removedCount: 0, hunks: [], preview: '', durationMs: Date.now() - startedAt, error: err?.message || 'Write failed' });
            }
        }

        const successCount = results.filter(r => r.status === 'success').length;
        const errorCount   = results.filter(r => r.status === 'error').length;

        return JSON.stringify({
            __tool: 'write_multiple_files',
            status: errorCount === results.length ? 'error' : 'success',
            summary: errorCount === 0
                ? `Written ${successCount} file${successCount !== 1 ? 's' : ''}`
                : `${successCount} written, ${errorCount} failed`,
            successCount,
            errorCount,
            results
        });
    }
}

// ── delete_multiple_files ───────────────────────────────────────────────────
export class DeleteMultipleFilesTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'delete_multiple_files',
            description: 'Delete multiple files or directories in a single operation. Use this instead of calling delete_file repeatedly.',
            parameters: {
                type: 'object',
                properties: {
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of file paths to delete, relative to workspace root'
                    }
                },
                required: ['paths']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return JSON.stringify({ __tool: 'delete_multiple_files', status: 'error', error: 'No workspace open', results: [] });

        const paths: string[] = Array.isArray(args.paths) ? args.paths : [];
        if (paths.length === 0) return JSON.stringify({ __tool: 'delete_multiple_files', status: 'error', error: 'No paths provided', results: [] });

        const results: Array<{ path: string; status: string; error?: string }> = [];

        for (const inputPath of paths) {
            try {
                const resolved = path.isAbsolute(inputPath)
                    ? path.normalize(inputPath)
                    : path.resolve(workspaceRoot, inputPath);
                const relativePath = path.relative(workspaceRoot, resolved);

                if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                    results.push({ path: inputPath, status: 'error', error: 'Path outside workspace' });
                    continue;
                }

                const filePath = path.join(workspaceRoot, relativePath);
                await fs.rm(filePath, { recursive: true, force: true });
                results.push({ path: relativePath, status: 'success' });
            } catch (err: any) {
                results.push({ path: inputPath, status: 'error', error: err?.message || 'Delete failed' });
            }
        }

        const successCount = results.filter(r => r.status === 'success').length;
        const errorCount   = results.filter(r => r.status === 'error').length;

        return JSON.stringify({
            __tool: 'delete_multiple_files',
            status: errorCount === results.length ? 'error' : 'success',
            summary: errorCount === 0
                ? `Deleted ${successCount} file${successCount !== 1 ? 's' : ''}`
                : `${successCount} deleted, ${errorCount} failed`,
            successCount,
            errorCount,
            results
        });
    }
}
