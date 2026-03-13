import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Archive,
  ArchiveRestore,
  Brain,
  Check,
  Clock,
  Code2,
  Download,
  MessageCircle,
  MessageSquare,
  Pencil,
  Pin,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { SessionInfo, AgentMode } from '../../types';
import { formatRelativeDate, type SessionGroup } from '../../hooks/useHistory';

interface ChatHistoryPanelProps {
  sessions: SessionInfo[];
  getGroups: (query?: string, options?: { includeArchived?: boolean }) => Array<{
    group: SessionGroup;
    sessions: SessionInfo[];
  }>;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onPinSession: (id: string, pinned: boolean) => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  onExportSession: (id: string) => void;
  onImportSessions: () => void;
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
  onPin: () => void;
  onArchive: () => void;
  onExport: () => void;
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
  onPin,
  onArchive,
  onExport,
}: SessionItemProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(session.title);
  const [showActions, setShowActions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    setRenameVal(session.title);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [renaming, session.title]);

  const commitRename = () => {
    const value = renameVal.trim();
    if (value && value !== session.title) onRename(value);
    setRenaming(false);
  };

  const cancelRename = () => {
    setRenameVal(session.title);
    setRenaming(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
    event.stopPropagation();
  };

  return (
    <div
      className={`history-item${isActive ? ' history-item--active' : ''}${session.archived ? ' history-item--archived' : ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {renaming ? (
        <div className="history-item-rename">
          <input
            ref={inputRef}
            className="history-item-rename-input"
            value={renameVal}
            onChange={(event) => setRenameVal(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitRename}
          />
          <div className="history-item-rename-actions">
            <button className="history-action-btn" onClick={commitRename} title="Confirm">
              <Check size={11} />
            </button>
            <button className="history-action-btn" onClick={cancelRename} title="Cancel">
              <X size={11} />
            </button>
          </div>
        </div>
      ) : (
        <button className="history-item-body" onClick={onSelect}>
          <div className="history-item-icon">
            <ModeIcon mode={session.mode} />
          </div>
          <div className="history-item-content">
            <div className="history-item-title-row">
              <span className="history-item-title">{session.title}</span>
              {session.pinned && <span className="history-item-badge">Pinned</span>}
              {session.archived && <span className="history-item-badge history-item-badge--muted">Archived</span>}
            </div>
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
            <div className="history-item-actions" onClick={(event) => event.stopPropagation()}>
              <button
                className={`history-action-btn${session.pinned ? ' history-action-btn--active' : ''}`}
                onClick={onPin}
                title={session.pinned ? 'Unpin' : 'Pin'}
              >
                <Pin size={11} />
              </button>
              <button className="history-action-btn" onClick={onExport} title="Export">
                <Download size={11} />
              </button>
              <button className="history-action-btn" onClick={() => setRenaming(true)} title="Rename">
                <Pencil size={11} />
              </button>
              <button className="history-action-btn" onClick={onArchive} title={session.archived ? 'Restore' : 'Archive'}>
                {session.archived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
              </button>
              <button className="history-action-btn history-action-btn--danger" onClick={onDelete} title="Delete">
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
  sessions,
  getGroups,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onPinSession,
  onArchiveSession,
  onExportSession,
  onImportSessions,
  onClose,
}: ChatHistoryPanelProps) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 80);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);

  const displayGroups = getGroups(query, {
    includeArchived: showArchived || query.trim().length > 0,
  });
  const totalCount = sessions.length;
  const archivedCount = sessions.filter((session) => session.archived).length;

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <span className="history-panel-title">Chat History</span>
        <span className="history-panel-count">{totalCount}</span>
        <button
          className={`history-panel-tool${showArchived ? ' history-panel-tool--active' : ''}`}
          onClick={() => setShowArchived((value) => !value)}
          title={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
        >
          {showArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
          {archivedCount > 0 && <span>{archivedCount}</span>}
        </button>
        <button className="history-panel-tool" onClick={onImportSessions} title="Import sessions">
          <Upload size={12} />
        </button>
        <button className="history-panel-close" onClick={onClose} title="Close">
          <X size={13} />
        </button>
      </div>

      <div className="history-search-wrap">
        <Search size={12} className="history-search-icon" />
        <input
          ref={searchRef}
          className="history-search-input"
          placeholder="Search conversations..."
          value={query}
          onChange={handleSearchChange}
        />
        {query && (
          <button className="history-search-clear" onClick={() => setQuery('')}>
            <X size={10} />
          </button>
        )}
      </div>

      <div className="history-list">
        {displayGroups.length === 0 ? (
          <div className="history-empty">
            {query ? 'No matching conversations' : 'No conversations yet'}
          </div>
        ) : (
          displayGroups.map(({ group, sessions: groupedSessions }) => (
            <div key={group} className="history-group">
              <div className="history-group-label">{group}</div>
              {groupedSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={() => {
                    onSelectSession(session.id);
                    onClose();
                  }}
                  onDelete={() => onDeleteSession(session.id)}
                  onRename={(title) => onRenameSession(session.id, title)}
                  onPin={() => onPinSession(session.id, !session.pinned)}
                  onArchive={() => onArchiveSession(session.id, !session.archived)}
                  onExport={() => onExportSession(session.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
