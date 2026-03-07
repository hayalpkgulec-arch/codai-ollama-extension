import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import * as path from 'path';
import { promises as fs } from 'fs';

// ── web_fetch ────────────────────────────────────────────────────────────────
// Fetches content from a URL. Useful for documentation, APIs, etc.
export class WebFetchTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'web_fetch',
            description: 'Fetch content from a URL (documentation, APIs, web pages). Returns the response body as text. Supports HTTP and HTTPS.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to fetch'
                    },
                    maxChars: {
                        type: 'number',
                        description: 'Maximum characters to return (default: 8000)'
                    }
                },
                required: ['url']
            }
        };
    }

    async execute(args: { url: string; maxChars?: number }): Promise<string> {
        const targetUrl = args.url?.trim();
        const maxChars = args.maxChars ?? 8000;

        if (!targetUrl) return 'Error: No URL provided';
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            return 'Error: Only http:// and https:// URLs are supported';
        }

        return new Promise<string>((resolve) => {
            const parsed = url.parse(targetUrl);
            const lib = parsed.protocol === 'https:' ? https : http;
            const startedAt = Date.now();

            const req = lib.get(targetUrl, { headers: { 'User-Agent': 'CodAI/1.0' } }, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    let body = Buffer.concat(chunks).toString('utf-8');
                    // Strip HTML tags for cleaner content
                    body = body
                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    if (body.length > maxChars) {
                        body = body.slice(0, maxChars) + '\n... [truncated]';
                    }
                    const ms = Date.now() - startedAt;
                    resolve(`Fetched ${targetUrl} (${ms}ms, ${res.statusCode}):\n\n${body}`);
                });
            });

            req.setTimeout(15000, () => {
                req.destroy();
                resolve(`Error: Request to ${targetUrl} timed out after 15s`);
            });
            req.on('error', (err: Error) => resolve(`Error fetching URL: ${err.message}`));
        });
    }
}

// ── grep_code ────────────────────────────────────────────────────────────────
// Ripgrep-style content search within workspace files
export class GrepCodeTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'grep_code',
            description: 'Search for a text pattern or regex inside file contents across the workspace. Returns matching lines with file names and line numbers.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'The text pattern or regex to search for'
                    },
                    path: {
                        type: 'string',
                        description: 'Directory or file path to search in (default: workspace root)'
                    },
                    filePattern: {
                        type: 'string',
                        description: 'File name pattern to restrict search (e.g. "*.ts", "*.py")'
                    },
                    caseSensitive: {
                        type: 'boolean',
                        description: 'Whether the search is case-sensitive (default: false)'
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Max number of matches to return (default: 50)'
                    }
                },
                required: ['pattern']
            }
        };
    }

    async execute(args: {
        pattern: string;
        path?: string;
        filePattern?: string;
        caseSensitive?: boolean;
        maxResults?: number;
    }): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const searchRoot = path.resolve(workspaceRoot, args.path || '.');
        const rawPattern = String(args.pattern || '');
        if (!rawPattern) return 'Error: No pattern provided';

        const regex = new RegExp(rawPattern, args.caseSensitive ? '' : 'i');
        const fileRegex = args.filePattern
            ? new RegExp(args.filePattern.replace(/\./g, '\\.').replace(/\*/g, '.*'), 'i')
            : null;
        const maxResults = args.maxResults ?? 50;
        const results: string[] = [];
        const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vscode', '.next', '__pycache__']);

        const searchFile = async (filePath: string): Promise<void> => {
            if (results.length >= maxResults) return;
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const lines = content.split('\n');
                const rel = path.relative(workspaceRoot!, filePath);
                for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                    if (regex.test(lines[i])) {
                        results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
                    }
                }
            } catch { /* binary or unreadable */ }
        };

        const walk = async (dir: string): Promise<void> => {
            if (results.length >= maxResults) return;
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const e of entries) {
                    if (results.length >= maxResults) break;
                    if (SKIP_DIRS.has(e.name)) continue;
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) {
                        await walk(full);
                    } else if (!fileRegex || fileRegex.test(e.name)) {
                        await searchFile(full);
                    }
                }
            } catch { /* ignore permission errors */ }
        };

        const stat = await fs.stat(searchRoot).catch(() => null);
        if (!stat) return `Error: Path not found: ${args.path}`;
        if (stat.isFile()) {
            await searchFile(searchRoot);
        } else {
            await walk(searchRoot);
        }

        if (results.length === 0) return `No matches found for "${rawPattern}"`;
        return `Found ${results.length} match${results.length > 1 ? 'es' : ''} for "${rawPattern}":\n\n${results.join('\n')}`;
    }
}

