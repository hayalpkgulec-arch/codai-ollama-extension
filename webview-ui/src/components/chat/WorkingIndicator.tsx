/**
 * WorkingIndicator — Kilo-style animated "working" shimmer
 * Shown between iterations when AI is actively processing.
 */
import { useEffect, useState } from 'react';

interface WorkingIndicatorProps {
  isProcessing: boolean;
  isStreaming: boolean;
  iterationCount: number;
}

const MESSAGES = [
  'Working…',
  'Thinking…',
  'Analyzing…',
  'Processing…',
  'Reading files…',
  'Running tools…',
];

export function WorkingIndicator({ isProcessing, isStreaming, iterationCount }: WorkingIndicatorProps) {
  const [msg, setMsg] = useState(MESSAGES[0]);

  useEffect(() => {
    if (!isProcessing) return;
    const idx = iterationCount % MESSAGES.length;
    setMsg(MESSAGES[idx]);
  }, [isProcessing, iterationCount]);

  if (!isProcessing || isStreaming) return null;

  return (
    <div className="working-indicator" role="status" aria-label="AI is working">
      <div className="working-dots">
        <span />
        <span />
        <span />
      </div>
      <span className="working-shimmer">{msg}</span>
    </div>
  );
}

// ── ScrollToBottom button ─────────────────────────────────────────────────────
interface ScrollToBottomProps {
  visible: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomProps) {
  if (!visible) return null;
  return (
    <button
      className="scroll-to-bottom-btn"
      onClick={onClick}
      aria-label="Scroll to bottom"
      title="Scroll to bottom"
    >
      ↓
    </button>
  );
}
