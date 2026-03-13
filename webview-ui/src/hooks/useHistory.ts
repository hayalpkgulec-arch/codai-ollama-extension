import { useState, useCallback, useEffect } from 'react';
import { vscode } from '../vscode';
import type { SessionInfo, AgentMode } from '../types';

const STORAGE_KEY = 'codai_sessions_v1';
const MAX_SESSIONS = 100;

export type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Older';
export type SessionGroup = 'Pinned' | DateGroup | 'Archived';

export function getDateGroup(iso: string): DateGroup {
  const now = new Date();
  const date = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
  const monthAgo = new Date(today.getTime() - 30 * 86_400_000);

  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= weekAgo) return 'This Week';
  if (date >= monthAgo) return 'This Month';
  return 'Older';
}

export function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function normalizeSession(session: SessionInfo): SessionInfo {
  return {
    ...session,
    pinned: !!session.pinned,
    archived: !!session.archived,
    archivedAt: typeof session.archivedAt === 'string' ? session.archivedAt : null,
  };
}

function loadFromStorage(): SessionInfo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as SessionInfo[]).map(normalizeSession);
  } catch {
    return [];
  }
}

function saveToStorage(sessions: SessionInfo[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Ignore storage quota pressure.
  }
}

export function generateSessionTitle(firstUserText: string): string {
  let text = firstUserText.trim();
  text = text.replace(/^\[Context:[^\]]*\]\n```[\s\S]*?```\n*/g, '').trim();
  text = text.replace(/^(@\S+\s+)+/, '').trim();
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New Chat';
  if (clean.length <= 52) return clean;
  return `${clean.slice(0, 49)}...`;
}

