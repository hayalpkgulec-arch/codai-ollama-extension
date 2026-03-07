import { BaseTool } from '../core/BaseTool';
import { Tool } from '../../core/types';

// ── task_notes ──────────────────────────────────────────────────────────────
// Model bu tool'u çağırarak görev listesini günceller.
// Sonuç UI'a "todoUpdate" event olarak iletilir.
export class TaskNotesTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'task_notes',
            description: 'Create or update your task progress checklist. ALWAYS call this at the very start of any multi-step task with ALL planned steps. Mark completed steps with [x]. Use markdown checkboxes.',
            parameters: {
                type: 'object',
                properties: {
                    todos: {
                        type: 'string',
                        description: 'Markdown checklist. Use "- [ ]" for pending and "- [x]" for done items. One item per line.'
                    },
                    summary: {
                        type: 'string',
                        description: 'Short (1-2 sentence) status summary of current progress.'
                    }
                },
                required: ['todos']
            }
        };
    }

    async execute(args: { todos: string; summary?: string }): Promise<string> {
        if (!args.todos?.trim()) return 'Error: todos cannot be empty';
        this.emitToWebview('todoUpdate', {
            todos: args.todos,
            summary: args.summary || ''
        });
        const lines = args.todos.split('\n').filter(l => /^\s*-\s*\[/.test(l)).length;
        return `Task notes updated (${lines} items).`;
    }
}

// ── ask_followup_question ───────────────────────────────────────────────────
// Model belirsizlikte kullanıcıya soru sorar.
export class AskFollowupQuestionTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'ask_followup_question',
            description: 'Ask the user a clarifying question when you need more information to complete a task. Use this when requirements are ambiguous.',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to ask the user.'
                    },
                    options: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional list of suggested answers the user can choose from (max 5).'
                    }
                },
                required: ['question']
            }
        };
    }

    async execute(args: { question: string; options?: string[] }): Promise<string> {
        if (!args.question?.trim()) return 'Error: question cannot be empty';
        const options = (args.options || []).slice(0, 5); // cap at 5
        this.emitToWebview('clarificationRequest', {
            question: args.question,
            options
        });
        return `Question sent to user: "${args.question}"`;
    }
}

// ── attempt_completion ──────────────────────────────────────────────────────
// Model görevi tamamladığında bunu resmi olarak bildirir.
export class AttemptCompletionTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'attempt_completion',
            description: 'Signal that you have completed the task. Use this only when all requested work is done. Provide a brief result summary.',
            parameters: {
                type: 'object',
                properties: {
                    result: {
                        type: 'string',
                        description: 'Brief description of what was accomplished.'
                    }
                },
                required: ['result']
            }
        };
    }

    async execute(args: { result: string }): Promise<string> {
        if (!args.result?.trim()) return 'Error: result cannot be empty';
        this.emitToWebview('taskComplete', {
            result: args.result
        });
        // Also update todos — mark all as done
        this.emitToWebview('taskCompletionResult', {
            result: args.result
        });
        return `Task complete: ${args.result}`;
    }
}
