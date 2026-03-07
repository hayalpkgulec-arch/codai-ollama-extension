import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { promises as fs } from 'fs';
import * as path from 'path';

export class ListFilesTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'list_files',
            description: 'List files and directories in a workspace path',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The directory path relative to workspace root' }
                },
                required: ['path']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const inputPath = args.path || args.dir || '.';
        const resolved = path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.resolve(workspaceRoot, inputPath);
        const relativePath = path.relative(workspaceRoot, resolved);

        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return 'Error: Path outside workspace';

        const dirPath = path.join(workspaceRoot, relativePath);
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const result = entries.map((entry) => ({
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file'
            }));
            return JSON.stringify(result, null, 2);
        } catch (error: any) {
            return `Error: ${error.message}`;
        }
    }
}

export class DeleteFileTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'delete_file',
            description: 'Delete a file from the workspace',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The file path relative to workspace root to delete' }
                },
                required: ['path']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const inputPath = args.path || args.file;
        const resolved = path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.resolve(workspaceRoot, inputPath);
        const relativePath = path.relative(workspaceRoot, resolved);

        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return 'Error: Path outside workspace';

        try {
            await fs.unlink(path.join(workspaceRoot, relativePath));
            return `File deleted successfully: ${relativePath}`;
        } catch (error: any) {
            return `Error: ${error.message}`;
        }
    }
}

export class RenameFileTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'rename_file',
            description: 'Rename or move a file in the workspace',
            parameters: {
                type: 'object',
                properties: {
                    oldPath: { type: 'string', description: 'Current file path' },
                    newPath: { type: 'string', description: 'New file path' }
                },
                required: ['oldPath', 'newPath']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const oldInput = args.oldPath || args.source;
        const newInput = args.newPath || args.target;

        const oldResolved = path.isAbsolute(oldInput) ? path.normalize(oldInput) : path.resolve(workspaceRoot, oldInput);
        const newResolved = path.isAbsolute(newInput) ? path.normalize(newInput) : path.resolve(workspaceRoot, newInput);

        try {
            await fs.mkdir(path.dirname(newResolved), { recursive: true });
            await fs.rename(oldResolved, newResolved);
            return `File renamed/moved successfully`;
        } catch (error: any) {
            return `Error: ${error.message}`;
        }
    }
}

// ── SearchFilesTool — enhanced with optional content filter ──────────────────
export class SearchFilesTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'search_files',
            description: 'Search for files by name pattern in the workspace. Optionally filter by content.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'File name pattern (e.g. "*.ts", "App*")' },
                    path: { type: 'string', description: 'Directory to search in (default: workspace root)' },
                    contains: { type: 'string', description: 'Optional: only return files whose content includes this string' }
                },
                required: ['pattern']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const searchRoot = path.resolve(workspaceRoot, args.path || '.');
        const pattern = String(args.pattern || '*');
        const nameRegex = new RegExp(
            '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
            'i'
        );
        const contentFilter: string | null = args.contains ? String(args.contains) : null;
        const results: string[] = [];
        const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.vscodium-server']);

        const walk = async (dir: string): Promise<void> => {
            if (results.length >= 100) return;
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (results.length >= 100) break;
                    if (SKIP.has(entry.name)) continue;
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(fullPath);
                    } else if (nameRegex.test(entry.name)) {
                        if (contentFilter) {
                            try {
                                const content = await fs.readFile(fullPath, 'utf-8');
                                if (!content.includes(contentFilter)) continue;
                            } catch { continue; }
                        }
                        results.push(path.relative(workspaceRoot, fullPath));
                    }
                }
            } catch { /* ignore permission errors */ }
        };

        await walk(searchRoot);
        if (results.length === 0) {
            return `No files found matching "${pattern}"${contentFilter ? ` containing "${contentFilter}"` : ''}`;
        }
        return `Found ${results.length} file${results.length > 1 ? 's' : ''}:\n${results.join('\n')}`;
    }
}
