/**
 * TaskHeader — Kilo-style sticky session header
 * Shows: session title, elapsed time, message count
 */
import { useEffect, useState } from 'react';
import { Clock, MessageSquare } from 'lucide-react';

interface TaskHeaderProps {
  title?: string;
  startedAt?: number;   // timestamp when current task started
  isProcessing: boolean;
  messageCount: number;
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

export function TaskHeader({ title, startedAt, isProcessing, messageCount }: TaskHeaderProps) {
  const elapsed = useElapsed(startedAt, isProcessing);

  if (!title && messageCount === 0) return null;

  return (
    <div className="task-header">
      <div className="task-header-title" title={title}>
        {title || 'New Chat'}
      </div>
      <div className="task-header-stats">
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
