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
export class AskFollowupQuestionTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'ask_followup_question',
            description: 'Ask the user a single clarifying question. In Plan Mode, prefer ask_followup_questions (plural) to ask multiple questions in one wizard UI.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question to ask the user.' },
                    options: {
                        type: 'array', items: { type: 'string' },
                        description: 'Optional suggested answers (max 5).'
                    }
                },
                required: ['question']
            }
        };
    }

    async execute(args: { question: string; options?: string[] }): Promise<string> {
        if (!args.question?.trim()) return 'Error: question cannot be empty';
        const options = (args.options || []).slice(0, 5);
        // Route through unified wizard UI
        this.emitToWebview('questionsRequest', {
            questions: [{ question: args.question, hint: '', options, allowCustom: true }]
        });
        return `Question sent to user: "${args.question}"`;
    }
}

// ── ask_followup_questions (plural) ─────────────────────────────────────────
export class AskFollowupQuestionsTool extends BaseTool {
    get definition(): Tool {
        return {
            name: 'ask_followup_questions',
            description: `Ask multiple clarifying questions in a step-by-step wizard UI (Kiro-style).
Use this in Plan Mode FIRST, before exploring or planning.
Ask 2-4 questions max. Each question shows radio buttons + optional free-text input.
Call ONCE with ALL questions — do not call multiple times.`,
            parameters: {
                type: 'object',
                properties: {
                    questions: {
                        type: 'array',
                        description: '2-4 questions to ask the user.',
                        items: {
                            type: 'object',
                            properties: {
                                question: { type: 'string', description: 'The question text.' },
                                hint:     { type: 'string', description: 'Subtitle hint e.g. "(pick one option)"' },
                                options:  { type: 'array', items: { type: 'string' }, description: '2-5 radio options.' },
                                allowCustom: { type: 'boolean', description: 'Show "Type your own answer" input. Default: true' }
                            },
                            required: ['question']
                        }
                    }
                },
                required: ['questions']
            }
        };
    }

    async execute(args: { questions: Array<{ question: string; hint?: string; options?: string[]; allowCustom?: boolean }> }): Promise<string> {
        const questions = (args.questions || []).slice(0, 4).map(q => ({
            question: (q.question || '').trim(),
            hint: q.hint || '',
            options: (q.options || []).slice(0, 5),
            allowCustom: q.allowCustom !== false,
        })).filter(q => q.question);

        if (!questions.length) return 'Error: questions array cannot be empty';
        this.emitToWebview('questionsRequest', { questions });
        return `Questions sent to user (${questions.length} questions in wizard).`;
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
