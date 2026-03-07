import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { ClipboardList, ChevronDown, ChevronRight, X, ArrowRight, Check, Zap } from 'lucide-react';
import { parsePlanTasks, getPlanStats } from './parsePlanTasks';
import type { PlanTask } from './parsePlanTasks';
import { PlanTaskItem } from './PlanTaskItem';
import './PlanPanel.css';

interface PlanPanelProps {
    /** Raw markdown checklist from task_notes */
    todos: string;
    /** Optional summary text */
    summary?: string;
    /** True when model has signalled plan is ready (attempt_completion) */
    planReady?: boolean;
    /** Is the agent currently processing? */
    isProcessing: boolean;
    /** Called when user wants to run a specific task */
    onRunTask: (taskText: string) => void;
    /** Called when user accepts the full plan and switches to Code mode */
    onAcceptPlan: (tasksMarkdown: string) => void;
    /** Called when user closes the panel */
    onClose: () => void;
}

export const PlanPanel = memo(({
    todos,
    summary,
    planReady = false,
    isProcessing,
    onRunTask,
    onAcceptPlan,
    onClose,
}: PlanPanelProps) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [overrides, setOverrides] = useState<Map<string, 'done' | 'skipped' | 'pending'>>(new Map());
    const [autoCollapsed, setAutoCollapsed] = useState(false);

    const tasks = useMemo(() => {
        const parsed = parsePlanTasks(todos);
        return parsed.map(t => {
            const ov = overrides.get(t.id);
            if (ov) return { ...t, status: ov as any };
            return t;
        });
    }, [todos, overrides]);

    const stats = useMemo(() => getPlanStats(tasks), [tasks]);

    // Auto-collapse 600ms after all tasks are marked done
    useEffect(() => {
        if (tasks.length > 0 && stats.total > 0 && stats.completed === stats.total && !autoCollapsed) {
            const t = setTimeout(() => { setIsExpanded(false); setAutoCollapsed(true); }, 600);
            return () => clearTimeout(t);
        }
    }, [stats.completed, stats.total, tasks.length, autoCollapsed]);

    const handleToggle = useCallback((id: string) => {
        setOverrides(prev => {
            const next = new Map(prev);
            const task = tasks.find(t => t.id === id);
            if (!task) return prev;
            next.set(id, task.status === 'done' ? 'pending' : 'done');
            return next;
        });
    }, [tasks]);

    const handleSkip = useCallback((id: string) => {
        setOverrides(prev => { const next = new Map(prev); next.set(id, 'skipped'); return next; });
    }, []);

    const handleRun = useCallback((task: PlanTask) => { onRunTask(task.text); }, [onRunTask]);

    const handleAcceptAll = useCallback(() => {
        const remaining = tasks
            .filter(t => t.status !== 'done' && t.status !== 'skipped')
            .map(t => `- [ ] ${t.text}`)
            .join('\n');
        onAcceptPlan(remaining || todos);
    }, [tasks, todos, onAcceptPlan]);

    const allDone = stats.total > 0 && stats.completed === stats.total;

    return (
        <div className={`plan-panel${allDone ? ' all-done' : ''}${planReady ? ' plan-ready' : ''}`}>

            {/* ── Header ── */}
            <div className="plan-panel-header" onClick={() => setIsExpanded(e => !e)}>
                <div className="plan-panel-header-left">
                    <ClipboardList size={12} className="plan-panel-icon" />
                    <span className="plan-panel-title">
                        {allDone ? 'Plan Complete' : planReady ? 'Plan Ready' : 'Task Plan'}
                    </span>
                    {stats.total > 0 && (
                        <span className="plan-panel-count">{stats.completed}/{stats.total}</span>
                    )}
                </div>

                {/* Progress bar */}
                {stats.total > 0 && (
                    <div className="plan-panel-progress-wrap">
                        <div
                            className="plan-panel-progress-fill"
                            style={{ width: `${stats.progressPct}%` }}
                        />
                    </div>
                )}

                <div className="plan-panel-header-right">
                    <button
                        className="plan-panel-close"
                        onClick={e => { e.stopPropagation(); onClose(); }}
                        title="Dismiss plan"
                    >
                        <X size={10} />
                    </button>
                    {isExpanded
                        ? <ChevronDown size={11} className="plan-chevron" />
                        : <ChevronRight size={11} className="plan-chevron" />}
                </div>
            </div>

            {/* ── Summary ── */}
            {summary && isExpanded && (
                <div className="plan-panel-summary">{summary}</div>
            )}

            {/* ── Task list ── */}
            {isExpanded && (
                <div className="plan-panel-body">
                    {tasks.length === 0 ? (
                        <div className="plan-panel-empty">
                            {isProcessing
                                ? <><span className="plan-spinner" /> Generating plan…</>
                                : 'No tasks yet.'}
                        </div>
                    ) : (
                        tasks.map(task => (
                            <PlanTaskItem
                                key={task.id}
                                task={task}
                                onToggle={handleToggle}
                                onRun={handleRun}
                                onSkip={handleSkip}
                                isProcessing={isProcessing}
                            />
                        ))
                    )}
                </div>
            )}

            {/* ── Footer — plan ready CTA ── */}
            {isExpanded && !allDone && (planReady || tasks.length > 0) && (
                <div className="plan-panel-footer">
                    {/* Accept full plan */}
                    <button
                        className="plan-accept-btn"
                        onClick={handleAcceptAll}
                        disabled={isProcessing}
                        title="Accept this plan and implement it in Code mode"
                    >
                        <Check size={11} strokeWidth={2.5} />
                        <span>Accept Plan</span>
                        <ArrowRight size={10} className="plan-accept-arrow" />
                    </button>

                    {/* Run single next task */}
                    {tasks.some(t => t.status === 'active' || t.status === 'pending') && (
                        <button
                            className="plan-next-btn"
                            onClick={() => {
                                const next = tasks.find(t => t.status === 'active' || t.status === 'pending');
                                if (next) handleRun(next);
                            }}
                            disabled={isProcessing}
                            title="Run just the next task in Code mode"
                        >
                            <Zap size={10} strokeWidth={2.5} />
                            <span>Next step only</span>
                        </button>
                    )}
                </div>
            )}

            {/* ── All done ── */}
            {allDone && isExpanded && (
                <div className="plan-panel-done-msg">
                    <Check size={12} /> All steps completed!
                </div>
            )}
        </div>
    );
});
PlanPanel.displayName = 'PlanPanel';
