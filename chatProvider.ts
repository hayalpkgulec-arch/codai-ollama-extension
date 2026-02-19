// @ts-nocheck
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface Tool {
    name: string;
    description: string;
    parameters: any;
}

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

class OllamaClient {
    constructor(public baseUrl: string) {}

    async chatWithTools(
        model: string, 
        messages: Message[], 
        tools: Tool[],
        onThinking?: (thinking: string) => void,
        onContent?: (content: string) => void
    ): Promise<any> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                tools,
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let fullThinking = '';
        let lastMessage: any = null;

        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const json = JSON.parse(line);
                        lastMessage = json;

                        console.log('Ollama chunk:', JSON.stringify(json));

                        // Handle thinking/reasoning content - check multiple possible fields
                        const thinkingContent = json.message?.reasoning_content || 
                                               json.message?.thinking || 
                                               json.reasoning_content ||
                                               json.thinking;
                        
                        if (thinkingContent) {
                            fullThinking += thinkingContent;
                            console.log('Thinking found:', thinkingContent);
                            onThinking?.(fullThinking);
                        }

                        // Handle regular content
                        if (json.message?.content) {
                            fullContent += json.message.content;
                            onContent?.(fullContent);
                        }
                    } catch (e) {
                        console.error('Failed to parse JSON:', line, e);
                    }
                }
            }
        }

        return lastMessage || { message: { content: fullContent } };
    }
}

// Tool definitions
const tools: Tool[] = [
    {
        name: 'read_file',
        description: 'Read the contents of a file from the workspace',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'The file path relative to workspace root'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'write_file',
        description: 'Write content to a file in the workspace',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'The file path relative to workspace root'
                },
                content: {
                    type: 'string',
                    description: 'The content to write to the file'
                }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'list_files',
        description: 'List files and directories in a workspace path',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'The directory path relative to workspace root (use "." for root)'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'search_files',
        description: 'Search for files by name pattern in the workspace',
        parameters: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'File name pattern to search for (e.g., "*.ts", "test*")'
                }
            },
            required: ['pattern']
        }
    },
    {
        name: 'run_command',
        description: 'Execute a shell command in the workspace directory',
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The shell command to execute'
                }
            },
            required: ['command']
        }
    },
    {
        name: 'analyze_project',
        description: 'Analyze the project structure and provide insights',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'delete_file',
        description: 'Delete a file from the workspace',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'The file path relative to workspace root to delete'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'rename_file',
        description: 'Rename or move a file in the workspace',
        parameters: {
            type: 'object',
            properties: {
                oldPath: {
                    type: 'string',
                    description: 'Current file path relative to workspace root'
                },
                newPath: {
                    type: 'string',
                    description: 'New file path relative to workspace root'
                }
            },
            required: ['oldPath', 'newPath']
        }
    },
    {
        name: 'get_diagnostics',
        description: 'Get compilation errors, warnings, and other diagnostics for files',
        parameters: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path relative to workspace root (optional, if not provided returns all diagnostics)'
                }
            }
        }
    }
];

