export type AgentMode = 'code' | 'plan' | 'chat';
export type WriteFileMode = 'creating' | 'editing';
export type ToolRiskLevel = 'low' | 'medium' | 'high';
export type ToolSideEffectScope = 'none' | 'filesystem' | 'process' | 'network' | 'workspace' | 'user';

export interface ToolManifest {
    name: string;
    category: 'read' | 'write' | 'run' | 'web' | 'plan' | 'user';
    riskLevel: ToolRiskLevel;
    requiresApproval: boolean;
    supportsAutoApprove: boolean;
    producesCheckpoint: boolean;
    idempotent: boolean;
    sideEffectScope: ToolSideEffectScope;
    commandProfile?: 'safe' | 'interactive' | 'background' | 'destructive';
    source?: 'builtin' | 'external';
    readOnly?: boolean;
    workspaceBoundaryLabel?: string;
    targetTool?: string;
}

export interface ToolArtifact {
    kind: 'url' | 'file' | 'command' | 'host' | 'note';
    label: string;
    value: string;
}

export interface ToolExecutionResult {
    toolName: string;
    status: 'success' | 'error';
    summary: string;
    rawResult: string;
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    manifest?: ToolManifest;
    artifacts?: ToolArtifact[];
    errorMessage?: string;
    checkpointRefs?: string[];
}

export interface WriteFileDiffEntry {
    type: 'add' | 'remove' | 'context';
    text: string;
    oldLineNo?: number;
    newLineNo?: number;
}

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCallMessage[];
    tool_call_id?: string;
    name?: string;
}

export interface ToolCallMessage {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string | Record<string, any>;
    };
}

export interface Tool {
    name: string;
    description: string;
    manifest?: ToolManifest;
    parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}