export function useHistory() {
  const [sessions, setSessions] = useState<SessionInfo[]>(() => loadFromStorage());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    saveToStorage(sessions);
  }, [sessions]);

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'sessionsList':
          if (Array.isArray(msg.sessions)) {
            setSessions((msg.sessions as SessionInfo[]).map(normalizeSession));
          }
          break;
        case 'sessionCreated':
          if (msg.session) {
            setSessions((previous) => {
              const existingIndex = previous.findIndex((session) => session.id === msg.session.id);
              if (existingIndex >= 0) {
                const next = [...previous];
                next[existingIndex] = normalizeSession(msg.session);
                return next;
              }
              return [normalizeSession(msg.session), ...previous];
            });
          }
          break;
        case 'sessionUpdated':
          if (msg.session) {
            setSessions((previous) => previous.map((session) =>
              session.id === msg.session.id ? normalizeSession(msg.session) : session
            ));
          } else if (msg.sessionId && msg.updates) {
            setSessions((previous) => previous.map((session) =>
              session.id === msg.sessionId
                ? normalizeSession({ ...session, ...msg.updates, updatedAt: new Date().toISOString() })
                : session
            ));
          }
          break;
        case 'sessionDeleted':
          if (msg.sessionId) {
            setSessions((previous) => previous.filter((session) => session.id !== msg.sessionId));
            if (activeSessionId === msg.sessionId) setActiveSessionId(null);
          }
          break;
        case 'sessionRenamed':
          if (msg.sessionId && msg.title) {
            setSessions((previous) => previous.map((session) =>
              session.id === msg.sessionId
                ? normalizeSession({ ...session, title: msg.title, updatedAt: new Date().toISOString() })
                : session
            ));
          }
          break;
      }
    };

    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [activeSessionId]);

  const createSession = useCallback((opts: {
    title?: string;
    mode: AgentMode;
    model?: string;
    preview?: string;
  }): string => {
    const id = `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const session: SessionInfo = normalizeSession({
      id,
      title: opts.title || 'New Chat',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      mode: opts.mode,
      model: opts.model,
      preview: opts.preview,
      pinned: false,
      archived: false,
      archivedAt: null,
    });
    setSessions((previous) => [session, ...previous]);
    setActiveSessionId(id);
    vscode.postMessage({ type: 'sessionCreated', session });
    return id;
  }, []);

  const updateSession = useCallback((id: string, updates: Partial<SessionInfo>) => {
    setSessions((previous) => previous.map((session) =>
      session.id === id
        ? normalizeSession({ ...session, ...updates, updatedAt: new Date().toISOString() })
        : session
    ));
    vscode.postMessage({ type: 'sessionUpdated', sessionId: id, updates });
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions((previous) => previous.filter((session) => session.id !== id));
    if (activeSessionId === id) setActiveSessionId(null);
    vscode.postMessage({ type: 'deleteSession', sessionId: id });
  }, [activeSessionId]);

  const renameSession = useCallback((id: string, title: string) => {
    setSessions((previous) => previous.map((session) =>
      session.id === id
        ? normalizeSession({ ...session, title, updatedAt: new Date().toISOString() })
        : session
    ));
    vscode.postMessage({ type: 'renameSession', sessionId: id, title });
  }, []);

  const toggleSessionPinned = useCallback((id: string, pinned: boolean) => {
    setSessions((previous) => previous.map((session) =>
      session.id === id
        ? normalizeSession({ ...session, pinned, updatedAt: new Date().toISOString() })
        : session
    ));
    vscode.postMessage({ type: 'toggleSessionPinned', sessionId: id, pinned });
  }, []);

  const toggleSessionArchived = useCallback((id: string, archived: boolean) => {
    setSessions((previous) => previous.map((session) =>
      session.id === id
        ? normalizeSession({
            ...session,
            archived,
            archivedAt: archived ? new Date().toISOString() : null,
            updatedAt: new Date().toISOString(),
          })
        : session
    ));
    vscode.postMessage({ type: 'toggleSessionArchived', sessionId: id, archived });
  }, []);

  const exportSession = useCallback((id: string) => {
    vscode.postMessage({ type: 'exportSession', sessionId: id });
  }, []);

  const importSessions = useCallback(() => {
    vscode.postMessage({ type: 'importSessions' });
  }, []);

  const loadSession = useCallback((id: string) => {
    setActiveSessionId(id);
    vscode.postMessage({ type: 'clearHistory' });
    setTimeout(() => {
      vscode.postMessage({ type: 'loadSession', sessionId: id });
    }, 50);
  }, []);

  const fetchSessions = useCallback(() => {
    vscode.postMessage({ type: 'getSessions' });
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const getGroupedSessions = useCallback((query?: string, options?: {
    includeArchived?: boolean;
  }): Array<{ group: SessionGroup; sessions: SessionInfo[] }> => {
    const normalizedQuery = query?.trim().toLowerCase() || '';
    const includeArchived = options?.includeArchived || !!normalizedQuery;
    const filtered = sessions.filter((session) => {
      if (!includeArchived && session.archived) return false;
      if (!normalizedQuery) return true;
      return (
        session.title.toLowerCase().includes(normalizedQuery) ||
        session.preview?.toLowerCase().includes(normalizedQuery)
      );
    });

    const sorted = [...filtered].sort((left, right) => {
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

    const groups = new Map<SessionGroup, SessionInfo[]>();
    const order: SessionGroup[] = ['Pinned', 'Today', 'Yesterday', 'This Week', 'This Month', 'Older', 'Archived'];

    for (const session of sorted) {
      if (session.archived) {
        if (!groups.has('Archived')) groups.set('Archived', []);
        groups.get('Archived')!.push(session);
        continue;
      }
      if (session.pinned) {
        if (!groups.has('Pinned')) groups.set('Pinned', []);
        groups.get('Pinned')!.push(session);
        continue;
      }

      const group = getDateGroup(session.updatedAt);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(session);
    }

    return order
      .filter((group) => groups.has(group))
      .map((group) => ({
        group,
        sessions: groups.get(group)!,
      }));
  }, [sessions]);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSession,
    deleteSession,
    renameSession,
    toggleSessionPinned,
    toggleSessionArchived,
    exportSession,
    importSessions,
    loadSession,
    fetchSessions,
    getGroupedSessions,
  };
}
