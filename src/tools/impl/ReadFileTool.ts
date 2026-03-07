import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { promises as fs } from 'fs';
import * as path from 'path';

export class ReadFileTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'read_file',
            description: 'Read the contents of a file from the workspace',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The file path relative to workspace root'
                    }
                },
                required: ['path']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const inputPath = args.path || args.file || args.file_path || '.';
        const resolved = path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.resolve(workspaceRoot, inputPath);
        const relativePath = path.relative(workspaceRoot, resolved);

        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return `Error: Path is outside workspace: ${inputPath}`;
        }

        const filePath = path.join(workspaceRoot, relativePath);

        try {
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                const entries = await fs.readdir(filePath, { withFileTypes: true });
                const result = entries.map((entry) => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file'
                }));
                return `Path is a directory. Contents of ${relativePath}:
${JSON.stringify(result, null, 2)}`;
            }
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        } catch (error: any) {
            return `Error: Failed to read file: ${error.message}`;
        }
    }
}
