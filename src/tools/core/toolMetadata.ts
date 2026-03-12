import type { ToolManifest } from '../../core/types';
import type { ToolCatalogEntry } from '../../services/runtimeTypes';

const DEFAULT_TOOL_MANIFESTS: Record<string, ToolManifest> = {
    read_file: { name: 'read_file', category: 'read', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'none' },
    read_multiple_files: { name: 'read_multiple_files', category: 'read', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'none' },
    list_files: { name: 'list_files', category: 'read', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'none' },
    list_directory_tree: { name: 'list_directory_tree', category: 'read', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'none' },
    search_files: { name: 'search_files', category: 'read', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'none' },
    grep_code: { name: 'grep_code', category: 'read', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'none' },
    get_file_info: { name: 'get_file_info', category: 'read', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'none' },
    get_diagnostics: { name: 'get_diagnostics', category: 'read', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'workspace' },

    write_file: { name: 'write_file', category: 'write', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: true, idempotent: false, sideEffectScope: 'filesystem' },
    write_multiple_files: { name: 'write_multiple_files', category: 'write', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: true, idempotent: false, sideEffectScope: 'filesystem' },
    delete_file: { name: 'delete_file', category: 'write', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: false, producesCheckpoint: false, idempotent: false, sideEffectScope: 'filesystem' },
    delete_multiple_files: { name: 'delete_multiple_files', category: 'write', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: false, producesCheckpoint: false, idempotent: false, sideEffectScope: 'filesystem' },
    rename_file: { name: 'rename_file', category: 'write', riskLevel: 'medium', requiresApproval: true, supportsAutoApprove: false, producesCheckpoint: false, idempotent: false, sideEffectScope: 'filesystem' },
    create_directory: { name: 'create_directory', category: 'write', riskLevel: 'medium', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'filesystem' },
    find_and_replace: { name: 'find_and_replace', category: 'write', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'filesystem' },
    append_to_file: { name: 'append_to_file', category: 'write', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'filesystem' },

    run_command: { name: 'run_command', category: 'run', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'process', commandProfile: 'interactive' },
    kill_bg_process: { name: 'kill_bg_process', category: 'run', riskLevel: 'medium', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'process', commandProfile: 'background' },

    web_fetch: { name: 'web_fetch', category: 'web', riskLevel: 'medium', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'network' },
    web_search: { name: 'web_search', category: 'web', riskLevel: 'medium', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'network' },
    browser_navigate: { name: 'browser_navigate', category: 'web', riskLevel: 'medium', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'network' },
    browser_click: { name: 'browser_click', category: 'web', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'network' },
    browser_type: { name: 'browser_type', category: 'web', riskLevel: 'high', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'network' },
    browser_scroll: { name: 'browser_scroll', category: 'web', riskLevel: 'medium', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'network' },
    browser_wait_for_text: { name: 'browser_wait_for_text', category: 'web', riskLevel: 'medium', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'network' },
    browser_screenshot: { name: 'browser_screenshot', category: 'web', riskLevel: 'medium', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'network' },
    browser_console_logs: { name: 'browser_console_logs', category: 'web', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'network' },
    browser_close: { name: 'browser_close', category: 'web', riskLevel: 'medium', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: true, sideEffectScope: 'network' },

    task_notes: { name: 'task_notes', category: 'plan', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'workspace' },
    save_plan: { name: 'save_plan', category: 'plan', riskLevel: 'medium', requiresApproval: true, supportsAutoApprove: true, producesCheckpoint: true, idempotent: false, sideEffectScope: 'filesystem' },
    ask_followup_question: { name: 'ask_followup_question', category: 'user', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'user' },
    ask_followup_questions: { name: 'ask_followup_questions', category: 'user', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'user' },
    attempt_completion: { name: 'attempt_completion', category: 'user', riskLevel: 'low', requiresApproval: false, supportsAutoApprove: true, producesCheckpoint: false, idempotent: false, sideEffectScope: 'user' },
};

export function getToolManifest(toolName: string): ToolManifest {
    return DEFAULT_TOOL_MANIFESTS[toolName] ?? {
        name: toolName,
        category: 'read',
        riskLevel: 'medium',
        requiresApproval: true,
        supportsAutoApprove: false,
        producesCheckpoint: false,
        idempotent: false,
        sideEffectScope: 'workspace',
    };
}

export function buildToolCatalogEntry(name: string, description: string): ToolCatalogEntry {
    return {
        manifest: getToolManifest(name),
        description,
    };
}
