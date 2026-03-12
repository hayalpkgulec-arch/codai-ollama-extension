/**
 * TaskHeader — Kilo-style sticky session header
 * Shows: session title, elapsed time, message count, token usage
 */
import { useEffect, useState } from 'react';
import { Clock, MessageSquare, Cpu } from 'lucide-react';
import type { ContextWindowStats } from '../../types';

interface TaskHeaderProps {
  title?: string;
  startedAt?: number;
  isProcessing: boolean;
  messageCount: number;
  tokenCount?: ContextWindowStats | null;
}

function useElapsed(startedAt: number | undefined, isProcessing: boolean): string | undefined {
  const [elapsed, setElapsed] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!startedAt || !isProcessing) {
      setElapsed(undefined);
      return;
    }
    const tick = () => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      if (secs < 60) setElapsed(`${secs}s`);
      else setElapsed(`${Math.floor(secs / 60)}m ${secs % 60}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, isProcessing]);

  return elapsed;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export function TaskHeader({ title, startedAt, isProcessing, messageCount, tokenCount }: TaskHeaderProps) {
  const elapsed = useElapsed(startedAt, isProcessing);
  const percentUsed = tokenCount?.percentUsed ?? 0;
  const percentLeft = Math.max(0, 100 - percentUsed);

  if (!title && messageCount === 0) return null;

  return (
    <div className="task-header">
      <div className="task-header-title" title={title}>
        {title || 'New Chat'}
      </div>
      <div className="task-header-stats">
        {tokenCount && tokenCount.contextTokens > 0 && (
          <div className="task-header-context">
            <span className="task-header-tokens">
              <Cpu size={10} />
              {formatPercent(percentUsed)}
            </span>
            <div className="task-header-context-popover" role="note">
              <div className="task-header-context-title">Context window:</div>
              <div className="task-header-context-strong">
                {formatPercent(percentUsed)} used ({formatPercent(percentLeft)} left)
              </div>
              <div className="task-header-context-meta">
                {formatTokens(tokenCount.contextTokens)} / {formatTokens(tokenCount.maxContextTokens || tokenCount.contextTokens)} tokens used
              </div>
              <div className="task-header-context-note">
                CodAI automatically compacts its context
              </div>
            </div>
          </div>
        )}
        {elapsed && (
          <span className="task-header-elapsed">
            <Clock size={10} />
            {elapsed}
          </span>
        )}
        {messageCount > 0 && (
          <span className="task-header-count">
            <MessageSquare size={10} />
            {messageCount}
          </span>
        )}
      </div>
    </div>
  );
}
