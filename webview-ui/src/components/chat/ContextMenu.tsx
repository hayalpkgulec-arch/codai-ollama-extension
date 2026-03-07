/**
 * ContextMenu — @ mention popup
 * Triggered when user types @ in the input box.
 * Options: file, folder, url, problems, git-changes
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, Folder, Globe, AlertTriangle, GitBranch, X } from 'lucide-react';
import { vscode } from '../../vscode';

export type MentionType = 'file' | 'folder' | 'url' | 'problems' | 'git-changes';

export interface MentionOption {
  type: MentionType;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
}

interface ContextMenuProps {
  query: string;             // text after @
  onSelect: (insertion: string) => void;
  onClose: () => void;
  anchorBottom?: number;
}

const STATIC_OPTIONS: Array<Omit<MentionOption, 'action'>> = [
  { type: 'file',        label: 'File',         description: 'Pick a file from workspace',         icon: <FileText size={12} /> },
  { type: 'folder',      label: 'Folder',       description: 'Pick a folder from workspace',       icon: <Folder size={12} /> },
  { type: 'url',         label: 'URL',          description: 'Fetch content from a URL',           icon: <Globe size={12} /> },
  { type: 'problems',    label: 'Problems',     description: 'Include workspace diagnostics',      icon: <AlertTriangle size={12} /> },
  { type: 'git-changes', label: 'Git Changes',  description: 'Include current git diff',           icon: <GitBranch size={12} /> },
];

export function ContextMenu({ query, onSelect, onClose, anchorBottom }: ContextMenuProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? STATIC_OPTIONS.filter(o =>
        o.label.toLowerCase().startsWith(query.toLowerCase()) ||
        o.type.toLowerCase().startsWith(query.toLowerCase())
      )
    : STATIC_OPTIONS;

  useEffect(() => { setActiveIdx(0); }, [query]);

  const handleSelect = (opt: typeof STATIC_OPTIONS[number]) => {
    switch (opt.type) {
      case 'file':
        vscode.postMessage({ type: 'mentionPickFile' });
        onClose();
        break;
      case 'folder':
        vscode.postMessage({ type: 'mentionPickFolder' });
        onClose();
        break;
      case 'url':
        onSelect('@url:');
        break;
      case 'problems':
        vscode.postMessage({ type: 'mentionGetProblems' });
        onClose();
        break;
      case 'git-changes':
        vscode.postMessage({ type: 'mentionGetGitChanges' });
        onClose();
        break;
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown')  { e.preventDefault(); e.stopPropagation(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); e.stopPropagation(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (filtered[activeIdx]) handleSelect(filtered[activeIdx]);
      }
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [activeIdx, filtered, onClose]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="context-menu"
      style={anchorBottom !== undefined ? { bottom: anchorBottom } : undefined}
    >
      <div className="context-menu-header">
        <span className="context-menu-title">Mention</span>
        <button className="context-menu-close" onClick={onClose}><X size={10} /></button>
      </div>
      <div className="context-menu-list">
        {filtered.map((opt, i) => (
          <button
            key={opt.type}
            className={`context-menu-item${i === activeIdx ? ' context-menu-item--active' : ''}`}
            onClick={() => handleSelect(opt)}
            onMouseEnter={() => setActiveIdx(i)}
          >
            <span className="context-menu-item-icon">{opt.icon}</span>
            <span className="context-menu-item-body">
              <span className="context-menu-item-label">@{opt.label}</span>
              <span className="context-menu-item-desc">{opt.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
