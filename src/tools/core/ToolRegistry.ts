import { ITool } from './BaseTool';
import { Tool } from '../../core/types';
import type { ToolManifest } from '../../core/types';
import type { ToolCatalogEntry } from '../../services/runtimeTypes';
import { buildToolCatalogEntry, getToolManifest } from './toolMetadata';

export class ToolRegistry {
    private tools = new Map<string, ITool>();

    public registerTool(tool: ITool) {
        const definition = tool.definition;
        definition.manifest = getToolManifest(definition.name);
        this.tools.set(definition.name, tool);
    }

    public getTool(name: string): ITool | undefined {
        return this.tools.get(name);
    }

    public getAllToolDefinitions(): Tool[] {
        return Array.from(this.tools.values()).map((t) => t.definition);
    }

    public getToolManifest(name: string): ToolManifest | undefined {
        const tool = this.tools.get(name);
        if (tool?.definition.manifest) {
            return tool.definition.manifest;
        }
        return getToolManifest(name);
    }

    public getToolCatalog(): ToolCatalogEntry[] {
        return Array.from(this.tools.values()).map((tool) =>
            buildToolCatalogEntry(tool.definition.name, tool.definition.description)
        );
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
