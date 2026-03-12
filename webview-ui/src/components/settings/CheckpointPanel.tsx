import { useEffect, useState } from 'react';
import { History, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react';
import { vscode } from '../../vscode';
import type { CheckpointEntry } from '../../types';

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

export function CheckpointPanel() {
  const [items, setItems] = useState<CheckpointEntry[]>([]);
  const [status, setStatus] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'checkpointsList' && Array.isArray(msg.checkpoints)) {
        setItems(msg.checkpoints);
      }
      if (msg.type === 'checkpointReverted') {
        setBusyId(null);
        setStatus(msg.message || (msg.success ? 'Checkpoint reverted.' : 'Failed to revert checkpoint.'));
        vscode.postMessage({ type: 'getCheckpoints' });
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'getCheckpoints' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const revert = (id: string) => {
    setBusyId(id);
    setStatus('');
    vscode.postMessage({ type: 'revertCheckpoint', checkpointId: id });
  };

  return (
    <div className="checkpoint-section">
      <div className="checkpoint-header">
        <span className="checkpoint-title">Checkpoints</span>
        <button className="checkpoint-refresh" onClick={() => vscode.postMessage({ type: 'getCheckpoints' })}>
          <History size={11} /> Refresh
        </button>
      </div>

      {status && (
        <div className="checkpoint-status">
          {status.toLowerCase().includes('reverted') ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
          <span>{status}</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="checkpoint-empty">No checkpoints yet.</div>
      ) : (
        <div className="checkpoint-list">
          {items.slice(0, 10).map((cp) => (
            <div key={cp.id} className="checkpoint-item">
              <div className="checkpoint-item-main">
                <span className="checkpoint-file" title={cp.filePath}>{cp.filePath}</span>
                <span className="checkpoint-meta">{fmtTime(cp.timestamp)} · {cp.toolName}</span>
              </div>
              <button
                className="checkpoint-revert-btn"
                disabled={busyId === cp.id}
                onClick={() => revert(cp.id)}
              >
                <RotateCcw size={10} /> {busyId === cp.id ? 'Reverting…' : 'Revert'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
