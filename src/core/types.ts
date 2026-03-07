export type AgentMode = 'code' | 'plan' | 'chat';
export type WriteFileMode = 'creating' | 'editing';

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
    parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}