// ── create_directory ─────────────────────────────────────────────────────────
export class CreateDirectoryTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'create_directory',
            description: 'Create a directory (and any needed parent directories) in the workspace',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path relative to workspace root' }
                },
                required: ['path']
            }
        };
    }

    async execute(args: { path: string }): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const inputPath = String(args.path || '').trim();
        if (!inputPath) return 'Error: No path provided';

        const resolved = path.isAbsolute(inputPath)
            ? path.normalize(inputPath)
            : path.resolve(workspaceRoot, inputPath);
        const rel = path.relative(workspaceRoot, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) return 'Error: Path outside workspace';

        try {
            await fs.mkdir(resolved, { recursive: true });
            return `Directory created: ${rel}`;
        } catch (e: any) {
            return `Error: ${e.message}`;
        }
    }
}

// ── get_file_info ─────────────────────────────────────────────────────────────
export class GetFileInfoTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'get_file_info',
            description: 'Get metadata about a file or directory: size, modification time, line count, encoding, permissions.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File or directory path relative to workspace root' }
                },
                required: ['path']
            }
        };
    }

    async execute(args: { path: string }): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const resolved = path.resolve(workspaceRoot, args.path);
        try {
            const stat = await fs.stat(resolved);
            if (stat.isDirectory()) {
                const entries = await fs.readdir(resolved);
                return JSON.stringify({
                    type: 'directory',
                    path: path.relative(workspaceRoot, resolved),
                    childCount: entries.length,
                    sizeBytes: stat.size,
                    modifiedAt: stat.mtime.toISOString()
                }, null, 2);
            }
            // File: count lines
            const content = await fs.readFile(resolved, 'utf-8').catch(() => null);
            const lineCount = content ? content.split('\n').length : null;
            return JSON.stringify({
                type: 'file',
                path: path.relative(workspaceRoot, resolved),
                sizeBytes: stat.size,
                lineCount,
                modifiedAt: stat.mtime.toISOString(),
                extension: path.extname(resolved)
            }, null, 2);
        } catch (e: any) {
            return `Error: ${e.message}`;
        }
    }
}

// ── find_and_replace ──────────────────────────────────────────────────────────
// Surgical text replacement within a file — no full rewrite needed
export class FindAndReplaceTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'find_and_replace',
            description: 'Find a specific text string in a file and replace it with new text. More efficient than rewriting the whole file for small targeted changes.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                    find: { type: 'string', description: 'Exact text to find (case-sensitive)' },
                    replace: { type: 'string', description: 'Text to replace the found string with' },
                    replaceAll: { type: 'boolean', description: 'Replace all occurrences (default: false — only first)' }
                },
                required: ['path', 'find', 'replace']
            }
        };
    }

    async execute(args: { path: string; find: string; replace: string; replaceAll?: boolean }): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const resolved = path.resolve(workspaceRoot, args.path);
        const rel = path.relative(workspaceRoot, resolved);
        if (rel.startsWith('..')) return 'Error: Path outside workspace';

        if (!args.find) return 'Error: find string is empty';

        try {
            let content = await fs.readFile(resolved, 'utf-8');
            const occurrences = content.split(args.find).length - 1;
            if (occurrences === 0) return `No occurrences of the target string found in ${rel}`;

            if (args.replaceAll) {
                content = content.split(args.find).join(args.replace);
            } else {
                content = content.replace(args.find, args.replace);
            }
            await fs.writeFile(resolved, content, 'utf-8');
            const count = args.replaceAll ? occurrences : 1;
            return `Replaced ${count} occurrence${count > 1 ? 's' : ''} in ${rel}`;
        } catch (e: any) {
            return `Error: ${e.message}`;
        }
    }
}

// ── append_to_file ────────────────────────────────────────────────────────────
export class AppendToFileTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'append_to_file',
            description: 'Append text to the end of an existing file (useful for logs, config additions, etc.)',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root' },
                    content: { type: 'string', description: 'Content to append' },
                    addNewline: { type: 'boolean', description: 'Prepend a newline before appending (default: true)' }
                },
                required: ['path', 'content']
            }
        };
    }

    async execute(args: { path: string; content: string; addNewline?: boolean }): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const resolved = path.resolve(workspaceRoot, args.path);
        const rel = path.relative(workspaceRoot, resolved);
        if (rel.startsWith('..')) return 'Error: Path outside workspace';

        try {
            const prefix = args.addNewline !== false ? '\n' : '';
            await fs.appendFile(resolved, prefix + args.content, 'utf-8');
            return `Appended to ${rel}`;
        } catch (e: any) {
            return `Error: ${e.message}`;
        }
    }
}
