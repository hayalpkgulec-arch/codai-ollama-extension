export type AgentMode = 'code' | 'plan' | 'chat';

export interface ProviderSavedConfig {
  apiKey: string;
  apiKeys: string[];
  baseUrl: string;
  hasApiKey?: boolean;
}

export interface ContextWindowStats {
  contextTokens: number;
  contextChars: number;
  maxContextTokens: number;
  tokensLeft: number;
  percentUsed: number;
  autoCompactEnabled: boolean;
  lastCompactionAt: number | null;
  compactedMessageCount: number;
}

export interface RetrievalHit {
  id: string;
  source: 'transcript' | 'snapshot' | 'memory' | 'workspace';
  title: string;
  preview: string;
  score: number;
}

export interface ContextArtifact {
  id: string;
  kind: 'system' | 'recent' | 'compacted' | 'retrieval' | 'memory' | 'workspace';
  title: string;
  preview: string;
  tokenEstimate: number;
  included: boolean;
}

export interface ContextPreviewPayload {
  artifacts: ContextArtifact[];
  retrievalHits: RetrievalHit[];
  compactionSnapshotCount: number;
  workspaceMemoryCount: number;
}

export type TurnPhase =
  | 'idle'
  | 'preflight'
  | 'llm_request'
  | 'tool_execution'
  | 'awaiting_user'
  | 'completed'
  | 'failed'
  | 'aborted';

export interface TurnState {
  turnId: string;
  requestId: string;
  providerId: string;
  model: string;
  phase: TurnPhase;
  iteration: number;
  startedAt: number;
  finishedAt?: number;
  activeToolCallIds: string[];
  budgetState: ContextWindowStats;
  error?: string;
  traceFilePath?: string;
  recoveredFromPreviousRun?: boolean;
}

export interface LatestTraceSummary {
  turnId: string;
  providerId: string;
  model: string;
  phase: TurnPhase;
  startedAt: number;
  finishedAt?: number;
  traceFilePath: string;
  eventCount: number;
  error?: string;
}

export interface ProviderCapability {
  id: string;
  label: string;
  baseUrl: string;
  requiresApiKey: boolean;
  protocol: 'openai' | 'ollama';
  modelsEndpoint?: string;
  docsUrl: string;
  keySignupUrl: string;
  isLocal: boolean;
  badge?: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  supportsVision: boolean;
  maxContextTokens: number;
  defaultModel: string;
  fallbackModels: string[];
  defaultModels: Array<{ id: string; label: string; tag: 'cloud' | 'local' }>;
}

// ── Auto-approve config ───────────────────────────────────────────────────────
export interface AutoApproveConfig {
  read_file: boolean;
  write_file: boolean;
  run_command: boolean;
  web_fetch: boolean;
  all: boolean;
}

// ── Chat History ──────────────────────────────────────────────────────────────
export interface SessionInfo {
  id: string;
  title: string;
  createdAt: string;  // ISO
  updatedAt: string;  // ISO
  messageCount: number;
  mode: AgentMode;
  model?: string;
  preview?: string;   // first user message snippet
}

// ── Plan Mode — Wizard question ───────────────────────────────────────────────
export interface WizardQuestion {
  question: string;
  hint?: string;
  options?: string[];
  allowCustom?: boolean;
}

// ── Plan Mode — Saved spec payload ───────────────────────────────────────────
export interface PlanSavedPayload {
  title: string;
  slug: string;
  planDir: string;
  files: {
    requirements: string;
    design: string;
    tasks: string;
  };
}

export interface CheckpointEntry {
  id: string;
  timestamp: string;
  filePath: string;
  originalPath: string;
  toolName: string;
}

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
