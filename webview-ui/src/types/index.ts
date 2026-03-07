export type AgentMode = 'code' | 'plan' | 'chat';

export type ToolStatus = 'running' | 'done' | 'error';


export interface ToolCall {
  phaseId: string;
  name: string;
  summary: string;
  status: ToolStatus;
  result?: string;
  args?: any;          // raw args from toolActivityStart (for live preview)
  startedAt?: number;
  finishedAt?: number;
}

// ── Ordered timeline segments within a message ────────────────────────────
export interface ThinkingSegment {
  type: 'thinking';
  text: string;
  done: boolean;
  startedAt?: number;
  finalMs?: number;
}

export interface ContentSegment {
  type: 'content';
  text: string;
}

export interface ToolSegment {
  type: 'tool';
  tool: ToolCall;
}

export type Segment = ThinkingSegment | ContentSegment | ToolSegment;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  // Ordered timeline: events in the exact order they arrived
  segments: Segment[];
  isStreaming?: boolean;
  error?: string;
}
