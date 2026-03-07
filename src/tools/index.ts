import { globalToolRegistry } from './core/ToolRegistry';
import { ReadFileTool } from './impl/ReadFileTool';
import { WriteFileTool } from './impl/WriteFileTool';
import { RunCommandTool } from './impl/RunCommandTool';
import { ListFilesTool, SearchFilesTool, DeleteFileTool, RenameFileTool } from './impl/FileSystemTools';
import { GetDiagnosticsTool } from './impl/ProjectTools';
import { TaskNotesTool, AskFollowupQuestionTool, AttemptCompletionTool } from './impl/InteractionTools';
import {
    WebFetchTool,
    GrepCodeTool,
    CreateDirectoryTool,
    GetFileInfoTool,
    FindAndReplaceTool,
    AppendToFileTool,
} from './impl/PowerTools';
import { ReadMultipleFilesTool, ListDirectoryTreeTool } from './impl/ReadMultipleFilesTool';

// ── Core file tools ──────────────────────────────────────────────────────────
globalToolRegistry.registerTool(new ReadFileTool());
globalToolRegistry.registerTool(new WriteFileTool());
globalToolRegistry.registerTool(new RunCommandTool());
globalToolRegistry.registerTool(new ListFilesTool());
globalToolRegistry.registerTool(new SearchFilesTool());
globalToolRegistry.registerTool(new DeleteFileTool());
globalToolRegistry.registerTool(new RenameFileTool());

// ── Batch tools — rate limit'i azaltır ───────────────────────────────────────
globalToolRegistry.registerTool(new ReadMultipleFilesTool());  // N dosyayı tek çağrıda oku
globalToolRegistry.registerTool(new ListDirectoryTreeTool());  // recursive dizin listesi

// ── Power tools ───────────────────────────────────────────────────────────────
globalToolRegistry.registerTool(new WebFetchTool());
globalToolRegistry.registerTool(new GrepCodeTool());
globalToolRegistry.registerTool(new CreateDirectoryTool());
globalToolRegistry.registerTool(new GetFileInfoTool());
globalToolRegistry.registerTool(new FindAndReplaceTool());
globalToolRegistry.registerTool(new AppendToFileTool());

// ── Diagnostic tools ─────────────────────────────────────────────────────────
globalToolRegistry.registerTool(new GetDiagnosticsTool());

// ── Interaction / agent tools ────────────────────────────────────────────────
globalToolRegistry.registerTool(new TaskNotesTool());
globalToolRegistry.registerTool(new AskFollowupQuestionTool());
globalToolRegistry.registerTool(new AttemptCompletionTool());

export { globalToolRegistry };
