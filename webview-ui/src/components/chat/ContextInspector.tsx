import type { ContextPreviewPayload, ContextWindowStats } from '../../types';

interface ContextInspectorProps {
  open: boolean;
  preview: ContextPreviewPayload | null;
  tokenCount: ContextWindowStats | null;
  onClose: () => void;
}

export function ContextInspector({ open, preview, tokenCount, onClose }: ContextInspectorProps) {
  if (!open) return null;

  const layerSummary = preview?.artifacts?.reduce<Record<string, { count: number; tokens: number }>>((acc, artifact) => {
    const entry = acc[artifact.kind] || { count: 0, tokens: 0 };
    entry.count += 1;
    entry.tokens += artifact.tokenEstimate;
    acc[artifact.kind] = entry;
    return acc;
  }, {}) || {};

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
          <div className="side-drawer-stat">
            <span>Max</span>
            <strong>{tokenCount.maxContextTokens.toLocaleString()}</strong>
          </div>
        </div>
      )}

      <div className="side-drawer-section">
        <div className="side-drawer-section-title">Prompt Layers</div>
        {Object.keys(layerSummary).length > 0 ? (
          <div className="side-drawer-list">
            {Object.entries(layerSummary).map(([kind, meta]) => (
              <div key={kind} className="side-drawer-card">
                <div className="side-drawer-card-head">
                  <span className="side-drawer-chip">{kind}</span>
                  <span className="side-drawer-card-tokens">{meta.tokens} tok</span>
                </div>
                <div className="side-drawer-card-title">{meta.count} layer{meta.count === 1 ? '' : 's'}</div>
                <div className="side-drawer-card-body">
                  This prompt layer currently contributes {meta.tokens} estimated tokens.
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="side-drawer-empty">Prompt layers will appear after the next context preview.</div>
        )}
      </div>

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

      {(preview?.compactionSnapshotCount || preview?.workspaceMemoryCount) && (
        <div className="side-drawer-section">
          <div className="side-drawer-section-title">Context Engine</div>
          <div className="side-drawer-list">
            <div className="side-drawer-card">
              <div className="side-drawer-meta-row">
                <span>Compaction snapshots</span>
                <strong>{preview?.compactionSnapshotCount ?? 0}</strong>
              </div>
              <div className="side-drawer-meta-row">
                <span>Workspace memories</span>
                <strong>{preview?.workspaceMemoryCount ?? 0}</strong>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
