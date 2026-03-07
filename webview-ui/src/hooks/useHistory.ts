/**
 * useHistory — Chat session history management
 * Sessions are persisted to localStorage for instant access.
 * VSCode backend is also notified for persistent globalState sync.
 */
import { useState, useCallback, useEffect } from 'react';
import { vscode } from '../vscode';
import type { SessionInfo, AgentMode } from '../types';

const STORAGE_KEY = 'codai_sessions_v1';
const MAX_SESSIONS = 100;

// ── Date grouping (Kilo-style) ────────────────────────────────────────────────
export type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Older';

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

// ── Local storage helpers ─────────────────────────────────────────────────────
function loadFromStorage(): SessionInfo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionInfo[];
  } catch {
    return [];
  }
}

function saveToStorage(sessions: SessionInfo[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch { /* quota exceeded — ignore */ }
}

// ── Generate title from first user message ────────────────────────────────────
export function generateSessionTitle(firstUserText: string): string {
  const clean = firstUserText.trim().replace(/\s+/g, ' ');
  if (clean.length <= 50) return clean;
  return clean.slice(0, 47) + '…';
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useHistory() {
  const [sessions, setSessions] = useState<SessionInfo[]>(() => loadFromStorage());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Persist to localStorage whenever sessions change
  useEffect(() => {
    saveToStorage(sessions);
  }, [sessions]);

  // ── Listen to backend session updates ─────────────────────────────────────
  useEffect(() => {
    const handle = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'sessionsList':
          // Backend sent full sessions list (on ready/sync)
          if (Array.isArray(msg.sessions)) {
            setSessions(msg.sessions as SessionInfo[]);
          }
          break;
        case 'sessionCreated':
        case 'sessionUpdated':
          if (msg.session) {
            setSessions(prev => {
              const exists = prev.findIndex(s => s.id === msg.session.id);
              if (exists >= 0) {
                const next = [...prev];
                next[exists] = msg.session;
                return next;
              }
              return [msg.session, ...prev];
            });
          }
          break;
        case 'sessionDeleted':
          if (msg.sessionId) {
            setSessions(prev => prev.filter(s => s.id !== msg.sessionId));
            if (activeSessionId === msg.sessionId) setActiveSessionId(null);
          }
          break;
        case 'sessionRenamed':
          if (msg.sessionId && msg.title) {
            setSessions(prev => prev.map(s =>
              s.id === msg.sessionId ? { ...s, title: msg.title, updatedAt: new Date().toISOString() } : s
            ));
          }
          break;
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [activeSessionId]);

  // ── Create new session ────────────────────────────────────────────────────
  const createSession = useCallback((opts: {
    title?: string;
    mode: AgentMode;
    model?: string;
    preview?: string;
  }): string => {
    const id = `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const session: SessionInfo = {
      id,
      title: opts.title || 'New Chat',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      mode: opts.mode,
      model: opts.model,
      preview: opts.preview,
    };
    setSessions(prev => [session, ...prev]);
    setActiveSessionId(id);
    vscode.postMessage({ type: 'sessionCreated', session });
    return id;
  }, []);

  // ── Update active session (call on every user message) ────────────────────
  const updateSession = useCallback((id: string, updates: Partial<SessionInfo>) => {
    setSessions(prev => prev.map(s =>
      s.id === id
        ? { ...s, ...updates, updatedAt: new Date().toISOString() }
        : s
    ));
    vscode.postMessage({ type: 'sessionUpdated', sessionId: id, updates });
  }, []);

  // ── Delete session ────────────────────────────────────────────────────────
  const deleteSession = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) setActiveSessionId(null);
    vscode.postMessage({ type: 'deleteSession', sessionId: id });
  }, [activeSessionId]);

  // ── Rename session ────────────────────────────────────────────────────────
  const renameSession = useCallback((id: string, title: string) => {
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, title, updatedAt: new Date().toISOString() } : s
    ));
    vscode.postMessage({ type: 'renameSession', sessionId: id, title });
  }, []);

  // ── Load session (restore conversation) ──────────────────────────────────
  const loadSession = useCallback((id: string) => {
    setActiveSessionId(id);
    // First clear current state, then load session history from backend
    vscode.postMessage({ type: 'clearHistory' });
    // Small delay so clearHistory processes before sessionLoaded arrives
    setTimeout(() => {
      vscode.postMessage({ type: 'loadSession', sessionId: id });
    }, 50);
  }, []);

  // ── Fetch sessions from backend ───────────────────────────────────────────
  const fetchSessions = useCallback(() => {
    vscode.postMessage({ type: 'getSessions' });
  }, []);

  // ── Get grouped sessions ──────────────────────────────────────────────────
  const getGroupedSessions = useCallback((query?: string): Array<{
    group: DateGroup;
    sessions: SessionInfo[];
  }> => {
    const filtered = query
      ? sessions.filter(s =>
          s.title.toLowerCase().includes(query.toLowerCase()) ||
          s.preview?.toLowerCase().includes(query.toLowerCase())
        )
      : sessions;

    const sorted = [...filtered].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const groups = new Map<DateGroup, SessionInfo[]>();
    const order: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];

    for (const s of sorted) {
      const g = getDateGroup(s.updatedAt);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(s);
    }

    return order.filter(g => groups.has(g)).map(g => ({
      group: g,
      sessions: groups.get(g)!,
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
    loadSession,
    fetchSessions,
    getGroupedSessions,
  };
}
