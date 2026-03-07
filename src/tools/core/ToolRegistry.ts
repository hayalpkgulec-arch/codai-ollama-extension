import { ITool } from './BaseTool';
import { Tool } from '../../core/types';

export class ToolRegistry {
    private tools = new Map<string, ITool>();

    public registerTool(tool: ITool) {
        this.tools.set(tool.definition.name, tool);
    }

    public getTool(name: string): ITool | undefined {
        return this.tools.get(name);
    }

    public getAllToolDefinitions(): Tool[] {
        return Array.from(this.tools.values()).map((t) => t.definition);
    }

    public async executeTool(name: string, args: any): Promise<any> {
        const tool = this.tools.get(name);
        if (!tool) {
            return `Error: Unknown tool: ${name}`;
        }
        try {
            return await tool.execute(args);
        } catch (error: any) {
            return `Error: Tool execution failed: ${error.message}`;
        }
    }
}

// Global Singleton Instance
export const globalToolRegistry = new ToolRegistry();
