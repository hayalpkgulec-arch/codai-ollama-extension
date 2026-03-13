import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import { createHash } from 'crypto';

export class WorkspaceStorage {
    private readonly globalRoot: string;
    private readonly workspaceRoot: string;
    private readonly workspaceHash: string;
    private readonly workspaceDir: string;
    private readonly writeQueue = new Map<string, Promise<void>>();

    constructor(private readonly context: vscode.ExtensionContext) {
        const workspaceFsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'no-workspace';
        this.workspaceRoot = workspaceFsPath;
        this.workspaceHash = createHash('sha1').update(workspaceFsPath).digest('hex').slice(0, 12);
        this.globalRoot = context.globalStorageUri.fsPath;
        this.workspaceDir = path.join(this.globalRoot, 'workspaces', this.workspaceHash);
        this.ensureDirectories();
    }

    public getWorkspaceHash(): string {
        return this.workspaceHash;
    }

    public getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    public getWorkspaceDir(): string {
        return this.workspaceDir;
    }

    public getTraceFilePath(turnId: string): string {
        return path.join(this.workspaceDir, 'traces', `${turnId}.jsonl`);
    }

    public getBrowserArtifactsDir(sessionId?: string): string {
        const baseDir = path.join(this.workspaceDir, 'browser');
        return sessionId ? path.join(baseDir, sessionId) : baseDir;
    }

    public getBrowserArtifactFilePath(sessionId: string, artifactId: string, extension: string): string {
        const normalizedExtension = extension.startsWith('.') ? extension.slice(1) : extension;
        return path.join(this.getBrowserArtifactsDir(sessionId), `${artifactId}.${normalizedExtension}`);
    }

    public readBrowserArtifactsIndex<T>(fallback: T): T {
        return this.readJsonSync(path.join(this.getBrowserArtifactsDir(), 'index.json'), fallback);
    }

    public async writeBrowserArtifactsIndex<T>(value: T): Promise<void> {
        await this.writeJson(path.join(this.getBrowserArtifactsDir(), 'index.json'), value);
    }

    public readWorkspaceState<T>(fallback: T): T {
        const file = path.join(this.workspaceDir, 'state.json');
        return this.readJsonSync(file, fallback);
    }

    public async writeWorkspaceState<T>(value: T): Promise<void> {
        await this.writeJson(path.join(this.workspaceDir, 'state.json'), value);
    }

    public readProviderState<T>(fallback: T): T {
        return this.readJsonSync(path.join(this.globalRoot, 'providers.json'), fallback);
    }

    public async writeProviderState<T>(value: T): Promise<void> {
        await this.writeJson(path.join(this.globalRoot, 'providers.json'), value);
    }

    public readSessionIndex<T>(fallback: T): T {
        return this.readJsonSync(path.join(this.workspaceDir, 'sessions', 'index.json'), fallback);
    }

    public async writeSessionIndex<T>(value: T): Promise<void> {
        await this.writeJson(path.join(this.workspaceDir, 'sessions', 'index.json'), value);
    }

    public readSessionHistory<T>(sessionId: string, fallback: T): T {
        return this.readJsonSync(path.join(this.workspaceDir, 'sessions', `${sessionId}.json`), fallback);
    }

    public async writeSessionHistory<T>(sessionId: string, value: T): Promise<void> {
        await this.writeJson(path.join(this.workspaceDir, 'sessions', `${sessionId}.json`), value);
    }

    public async deleteSessionHistory(sessionId: string): Promise<void> {
        const filePath = path.join(this.workspaceDir, 'sessions', `${sessionId}.json`);
        await fsp.rm(filePath, { force: true });
    }

    public readTurnState<T>(fallback: T): T {
        return this.readJsonSync(path.join(this.workspaceDir, 'turn-state.json'), fallback);
    }

    public async writeTurnState<T>(value: T): Promise<void> {
        await this.writeJson(path.join(this.workspaceDir, 'turn-state.json'), value);
    }

    public readLatestTraceSummary<T>(fallback: T): T {
        return this.readJsonSync(path.join(this.workspaceDir, 'latest-trace.json'), fallback);
    }

    public async writeLatestTraceSummary<T>(value: T): Promise<void> {
        await this.writeJson(path.join(this.workspaceDir, 'latest-trace.json'), value);
    }

    public async appendTraceEvent(turnId: string, value: unknown): Promise<void> {
        const traceFile = this.getTraceFilePath(turnId);
        await fsp.mkdir(path.dirname(traceFile), { recursive: true });
        await fsp.appendFile(traceFile, `${JSON.stringify(value)}\n`, 'utf8');
    }

    private ensureDirectories() {
        const dirs = [
            this.globalRoot,
            path.join(this.workspaceDir, 'sessions'),
            path.join(this.workspaceDir, 'transcripts'),
            path.join(this.workspaceDir, 'context'),
            path.join(this.workspaceDir, 'memories'),
            path.join(this.workspaceDir, 'traces'),
            path.join(this.workspaceDir, 'indexes'),
            path.join(this.workspaceDir, 'browser'),
        ];
        for (const dirPath of dirs) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    private readJsonSync<T>(filePath: string, fallback: T): T {
        try {
            if (!fs.existsSync(filePath)) return fallback;
            return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
        } catch {
            return fallback;
        }
    }

    private async writeJson(filePath: string, value: unknown): Promise<void> {
        const previousWrite = this.writeQueue.get(filePath) ?? Promise.resolve();
        const nextWrite = previousWrite
            .catch(() => undefined)
            .then(async () => {
                await fsp.mkdir(path.dirname(filePath), { recursive: true });
                const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const payload = JSON.stringify(value, null, 2);

                try {
                    await fsp.writeFile(tempFile, payload, 'utf8');
                    await fsp.rename(tempFile, filePath);
                } catch (error: any) {
                    if (error?.code === 'ENOENT' || error?.code === 'EPERM' || error?.code === 'EEXIST') {
                        await fsp.writeFile(filePath, payload, 'utf8');
                    } else {
                        throw error;
                    }
                } finally {
                    await fsp.rm(tempFile, { force: true }).catch(() => undefined);
                }
            });

        this.writeQueue.set(filePath, nextWrite);
        try {
            await nextWrite;
        } finally {
            if (this.writeQueue.get(filePath) === nextWrite) {
                this.writeQueue.delete(filePath);
            }
        }
    }
}
