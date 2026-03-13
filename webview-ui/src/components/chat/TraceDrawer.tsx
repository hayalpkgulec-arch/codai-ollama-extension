import { vscode } from '../../vscode';
import type {
  BrowserSessionState,
  GoalControlState,
  LatestTraceSummary,
  ToolApprovalPreview,
  ToolCatalogEntry,
  ToolControlState,
  TurnState,
} from '../../types';

interface PreflightNotice {
  severity: 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

interface TraceDrawerProps {
  open: boolean;
  latestTrace: LatestTraceSummary | null;
  turnState: TurnState | null;
  toolControlState: ToolControlState | null;
  goalControlState: GoalControlState | null;
  browserSessionState: BrowserSessionState | null;
  approvalPreview: ToolApprovalPreview | null;
  runtimeWarning: { severity: 'info' | 'warning' | 'error'; message: string } | null;
  preflightNotice: PreflightNotice | null;
  resumeNotice: string | null;
  toolCatalog: ToolCatalogEntry[];
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
  toolControlState,
  goalControlState,
  browserSessionState,
  approvalPreview,
  runtimeWarning,
  preflightNotice,
  resumeNotice,
  toolCatalog,
  onClose,
  onOpenTrace,
}: TraceDrawerProps) {
  if (!open) return null;

  const latestBlockedAlert = toolControlState?.alerts
    .filter((alert) => alert.code.toLowerCase().includes('block'))
    .slice(-1)[0] || null;
  const recoveryHint = goalControlState?.recoveryHint || latestBlockedAlert?.suggestedAction || toolControlState?.recommendedAction || null;
  const externalTools = toolCatalog.filter((entry) => entry.manifest.source === 'external');
  const completedCheckpoints = goalControlState?.checkpoints.filter((checkpoint) => checkpoint.done).length ?? 0;

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

      {runtimeWarning && (
        <div className={`side-drawer-notice side-drawer-notice--${runtimeWarning.severity === 'error' ? 'error' : 'warning'}`}>
          {runtimeWarning.message}
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

        {goalControlState && (
          <div className="side-drawer-card">
            <div className="side-drawer-card-title">Goal control</div>
            <div className="side-drawer-meta-row">
              <span>Active goal</span>
              <strong>{goalControlState.activeGoal}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Checkpoint progress</span>
              <strong>{goalControlState.checkpoints.length > 0 ? `${completedCheckpoints}/${goalControlState.checkpoints.length}` : 'No checkpoints yet'}</strong>
            </div>
            {goalControlState.lastProgressNote && (
              <div className="side-drawer-meta-row">
                <span>Last progress</span>
                <strong>{goalControlState.lastProgressNote}</strong>
              </div>
            )}
            {goalControlState.recommendedNextStep && (
              <div className="side-drawer-meta-row">
                <span>Next step</span>
                <strong>{goalControlState.recommendedNextStep}</strong>
              </div>
            )}
            {recoveryHint && (
              <div className="side-drawer-meta-row">
                <span>Recovery hint</span>
                <strong>{recoveryHint}</strong>
              </div>
            )}
            {goalControlState.driftWarnings.length > 0 && (
              <div className="side-drawer-stack">
                {goalControlState.driftWarnings.slice(-3).reverse().map((warning, index) => (
                  <div key={`${warning}-${index}`} className="side-drawer-notice side-drawer-notice--warning">
                    {warning}
                  </div>
                ))}
              </div>
            )}
            {goalControlState.checkpoints.length > 0 && (
              <div className="side-drawer-tags">
                {goalControlState.checkpoints.map((checkpoint) => (
                  <span key={checkpoint.id} className="side-drawer-tag">
                    {checkpoint.done ? 'done' : 'todo'}: {checkpoint.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {toolControlState && (
          <div className="side-drawer-card">
            <div className="side-drawer-card-title">Tool control</div>
            <div className="side-drawer-meta-row">
              <span>Focus</span>
              <strong>{toolControlState.focus}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Recommended</span>
              <strong>{toolControlState.recommendedAction}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Total calls</span>
              <strong>{toolControlState.totalCalls}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Blocked</span>
              <strong>{toolControlState.blockedCalls}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Failure streak</span>
              <strong>{toolControlState.consecutiveFailures}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>External tools</span>
              <strong>{externalTools.length}</strong>
            </div>
            {latestBlockedAlert && (
              <div className="side-drawer-meta-row">
                <span>Last blocked</span>
                <strong>{latestBlockedAlert.message}</strong>
              </div>
            )}
            {recoveryHint && (
              <div className="side-drawer-meta-row">
                <span>Recovery hint</span>
                <strong>{recoveryHint}</strong>
              </div>
            )}
            {toolControlState.alerts.length > 0 && (
              <div className="side-drawer-stack">
                {toolControlState.alerts.slice(-3).reverse().map((alert) => (
                  <div key={alert.id} className={`side-drawer-notice side-drawer-notice--${alert.severity === 'error' ? 'error' : 'warning'}`}>
                    {alert.message}
                  </div>
                ))}
              </div>
            )}
            {toolControlState.recentActions.length > 0 && (
              <div className="side-drawer-tags">
                {toolControlState.recentActions.slice(-4).reverse().map((action, index) => (
                  <span key={`${action.toolName}-${action.at}-${index}`} className="side-drawer-tag">
                    {action.toolName}: {action.status}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {approvalPreview && (
          <div className="side-drawer-card">
            <div className="side-drawer-card-title">Approval preview</div>
            <div className="side-drawer-meta-row">
              <span>Tool</span>
              <strong>{approvalPreview.toolName}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Preview</span>
              <strong>{approvalPreview.preview}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Boundary</span>
              <strong>{approvalPreview.boundaryLabel || '-'}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Retry policy</span>
              <strong>{approvalPreview.retryPolicy.maxAttempts} attempts / {approvalPreview.retryPolicy.backoffMs}ms backoff</strong>
            </div>
          </div>
        )}

        {externalTools.length > 0 && (
          <div className="side-drawer-card">
            <div className="side-drawer-card-title">External read-only tools</div>
            <div className="side-drawer-tags">
              {externalTools.map((entry) => (
                <span key={entry.manifest.name} className="side-drawer-tag" title={entry.description}>
                  {entry.manifest.name}: {entry.manifest.workspaceBoundaryLabel || 'Workspace-bound'}
                </span>
              ))}
            </div>
          </div>
        )}

        {(browserSessionState?.lastArtifactPath || latestTrace?.traceFilePath) && (
          <div className="side-drawer-card">
            <div className="side-drawer-card-title">Latest artifacts</div>
            {browserSessionState?.lastArtifactPath && (
              <button
                className="side-drawer-action side-drawer-action--block"
                onClick={() => vscode.postMessage({ type: 'openFile', path: browserSessionState.lastArtifactPath })}
              >
                Open browser artifact
              </button>
            )}
            {latestTrace?.traceFilePath && (
              <button className="side-drawer-action side-drawer-action--block" onClick={onOpenTrace}>
                Open latest trace
              </button>
            )}
          </div>
        )}

        {browserSessionState && (
          <div className="side-drawer-card">
            <div className="side-drawer-card-title">Browser session</div>
            <div className="side-drawer-meta-row">
              <span>Active</span>
              <strong>{browserSessionState.active ? 'yes' : 'no'}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Current URL</span>
              <strong>{browserSessionState.currentUrl || '-'}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Last action</span>
              <strong>{browserSessionState.lastAction || '-'}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Artifacts</span>
              <strong>{browserSessionState.artifactCount}</strong>
            </div>
            <div className="side-drawer-meta-row">
              <span>Console messages</span>
              <strong>{browserSessionState.consoleMessageCount ?? 0}</strong>
            </div>
            {browserSessionState.lastError && (
              <div className="side-drawer-notice side-drawer-notice--error">
                {browserSessionState.lastError}
              </div>
            )}
          </div>
        )}

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
