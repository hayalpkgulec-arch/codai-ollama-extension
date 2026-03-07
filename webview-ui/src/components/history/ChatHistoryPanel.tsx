/**
 * ChatHistoryPanel
 * Kilo-style session list with date grouping, search, rename & delete.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, MessageSquare, Trash2, Pencil, Check, X, Clock, Code2, Brain, MessageCircle } from 'lucide-react';
import type { SessionInfo, AgentMode } from '../../types';
import { formatRelativeDate, type DateGroup } from '../../hooks/useHistory';

interface ChatHistoryPanelProps {
  groups: Array<{ group: DateGroup; sessions: SessionInfo[] }>;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onClose: () => void;
}

function ModeIcon({ mode }: { mode: AgentMode }) {
  if (mode === 'plan') return <Brain size={11} />;
  if (mode === 'chat') return <MessageCircle size={11} />;
  return <Code2 size={11} />;
}

interface SessionItemProps {
  session: SessionInfo;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}

function SessionItem({ session, isActive, onSelect, onDelete, onRename }: SessionItemProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(session.title);
  const [showActions, setShowActions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setRenameVal(session.title);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [renaming, session.title]);

  const commitRename = () => {
    const val = renameVal.trim();
    if (val && val !== session.title) onRename(val);
    setRenaming(false);
  };

  const cancelRename = () => {
    setRenameVal(session.title);
    setRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    e.stopPropagation();
  };

  return (
    <div
      className={`history-item${isActive ? ' history-item--active' : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {renaming ? (
        <div className="history-item-rename">
          <input
            ref={inputRef}
            className="history-item-rename-input"
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitRename}
          />
          <div className="history-item-rename-actions">
            <button className="history-action-btn" onClick={commitRename} title="Confirm"><Check size={11} /></button>
            <button className="history-action-btn" onClick={cancelRename} title="Cancel"><X size={11} /></button>
          </div>
        </div>
      ) : (
        <button className="history-item-body" onClick={onSelect}>
          <div className="history-item-icon">
            <ModeIcon mode={session.mode} />
          </div>
          <div className="history-item-content">
            <span className="history-item-title">{session.title}</span>
            {session.preview && (
              <span className="history-item-preview">{session.preview}</span>
            )}
            <div className="history-item-meta">
              <span className="history-item-date">
                <Clock size={9} />
                {formatRelativeDate(session.updatedAt)}
              </span>
              {session.messageCount > 0 && (
                <span className="history-item-count">
                  <MessageSquare size={9} />
                  {session.messageCount}
                </span>
              )}
            </div>
          </div>
          {(showActions || isActive) && (
            <div
              className="history-item-actions"
              onClick={e => e.stopPropagation()}
            >
              <button
                className="history-action-btn"
                onClick={() => setRenaming(true)}
                title="Rename"
              >
                <Pencil size={11} />
              </button>
              <button
                className="history-action-btn history-action-btn--danger"
                onClick={onDelete}
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )}
        </button>
      )}
    </div>
  );
}

export function ChatHistoryPanel({
  groups,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onClose,
}: ChatHistoryPanelProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 80);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  // Filter sessions by query if set
  const displayGroups = query.trim()
    ? groups.map(g => ({
        ...g,
        sessions: g.sessions.filter(s =>
          s.title.toLowerCase().includes(query.toLowerCase()) ||
          s.preview?.toLowerCase().includes(query.toLowerCase())
        ),
      })).filter(g => g.sessions.length > 0)
    : groups;

  const totalCount = groups.reduce((acc, g) => acc + g.sessions.length, 0);

  return (
    <div className="history-panel">
      {/* Header */}
      <div className="history-panel-header">
        <span className="history-panel-title">Chat History</span>
        <span className="history-panel-count">{totalCount}</span>
        <button className="history-panel-close" onClick={onClose} title="Close">
          <X size={13} />
        </button>
      </div>

      {/* Search */}
      <div className="history-search-wrap">
        <Search size={12} className="history-search-icon" />
        <input
          ref={searchRef}
          className="history-search-input"
          placeholder="Search conversations…"
          value={query}
          onChange={handleSearchChange}
        />
        {query && (
          <button className="history-search-clear" onClick={() => setQuery('')}>
            <X size={10} />
          </button>
        )}
      </div>

      {/* Session list */}
      <div className="history-list">
        {displayGroups.length === 0 ? (
          <div className="history-empty">
            {query ? 'No matching conversations' : 'No conversations yet'}
          </div>
        ) : (
          displayGroups.map(({ group, sessions }) => (
            <div key={group} className="history-group">
              <div className="history-group-label">{group}</div>
              {sessions.map(session => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={() => { onSelectSession(session.id); onClose(); }}
                  onDelete={() => onDeleteSession(session.id)}
                  onRename={title => onRenameSession(session.id, title)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
