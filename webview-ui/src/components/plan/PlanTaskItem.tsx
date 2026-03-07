import { memo } from 'react';
import { Play, SkipForward, Check } from 'lucide-react';
import type { PlanTask } from './parsePlanTasks';

interface PlanTaskItemProps {
    task: PlanTask;
    onToggle: (id: string) => void;
    onRun: (task: PlanTask) => void;
    onSkip: (id: string) => void;
    isProcessing: boolean;
}

export const PlanTaskItem = memo(({ task, onToggle, onRun, onSkip, isProcessing }: PlanTaskItemProps) => {
    const isDone = task.status === 'done';
    const isSkipped = task.status === 'skipped';
    const isActive = task.status === 'active';

    return (
        <div
            className={`plan-task-item plan-task-${task.status}`}
            style={{ paddingLeft: `${task.indent * 16 + 10}px` }}
        >
            {/* Indicator: spinner for active, checkmark for done, empty ring for pending */}
            <button
                className="plan-task-checkbox"
                onClick={() => onToggle(task.id)}
                title={isDone ? 'Mark as pending' : 'Mark as done'}
                aria-label={isDone ? 'Mark as pending' : 'Mark as done'}
            >
                {isDone ? (
                    <Check size={10} strokeWidth={3} />
                ) : isActive ? (
                    // Minimal spinner for active task
                    <span className="plan-task-spinner" />
                ) : (
                    <span className="plan-task-empty-dot" />
                )}
            </button>

            {/* Task text — shimmer on active */}
            <span className={`plan-task-text${isActive ? ' active-shimmer' : ''}${isSkipped ? ' skipped' : ''}`}>
                {task.text}
            </span>

            {/* Actions */}
            <div className="plan-task-actions">
                {!isDone && !isSkipped && (
                    <>
                        <button
                            className="plan-task-run-btn"
                            onClick={() => onRun(task)}
                            disabled={isProcessing}
                            title="Execute this task in Code mode"
                        >
                            <Play size={9} strokeWidth={2.5} />
                            <span>Run</span>
                        </button>
                        <button
                            className="plan-task-skip-btn"
                            onClick={() => onSkip(task.id)}
                            title="Skip this task"
                        >
                            <SkipForward size={9} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
});
PlanTaskItem.displayName = 'PlanTaskItem';
