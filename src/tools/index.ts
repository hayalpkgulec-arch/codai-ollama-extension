import { globalToolRegistry } from './core/ToolRegistry';
import { ReadFileTool } from './impl/ReadFileTool';
import { WriteFileTool } from './impl/WriteFileTool';
import { RunCommandTool } from './impl/RunCommandTool';
import { ListFilesTool, SearchFilesTool, DeleteFileTool, RenameFileTool } from './impl/FileSystemTools';
import { GetDiagnosticsTool } from './impl/ProjectTools';
import { TaskNotesTool, AskFollowupQuestionTool, AskFollowupQuestionsTool, AttemptCompletionTool } from './impl/InteractionTools';
import {
    WebFetchTool,
    GrepCodeTool,
    CreateDirectoryTool,
    GetFileInfoTool,
    FindAndReplaceTool,
    AppendToFileTool,
} from './impl/PowerTools';
import { ReadMultipleFilesTool, ListDirectoryTreeTool } from './impl/ReadMultipleFilesTool';
import { WriteMultipleFilesTool, DeleteMultipleFilesTool } from './impl/BatchFileTools';
import { SavePlanTool } from './impl/SavePlanTool';

// ── Core file tools ──────────────────────────────────────────────────────────
globalToolRegistry.registerTool(new ReadFileTool());
globalToolRegistry.registerTool(new WriteFileTool());
globalToolRegistry.registerTool(new RunCommandTool());
globalToolRegistry.registerTool(new ListFilesTool());
globalToolRegistry.registerTool(new SearchFilesTool());
globalToolRegistry.registerTool(new DeleteFileTool());
globalToolRegistry.registerTool(new RenameFileTool());

// ── Batch tools — rate limit'i azaltır ───────────────────────────────────────
globalToolRegistry.registerTool(new ReadMultipleFilesTool());    // N dosyayı tek çağrıda oku
globalToolRegistry.registerTool(new ListDirectoryTreeTool());    // recursive dizin listesi
globalToolRegistry.registerTool(new WriteMultipleFilesTool());   // N dosyayı tek çağrıda yaz
globalToolRegistry.registerTool(new DeleteMultipleFilesTool());  // N dosyayı tek çağrıda sil

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
globalToolRegistry.registerTool(new AskFollowupQuestionsTool());
globalToolRegistry.registerTool(new AttemptCompletionTool());
globalToolRegistry.registerTool(new SavePlanTool());

export { globalToolRegistry };
