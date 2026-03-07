import { FileText, Zap, RotateCcw, FolderOpen } from 'lucide-react';
import type { PlanSavedPayload } from '../../types';

interface PlanReadyCardProps {
  planSaved: PlanSavedPayload;
  elapsedSeconds?: number;
  taskResult?: string;
  onBuild: () => void;
  onViewPlan: () => void;
  onRevise: () => void;
}

export function PlanReadyCard({
  planSaved,
  elapsedSeconds,
  taskResult,
  onBuild,
  onViewPlan,
  onRevise,
}: PlanReadyCardProps) {
  return (
    <div className="plan-ready-card">
      {/* ── Top row: title + elapsed + revise ── */}
      <div className="plan-ready-top">
        <div className="plan-ready-title-row">
          <span className="plan-ready-badge">Plan ready</span>
          {elapsedSeconds !== undefined && (
            <span className="plan-ready-elapsed">{elapsedSeconds.toFixed(1)}s</span>
          )}
          <span className="plan-ready-title">{planSaved.title}</span>
        </div>
        <button className="plan-ready-revise" onClick={onRevise} title="Revise plan">
          <RotateCcw size={11} />
          <span>Revise</span>
        </button>
      </div>

      {/* ── Summary ── */}
      {taskResult && (
        <p className="plan-ready-summary">{taskResult}</p>
      )}

      {/* ── File path ── */}
      <div className="plan-ready-path">
        <FolderOpen size={11} className="plan-ready-path-icon" />
        <span className="plan-ready-path-text">.codai/plans/{planSaved.slug}/</span>
      </div>

      {/* ── Actions ── */}
      <div className="plan-ready-actions">
        <button className="plan-ready-view-btn" onClick={onViewPlan}>
          <FileText size={12} />
          <span>View Plan</span>
        </button>
        <button className="plan-ready-build-btn" onClick={onBuild}>
          <Zap size={12} />
          <span>Build</span>
        </button>
      </div>
    </div>
  );
}
