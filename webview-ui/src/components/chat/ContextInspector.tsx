import type { ContextPreviewPayload, ContextWindowStats } from '../../types';

interface ContextInspectorProps {
  open: boolean;
  preview: ContextPreviewPayload | null;
  tokenCount: ContextWindowStats | null;
  onClose: () => void;
}

export function ContextInspector({ open, preview, tokenCount, onClose }: ContextInspectorProps) {
  if (!open) return null;

  return (
    <aside className="side-drawer side-drawer--context" aria-label="Context inspector">
      <div className="side-drawer-header">
        <div>
          <div className="side-drawer-eyebrow">Context Inspector</div>
          <div className="side-drawer-title">What is in the prompt now</div>
        </div>
        <button className="side-drawer-close" onClick={onClose} title="Close context inspector">
          Close
        </button>
      </div>

      {tokenCount && (
        <div className="side-drawer-stat-grid">
          <div className="side-drawer-stat">
            <span>Used</span>
            <strong>{tokenCount.percentUsed}%</strong>
          </div>
          <div className="side-drawer-stat">
            <span>Tokens</span>
            <strong>{tokenCount.contextTokens.toLocaleString()}</strong>
          </div>
          <div className="side-drawer-stat">
            <span>Left</span>
            <strong>{tokenCount.tokensLeft.toLocaleString()}</strong>
          </div>
        </div>
      )}

      <div className="side-drawer-section">
        <div className="side-drawer-section-title">Artifacts</div>
        {preview?.artifacts?.length ? (
          <div className="side-drawer-list">
            {preview.artifacts.map((artifact) => (
              <div key={artifact.id} className="side-drawer-card">
                <div className="side-drawer-card-head">
                  <span className="side-drawer-chip">{artifact.kind}</span>
                  <span className="side-drawer-card-tokens">{artifact.tokenEstimate} tok</span>
                </div>
                <div className="side-drawer-card-title">{artifact.title}</div>
                <div className="side-drawer-card-body">{artifact.preview}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="side-drawer-empty">No context preview available yet.</div>
        )}
      </div>

      <div className="side-drawer-section">
        <div className="side-drawer-section-title">Retrieved Memory</div>
        {preview?.retrievalHits?.length ? (
          <div className="side-drawer-list">
            {preview.retrievalHits.map((hit) => (
              <div key={hit.id} className="side-drawer-card">
                <div className="side-drawer-card-head">
                  <span className="side-drawer-chip">{hit.source}</span>
                  <span className="side-drawer-card-tokens">score {hit.score}</span>
                </div>
                <div className="side-drawer-card-title">{hit.title}</div>
                <div className="side-drawer-card-body">{hit.preview}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="side-drawer-empty">No retrieved context was needed for the latest turn.</div>
        )}
      </div>
    </aside>
  );
}
