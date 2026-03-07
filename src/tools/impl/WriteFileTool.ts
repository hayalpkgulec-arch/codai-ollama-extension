import { BaseTool } from '../core/BaseTool';
import { Tool, WriteFileMode } from '../../core/types';
import { promises as fs } from 'fs';
import * as path from 'path';
import { buildUnifiedLineDiff } from '../../core/diff/lineDiff';

export class WriteFileTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'write_file',
            description: 'Write content to a file in the workspace',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The file path relative to workspace root'
                    },
                    content: {
                        type: 'string',
                        description: 'The content to write to the file'
                    }
                },
                required: ['path', 'content']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const inputPath = args.path ?? args.file ?? args.file_path ?? '.';
        const contentArg = args.content ?? args.text ?? args.value ?? args.code ?? '';
        
        const resolved = path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.resolve(workspaceRoot, inputPath);
        const relativePath = path.relative(workspaceRoot, resolved);

        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return `Error: Path is outside workspace: ${inputPath}`;
        }

        const filePath = path.join(workspaceRoot, relativePath);
        const fileName = path.basename(relativePath);
        const startedAt = Date.now();
        let mode: WriteFileMode = 'creating';
        let beforeContent = '';

        try {
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) return `Error: Path is a directory: ${relativePath}`;
            mode = 'editing';
            beforeContent = await fs.readFile(filePath, 'utf-8');
        } catch {
            mode = 'creating';
        }

        const afterContent = typeof contentArg === 'string' ? contentArg : String(contentArg);

        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, afterContent, 'utf-8');
            const finishedAt = Date.now();
            const diff = buildUnifiedLineDiff(beforeContent, afterContent, {
                maxEntries: 1200,
                contextRadius: 2
            });
            const preview = afterContent.split(/\r?\n/).slice(0, 24).join('\n');

            return JSON.stringify({
                __tool: 'write_file',
                status: 'success',
                summary: mode === 'creating' ? `Created ${fileName}` : `Edited ${fileName}`,
                mode,
                path: relativePath,
                fileName,
                preview,
                hunks: diff.entries,
                addedCount: diff.addedCount,
                removedCount: diff.removedCount,
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt,
                truncated: diff.truncated
            });
        } catch (error: any) {
            const finishedAt = Date.now();
            return JSON.stringify({
                __tool: 'write_file',
                status: 'error',
                summary: mode === 'creating' ? `Creating ${fileName} failed` : `Editing ${fileName} failed`,
                mode,
                path: relativePath,
                fileName,
                preview: '',
                hunks: [],
                addedCount: 0,
                removedCount: 0,
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt,
                errorMessage: error?.message || 'File write failed'
            });
        }
    }
}
