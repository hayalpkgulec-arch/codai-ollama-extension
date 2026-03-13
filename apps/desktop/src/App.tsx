import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { DesktopTreeNode, DesktopWorkspaceSnapshot } from './types';

type OpenTab = {
  path: string;
  title: string;
  content: string;
};

type TimelineCard = {
  title: string;
  detail: string;
  tone: 'info' | 'success' | 'warning';
};

const mockTimeline: TimelineCard[] = [
  {
    title: 'Task Runtime',
    detail: 'Shared core runtime will land here with live turn traces and tool events.',
    tone: 'info',
  },
  {
    title: 'Web Tools',
    detail: 'web_fetch, web_search, and browser actions will surface as first-class cards.',
    tone: 'success',
  },
  {
    title: 'Review Flow',
    detail: 'Diff and checkpoint restore stay visible instead of hiding behind modal flows.',
    tone: 'warning',
  },
];

function TreeNode({
  node,
  activePath,
  onOpenFile,
}: {
  node: DesktopTreeNode;
  activePath: string | null;
  onOpenFile: (path: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState(node.kind === 'directory');

  if (node.kind === 'file') {
    return (
      <button
        className={`tree-file${activePath === node.path ? ' active' : ''}`}
        onClick={() => onOpenFile(node.path, node.name)}
        type="button"
      >
        <span className="tree-bullet" />
        <span>{node.name}</span>
      </button>
    );
  }

  return (
    <div className="tree-branch">
      <button className="tree-directory" onClick={() => setExpanded((value) => !value)} type="button">
        <span className="tree-chevron">{expanded ? '▾' : '▸'}</span>
        <span>{node.name}</span>
      </button>
      {expanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} activePath={activePath} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [workspace, setWorkspace] = useState<DesktopWorkspaceSnapshot | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activeTabPath) ?? tabs[0] ?? null,
    [activeTabPath, tabs],
  );

  const openWorkspace = async () => {
    const nextWorkspace = await window.codaiDesktop.openWorkspace();
    if (!nextWorkspace) return;
    setWorkspace(nextWorkspace);
    setTabs([]);
    setActiveTabPath(null);
  };

  const openFile = async (filePath: string, title: string) => {
    const existing = tabs.find((tab) => tab.path === filePath);
    if (existing) {
      setActiveTabPath(existing.path);
      return;
    }

    const payload = await window.codaiDesktop.readFile(filePath);
    const nextTab = {
      path: payload.path,
      title,
      content: payload.content,
    };
    setTabs((currentTabs) => [...currentTabs, nextTab]);
    setActiveTabPath(payload.path);
  };

  return (
    <div className="desktop-shell">
      <header className="desktop-topbar">
        <div className="desktop-brand">
          <span className="desktop-dot" />
          <div>
            <p className="eyebrow">CodAI Desktop Alpha</p>
            <h1>AI-native coding workbench</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button">Trace Ready</button>
          <button className="primary-button" onClick={openWorkspace} type="button">Open workspace</button>
        </div>
      </header>

      <main className="desktop-grid">
        <aside className="workspace-sidebar panel">
          <div className="panel-header">
            <span className="eyebrow">Workspace</span>
            <strong>{workspace ? workspace.rootPath.split(/[\\/]/).pop() : 'No project selected'}</strong>
          </div>
          <div className="panel-body tree-body">
            {workspace ? workspace.nodes.map((node) => (
              <TreeNode key={node.path} node={node} activePath={activeTab?.path ?? null} onOpenFile={openFile} />
            )) : (
              <div className="empty-state">
                <p>Start with a single folder.</p>
                <span>File tree, tabs, agent shell, trace, and review flow live in the same window.</span>
              </div>
            )}
          </div>
        </aside>

        <section className="editor-stage">
          <div className="panel editor-panel">
            <div className="editor-tabs">
              {tabs.length === 0 ? (
                <div className="tab muted">No file open</div>
              ) : tabs.map((tab) => (
                <button
                  key={tab.path}
                  className={`tab${tab.path === activeTab?.path ? ' active' : ''}`}
                  onClick={() => setActiveTabPath(tab.path)}
                  type="button"
                >
                  {tab.title}
                </button>
              ))}
            </div>
            <div className="editor-surface">
              {activeTab ? (
                <Editor
                  height="100%"
                  defaultLanguage="typescript"
                  theme="vs-dark"
                  value={activeTab.content}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    smoothScrolling: true,
                    fontFamily: 'Cascadia Code, Consolas, monospace',
                  }}
                />
              ) : (
                <div className="editor-placeholder">
                  <p>Agent-first editor shell</p>
                  <span>Monaco sits in the center, while tools, review, and trace stay visible around it.</span>
                </div>
              )}
            </div>
          </div>

          <div className="bottom-row">
            <section className="panel terminal-panel">
              <div className="panel-header">
                <span className="eyebrow">Terminal</span>
                <strong>Shared shell envelope</strong>
              </div>
              <div className="terminal-output">
                <p>&gt; requested: npm run dev</p>
                <p>&gt; adapted: Set-Location -LiteralPath 'C:\repo'; npm run dev</p>
                <p>&gt; execution path: shell_integration</p>
              </div>
            </section>

            <section className="panel review-panel">
              <div className="panel-header">
                <span className="eyebrow">Review</span>
                <strong>Diff and checkpoint lane</strong>
              </div>
              <div className="review-card">
                <span className="review-badge">Next</span>
                <p>Changed files, diff summary, restore-all, and session-linked review checkpoints land here.</p>
              </div>
            </section>
          </div>
        </section>

        <aside className="agent-sidebar">
          <section className="panel agent-panel">
            <div className="panel-header">
              <span className="eyebrow">Agent Shell</span>
              <strong>Trace-forward chat</strong>
            </div>
            <div className="agent-input">
              <p>Ask CodAI to inspect the workspace, run tools, and keep the reasoning trace visible.</p>
              <div className="agent-composer">
                <span>Implement session restore flow with shell-safe command execution.</span>
                <button className="primary-button" type="button">Run task</button>
              </div>
            </div>
            <div className="timeline-stack">
              {mockTimeline.map((card) => (
                <article key={card.title} className={`timeline-card ${card.tone}`}>
                  <strong>{card.title}</strong>
                  <p>{card.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel history-panel">
            <div className="panel-header">
              <span className="eyebrow">Sessions</span>
              <strong>Local-first history</strong>
            </div>
            <div className="session-list">
              <div className="session-pill active">Current workspace runtime</div>
              <div className="session-pill">Pinned: provider retry investigation</div>
              <div className="session-pill">Archived: long-run browser task</div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
