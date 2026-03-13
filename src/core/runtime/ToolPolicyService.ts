import type { ToolManifest } from '../types';
import type { ToolControlService } from '../../services/ToolControlService';
import type { ToolApprovalPreview, ToolPolicyDecision, ToolRetryPolicy } from '../../services/runtimeTypes';
import { buildToolSummary, createFallbackToolManifest } from './RuntimeUtils';

export interface AutoApproveConfig {
    read_file: boolean;
    write_file: boolean;
    run_command: boolean;
    web_fetch: boolean;
    all: boolean;
}

interface EvaluateToolPolicyInput {
    turnId: string;
    toolCallId: string;
    toolName: string;
    args: any;
    summary?: string;
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

    public evaluate(toolControl: ToolControlService, input: EvaluateToolPolicyInput): ToolPolicyDecision {
        const manifest = this.getManifest(input.toolName);
        const autoApproved = this.isAutoApproved(input.toolName);
        const controlDecision = toolControl.beforeToolExecution(input.toolName, input.args, manifest);
        const retryPolicy = this.getRetryPolicy(input.toolName, manifest);
        const requiresApproval = manifest.requiresApproval && !autoApproved;

        return {
            manifest,
            autoApproved,
            controlDecision,
            requiresApproval,
            retryPolicy,
            approvalPreview: requiresApproval
                ? this.buildApprovalPreview({
                    turnId: input.turnId,
                    toolCallId: input.toolCallId,
                    toolName: input.toolName,
                    args: input.args,
                    manifest,
                    autoApproved,
                    retryPolicy,
                    summary: input.summary,
                })
                : null,
        };
    }

    private getRetryPolicy(toolName: string, manifest: ToolManifest): ToolRetryPolicy {
        if (toolName === 'run_command') {
            return {
                maxAttempts: 2,
                backoffMs: 1200,
                retryableFailures: ['timeout', 'abort'],
            };
        }

        if (manifest.category === 'web') {
            return {
                maxAttempts: 2,
                backoffMs: 900,
                retryableFailures: ['execution', 'provider', 'timeout'],
            };
        }

        if (manifest.category === 'read') {
            return {
                maxAttempts: 2,
                backoffMs: 250,
                retryableFailures: ['execution', 'timeout'],
            };
        }

        if (manifest.category === 'write') {
            return {
                maxAttempts: 1,
                backoffMs: 0,
                retryableFailures: [],
            };
        }

        return {
            maxAttempts: 1,
            backoffMs: 0,
            retryableFailures: [],
        };
    }

    private buildApprovalPreview(input: {
        turnId: string;
        toolCallId: string;
        toolName: string;
        args: any;
        manifest: ToolManifest;
        autoApproved: boolean;
        retryPolicy: ToolRetryPolicy;
        summary?: string;
    }): ToolApprovalPreview {
        const summary = input.summary || buildToolSummary(input.toolName, input.args);
        return {
            turnId: input.turnId,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            args: input.args,
            manifest: input.manifest,
            autoApproved: input.autoApproved,
            summary,
            preview: buildPreviewText(input.toolName, input.args, summary),
            boundaryLabel: input.manifest.workspaceBoundaryLabel || describeBoundary(input.manifest),
            retryPolicy: input.retryPolicy,
        };
    }
}

function buildPreviewText(toolName: string, args: any, summary: string): string {
    if (toolName === 'run_command') {
        return `Command: ${String(args?.command || '').trim() || summary}`;
    }
    if (toolName === 'write_file' || toolName === 'append_to_file' || toolName === 'find_and_replace') {
        return `Path: ${String(args?.path || args?.file_path || '').trim() || summary}`;
    }
    if (toolName === 'delete_file' || toolName === 'rename_file') {
        return `Target: ${String(args?.path || args?.oldPath || '').trim() || summary}`;
    }
    if (toolName.startsWith('browser_')) {
        return `Browser action: ${summary}`;
    }
    return summary;
}

function describeBoundary(manifest: ToolManifest): string {
    if (manifest.workspaceBoundaryLabel) return manifest.workspaceBoundaryLabel;
    if (manifest.sideEffectScope === 'filesystem') return 'Workspace filesystem';
    if (manifest.sideEffectScope === 'process') return 'Local process execution';
    if (manifest.sideEffectScope === 'network') return 'Network access';
    if (manifest.sideEffectScope === 'workspace') return 'Workspace state';
    if (manifest.readOnly) return 'Read-only';
    return 'User-visible action';
}
