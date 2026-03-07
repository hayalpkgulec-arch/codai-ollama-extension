import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class AnalyzeProjectTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'analyze_project',
            description: 'Analyze the project structure and provide insights',
            parameters: { type: 'object', properties: {} }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const analysis: any = {
            root: workspaceRoot,
            files: [],
            languages: new Set(),
            frameworks: [],
            packageManagers: []
        };

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

                if (file === 'package.json') {
                    analysis.packageManagers.push('npm/yarn');
                    const content = await fs.readFile(filePath, 'utf-8');
                    const pkg = JSON.parse(content);
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
            } catch { /* ignore */ }
        }

        analysis.languages = Array.from(analysis.languages);
        return `Project Analysis:
- Root: ${analysis.root}
- Languages: ${analysis.languages.join(', ') || 'Unknown'}
- Frameworks: ${analysis.frameworks.join(', ') || 'None detected'}
- Package Managers: ${analysis.packageManagers.join(', ') || 'None detected'}
- Config Files: ${analysis.files.join(', ')}`;
    }
}

export class GetDiagnosticsTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'get_diagnostics',
            description: 'Get compilation errors, warnings, and other diagnostics for files',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace root (optional)' }
                }
            }
        };
    }

    async execute(args: any): Promise<any> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const diagnostics = vscode.languages.getDiagnostics();

        if (args.path) {
            const resolved = path.resolve(workspaceRoot, args.path);
            const fileUri = vscode.Uri.file(resolved);
            const fileDiagnostics = vscode.languages.getDiagnostics(fileUri);

            if (fileDiagnostics.length === 0) return `No diagnostics found for ${args.path}`;

            const result = fileDiagnostics.map((d) => ({
                severity: vscode.DiagnosticSeverity[d.severity],
                message: d.message,
                line: d.range.start.line + 1,
                column: d.range.start.character + 1,
                source: d.source
            }));
            return `Diagnostics for ${args.path}:
${JSON.stringify(result, null, 2)}`;
        }

        if (diagnostics.length === 0) return 'No diagnostics found in workspace';

        const result: any = {};
        diagnostics.forEach(([uri, diags]) => {
            const relativePath = path.relative(workspaceRoot, uri.fsPath);
            result[relativePath] = diags.map((d) => ({
                severity: vscode.DiagnosticSeverity[d.severity],
                message: d.message,
                line: d.range.start.line + 1,
                column: d.range.start.character + 1,
                source: d.source
            }));
        });
        return `Workspace Diagnostics:
${JSON.stringify(result, null, 2)}`;
    }
}
