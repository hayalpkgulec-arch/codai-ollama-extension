/**
 * WorkingIndicator
 * Shown below the conversation while the assistant is processing but has not
 * yet rendered a visible thinking/content/tool block for the current turn.
 */

interface WorkingIndicatorProps {
  isProcessing: boolean;
  isStreaming: boolean;
  iterationCount: number;
  /** Son mesajın aktif segment içerip içermediği — doluysa zaten UI gösteriyor, duplicate etme */
  lastMessageHasContent: boolean;
}

export function WorkingIndicator({
  isProcessing,
  isStreaming,
  iterationCount,
  lastMessageHasContent,
}: WorkingIndicatorProps) {
  // Sadece gerçekten "boşta bekliyor" durumunda göster:
  // - İşlem devam ediyor
  // - Streaming yok (henüz token gelmiyor)
  // - Son mesajda görünür içerik yok (thinking/tool/content segment'i yok)
  //   → aksi halde duplicate "..." görünür
  if (!isProcessing || isStreaming || lastMessageHasContent) return null;

  const label = iterationCount > 1 ? 'Working...' : 'Generating...';

  return (
    <div className="working-indicator" role="status" aria-label="AI is working">
      <span className="working-shimmer">{label}</span>
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
