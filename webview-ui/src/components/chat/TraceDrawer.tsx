import type { LatestTraceSummary, TurnState } from '../../types';

interface PreflightNotice {
  severity: 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

interface TraceDrawerProps {
  open: boolean;
  latestTrace: LatestTraceSummary | null;
  turnState: TurnState | null;
  preflightNotice: PreflightNotice | null;
  resumeNotice: string | null;
  onClose: () => void;
  onOpenTrace: () => void;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleTimeString();
}

export function TraceDrawer({
  open,
  latestTrace,
  turnState,
  preflightNotice,
  resumeNotice,
  onClose,
  onOpenTrace,
}: TraceDrawerProps) {
  if (!open) return null;

  return (
    <aside className="side-drawer side-drawer--trace" aria-label="Debug trace drawer">
      <div className="side-drawer-header">
        <div>
          <div className="side-drawer-eyebrow">Debug Trace</div>
          <div className="side-drawer-title">Latest turn state and local trace</div>
        </div>
        <div className="side-drawer-actions">
          {latestTrace?.traceFilePath && (
            <button className="side-drawer-action" onClick={onOpenTrace}>
              Open trace
            </button>
          )}
          <button className="side-drawer-close" onClick={onClose} title="Close debug trace">
            Close
          </button>
        </div>
      </div>

      {resumeNotice && <div className="side-drawer-notice">{resumeNotice}</div>}

      {preflightNotice && (
        <div className={`side-drawer-notice side-drawer-notice--${preflightNotice.severity}`}>
          {[...preflightNotice.errors, ...preflightNotice.warnings].join(' ')}
        </div>
      )}

      <div className="side-drawer-stat-grid">
        <div className="side-drawer-stat">
          <span>Phase</span>
          <strong>{turnState?.phase || latestTrace?.phase || 'idle'}</strong>
        </div>
        <div className="side-drawer-stat">
          <span>Provider</span>
          <strong>{turnState?.providerId || latestTrace?.providerId || '-'}</strong>
        </div>
        <div className="side-drawer-stat">
          <span>Model</span>
          <strong>{turnState?.model || latestTrace?.model || '-'}</strong>
        </div>
      </div>

      <div className="side-drawer-list">
        <div className="side-drawer-card">
          <div className="side-drawer-card-title">Turn lifecycle</div>
          <div className="side-drawer-meta-row">
            <span>Started</span>
            <strong>{formatTime(turnState?.startedAt || latestTrace?.startedAt)}</strong>
          </div>
          <div className="side-drawer-meta-row">
            <span>Finished</span>
            <strong>{formatTime(turnState?.finishedAt || latestTrace?.finishedAt)}</strong>
          </div>
          <div className="side-drawer-meta-row">
            <span>Iteration</span>
            <strong>{turnState?.iteration ?? 0}</strong>
          </div>
          <div className="side-drawer-meta-row">
            <span>Events</span>
            <strong>{latestTrace?.eventCount ?? 0}</strong>
          </div>
        </div>

        <div className="side-drawer-card">
          <div className="side-drawer-card-title">Active tool calls</div>
          {turnState?.activeToolCallIds?.length ? (
            <div className="side-drawer-tags">
              {turnState.activeToolCallIds.map((id) => (
                <span key={id} className="side-drawer-tag">{id}</span>
              ))}
            </div>
          ) : (
            <div className="side-drawer-empty">No active tool calls for the latest turn.</div>
          )}
        </div>

        <div className="side-drawer-card">
          <div className="side-drawer-card-title">Budget snapshot</div>
          <div className="side-drawer-meta-row">
            <span>Context tokens</span>
            <strong>{turnState?.budgetState?.contextTokens?.toLocaleString?.() ?? '-'}</strong>
          </div>
          <div className="side-drawer-meta-row">
            <span>Tokens left</span>
            <strong>{turnState?.budgetState?.tokensLeft?.toLocaleString?.() ?? '-'}</strong>
          </div>
          <div className="side-drawer-meta-row">
            <span>Compacted messages</span>
            <strong>{turnState?.budgetState?.compactedMessageCount ?? 0}</strong>
          </div>
        </div>

        {(turnState?.error || latestTrace?.error) && (
          <div className="side-drawer-card side-drawer-card--error">
            <div className="side-drawer-card-title">Latest error</div>
            <div className="side-drawer-card-body">{turnState?.error || latestTrace?.error}</div>
          </div>
        )}
      </div>
    </aside>
  );
}