export class ChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private ollamaClient: OllamaClient;
    private conversationHistory: Message[] = [];
    private defaultModel: string;
    private systemPrompt: string = `You are Codai, an expert AI coding assistant. You help developers with:
- Writing, debugging, and optimizing code
- Explaining complex programming concepts
- Suggesting best practices and design patterns
- Reviewing code and identifying potential issues
- Answering technical questions about various programming languages and frameworks

Always provide clear, concise, and practical solutions. Use code examples when helpful. Be friendly and supportive.`;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        ollamaUrl: string,
        defaultModel: string
    ) {
        this.ollamaClient = new OllamaClient(ollamaUrl);
        this.defaultModel = defaultModel;
        
        // Initialize with system message
        this.conversationHistory.push({
            role: 'system',
            content: this.systemPrompt
        });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'sendMessage':
                    await this._handleMessage(data.message);
                    break;
                case 'clearHistory':
                    this.conversationHistory = [{
                        role: 'system',
                        content: this.systemPrompt
                    }];
                    break;
                case 'changeModel':
                    this.defaultModel = data.model;
                    break;
                case 'saveConversation':
                    // Conversation saved in webview localStorage
                    break;
                case 'loadConversation':
                    // Load conversation from webview
                    if (data.history && Array.isArray(data.history)) {
                        this.conversationHistory = data.history;
                    }
                    break;
                case 'updateSystemPrompt':
                    // Update system prompt
                    if (data.prompt) {
                        this.systemPrompt = data.prompt;
                        // Update first message if it's system
                        if (this.conversationHistory.length > 0 && this.conversationHistory[0].role === 'system') {
                            this.conversationHistory[0].content = this.systemPrompt;
                        }
                    }
                    break;
            }
        });
    }

    private async executeTool(toolName: string, args: any): Promise<string> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            return 'Error: No workspace folder open';
        }

        try {
            switch (toolName) {
                case 'read_file': {
                    const filePath = path.join(workspaceRoot, args.path);
                    const content = await fs.readFile(filePath, 'utf-8');
                    return content;
                }

                case 'write_file': {
                    const filePath = path.join(workspaceRoot, args.path);
                    await fs.mkdir(path.dirname(filePath), { recursive: true });
                    await fs.writeFile(filePath, args.content, 'utf-8');
                    return `File written successfully: ${args.path}`;
                }

                case 'list_files': {
                    const dirPath = path.join(workspaceRoot, args.path || '.');
                    const entries = await fs.readdir(dirPath, { withFileTypes: true });
                    const result = entries.map(entry => ({
                        name: entry.name,
                        type: entry.isDirectory() ? 'directory' : 'file'
                    }));
                    return JSON.stringify(result, null, 2);
                }

                case 'search_files': {
                    const pattern = args.pattern;
                    const results: string[] = [];
                    
                    async function searchDir(dir: string) {
                        const entries = await fs.readdir(dir, { withFileTypes: true });
                        for (const entry of entries) {
                            const fullPath = path.join(dir, entry.name);
                            const relativePath = path.relative(workspaceRoot, fullPath);
                            
                            // Skip node_modules and .git
                            if (entry.name === 'node_modules' || entry.name === '.git') {
                                continue;
                            }
                            
                            if (entry.isDirectory()) {
                                await searchDir(fullPath);
                            } else {
                                // Simple pattern matching
                                const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
                                if (regex.test(entry.name)) {
                                    results.push(relativePath);
                                }
                            }
                        }
                    }
                    
                    await searchDir(workspaceRoot);
                    return results.length > 0 
                        ? `Found ${results.length} files:\n${results.join('\n')}`
                        : 'No files found matching pattern';
                }

                case 'run_command': {
                    const { stdout, stderr } = await execAsync(args.command, {
                        cwd: workspaceRoot,
                        timeout: 30000 // 30 second timeout
                    });
                    return stdout || stderr || 'Command executed successfully';
                }

                case 'analyze_project': {
                    const analysis: any = {
                        root: workspaceRoot,
                        files: [],
                        languages: new Set(),
                        frameworks: [],
                        packageManagers: []
                    };

                    // Check for common files
                    const commonFiles = [
                        'package.json', 'requirements.txt', 'Cargo.toml', 
                        'go.mod', 'pom.xml', 'build.gradle', 'composer.json',
                        'README.md', '.gitignore', 'tsconfig.json'
                    ];

                    for (const file of commonFiles) {
                        try {
                            const filePath = path.join(workspaceRoot, file);
                            await fs.access(filePath);
                            analysis.files.push(file);

                            // Detect package manager and read content
                            if (file === 'package.json') {
                                analysis.packageManagers.push('npm/yarn');
                                const content = await fs.readFile(filePath, 'utf-8');
                                const pkg = JSON.parse(content);
                                
                                // Detect frameworks
                                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                                if (deps.react) analysis.frameworks.push('React');
                                if (deps.vue) analysis.frameworks.push('Vue');
                                if (deps.angular) analysis.frameworks.push('Angular');
                                if (deps.next) analysis.frameworks.push('Next.js');
                                if (deps.express) analysis.frameworks.push('Express');
                                if (deps.typescript) analysis.languages.add('TypeScript');
                                
                                analysis.languages.add('JavaScript');
                            } else if (file === 'requirements.txt') {
                                analysis.packageManagers.push('pip');
                                analysis.languages.add('Python');
                            } else if (file === 'Cargo.toml') {
                                analysis.packageManagers.push('cargo');
                                analysis.languages.add('Rust');
                            } else if (file === 'go.mod') {
                                analysis.packageManagers.push('go modules');
                                analysis.languages.add('Go');
                            }
                        } catch (e) {
                            // File doesn't exist, skip
                        }
                    }

                    // Count files by extension
                    const fileStats: any = {};
                    async function countFiles(dir: string) {
                        try {
                            const entries = await fs.readdir(dir, { withFileTypes: true });
                            for (const entry of entries) {
                                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                                
                                const fullPath = path.join(dir, entry.name);
                                if (entry.isDirectory()) {
                                    await countFiles(fullPath);
                                } else {
                                    const ext = path.extname(entry.name);
                                    fileStats[ext] = (fileStats[ext] || 0) + 1;
                                }
                            }
                        } catch (e) {
                            // Skip inaccessible directories
                        }
                    }
                    
                    await countFiles(workspaceRoot);
                    analysis.fileStats = fileStats;
                    analysis.languages = Array.from(analysis.languages);

                    return `Project Analysis:
- Root: ${analysis.root}
- Languages: ${analysis.languages.join(', ') || 'Unknown'}
- Frameworks: ${analysis.frameworks.join(', ') || 'None detected'}
- Package Managers: ${analysis.packageManagers.join(', ') || 'None detected'}
- Config Files: ${analysis.files.join(', ')}
- File Statistics: ${JSON.stringify(fileStats, null, 2)}`;
                }

                case 'delete_file': {
                    const filePath = path.join(workspaceRoot, args.path);
                    await fs.unlink(filePath);
                    return `File deleted successfully: ${args.path}`;
                }

                case 'rename_file': {
                    const oldPath = path.join(workspaceRoot, args.oldPath);
                    const newPath = path.join(workspaceRoot, args.newPath);
                    
                    // Create directory if it doesn't exist
                    await fs.mkdir(path.dirname(newPath), { recursive: true });
                    
                    // Rename/move the file
                    await fs.rename(oldPath, newPath);
                    return `File renamed/moved successfully: ${args.oldPath} → ${args.newPath}`;
                }

                case 'get_diagnostics': {
                    const diagnostics = vscode.languages.getDiagnostics();
                    
                    if (args.path) {
                        // Get diagnostics for specific file
                        const fileUri = vscode.Uri.file(path.join(workspaceRoot, args.path));
                        const fileDiagnostics = vscode.languages.getDiagnostics(fileUri);
                        
                        if (fileDiagnostics.length === 0) {
                            return `No diagnostics found for ${args.path}`;
                        }
                        
                        const result = fileDiagnostics.map(d => ({
                            severity: vscode.DiagnosticSeverity[d.severity],
                            message: d.message,
                            line: d.range.start.line + 1,
                            column: d.range.start.character + 1,
                            source: d.source
                        }));
                        
                        return `Diagnostics for ${args.path}:\n${JSON.stringify(result, null, 2)}`;
                    } else {
                        // Get all diagnostics
                        if (diagnostics.length === 0) {
                            return 'No diagnostics found in workspace';
                        }
                        
                        const result: any = {};
                        diagnostics.forEach(([uri, diags]) => {
                            const relativePath = path.relative(workspaceRoot, uri.fsPath);
                            result[relativePath] = diags.map(d => ({
                                severity: vscode.DiagnosticSeverity[d.severity],
                                message: d.message,
                                line: d.range.start.line + 1,
                                column: d.range.start.character + 1,
                                source: d.source
                            }));
                        });
                        
                        return `Workspace Diagnostics:\n${JSON.stringify(result, null, 2)}`;
                    }
                }

                default:
                    return `Unknown tool: ${toolName}`;
            }
        } catch (error) {
            return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    private async _handleMessage(message: string) {
        if (!this._view) return;

        try {
            // Check if this is the first user message (only system prompt exists)
            const isFirstMessage = this.conversationHistory.length === 1 && 
                                   this.conversationHistory[0].role === 'system';

            // Auto-analyze project on first message
            if (isFirstMessage) {
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspaceRoot) {
                    this._view?.webview.postMessage({
                        type: 'systemMessage',
                        content: '🔍 Analyzing project...'
                    });

                    const analysis = await this.executeTool('analyze_project', {});
                    
                    // Add project context to system prompt
                    const enhancedSystemPrompt = this.systemPrompt + `\n\n## Current Project Context:\n${analysis}`;
                    this.conversationHistory[0].content = enhancedSystemPrompt;

                    this._view?.webview.postMessage({
                        type: 'systemMessage',
                        content: '✅ Project analyzed and ready!'
                    });
                }
            }

            this.conversationHistory.push({
                role: 'user',
                content: message
            });

            let continueLoop = true;
            let maxIterations = 5; // Prevent infinite loops
            let iteration = 0;

            while (continueLoop && iteration < maxIterations) {
                iteration++;

                const response = await this.ollamaClient.chatWithTools(
                    this.defaultModel,
                    this.conversationHistory,
                    tools,
                    // onThinking callback
                    (thinking) => {
                        this._view?.webview.postMessage({
                            type: 'thinking',
                            content: thinking
                        });
                    },
                    // onContent callback
                    (content) => {
                        this._view?.webview.postMessage({
                            type: 'contentChunk',
                            content: content
                        });
                    }
                );

                // Check if model wants to call tools
                if (response.message?.tool_calls && response.message.tool_calls.length > 0) {
                    console.log('Tool calls detected:', response.message.tool_calls);

                    // Add assistant message with tool calls
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: response.message.content || '',
                        tool_calls: response.message.tool_calls
                    });

                    // Execute each tool call
                    for (const toolCall of response.message.tool_calls) {
                        const toolName = toolCall.function?.name;
                        const toolArgs = toolCall.function?.arguments;

                        if (toolName && toolArgs) {
                            console.log(`Executing tool: ${toolName}`, toolArgs);

                            // Show tool execution in UI
                            this._view?.webview.postMessage({
                                type: 'toolExecution',
                                tool: toolName,
                                args: toolArgs
                            });

                            const result = await this.executeTool(toolName, toolArgs);
                            console.log(`Tool result:`, result);

                            // Add tool result to conversation
                            this.conversationHistory.push({
                                role: 'tool',
                                content: result,
                                tool_call_id: toolCall.id
                            });

                            // Show tool result in UI
                            this._view?.webview.postMessage({
                                type: 'toolResult',
                                tool: toolName,
                                result: result
                            });
                        }
                    }

                    // Continue loop to get final response
                    continueLoop = true;
                } else {
                    // No tool calls, we have the final response
                    const finalContent = response.message.content || 'No response';
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: finalContent
                    });

                    this._view.webview.postMessage({
                        type: 'finalResponse',
                        content: finalContent
                    });

                    continueLoop = false;
                }
            }

            if (iteration >= maxIterations) {
                console.warn('Max tool call iterations reached');
            }

        } catch (error) {
            this._view.webview.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CodAI Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .header {
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .logo {
            font-size: 18px;
            font-weight: 600;
            letter-spacing: 0.5px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .model-selector {
            flex: 1;
            max-width: 300px;
            margin: 0 20px;
            padding: 10px 16px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s ease;
            outline: none;
        }
        
        .model-selector:hover {
            border-color: var(--vscode-focusBorder);
        }
        
        .model-selector:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
        }
        
        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
            scroll-behavior: smooth;
        }
        
        #messages::-webkit-scrollbar {
            width: 8px;
        }
        
        #messages::-webkit-scrollbar-track {
            background: transparent;
        }
        
        #messages::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 4px;
        }
        
        #messages::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
        
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            opacity: 0.6;
            animation: fadeIn 0.5s ease;
        }
        
        .empty-icon {
            width: 64px;
            height: 64px;
            margin-bottom: 16px;
            opacity: 0.5;
            animation: float 3s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 0.6; transform: translateY(0); }
        }
        
        .empty-text {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }
        
        .message {
            margin-bottom: 8px;
            animation: messageSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            opacity: 0;
            animation-fill-mode: forwards;
        }
        
        .message > * {
            margin-left: 0;
        }
        
        @keyframes messageSlideIn {
            from {
                opacity: 0;
                transform: translateY(8px) scale(0.98);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
        
        .message-header {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
        }
        
        .message-avatar {
            display: none !important;
        }
        
        .message-role {
            display: none !important;
        }
        
        .message-content {
            margin-left: 0;
            padding: 0 0 0 8px;
            border-radius: 0;
            line-height: 1.5;
            font-size: 13px;
            overflow-wrap: break-word;
            word-wrap: break-word;
            word-break: break-word;
            max-width: 100%;
        }
        
        .message-timestamp {
            font-size: 11px;
            opacity: 0.4;
            margin-top: 4px;
            padding-left: 8px;
        }
        
        .message-content p {
            margin: 0 0 8px 0;
        }
        
        .message-content p:last-child {
            margin-bottom: 0;
        }
        
        .message-content h1,
        .message-content h2,
        .message-content h3 {
            margin: 12px 0 6px 0;
            font-weight: 600;
            line-height: 1.3;
        }
        
        .message-content h1:first-child,
        .message-content h2:first-child,
        .message-content h3:first-child {
            margin-top: 0;
        }
        
        .message-content h1 {
            font-size: 16px;
        }
        
        .message-content h2 {
            font-size: 15px;
        }
        
        .message-content h3 {
            font-size: 14px;
        }
        
        .message-content ul,
        .message-content ol {
            margin: 6px 0;
            padding-left: 0;
            max-width: 100%;
            list-style-position: inside;
        }
        
        .message-content li {
            margin: 4px 0;
            line-height: 1.5;
            overflow-wrap: break-word;
            word-wrap: break-word;
            padding-left: 0;
            margin-left: 0;
        }
        
        .message-content ul li {
            list-style-type: disc;
        }
        
        .message-content ol li {
            list-style-type: decimal;
        }
        
        .message-content strong {
            font-weight: 600;
            color: var(--vscode-editor-foreground);
        }
        
        .message-content em {
            font-style: italic;
        }
        
        .message-content a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        
        .message-content a:hover {
            text-decoration: underline;
        }
        
        .user {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }
        
        .user .message-header {
            flex-direction: row-reverse;
        }
        
        .user .message-content {
            margin-left: 0;
            margin-right: 0;
            background: transparent;
            border: none;
            padding-left: 0;
        }
        
        .assistant .message-content {
            background: transparent;
            border: none;
            padding-left: 0;
        }
        
        .message-content pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
            font-size: 13px;
        }
        
        .message-content code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 13px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        }
        
        .message-content pre {
            position: relative;
        }
        
        .message-content pre code {
            background: none;
            padding: 0;
        }
        
        .code-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.03);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 6px 6px 0 0;
            margin: 8px 0 0 0;
        }
        
        .code-language {
            font-size: 11px;
            opacity: 0.6;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .copy-code-btn {
            padding: 4px 8px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            font-size: 11px;
            color: var(--vscode-foreground);
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .copy-code-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
        }
        
        .copy-code-btn svg {
            width: 12px;
            height: 12px;
        }
        
        .copy-code-btn.copied {
            background: rgba(102, 126, 234, 0.2);
            border-color: rgba(102, 126, 234, 0.3);
        }
        
        .message-actions {
            position: absolute;
            top: -8px;
            right: 8px;
            display: none;
            gap: 4px;
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            z-index: 100;
        }
        
        .message:hover .message-actions {
            display: flex;
        }
        
        .action-btn {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
            color: var(--vscode-foreground);
            opacity: 0.7;
        }
        
        .action-btn:hover {
            opacity: 1;
            background: var(--vscode-list-hoverBackground);
        }
        
        .action-btn svg {
            width: 14px;
            height: 14px;
        }
        
        .scroll-to-bottom {
            position: absolute;
            bottom: 80px;
            right: 20px;
            width: 40px;
            height: 40px;
            display: none;
            align-items: center;
            justify-content: center;
            background: var(--vscode-button-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 50;
        }
        
        .scroll-to-bottom.show {
            display: flex;
            animation: fadeInScale 0.3s ease;
        }
        
        @keyframes fadeInScale {
            from {
                opacity: 0;
                transform: scale(0.8);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }
        
        @keyframes fadeOut {
            from {
                opacity: 1;
                transform: scale(1);
            }
            to {
                opacity: 0;
                transform: scale(0.95);
            }
        }
        
        .scroll-to-bottom:hover {
            background: var(--vscode-button-hoverBackground);
            transform: scale(1.05);
        }
        
        .scroll-to-bottom svg {
            width: 20px;
            height: 20px;
            color: var(--vscode-button-foreground);
        }
        
        .tool-execution {
            padding: 8px 12px;
            margin: 8px 0;
            background: rgba(102, 126, 234, 0.1);
            border-left: 3px solid rgba(102, 126, 234, 0.5);
            border-radius: 4px;
            font-size: 12px;
            opacity: 0.8;
        }
        
        .tool-execution-header {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 500;
            margin-bottom: 4px;
        }
        
        .tool-execution-header svg {
            width: 14px;
            height: 14px;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        .tool-result {
            padding: 8px 12px;
            margin: 8px 0;
            background: rgba(76, 175, 80, 0.1);
            border-left: 3px solid rgba(76, 175, 80, 0.5);
            border-radius: 4px;
            font-size: 12px;
            opacity: 0.8;
        }
        
        .tool-result-header {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 500;
            margin-bottom: 4px;
            color: rgba(76, 175, 80, 1);
        }
        
        .tool-result-header svg {
            width: 14px;
            height: 14px;
        }
        
        .tool-content {
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 11px;
            opacity: 0.7;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .system-message {
            padding: 8px 16px;
            margin: 8px 0;
            background: rgba(255, 193, 7, 0.1);
            border-left: 3px solid rgba(255, 193, 7, 0.5);
            border-radius: 4px;
            font-size: 12px;
            text-align: center;
            opacity: 0.9;
            animation: fadeIn 0.3s ease;
        }
        
        .header-actions {
            display: flex;
            gap: 8px;
        }
        
        .header-btn {
            padding: 6px 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            font-size: 12px;
            color: var(--vscode-foreground);
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .header-btn:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
        }
        
        .header-btn svg {
            width: 14px;
            height: 14px;
        }
        
        .settings-panel {
            position: fixed;
            top: 0;
            right: -350px;
            width: 350px;
            height: 100vh;
            background: var(--vscode-sideBar-background);
            border-left: 1px solid var(--vscode-panel-border);
            box-shadow: -2px 0 8px rgba(0, 0, 0, 0.3);
            transition: right 0.3s ease;
            z-index: 10000;
            overflow-y: auto;
            padding: 20px;
        }
        
        .settings-panel.show {
            right: 0;
        }
        
        .settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .settings-title {
            font-size: 16px;
            font-weight: 600;
        }
        
        .close-settings {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
            color: var(--vscode-foreground);
        }
        
        .close-settings:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .close-settings svg {
            width: 18px;
            height: 18px;
        }
        
        .setting-group {
            margin-bottom: 24px;
        }
        
        .setting-label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }
        
        .setting-description {
            font-size: 11px;
            opacity: 0.6;
            margin-bottom: 8px;
        }
        
        .setting-input {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            font-family: inherit;
        }
        
        .setting-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .setting-textarea {
            min-height: 100px;
            resize: vertical;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        }
        
        .setting-range {
            width: 100%;
        }
        
        .setting-value {
            display: inline-block;
            margin-left: 8px;
            font-size: 12px;
            opacity: 0.7;
        }
        
        .thinking {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 0 0 0 8px;
            margin-left: 0;
            margin-bottom: 12px;
            font-size: 13px;
            background: transparent;
            border: none;
            border-radius: 0;
            max-height: 300px;
            overflow: hidden;
            transition: max-height 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), 
                        opacity 0.3s ease;
        }
        
        .thinking.collapsed {
            max-height: 28px;
        }
        
        .thinking::-webkit-scrollbar {
            width: 4px;
        }
        
        .thinking::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 2px;
        }
        
        .thinking-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
            font-weight: 400;
            cursor: pointer;
            user-select: none;
            opacity: 0.5;
            transition: opacity 0.2s ease;
            font-size: 13px;
        }
        
        .thinking-header:hover {
            opacity: 0.7;
        }
        
        .thinking-header svg {
            width: 14px;
            height: 14px;
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            opacity: 0.5;
        }
        
        .thinking.collapsed .thinking-header svg {
            transform: rotate(-90deg);
        }
        
        .thinking-content {
            font-family: inherit;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
            opacity: 0.5;
            display: block;
            overflow-y: auto;
            overflow-wrap: break-word;
            max-width: 100%;
            max-height: 250px;
            scroll-behavior: smooth;
            transition: opacity 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), 
                        max-height 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            padding-left: 0;
            margin-left: 0;
        }
        
        .thinking.collapsed .thinking-content {
            max-height: 0;
            opacity: 0;
            overflow: hidden;
        }
        
        .thinking-dots {
            display: flex;
            gap: 4px;
        }
        
        .thinking-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--vscode-foreground);
            opacity: 0.6;
            animation: bounce 1.4s infinite ease-in-out;
        }
        
        .thinking-dot:nth-child(1) { animation-delay: -0.32s; }
        .thinking-dot:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0.8); opacity: 0.4; }
            40% { transform: scale(1.2); opacity: 0.8; }
        }
        
        .typing-indicator {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 12px 0 12px 8px;
            margin-bottom: 8px;
        }
        
        .typing-bubble {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--vscode-foreground);
            opacity: 0.5;
            animation: typingBounce 1.4s infinite ease-in-out;
        }
        
        .typing-bubble:nth-child(1) { animation-delay: 0s; }
        .typing-bubble:nth-child(2) { animation-delay: 0.2s; }
        .typing-bubble:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes typingBounce {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
            30% { transform: translateY(-8px); opacity: 0.8; }
        }
        
        .input-container {
            padding: 20px;
            background: var(--vscode-sideBar-background);
            position: relative;
            overflow: visible;
        }
        
        .input-wrapper {
            display: flex;
            align-items: center;
            gap: 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 8px 12px;
            transition: all 0.2s ease;
            position: relative;
            overflow: visible;
        }
        
        .input-wrapper:focus-within {
            border-color: rgba(255, 255, 255, 0.2);
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05);
        }
        
        .input-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            position: relative;
            z-index: 100;
        }
        
        .icon-button {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s ease;
            color: var(--vscode-foreground);
            opacity: 0.7;
            padding: 0;
            position: relative;
            z-index: 10;
        }
        
        .icon-button:hover {
            opacity: 1;
            background: var(--vscode-list-hoverBackground);
        }
        
        .icon-button svg {
            width: 18px;
            height: 18px;
        }
        
        #input {
            flex: 1;
            padding: 8px 12px;
            background: transparent;
            color: var(--vscode-input-foreground);
            border: none;
            font-size: 14px;
            font-family: inherit;
            resize: none;
            min-height: 24px;
            max-height: 120px;
            outline: none;
            line-height: 1.5;
            z-index: 1;
            position: relative;
        }
        
        #input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        
        .model-dropdown {
            position: relative;
            z-index: 100000 !important;
            overflow: visible;
            pointer-events: auto !important;
        }
        
        .model-button {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            font-size: 12px;
            color: var(--vscode-foreground);
            cursor: pointer !important;
            transition: all 0.2s ease;
            white-space: nowrap;
            position: relative;
            z-index: 100001 !important;
            pointer-events: auto !important;
        }
        
        .model-button:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.15);
        }
        
        .model-button svg {
            width: 14px;
            height: 14px;
        }
        
        .model-menu {
            position: absolute;
            bottom: 100%;
            right: 0;
            margin-bottom: 8px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 8px;
            padding: 4px;
            min-width: 200px;
            max-height: 300px;
            overflow-y: auto;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            display: none;
            z-index: 100002;
            pointer-events: auto;
        }
        
        .model-menu.show {
            display: block;
            animation: slideUp 0.2s ease;
        }
        
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .model-option {
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .model-option:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .model-option.selected {
            background: rgba(102, 126, 234, 0.2);
        }
        
        .model-option svg {
            width: 12px;
            height: 12px;
            opacity: 0;
        }
        
        .model-option.selected svg {
            opacity: 1;
        }
        
        #send {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s ease;
            padding: 0;
            position: relative;
            z-index: 10;
        }
        
        #send:hover:not(:disabled) {
            transform: scale(1.05);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        
        #send:active:not(:disabled) {
            transform: scale(0.95);
        }
        
        #send:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        #send svg {
            width: 16px;
            height: 16px;
            color: white;
        }
        
        .shortcuts {
            display: flex;
            gap: 12px;
            margin-top: 8px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.6;
            padding: 0 12px;
        }
        
        .shortcut {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .key {
            padding: 2px 6px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-family: monospace;
            font-size: 10px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">CODAI</div>
        <div class="header-actions">
            <button class="header-btn" id="new-chat" title="New chat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                <span>New</span>
            </button>
            <button class="header-btn" id="clear-chat" title="Clear chat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                <span>Clear</span>
            </button>
            <button class="header-btn" id="settings-btn" title="Settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
                </svg>
            </button>
        </div>
    </div>
    
    <div class="settings-panel" id="settings-panel">
        <div class="settings-header">
            <div class="settings-title">Settings</div>
            <button class="close-settings" id="close-settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </div>
        
        <div class="setting-group">
            <label class="setting-label">
                Temperature
                <span class="setting-value" id="temp-value">0.7</span>
            </label>
            <div class="setting-description">Controls randomness: 0 is focused, 1 is creative</div>
            <input type="range" class="setting-input setting-range" id="temperature" min="0" max="1" step="0.1" value="0.7">
        </div>
        
        <div class="setting-group">
            <label class="setting-label">
                Max Tokens
                <span class="setting-value" id="tokens-value">2048</span>
            </label>
            <div class="setting-description">Maximum length of response</div>
            <input type="range" class="setting-input setting-range" id="max-tokens" min="256" max="8192" step="256" value="2048">
        </div>
        
        <div class="setting-group">
            <label class="setting-label">System Prompt</label>
            <div class="setting-description">Customize the AI's behavior and personality</div>
            <textarea class="setting-input setting-textarea" id="system-prompt" placeholder="Enter system prompt..."></textarea>
        </div>
    </div>
    
    <div id="messages">
        <div class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <div class="empty-text">Start a conversation</div>
        </div>
    </div>
    
    <button class="scroll-to-bottom" id="scroll-to-bottom" title="Scroll to bottom">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
        </svg>
    </button>
    
    <div class="input-container">
        <div class="input-wrapper">
            <div class="input-actions">
                <button class="icon-button" id="attach" title="Attach file">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                </button>
            </div>
            
            <textarea id="input" placeholder="Send a message" rows="1"></textarea>
            
            <div class="input-actions">
                <div class="model-dropdown">
                    <button class="model-button" id="model-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M12 1v6m0 6v6"/>
                        </svg>
                        <span id="model-text">qwen3-coder:480b-cloud</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                    </button>
                    <div class="model-menu" id="model-menu">
                        <div class="model-option selected" data-value="qwen3-coder:480b-cloud">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <span>qwen3-coder:480b-cloud</span>
                        </div>
                        <div class="model-option" data-value="deepseek-v3.1:671b-cloud">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <span>deepseek-v3.1:671b-cloud</span>
                        </div>
                        <div class="model-option" data-value="minimax-m2:cloud">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            <span>minimax-m2:cloud</span>
                        </div>
                    </div>
                </div>
                
                <button id="send" title="Send message">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"/>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                </button>
            </div>
        </div>
        <div class="shortcuts">
            <div class="shortcut">
                <span class="key">Enter</span>
                <span>to send</span>
            </div>
            <div class="shortcut">
                <span class="key">Shift</span>
                <span>+</span>
                <span class="key">Enter</span>
                <span>for new line</span>
            </div>
            <div class="shortcut">
                <span class="key">Ctrl</span>
                <span>+</span>
                <span class="key">K</span>
                <span>clear</span>
            </div>
            <div class="shortcut">
                <span class="key">Ctrl</span>
                <span>+</span>
                <span class="key">L</span>
                <span>new</span>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const modelBtn = document.getElementById('model-btn');
        const modelMenu = document.getElementById('model-menu');
        const modelText = document.getElementById('model-text');
        const messages = document.getElementById('messages');
        const input = document.getElementById('input');
        const sendBtn = document.getElementById('send');
        const attachBtn = document.getElementById('attach');
        const scrollToBottomBtn = document.getElementById('scroll-to-bottom');
        const newChatBtn = document.getElementById('new-chat');
        const clearChatBtn = document.getElementById('clear-chat');
        const settingsBtn = document.getElementById('settings-btn');
        const settingsPanel = document.getElementById('settings-panel');
        const closeSettingsBtn = document.getElementById('close-settings');
        const temperatureInput = document.getElementById('temperature');
        const tempValue = document.getElementById('temp-value');
        const maxTokensInput = document.getElementById('max-tokens');
        const tokensValue = document.getElementById('tokens-value');
        const systemPromptInput = document.getElementById('system-prompt');
        
        let messageCount = 0;
        let currentModel = 'qwen3-coder:480b-cloud';
        let isAtBottom = true;
        
        var defaultSystemPrompt = 'You are Codai, an expert AI coding assistant. You help developers with:' + String.fromCharCode(10) +
            '- Writing, debugging, and optimizing code' + String.fromCharCode(10) +
            '- Explaining complex programming concepts' + String.fromCharCode(10) +
            '- Suggesting best practices and design patterns' + String.fromCharCode(10) +
            '- Reviewing code and identifying potential issues' + String.fromCharCode(10) +
            '- Answering technical questions about various programming languages and frameworks' + String.fromCharCode(10) + String.fromCharCode(10) +
            'Always provide clear, concise, and practical solutions. Use code examples when helpful. Be friendly and supportive.';
        
        // Set default system prompt
        systemPromptInput.value = defaultSystemPrompt;
        
        let settings = {
            temperature: 0.7,
            maxTokens: 2048,
            systemPrompt: defaultSystemPrompt
        };
        
        // Load settings from localStorage
        try {
            const savedSettings = localStorage.getItem('codai_settings');
            if (savedSettings) {
                settings = JSON.parse(savedSettings);
                temperatureInput.value = settings.temperature;
                tempValue.textContent = settings.temperature;
                maxTokensInput.value = settings.maxTokens;
                tokensValue.textContent = settings.maxTokens;
                systemPromptInput.value = settings.systemPrompt;
            }
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
        
        // Settings panel toggle
        settingsBtn.onclick = () => {
            settingsPanel.classList.add('show');
        };
        
        closeSettingsBtn.onclick = () => {
            settingsPanel.classList.remove('show');
        };
        
        // Close settings when clicking outside
        settingsPanel.onclick = (e) => {
            if (e.target === settingsPanel) {
                settingsPanel.classList.remove('show');
            }
        };
        
        // Temperature slider
        temperatureInput.oninput = () => {
            settings.temperature = parseFloat(temperatureInput.value);
            tempValue.textContent = settings.temperature;
            localStorage.setItem('codai_settings', JSON.stringify(settings));
        };
        
        // Max tokens slider
        maxTokensInput.oninput = () => {
            settings.maxTokens = parseInt(maxTokensInput.value);
            tokensValue.textContent = settings.maxTokens;
            localStorage.setItem('codai_settings', JSON.stringify(settings));
        };
        
        // System prompt
        systemPromptInput.onchange = () => {
            settings.systemPrompt = systemPromptInput.value;
            localStorage.setItem('codai_settings', JSON.stringify(settings));
            
            // Update system prompt in backend
            vscode.postMessage({
                type: 'updateSystemPrompt',
                prompt: settings.systemPrompt
            });
        };
        
        // Memory System - Load conversation on startup
        function loadConversation() {
            try {
                const saved = localStorage.getItem('codai_conversation');
                if (saved) {
                    const data = JSON.parse(saved);
                    
                    // Restore messages to UI
                    if (data.messages && data.messages.length > 0) {
                        messages.innerHTML = '';
                        data.messages.forEach(msg => {
                            if (msg.role === 'user' || msg.role === 'assistant') {
                                addMessage(msg.role, msg.content, false);
                            }
                        });
                        messageCount = data.messages.length;
                    }
                    
                    // Send conversation history to backend
                    if (data.history) {
                        vscode.postMessage({
                            type: 'loadConversation',
                            history: data.history
                        });
                    }
                }
            } catch (e) {
                console.error('Failed to load conversation:', e);
            }
        }
        
        function saveConversation() {
            try {
                const messagesData = [];
                const messageElements = messages.querySelectorAll('.message');
                
                messageElements.forEach(msg => {
                    const role = msg.classList.contains('user') ? 'user' : 'assistant';
                    const contentEl = msg.querySelector('.message-content');
                    if (contentEl) {
                        messagesData.push({
                            role: role,
                            content: contentEl.textContent
                        });
                    }
                });
                
                localStorage.setItem('codai_conversation', JSON.stringify({
                    messages: messagesData,
                    timestamp: Date.now()
                }));
                
                vscode.postMessage({
                    type: 'saveConversation'
                });
            } catch (e) {
                console.error('Failed to save conversation:', e);
            }
        }
        
        // Load conversation on startup
        loadConversation();
        
        // New chat button
        newChatBtn.onclick = () => {
            if (confirm('Start a new chat? Current conversation will be cleared.')) {
                messages.innerHTML = '<div class="empty-state">' +
                    '<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
                    '</svg>' +
                    '<div class="empty-text">Start a conversation</div>' +
                    '</div>';
                messageCount = 0;
                
                // Clear localStorage
                localStorage.removeItem('codai_conversation');
                
                vscode.postMessage({
                    type: 'clearHistory'
                });
            }
        };
        
        // Clear chat button
        clearChatBtn.onclick = () => {
            if (confirm('Clear all messages? This cannot be undone.')) {
                messages.innerHTML = '<div class="empty-state">' +
                    '<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
                    '</svg>' +
                    '<div class="empty-text">Start a conversation</div>' +
                    '</div>';
                messageCount = 0;
                
                // Clear localStorage
                localStorage.removeItem('codai_conversation');
                
                vscode.postMessage({
                    type: 'clearHistory'
                });
            }
        };
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+K - Clear chat
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                clearChatBtn.click();
            }
            
            // Ctrl+L - New chat
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                newChatBtn.click();
            }
            
            // Ctrl+/ - Focus input
            if (e.ctrlKey && e.key === '/') {
                e.preventDefault();
                input.focus();
            }
            
            // Escape - Blur input
            if (e.key === 'Escape' && document.activeElement === input) {
                input.blur();
            }
        });
        
        // Scroll to bottom functionality
        function checkScrollPosition() {
            const threshold = 100;
            isAtBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
            
            if (isAtBottom) {
                scrollToBottomBtn.classList.remove('show');
            } else {
                scrollToBottomBtn.classList.add('show');
            }
        }
        
        messages.addEventListener('scroll', checkScrollPosition);
        
        scrollToBottomBtn.onclick = () => {
            messages.scrollTo({
                top: messages.scrollHeight,
                behavior: 'smooth'
            });
        };
        
        function scrollToBottom(smooth = true) {
            if (smooth) {
                messages.scrollTo({
                    top: messages.scrollHeight,
                    behavior: 'smooth'
                });
            } else {
                messages.scrollTop = messages.scrollHeight;
            }
        }
        
        // Model selector
        modelBtn.onclick = (e) => {
            console.log('Model button clicked!');
            e.stopPropagation();
            e.preventDefault();
            modelMenu.classList.toggle('show');
            console.log('Menu classes:', modelMenu.className);
        };
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!modelBtn.contains(e.target) && !modelMenu.contains(e.target)) {
                modelMenu.classList.remove('show');
            }
        });
        
        // Model option click
        document.querySelectorAll('.model-option').forEach(option => {
            option.onclick = (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                currentModel = value;
                modelText.textContent = value;
                
                // Update selected state
                document.querySelectorAll('.model-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                option.classList.add('selected');
                
                modelMenu.classList.remove('show');
                
                vscode.postMessage({
                    type: 'changeModel',
                    model: value
                });
            };
        });
        
        // Attach button (placeholder)
        attachBtn.onclick = () => {
            // TODO: Implement file attachment
            console.log('Attach clicked');
        };
        
        function clearEmptyState() {
            const emptyState = messages.querySelector('.empty-state');
            if (emptyState) {
                emptyState.style.animation = 'fadeOut 0.3s ease';
                setTimeout(() => emptyState.remove(), 300);
            }
        }
        
        function formatMarkdown(text) {
            text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            // Handle code blocks first
            var codeBlocks = [];
            var backtick = String.fromCharCode(96);
            var codeBlockRegex = new RegExp(backtick + backtick + backtick + '(\\\\w+)?\\\\n([\\\\s\\\\S]*?)' + backtick + backtick + backtick, 'g');
            text = text.replace(codeBlockRegex, function(match, lang, code) {
                var placeholder = '___CODE_BLOCK_' + codeBlocks.length + '___';
                codeBlocks.push({ lang: lang || 'code', code: code });
                return placeholder;
            });
            
            var lines = text.split(String.fromCharCode(10));
            var result = [];
            var inList = false;
            var listType = null;
            
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var trimmed = line.trim();
                
                // Check for code block placeholders
                if (trimmed.match(/^___CODE_BLOCK_(\d+)___$/)) {
                    if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
                    result.push(trimmed);
                    continue;
                }
                
                if (trimmed.match(/^### /)) {
                    if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
                    result.push('<h3>' + trimmed.substring(4) + '</h3>');
                }
                else if (trimmed.match(/^## /)) {
                    if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
                    result.push('<h2>' + trimmed.substring(3) + '</h2>');
                }
                else if (trimmed.match(/^# /)) {
                    if (inList) { result.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
                    result.push('<h1>' + trimmed.substring(2) + '</h1>');
                }
                else if (trimmed.match(/^[*-] /)) {
                    if (!inList || listType !== 'ul') {
                        if (inList) result.push('</ol>');
                        result.push('<ul>');
                        inList = true;
                        listType = 'ul';
                    }
                    result.push('<li>' + trimmed.substring(2) + '</li>');
                }
                else if (trimmed.match(/^[0-9]+\\. /)) {
                    if (!inList || listType !== 'ol') {
                        if (inList) result.push('</ul>');
                        result.push('<ol>');
                        inList = true;
                        listType = 'ol';
                    }
                    var content = trimmed.replace(/^[0-9]+\\. /, '');
                    result.push('<li>' + content + '</li>');
                }
                else {
                    if (inList) {
                        result.push(listType === 'ul' ? '</ul>' : '</ol>');
                        inList = false;
                    }
                    if (trimmed) {
                        result.push('<p>' + trimmed + '</p>');
                    }
                }
            }
            
            if (inList) {
                result.push(listType === 'ul' ? '</ul>' : '</ol>');
            }
            
            var html = result.join('');
            
            // Restore code blocks with proper formatting
            for (var i = 0; i < codeBlocks.length; i++) {
                var block = codeBlocks[i];
                var codeHtml = '<div class="code-header">' +
                    '<span class="code-language">' + block.lang + '</span>' +
                    '<button class="copy-code-btn" onclick="copyCode(this, ' + i + ')">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
                    '</svg>' +
                    '<span>Copy</span>' +
                    '</button>' +
                    '</div>' +
                    '<pre><code data-code-index="' + i + '">' + block.code + '</code></pre>';
                html = html.replace('___CODE_BLOCK_' + i + '___', codeHtml);
            }
            
            html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
            html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
            html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
            html = html.replace(/_(.+?)_/g, '<em>$1</em>');
            
            return html;
        }
        
        function copyCode(btn, index) {
            var code = document.querySelector('code[data-code-index="' + index + '"]');
            if (code) {
                navigator.clipboard.writeText(code.textContent).then(function() {
                    var span = btn.querySelector('span');
                    var originalText = span.textContent;
                    span.textContent = 'Copied!';
                    btn.classList.add('copied');
                    setTimeout(function() {
                        span.textContent = originalText;
                        btn.classList.remove('copied');
                    }, 2000);
                });
            }
        }
        
        function getRelativeTime(timestamp) {
            var now = Date.now();
            var diff = now - timestamp;
            var seconds = Math.floor(diff / 1000);
            var minutes = Math.floor(seconds / 60);
            var hours = Math.floor(minutes / 60);
            var days = Math.floor(hours / 24);
            
            if (seconds < 60) return 'Just now';
            if (minutes < 60) return minutes + 'm ago';
            if (hours < 24) return hours + 'h ago';
            return days + 'd ago';
        }
        
        function addMessage(role, content, shouldSave = true) {
            clearEmptyState();
            
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + role;
            messageDiv.style.animationDelay = (messageCount * 0.05) + 's';
            messageDiv.style.position = 'relative';
            messageDiv.dataset.timestamp = Date.now();
            
            const avatar = role === 'user' ? 'U' : 'AI';
            const roleName = role === 'user' ? 'You' : 'Codai';
            
            const formattedContent = formatMarkdown(content);
            
            const header = document.createElement('div');
            header.className = 'message-header';
            header.innerHTML = '<div class="message-avatar">' + avatar + '</div><div class="message-role">' + roleName + '</div>';
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = formattedContent;
            
            const timestamp = document.createElement('div');
            timestamp.className = 'message-timestamp';
            timestamp.textContent = 'Just now';
            
            // Message actions
            const actions = document.createElement('div');
            actions.className = 'message-actions';
            actions.innerHTML = 
                '<button class="action-btn" title="Copy message" onclick="copyMessage(this)">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
                '</svg>' +
                '</button>' +
                (role === 'assistant' ? 
                '<button class="action-btn" title="Regenerate" onclick="regenerateMessage(this)">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<polyline points="23 4 23 10 17 10"/>' +
                '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>' +
                '</svg>' +
                '</button>' : '') +
                '<button class="action-btn" title="Delete" onclick="deleteMessage(this)">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<polyline points="3 6 5 6 21 6"/>' +
                '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
                '</svg>' +
                '</button>';
            
            messageDiv.appendChild(actions);
            messageDiv.appendChild(header);
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timestamp);
            
            messages.appendChild(messageDiv);
            
            if (isAtBottom) {
                scrollToBottom(true);
            }
            
            messageCount++;
            
            // Auto-save conversation
            if (shouldSave) {
                saveConversation();
            }
            
            return messageDiv;
        }
        
        function copyMessage(btn) {
            var messageDiv = btn.closest('.message');
            var content = messageDiv.querySelector('.message-content');
            if (content) {
                navigator.clipboard.writeText(content.textContent);
            }
        }
        
        function regenerateMessage(btn) {
            var messageDiv = btn.closest('.message');
            var index = Array.from(messages.children).indexOf(messageDiv);
            
            // Find the user message before this assistant message
            var userMessage = null;
            for (var i = index - 1; i >= 0; i--) {
                if (messages.children[i].classList.contains('user')) {
                    userMessage = messages.children[i].querySelector('.message-content').textContent;
                    break;
                }
            }
            
            if (userMessage) {
                // Remove this and all subsequent messages
                while (messages.children.length > index) {
                    messages.removeChild(messages.lastChild);
                }
                
                // Resend the message
                sendBtn.disabled = true;
                vscode.postMessage({
                    type: 'sendMessage',
                    message: userMessage
                });
            }
        }
        
        function deleteMessage(btn) {
            var messageDiv = btn.closest('.message');
            messageDiv.style.animation = 'fadeOut 0.3s ease';
            setTimeout(function() {
                messageDiv.remove();
            }, 300);
        }
        
        // Update timestamps periodically
        setInterval(function() {
            document.querySelectorAll('.message-timestamp').forEach(function(ts) {
                var messageDiv = ts.closest('.message');
                if (messageDiv && messageDiv.dataset.timestamp) {
                    ts.textContent = getRelativeTime(parseInt(messageDiv.dataset.timestamp));
                }
            });
        }, 30000); // Update every 30 seconds
        
        function addThinking() {
            clearEmptyState();
            
            const thinkingDiv = document.createElement('div');
            thinkingDiv.className = 'message assistant';
            thinkingDiv.style.position = 'relative';
            thinkingDiv.dataset.timestamp = Date.now();
            
            const header = document.createElement('div');
            header.className = 'message-header';
            header.innerHTML = '<div class="message-avatar">AI</div><div class="message-role">Codai</div>';
            
            // Add typing indicator
            const typingIndicator = document.createElement('div');
            typingIndicator.className = 'typing-indicator';
            typingIndicator.innerHTML = 
                '<div class="typing-bubble"></div>' +
                '<div class="typing-bubble"></div>' +
                '<div class="typing-bubble"></div>';
            
            const thinking = document.createElement('div');
            thinking.className = 'thinking';
            thinking.id = 'thinking-container';
            
            const thinkingHeader = document.createElement('div');
            thinkingHeader.className = 'thinking-header';
            thinkingHeader.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg><span>Thinking...</span>';
            
            const thinkingContent = document.createElement('div');
            thinkingContent.className = 'thinking-content';
            
            thinking.appendChild(thinkingHeader);
            thinking.appendChild(thinkingContent);
            thinkingDiv.appendChild(header);
            thinkingDiv.appendChild(typingIndicator);
            thinkingDiv.appendChild(thinking);
            
            messages.appendChild(thinkingDiv);
            
            if (isAtBottom) {
                scrollToBottom(true);
            }
            
            thinkingHeader.onclick = () => {
                thinking.classList.toggle('collapsed');
            };
            
            return thinkingDiv;
        }
        
        function updateThinking(thinkingDiv, text) {
            const content = thinkingDiv.querySelector('.thinking-content');
            const header = thinkingDiv.querySelector('.thinking-header span');
            if (content) {
                content.textContent = text;
                if (!content.parentElement.classList.contains('collapsed')) {
                    content.scrollTop = content.scrollHeight;
                }
            }
            if (header && text) {
                const lines = text.split(String.fromCharCode(10)).length;
                header.textContent = 'Thought for ' + lines + ' lines';
            }
        }
        
        function send() {
            const text = input.value.trim();
            if (!text || sendBtn.disabled) return;
            
            addMessage('user', text);
            input.value = '';
            input.style.height = 'auto';
            sendBtn.disabled = true;
            
            vscode.postMessage({
                type: 'sendMessage',
                message: text
            });
        }
        
        // Auto-resize textarea
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });
        
        sendBtn.onclick = send;
        
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
            }
        };
        
        window.addEventListener('message', (event) => {
            const msg = event.data;
            
            if (msg.type === 'systemMessage') {
                clearEmptyState();
                
                const sysDiv = document.createElement('div');
                sysDiv.className = 'system-message';
                sysDiv.textContent = msg.content;
                
                messages.appendChild(sysDiv);
                if (isAtBottom) {
                    scrollToBottom(true);
                }
                
                // Auto-remove after 3 seconds if it's a success message
                if (msg.content.includes('✅')) {
                    setTimeout(function() {
                        sysDiv.style.animation = 'fadeOut 0.3s ease';
                        setTimeout(function() {
                            sysDiv.remove();
                        }, 300);
                    }, 3000);
                }
            }
            else if (msg.type === 'toolExecution') {
                clearEmptyState();
                
                const toolDiv = document.createElement('div');
                toolDiv.className = 'tool-execution';
                toolDiv.innerHTML = 
                    '<div class="tool-execution-header">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<circle cx="12" cy="12" r="10"/>' +
                    '<polyline points="12 6 12 12 16 14"/>' +
                    '</svg>' +
                    '<span>Executing: ' + msg.tool + '</span>' +
                    '</div>' +
                    '<div class="tool-content">' + JSON.stringify(msg.args, null, 2) + '</div>';
                
                messages.appendChild(toolDiv);
                if (isAtBottom) {
                    scrollToBottom(true);
                }
            }
            else if (msg.type === 'toolResult') {
                const lastTool = messages.querySelector('.tool-execution:last-child');
                if (lastTool) {
                    lastTool.remove();
                }
                
                const resultDiv = document.createElement('div');
                resultDiv.className = 'tool-result';
                const truncatedResult = msg.result.length > 500 
                    ? msg.result.substring(0, 500) + '...' + String.fromCharCode(10) + '[truncated]'
                    : msg.result;
                    
                resultDiv.innerHTML = 
                    '<div class="tool-result-header">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<polyline points="20 6 9 17 4 12"/>' +
                    '</svg>' +
                    '<span>Tool result: ' + msg.tool + '</span>' +
                    '</div>' +
                    '<div class="tool-content">' + truncatedResult + '</div>';
                
                messages.appendChild(resultDiv);
                if (isAtBottom) {
                    scrollToBottom(true);
                }
            }
            else if (msg.type === 'thinking') {
                let thinkingDiv = messages.querySelector('.message.assistant:last-child');
                if (!thinkingDiv || !thinkingDiv.querySelector('.thinking')) {
                    thinkingDiv = addThinking();
                }
                if (thinkingDiv) {
                    updateThinking(thinkingDiv, msg.content);
                }
            }
            else if (msg.type === 'contentChunk') {
                // Check if we have a thinking message
                let lastMessage = messages.querySelector('.message.assistant:last-child');
                
                if (lastMessage && lastMessage.querySelector('.thinking')) {
                    // Remove typing indicator when content starts
                    const typingIndicator = lastMessage.querySelector('.typing-indicator');
                    if (typingIndicator) {
                        typingIndicator.remove();
                    }
                    
                    // Auto-collapse thinking when content starts
                    const thinking = lastMessage.querySelector('.thinking');
                    if (thinking && !thinking.classList.contains('collapsed')) {
                        thinking.classList.add('collapsed');
                    }
                    
                    // We have thinking, add content to the same message
                    let contentDiv = lastMessage.querySelector('.message-content');
                    if (!contentDiv) {
                        contentDiv = document.createElement('div');
                        contentDiv.className = 'message-content';
                        
                        // Add timestamp
                        const timestamp = document.createElement('div');
                        timestamp.className = 'message-timestamp';
                        timestamp.textContent = 'Just now';
                        
                        // Add message actions
                        const actions = document.createElement('div');
                        actions.className = 'message-actions';
                        actions.innerHTML = 
                            '<button class="action-btn" title="Copy message" onclick="copyMessage(this)">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
                            '</svg>' +
                            '</button>' +
                            '<button class="action-btn" title="Regenerate" onclick="regenerateMessage(this)">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                            '<polyline points="23 4 23 10 17 10"/>' +
                            '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>' +
                            '</svg>' +
                            '</button>' +
                            '<button class="action-btn" title="Delete" onclick="deleteMessage(this)">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                            '<polyline points="3 6 5 6 21 6"/>' +
                            '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
                            '</svg>' +
                            '</button>';
                        
                        if (!lastMessage.querySelector('.message-actions')) {
                            lastMessage.insertBefore(actions, lastMessage.firstChild);
                        }
                        lastMessage.appendChild(contentDiv);
                        lastMessage.appendChild(timestamp);
                    }
                    contentDiv.innerHTML = formatMarkdown(msg.content);
                } else {
                    // No thinking, create new message or update existing
                    if (!lastMessage || lastMessage.querySelector('.thinking')) {
                        addMessage('assistant', msg.content);
                    } else {
                        const contentDiv = lastMessage.querySelector('.message-content');
                        if (contentDiv) {
                            contentDiv.innerHTML = formatMarkdown(msg.content);
                        }
                    }
                }
                
                if (isAtBottom) {
                    scrollToBottom(true);
                }
            }
            else if (msg.type === 'finalResponse') {
                // Check if we already have the message from streaming
                let lastMessage = messages.querySelector('.message.assistant:last-child');
                
                // Remove typing indicator
                const typingIndicator = lastMessage?.querySelector('.typing-indicator');
                if (typingIndicator) {
                    typingIndicator.remove();
                }
                
                // If we have thinking but no content yet, add content
                if (lastMessage && lastMessage.querySelector('.thinking') && !lastMessage.querySelector('.message-content')) {
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'message-content';
                    contentDiv.innerHTML = formatMarkdown(msg.content);
                    
                    const timestamp = document.createElement('div');
                    timestamp.className = 'message-timestamp';
                    timestamp.textContent = 'Just now';
                    
                    const actions = document.createElement('div');
                    actions.className = 'message-actions';
                    actions.innerHTML = 
                        '<button class="action-btn" title="Copy message" onclick="copyMessage(this)">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
                        '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
                        '</svg>' +
                        '</button>' +
                        '<button class="action-btn" title="Regenerate" onclick="regenerateMessage(this)">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<polyline points="23 4 23 10 17 10"/>' +
                        '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>' +
                        '</svg>' +
                        '</button>' +
                        '<button class="action-btn" title="Delete" onclick="deleteMessage(this)">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<polyline points="3 6 5 6 21 6"/>' +
                        '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
                        '</svg>' +
                        '</button>';
                    
                    if (!lastMessage.querySelector('.message-actions')) {
                        lastMessage.insertBefore(actions, lastMessage.firstChild);
                    }
                    lastMessage.appendChild(contentDiv);
                    lastMessage.appendChild(timestamp);
                } else if (!lastMessage || (!lastMessage.querySelector('.message-content') && !lastMessage.querySelector('.thinking'))) {
                    // No message at all, create new one
                    addMessage('assistant', msg.content);
                }
                
                sendBtn.disabled = false;
            }
            else if (msg.type === 'error') {
                const thinking = messages.querySelector('.thinking');
                if (thinking) {
                    thinking.parentElement.remove();
                }
                addMessage('assistant', 'Error: ' + msg.message);
                sendBtn.disabled = false;
            }
        });
    </script>
</body>
</html>`;
    }
}
