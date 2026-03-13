export type SidebarMode = 'threads' | 'workspace';
export type RightPaneTab = 'review' | 'changes' | 'trace';
export type ActivityTab = 'agent' | 'terminal';

export interface DesktopTabState {
  path: string;
  title: string;
  language: string;
  originalContent: string;
  currentContent: string;
  openedAt: number;
  updatedAt: number;
}

export interface DesktopThread {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopTimelineItemBase {
  id: string;
  createdAt: number;
  threadId: string;
}

export interface DesktopMessageTimelineItem extends DesktopTimelineItemBase {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface DesktopCommandTimelineItem extends DesktopTimelineItemBase {
  type: 'command';
  status: 'running' | 'success' | 'error';
  command: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  exitCode?: number | null;
  cwd?: string;
  shellLabel?: string;
}

export interface DesktopEventTimelineItem extends DesktopTimelineItemBase {
  type: 'event';
  title: string;
  detail: string;
  tone: 'info' | 'success' | 'warning';
}

export type DesktopTimelineItem =
  | DesktopMessageTimelineItem
  | DesktopCommandTimelineItem
  | DesktopEventTimelineItem;

export interface DesktopTraceEntry {
  id: string;
  channel: 'workspace' | 'runtime';
  title: string;
  detail: string;
  createdAt: number;
}

export interface ReviewFileSummary {
  path: string;
  title: string;
  added: number;
  removed: number;
  changed: number;
  dirty: boolean;
}
