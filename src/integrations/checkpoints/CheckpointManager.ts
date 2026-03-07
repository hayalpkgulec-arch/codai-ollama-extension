/**
 * CheckpointManager — lightweight shadow-copy based file checkpointing.
 *
 * Before every write_file operation, the original file is copied to
 * .codai/checkpoints/<timestamp>/<relative-path>.
 * Users can revert to any checkpoint.
 *
 * Inspired by Cline's CheckpointTracker (git-based) but simpler:
 * no git required, works in any workspace.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const MAX_CHECKPOINTS = 30;
const CHECKPOINT_DIR = '.codai/checkpoints';

export interface CheckpointEntry {
    id: string;             // timestamp-based unique id
    timestamp: string;      // ISO
    filePath: string;       // relative to workspace root
    originalPath: string;   // absolute path to backup copy
    toolName: string;       // which tool triggered this
}

export class CheckpointManager {
    private workspaceRoot: string;
    private checkpointDir: string;
    private entries: CheckpointEntry[] = [];
    private readonly storageKey = 'codai_checkpoints_v1';

    constructor(
        private readonly extensionContext: vscode.ExtensionContext
    ) {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        this.checkpointDir = path.join(this.workspaceRoot, CHECKPOINT_DIR);
        this.entries = extensionContext.workspaceState.get<CheckpointEntry[]>(this.storageKey) ?? [];
    }

    /**
     * Save a checkpoint of a file before it's written.
     * Call this BEFORE write_file executes.
     */
    public async saveCheckpoint(filePath: string, toolName: string): Promise<string | null> {
        if (!this.workspaceRoot || !filePath) return null;
        try {
            const absPath = path.isAbsolute(filePath)
                ? filePath
                : path.join(this.workspaceRoot, filePath);

            // File must exist to checkpoint
            if (!fs.existsSync(absPath)) return null;

            const id = `cp-${Date.now()}`;
            const relPath = path.relative(this.workspaceRoot, absPath);
            const backupDir = path.join(this.checkpointDir, id, path.dirname(relPath));
            const backupPath = path.join(backupDir, path.basename(relPath));

            fs.mkdirSync(backupDir, { recursive: true });
            fs.copyFileSync(absPath, backupPath);

            const entry: CheckpointEntry = {
                id,
                timestamp: new Date().toISOString(),
                filePath: relPath,
                originalPath: backupPath,
                toolName,
            };
            this.entries.unshift(entry);

            // Prune old checkpoints
            if (this.entries.length > MAX_CHECKPOINTS) {
                const removed = this.entries.splice(MAX_CHECKPOINTS);
                for (const r of removed) {
                    try { fs.rmSync(path.dirname(r.originalPath), { recursive: true, force: true }); } catch { /* */ }
                }
            }

            await this.persist();
            return id;
        } catch (e) {
            console.error('CheckpointManager.saveCheckpoint:', e);
            return null;
        }
    }

    /**
     * Revert file to a specific checkpoint.
     */
    public async revertToCheckpoint(checkpointId: string): Promise<{ success: boolean; message: string }> {
        const entry = this.entries.find(e => e.id === checkpointId);
        if (!entry) return { success: false, message: `Checkpoint ${checkpointId} not found` };

        try {
            const absTarget = path.join(this.workspaceRoot, entry.filePath);
            if (!fs.existsSync(entry.originalPath)) {
                return { success: false, message: 'Backup file no longer exists' };
            }
            fs.mkdirSync(path.dirname(absTarget), { recursive: true });
            fs.copyFileSync(entry.originalPath, absTarget);
            return { success: true, message: `Reverted ${entry.filePath} to checkpoint ${entry.timestamp}` };
        } catch (e: any) {
            return { success: false, message: e.message };
        }
    }

    public getCheckpoints(): CheckpointEntry[] {
        return this.entries;
    }

    public getCheckpointsForFile(relPath: string): CheckpointEntry[] {
        return this.entries.filter(e => e.filePath === relPath);
    }

    private async persist(): Promise<void> {
        await this.extensionContext.workspaceState.update(this.storageKey, this.entries);
    }
}
