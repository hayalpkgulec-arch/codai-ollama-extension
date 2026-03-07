import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class RunCommandTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'run_command',
            description: 'Execute a shell command in the workspace directory',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute'
                    }
                },
                required: ['command']
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const command = String(args.command || args.cmd || '').trim();
        if (!command) return 'Error: No command provided';

        const startedAt = Date.now();
        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: workspaceRoot,
                timeout: 30000 // 30 seconds timeout
            });
            const finishedAt = Date.now();
            return JSON.stringify({
                __tool: 'run_command',
                status: 'success',
                summary: 'Command executed successfully',
                command,
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: 0,
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt
            });
        } catch (error: any) {
            const finishedAt = Date.now();
            return JSON.stringify({
                __tool: 'run_command',
                status: 'error',
                summary: error?.message || 'Command execution failed',
                command,
                stdout: error?.stdout || '',
                stderr: error?.stderr || '',
                exitCode: typeof error?.code === 'number' ? error.code : -1,
                startedAt,
                finishedAt,
                durationMs: finishedAt - startedAt
            });
        }
    }
}
