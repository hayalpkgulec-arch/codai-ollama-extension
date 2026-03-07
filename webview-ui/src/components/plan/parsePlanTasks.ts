// ── Parse markdown checklist into structured PlanTask array ──────────────────
// Supports: - [ ] pending, - [x] done, indented sub-tasks

export type TaskItemStatus = 'pending' | 'active' | 'done' | 'skipped';

export interface PlanTask {
    id: string;
    text: string;
    status: TaskItemStatus;
    indent: number;  // 0 = top level
}

export interface PlanStats {
    total: number;
    completed: number;
    progressPct: number;
    firstPendingIdx: number;  // BUG 6 FIX: "firstPeridingIdx" → "firstPendingIdx"
}

const ITEM_RE = /^(\s*)-\s*\[(.)\]\s*(.+)$/;

export function parsePlanTasks(markdown: string): PlanTask[] {
    if (!markdown) return [];
    const lines = markdown.split('\n');
    const tasks: PlanTask[] = [];
    let idx = 0;

    for (const line of lines) {
        const m = ITEM_RE.exec(line);
        if (!m) continue;
        const [, leadingSpace, checkChar, text] = m;
        const indent = leadingSpace ? Math.floor(leadingSpace.length / 2) : 0;
        const isDone = checkChar.toLowerCase() === 'x';
        tasks.push({
            id: `task-${idx++}`,
            text: text.trim(),
            status: isDone ? 'done' : 'pending',
            indent,
        });
    }

    // Mark the first pending top-level item as 'active'
    const firstPending = tasks.find(t => t.status === 'pending' && t.indent === 0);
    if (firstPending) firstPending.status = 'active';

    return tasks;
}

export function getPlanStats(tasks: PlanTask[]): PlanStats {
    const total = tasks.filter(t => t.indent === 0).length;
    const completed = tasks.filter(t => t.indent === 0 && t.status === 'done').length;
    const firstPendingIdx = tasks.findIndex(t => t.status === 'pending' || t.status === 'active');
    return {
        total,
        completed,
        progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
        firstPendingIdx: firstPendingIdx,
    };
}

/** Serialize tasks back to markdown (when user edits) */
export function tasksToPlanMarkdown(tasks: PlanTask[]): string {
    return tasks.map(t => {
        const check = t.status === 'done' ? 'x' : ' ';
        const indent = '  '.repeat(t.indent);
        return `${indent}- [${check}] ${t.text}`;
    }).join('\n');
}
