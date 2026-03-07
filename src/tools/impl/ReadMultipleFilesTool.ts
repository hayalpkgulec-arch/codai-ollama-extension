import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { promises as fs } from 'fs';
import * as path from 'path';

// ── Ignore patterns — rate limit'i azaltmak için gereksiz büyük dosyalar ──────
const IGNORE_PATTERNS = [
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /bun\.lockb$/,
    /\.min\.(js|css)$/,
    /node_modules/,
    /\.git\//,
    /dist\//,
    /build\//,
    /\.next\//,
    /\.nuxt\//,
    /coverage\//,
    /\.cache\//,
    /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|tar|gz)$/i,
];

function shouldIgnore(filePath: string): boolean {
    return IGNORE_PATTERNS.some(p => p.test(filePath));
}

function truncate(content: string, maxLines = 300): string {
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    return lines.slice(0, maxLines).join('\n') + `\n...[truncated — ${lines.length - maxLines} more lines]`;
}

/**
 * read_multiple_files — tek LLM turunda N dosya okur.
 * Rate limit hit sayısını 1/N'e indirir.
 */
export class ReadMultipleFilesTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'read_multiple_files',
            description: [
                'Read multiple files in a single call. Use this instead of calling read_file multiple times.',
                'IMPORTANT: Prefer this tool whenever you need to read 2 or more files — it reduces API calls significantly.',
                'Automatically skips large/binary files (package-lock.json, node_modules, images, etc.).',
                'Returns all file contents concatenated with clear separators.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of file paths relative to workspace root. E.g. ["src/index.ts", "package.json", "README.md"]',
                    },
                    max_lines_per_file: {
                        type: 'number',
                        description: 'Max lines to read per file (default: 300, max: 500). Prevents context overflow.',
                    },
                },
                required: ['paths'],
            },
        };
    }

    async execute(args: any): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const paths: string[] = Array.isArray(args.paths) ? args.paths : [];
        if (paths.length === 0) return 'Error: No paths provided';

        const maxLines = Math.min(Number(args.max_lines_per_file) || 300, 500);
        const results: string[] = [];
        let skipped = 0;

        for (const inputPath of paths) {
            if (!inputPath || typeof inputPath !== 'string') continue;

            if (shouldIgnore(inputPath)) {
                results.push(`## ${inputPath}\n[Skipped — large/binary/lock file]`);
                skipped++;
                continue;
            }

            const resolved = path.isAbsolute(inputPath)
                ? path.normalize(inputPath)
                : path.resolve(workspaceRoot, inputPath);
            const relative = path.relative(workspaceRoot, resolved);

            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                results.push(`## ${inputPath}\n[Error: path outside workspace]`);
                continue;
            }

            const fullPath = path.join(workspaceRoot, relative);
            try {
                const stat = await fs.stat(fullPath);
                if (stat.isDirectory()) {
                    results.push(`## ${inputPath}\n[Directory — use list_files to browse]`);
                    continue;
                }
                // 512KB üzeri dosyaları atla
                if (stat.size > 512 * 1024) {
                    results.push(`## ${inputPath}\n[Skipped — file too large (${Math.round(stat.size / 1024)}KB)]`);
                    skipped++;
                    continue;
                }
                const content = await fs.readFile(fullPath, 'utf-8');
                const truncated = truncate(content, maxLines);
                const lineCount = content.split('\n').length;
                results.push(`## ${inputPath} (${lineCount} lines)\n${truncated}`);
            } catch (err: any) {
                results.push(`## ${inputPath}\n[Error: ${err.message}]`);
            }
        }

        const header = `Read ${paths.length} files (${skipped} skipped):\n\n`;
        return header + results.join('\n\n---\n\n');
    }
}

/**
 * list_directory_tree — bir dizini recursive olarak tek çağrıda tarar.
 * Model'in "list → list → list" döngüsünü önler.
 */
export class ListDirectoryTreeTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'list_directory_tree',
            description: [
                'List a directory and all its subdirectories recursively in a single call.',
                'Use this instead of calling list_files multiple times for nested directories.',
                'Returns a tree structure with file/folder names.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Directory path relative to workspace root (default: "." for root)',
                    },
                    max_depth: {
                        type: 'number',
                        description: 'Maximum directory depth (default: 3, max: 5)',
                    },
                    include_files: {
                        type: 'boolean',
                        description: 'Include files in listing (default: true)',
                    },
                },
                required: [],
            },
        };
    }

    async execute(args: any): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const inputPath = args.path || '.';
        const maxDepth = Math.min(Number(args.max_depth) || 3, 5);
        const includeFiles = args.include_files !== false;

        const resolved = path.isAbsolute(inputPath)
            ? path.normalize(inputPath)
            : path.resolve(workspaceRoot, inputPath);
        const relative = path.relative(workspaceRoot, resolved);

        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return 'Error: Path is outside workspace';
        }

        const targetPath = path.join(workspaceRoot, relative || '.');
        const lines: string[] = [];
        let fileCount = 0;
        let dirCount = 0;

        const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache', '__pycache__']);

        async function walk(dir: string, depth: number, prefix: string) {
            if (depth > maxDepth) { lines.push(`${prefix}... (max depth reached)`); return; }
            let entries: any[];
            try { entries = await fs.readdir(dir, { withFileTypes: true }); }
            catch { return; }

            entries.sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                return a.name.localeCompare(b.name);
            });

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const isLast = i === entries.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                const childPrefix = isLast ? prefix + '    ' : prefix + '│   ';

                if (entry.isDirectory()) {
                    if (SKIP_DIRS.has(entry.name)) {
                        lines.push(`${prefix}${connector}📁 ${entry.name}/ [skipped]`);
                        continue;
                    }
                    lines.push(`${prefix}${connector}📁 ${entry.name}/`);
                    dirCount++;
                    await walk(path.join(dir, entry.name), depth + 1, childPrefix);
                } else if (includeFiles) {
                    lines.push(`${prefix}${connector}📄 ${entry.name}`);
                    fileCount++;
                }

                if (lines.length > 500) { lines.push(`${prefix}... (too many entries)`); break; }
            }
        }

        const rootLabel = relative || '.';
        lines.push(`📁 ${rootLabel}/`);
        await walk(targetPath, 1, '');

        return `Directory tree for "${rootLabel}" (depth: ${maxDepth}):\n${lines.join('\n')}\n\n${dirCount} directories, ${fileCount} files`;
    }
}
