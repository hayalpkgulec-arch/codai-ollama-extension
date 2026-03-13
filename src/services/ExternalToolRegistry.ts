import * as fs from 'fs';
import * as path from 'path';
import type { ToolManifest } from '../core/types';
import type { ToolCatalogEntry } from './runtimeTypes';
import type { ITool } from '../tools/core/BaseTool';
import type { ToolRegistry } from '../tools/core/ToolRegistry';

interface ExternalToolBindingConfig {
    tools?: Array<{
        name: string;
        description?: string;
        targetTool: string;
        workspaceBoundaryLabel?: string;
    }>;
}

class ExternalToolAlias implements ITool {
    constructor(
        private readonly aliasName: string,
        private readonly description: string,
        private readonly manifest: ToolManifest,
        private readonly target: ITool,
    ) {}

    public get definition() {
        return {
            ...this.target.definition,
            name: this.aliasName,
            description: this.description,
            manifest: this.manifest,
        };
    }

    public async execute(args: any): Promise<any> {
        return this.target.execute(args);
    }
}

export class ExternalToolRegistry {
    constructor(private readonly workspaceRoot?: string) {}

    public registerBindings(registry: ToolRegistry): ToolCatalogEntry[] {
        const config = this.readConfig();
        if (!config?.tools?.length) return [];

        const boundCatalog: ToolCatalogEntry[] = [];
        for (const entry of config.tools) {
            if (!entry?.name || !entry?.targetTool) continue;
            const targetTool = registry.getTool(entry.targetTool);
            const targetManifest = registry.getToolManifest(entry.targetTool);
            if (!targetTool || !targetManifest || !isSupportedReadOnlyTarget(targetManifest)) {
                continue;
            }

            const manifest: ToolManifest = {
                ...targetManifest,
                name: entry.name,
                source: 'external',
                readOnly: true,
                requiresApproval: false,
                workspaceBoundaryLabel: entry.workspaceBoundaryLabel || `Workspace-only read binding to ${entry.targetTool}`,
                targetTool: entry.targetTool,
            };
            const description = entry.description?.trim() || targetTool.definition.description;
            registry.registerTool(new ExternalToolAlias(entry.name, description, manifest, targetTool));
            boundCatalog.push({
                manifest,
                description,
            });
        }

        return boundCatalog;
    }

    private readConfig(): ExternalToolBindingConfig | null {
        if (!this.workspaceRoot) return null;
        const configPath = path.join(this.workspaceRoot, '.codai', 'external-tools.json');
        if (!fs.existsSync(configPath)) return null;
        try {
            return JSON.parse(fs.readFileSync(configPath, 'utf8')) as ExternalToolBindingConfig;
        } catch {
            return null;
        }
    }
}

function isSupportedReadOnlyTarget(manifest: ToolManifest): boolean {
    return manifest.category === 'read'
        && manifest.sideEffectScope !== 'process'
        && manifest.sideEffectScope !== 'filesystem';
}
