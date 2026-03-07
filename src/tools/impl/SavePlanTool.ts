/**
 * SavePlanTool — Kiro-style spec file writer.
 *
 * Saves a structured plan to .codai/plans/<slug>/ with:
 *   requirements.md  — EARS notation user stories
 *   design.md        — Technical architecture
 *   tasks.md         — Implementation checklist
 */

import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';
import * as path from 'path';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';

function slugify(title: string): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 40);
    return `${slug}-${date}`;
}

export class SavePlanTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'save_plan',
            description: `Save the feature plan as structured spec files to .codai/plans/<name>/ directory.
Creates three files: requirements.md, design.md, tasks.md (Kiro-style specs).
Call this BEFORE task_notes in Plan Mode. The files will be opened in VSCode.`,
            parameters: {
                type: 'object',
                properties: {
                    title: {
                        type: 'string',
                        description: 'Short title for the plan (used as folder name). E.g. "Admin Panel Feature"'
                    },
                    requirements: {
                        type: 'string',
                        description: `Requirements in EARS notation markdown.
Format:
# Requirements

## User Stories
- WHEN [condition] THE SYSTEM SHALL [behavior]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2`
                    },
                    design: {
                        type: 'string',
                        description: `Technical design markdown.
Format:
# Design

## Architecture
Description of approach

## Components
- Component A: purpose
- Component B: purpose

## Data Flow
Description

## Considerations
- Security, performance, edge cases`
                    },
                    tasks: {
                        type: 'string',
                        description: `Implementation tasks markdown checklist.
Format:
# Tasks

- [ ] Create src/components/AdminPanel.tsx
- [ ] Add route /admin in App.tsx
- [ ] Create src/api/admin.ts`
                    }
                },
                required: ['title', 'requirements', 'tasks']
            }
        };
    }

    async execute(args: {
        title: string;
        requirements: string;
        design?: string;
        tasks: string;
    }): Promise<string> {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) return 'Error: No workspace folder open';

        const { title, requirements, design, tasks } = args;
        if (!title?.trim()) return 'Error: title is required';
        if (!requirements?.trim()) return 'Error: requirements is required';
        if (!tasks?.trim()) return 'Error: tasks is required';

        const slug = slugify(title.trim());
        const planDir = path.join(workspaceRoot, '.codai', 'plans', slug);

        try {
            await fs.mkdir(planDir, { recursive: true });

            const reqPath    = path.join(planDir, 'requirements.md');
            const designPath = path.join(planDir, 'design.md');
            const tasksPath  = path.join(planDir, 'tasks.md');

            await Promise.all([
                fs.writeFile(reqPath, requirements.trim(), 'utf-8'),
                fs.writeFile(designPath, (design || `# Design\n\n_No design notes provided._`).trim(), 'utf-8'),
                fs.writeFile(tasksPath, tasks.trim(), 'utf-8'),
            ]);

            // Notify webview with plan file paths for View Plan button
            this.emitToWebview('planSaved', {
                title: title.trim(),
                slug,
                planDir: path.relative(workspaceRoot, planDir),
                files: {
                    requirements: path.relative(workspaceRoot, reqPath),
                    design: path.relative(workspaceRoot, designPath),
                    tasks: path.relative(workspaceRoot, tasksPath),
                }
            });

            // Open tasks.md in VSCode editor
            try {
                await vscode.commands.executeCommand(
                    'vscode.open',
                    vscode.Uri.file(tasksPath),
                    { preview: true, preserveFocus: true }
                );
            } catch { /* non-critical */ }

            return JSON.stringify({
                status: 'success',
                message: `Plan saved to .codai/plans/${slug}/`,
                files: ['requirements.md', 'design.md', 'tasks.md'],
                planDir: `.codai/plans/${slug}`,
            });
        } catch (e: any) {
            return `Error saving plan: ${e.message}`;
        }
    }
}
