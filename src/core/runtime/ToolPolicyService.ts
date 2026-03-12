import type { ToolManifest } from '../types';
import type { ToolControlService } from '../../services/ToolControlService';
import type { ToolPolicyDecision } from '../../services/runtimeTypes';
import { createFallbackToolManifest } from './RuntimeUtils';

export interface AutoApproveConfig {
    read_file: boolean;
    write_file: boolean;
    run_command: boolean;
    web_fetch: boolean;
    all: boolean;
}

export class ToolPolicyService {
    constructor(
        private readonly getAutoApproveConfig: () => AutoApproveConfig,
        private readonly manifestResolver: (toolName: string) => ToolManifest | undefined,
    ) {}

    public getManifest(toolName: string): ToolManifest {
        return this.manifestResolver(toolName) ?? createFallbackToolManifest(toolName);
    }

    public isAutoApproved(toolName: string): boolean {
        const config = this.getAutoApproveConfig();
        if (config.all) return true;
        const readTools = ['read_file', 'read_multiple_files', 'list_directory', 'list_directory_tree', 'search_in_files', 'get_file_info', 'list_files', 'search_files', 'grep_code', 'get_diagnostics'];
        const writeTools = ['write_file', 'delete_file', 'create_directory', 'move_file', 'write_multiple_files', 'delete_multiple_files', 'rename_file', 'find_and_replace', 'append_to_file', 'save_plan'];
        const commandTools = ['run_command', 'kill_bg_process'];
        const webTools = [
            'web_search', 'web_fetch',
            'browser_navigate', 'browser_click', 'browser_type', 'browser_scroll',
            'browser_wait_for_text', 'browser_screenshot', 'browser_console_logs', 'browser_close',
        ];

        if (config.read_file && readTools.includes(toolName)) return true;
        if (config.write_file && writeTools.includes(toolName)) return true;
        if (config.run_command && commandTools.includes(toolName)) return true;
        if (config.web_fetch && webTools.includes(toolName)) return true;
        return false;
    }

    public evaluate(toolControl: ToolControlService, toolName: string, args: any): ToolPolicyDecision {
        const manifest = this.getManifest(toolName);
        const autoApproved = this.isAutoApproved(toolName);
        const controlDecision = toolControl.beforeToolExecution(toolName, args, manifest);

        return {
            manifest,
            autoApproved,
            controlDecision,
            requiresApproval: manifest.requiresApproval && !autoApproved,
        };
    }
}
