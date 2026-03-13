import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import type {
  DesktopRuntimeEvent,
  DesktopTerminalRunResult,
  DesktopTreeNode,
  DesktopWorkspaceEvent,
} from './types';
import { buildDiffPreview, buildReviewSummary } from './lib/diff';
import { useWorkbenchStore } from './store/WorkbenchStore';
import { useRuntimeStore } from './store/RuntimeStore';

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function TreeNode({
  node,
  activePath,
  onOpenFile,
}: {
  node: DesktopTreeNode;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(node.kind === 'directory');

  if (node.kind === 'file') {
    return (
      <button
        className={`tree-row tree-file${activePath === node.path ? ' active' : ''}`}
        onClick={() => onOpenFile(node.path)}
        type="button"
      >
        <span className="tree-dot" />
        <span>{node.name}</span>
      </button>
    );
  }

  return (
    <div className="tree-branch">
      <button className="tree-row tree-directory" onClick={() => setExpanded((value) => !value)} type="button">
        <span className="tree-chevron">{expanded ? 'v' : '>'}</span>
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
  const { state: workbench, actions: workbenchActions } = useWorkbenchStore();
  const { state: runtime, actions: runtimeActions } = useRuntimeStore();
  const [prompt, setPrompt] = useState('');
  const [commandInput, setCommandInput] = useState('');

  const activeTab = useMemo(
    () => workbench.tabs.find((tab) => tab.path === workbench.activeTabPath) ?? workbench.tabs[0] ?? null,
    [workbench.activeTabPath, workbench.tabs],
  );

  const filteredTimeline = useMemo(
    () => runtime.timeline.filter((item) => item.threadId === runtime.activeThreadId),
    [runtime.activeThreadId, runtime.timeline],
  );

  const reviewFiles = useMemo(() => buildReviewSummary(workbench.tabs), [workbench.tabs]);
  const diffPreview = useMemo(
    () => activeTab ? buildDiffPreview(activeTab.originalContent, activeTab.currentContent) : ['No active file'],
    [activeTab],
  );
  const activeThread = useMemo(
    () => runtime.threads.find((thread) => thread.id === runtime.activeThreadId) ?? runtime.threads[0],
    [runtime.activeThreadId, runtime.threads],
  );
  const workspaceLabel = workbench.workspace?.rootPath.split(/[\\/]/).pop() || 'No workspace';
  const branchLabel = workbench.workspace?.branch || 'local';
  const dirtyCount = reviewFiles.length;
  const lastRun: DesktopTerminalRunResult | null = runtime.terminalRuns[runtime.terminalRuns.length - 1] ?? null;

  useEffect(() => {
    const unsubscribeWorkspace = window.codaiDesktop.onWorkspaceEvent((event: DesktopWorkspaceEvent) => {
      runtimeActions.recordWorkspaceEvent(event);
    });
    const unsubscribeRuntime = window.codaiDesktop.onRuntimeEvent((event: DesktopRuntimeEvent) => {
      runtimeActions.recordRuntimeEvent(event);
      if (event.type === 'command-started' || event.type === 'command-finished') {
        workbenchActions.setActivityTab('terminal');
      }
      if (event.type === 'command-finished') {
        workbenchActions.setRightPaneTab('trace');
      }
    });

    return () => {
      unsubscribeWorkspace();
      unsubscribeRuntime();
    };
  }, [runtimeActions, workbenchActions]);

  const openWorkspace = async () => {
    const snapshot = await window.codaiDesktop.openWorkspace();
    if (!snapshot) {
      return;
    }
    workbenchActions.hydrateWorkspace(snapshot);
    workbenchActions.setSidebarMode('workspace');
  };

  const openFile = async (filePath: string) => {
    const payload = await window.codaiDesktop.readFile(filePath);
    workbenchActions.openTab(payload);
  };

  const saveActiveTab = async () => {
    if (!activeTab || activeTab.originalContent === activeTab.currentContent) {
      return;
    }
    await window.codaiDesktop.writeFile(activeTab.path, activeTab.currentContent);
    workbenchActions.markTabSaved(activeTab.path, activeTab.currentContent);
    workbenchActions.setRightPaneTab('review');
  };

  const sendPrompt = () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    const contextSummary = [
      `workspace ${workspaceLabel}`,
      activeTab ? `active file ${activeTab.title}` : 'no active file',
      dirtyCount > 0 ? `${dirtyCount} changed file(s)` : 'no pending changes',
      lastRun ? `last command ${lastRun.exitCode === 0 ? 'passed' : 'failed'}` : 'no command history yet',
    ].join(', ');

    runtimeActions.sendPrompt(trimmedPrompt, contextSummary);
    workbenchActions.setActivityTab('agent');
    setPrompt('');
  };

  const runCommand = async () => {
    const trimmedCommand = commandInput.trim();
    if (!trimmedCommand) {
      return;
    }
    workbenchActions.setActivityTab('terminal');
    await window.codaiDesktop.runCommand(trimmedCommand, workbench.workspace?.rootPath || activeTab?.path);
    setCommandInput('');
  };

  const createThread = () => {
    runtimeActions.createThread();
    workbenchActions.setSidebarMode('threads');
    workbenchActions.setActivityTab('agent');
  };

  return (
    <div className="ide-shell">
      <header className="ide-topbar">
        <div className="topbar-left">
          <span className="brand-mark">C</span>
          <div className="topbar-stack">
            <strong>CodAI Desktop</strong>
            <span>{workspaceLabel}</span>
          </div>
          <span className="topbar-pill">{branchLabel}</span>
          <span className="topbar-pill subtle">{dirtyCount > 0 ? `${dirtyCount} changes` : 'Clean'}</span>
        </div>
        <div className="topbar-right">
          <button className="topbar-button" onClick={openWorkspace} type="button">Open</button>
          <button className="topbar-button" onClick={saveActiveTab} type="button">Save</button>
          <button className="topbar-button primary" onClick={createThread} type="button">New Thread</button>
        </div>
      </header>

      <main className="ide-workbench">
        <nav className="global-rail">
          <button
            className={`rail-button${workbench.sidebarMode === 'threads' ? ' active' : ''}`}
            onClick={() => workbenchActions.setSidebarMode('threads')}
            type="button"
          >
            <span>T</span>
            <small>Threads</small>
          </button>
          <button
            className={`rail-button${workbench.sidebarMode === 'workspace' ? ' active' : ''}`}
            onClick={() => workbenchActions.setSidebarMode('workspace')}
            type="button"
          >
            <span>W</span>
            <small>Workspace</small>
          </button>
          <button
            className={`rail-button${workbench.rightPaneTab === 'review' ? ' active' : ''}`}
            onClick={() => workbenchActions.setRightPaneTab('review')}
            type="button"
          >
            <span>R</span>
            <small>Review</small>
          </button>
          <button
            className={`rail-button${workbench.rightPaneTab === 'trace' ? ' active' : ''}`}
            onClick={() => workbenchActions.setRightPaneTab('trace')}
            type="button"
          >
            <span>X</span>
            <small>Trace</small>
          </button>
        </nav>

        <aside className="sidebar-pane">
          <div className="pane-header">
            <div>
              <p className="pane-kicker">{workbench.sidebarMode === 'threads' ? 'Threads' : 'Workspace'}</p>
              <strong>{workbench.sidebarMode === 'threads' ? activeThread.title : workspaceLabel}</strong>
            </div>
            {workbench.sidebarMode === 'threads' && (
              <button className="inline-button" onClick={createThread} type="button">+</button>
            )}
          </div>
          <div className="pane-body sidebar-body">
            {workbench.sidebarMode === 'threads' ? (
              <div className="thread-list">
                {runtime.threads.map((thread) => (
                  <button
                    key={thread.id}
                    className={`thread-item${thread.id === runtime.activeThreadId ? ' active' : ''}`}
                    onClick={() => runtimeActions.setActiveThread(thread.id)}
                    type="button"
                  >
                    <strong>{thread.title}</strong>
                    <span>{thread.preview}</span>
                  </button>
                ))}
              </div>
            ) : workbench.workspace ? (
              <div className="tree-scroll">
                {workbench.workspace.nodes.map((node) => (
                  <TreeNode key={node.path} node={node} activePath={activeTab?.path ?? null} onOpenFile={openFile} />
                ))}
              </div>
            ) : (
              <div className="empty-panel">
                <p>No workspace loaded.</p>
                <span>Open a folder to unlock file tree, editor, review, and terminal flows.</span>
              </div>
            )}
          </div>
        </aside>

        <section className="center-stage">
          <section className="editor-pane">
            <div className="tab-strip">
              {workbench.tabs.length === 0 ? (
                <div className="tab-chip muted">No file open</div>
              ) : workbench.tabs.map((tab) => (
                <button
                  key={tab.path}
                  className={`tab-chip${tab.path === activeTab?.path ? ' active' : ''}${tab.originalContent !== tab.currentContent ? ' dirty' : ''}`}
                  onClick={() => workbenchActions.setActiveTab(tab.path)}
                  type="button"
                >
                  {tab.title}
                </button>
              ))}
            </div>
            <div className="editor-frame">
              {activeTab ? (
                <Editor
                  height="100%"
                  language={activeTab.language}
                  theme="vs-dark"
                  value={activeTab.currentContent}
                  onChange={(value) => workbenchActions.updateTabContent(activeTab.path, value ?? '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    smoothScrolling: true,
                    scrollBeyondLastLine: false,
                    fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
                  }}
                />
              ) : (
                <div className="empty-editor">
                  <p>Open a file to start editing.</p>
                  <span>The center stage is now editor-first, with chat and terminal docked below it.</span>
                </div>
              )}
            </div>
          </section>

          <section className="activity-pane">
            <div className="activity-header">
              <div className="activity-tabs">
                <button
                  className={`activity-tab${workbench.activityTab === 'agent' ? ' active' : ''}`}
                  onClick={() => workbenchActions.setActivityTab('agent')}
                  type="button"
                >
                  Agent
                </button>
                <button
                  className={`activity-tab${workbench.activityTab === 'terminal' ? ' active' : ''}`}
                  onClick={() => workbenchActions.setActivityTab('terminal')}
                  type="button"
                >
                  Terminal
                </button>
              </div>
              <span className="activity-meta">{activeThread.title}</span>
            </div>

            <div className="activity-body">
              {workbench.activityTab === 'agent' ? (
                <div className="timeline-list">
                  {filteredTimeline.map((item) => {
                    if (item.type === 'message') {
                      return (
                        <article key={item.id} className={`timeline-message ${item.role}`}>
                          <header>
                            <strong>{item.role === 'user' ? 'You' : item.role === 'assistant' ? 'CodAI' : 'System'}</strong>
                            <span>{formatTime(item.createdAt)}</span>
                          </header>
                          <p>{item.text}</p>
                        </article>
                      );
                    }

                    if (item.type === 'command') {
                      return (
                        <article key={item.id} className={`timeline-command ${item.status}`}>
                          <header>
                            <strong>{item.command}</strong>
                            <span>{item.shellLabel || 'terminal'}</span>
                          </header>
                          <p>{item.status === 'running' ? 'Running...' : `Exit ${item.exitCode ?? '-'} in ${item.durationMs ?? 0}ms`}</p>
                          {item.stdout ? <pre>{item.stdout.slice(0, 400)}</pre> : null}
                          {item.stderr ? <pre className="stderr">{item.stderr.slice(0, 240)}</pre> : null}
                        </article>
                      );
                    }

                    return (
                      <article key={item.id} className={`timeline-event ${item.tone}`}>
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="terminal-history">
                  {runtime.terminalRuns.length === 0 ? (
                    <div className="empty-panel compact">
                      <p>No command history yet.</p>
                      <span>Run a command below and the structured result will land here and in trace.</span>
                    </div>
                  ) : runtime.terminalRuns.slice().reverse().map((run) => (
                    <article key={run.id} className={`terminal-run${run.exitCode === 0 ? ' success' : ' error'}`}>
                      <header>
                        <strong>{run.command}</strong>
                        <span>{run.shell.shellKind} • {run.durationMs}ms</span>
                      </header>
                      <p>{run.cwd}</p>
                      {run.stdout ? <pre>{run.stdout.slice(0, 500)}</pre> : null}
                      {run.stderr ? <pre className="stderr">{run.stderr.slice(0, 260)}</pre> : null}
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="composer-shell">
              {workbench.activityTab === 'agent' ? (
                <>
                  <textarea
                    className="composer-input"
                    placeholder="Ask CodAI to inspect the current workspace, review changes, or plan the next edit."
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                  />
                  <div className="composer-footer">
                    <span>{activeTab ? `Context: ${activeTab.title}` : 'No active file context'}</span>
                    <button className="composer-submit" onClick={sendPrompt} type="button">Send</button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    className="command-input"
                    placeholder="Run a workspace command"
                    value={commandInput}
                    onChange={(event) => setCommandInput(event.target.value)}
                  />
                  <div className="composer-footer">
                    <span>{workbench.workspace?.rootPath || 'Workspace root required'}</span>
                    <button className="composer-submit" onClick={runCommand} type="button">Run</button>
                  </div>
                </>
              )}
            </div>
          </section>
        </section>

        <aside className="inspector-pane">
          <div className="inspector-tabs">
            {(['review', 'changes', 'trace'] as const).map((tab) => (
              <button
                key={tab}
                className={`inspector-tab${workbench.rightPaneTab === tab ? ' active' : ''}`}
                onClick={() => workbenchActions.setRightPaneTab(tab)}
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="inspector-body">
            {workbench.rightPaneTab === 'review' ? (
              reviewFiles.length > 0 ? (
                <div className="review-list">
                  {reviewFiles.map((file) => (
                    <article key={file.path} className="review-item">
                      <header>
                        <strong>{file.title}</strong>
                        <span>{file.added + file.changed + file.removed} lines</span>
                      </header>
                      <p>{file.path}</p>
                      <div className="review-stats">
                        <span className="positive">+{file.added}</span>
                        <span className="warning">~{file.changed}</span>
                        <span className="negative">-{file.removed}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-panel compact">
                  <p>No review items.</p>
                  <span>Edit and save files to populate the review lane.</span>
                </div>
              )
            ) : workbench.rightPaneTab === 'changes' ? (
              <div className="diff-preview">
                <div className="diff-header">
                  <strong>{activeTab?.title || 'No file selected'}</strong>
                  <span>{activeTab && activeTab.originalContent !== activeTab.currentContent ? 'Unsaved changes' : 'No pending diff'}</span>
                </div>
                <pre>{diffPreview.join('\n')}</pre>
              </div>
            ) : (
              <div className="trace-list">
                {runtime.trace.length === 0 ? (
                  <div className="empty-panel compact">
                    <p>No trace events yet.</p>
                    <span>Open files or run commands to inspect runtime and workspace traffic.</span>
                  </div>
                ) : runtime.trace.slice().reverse().map((entry) => (
                  <article key={entry.id} className="trace-item">
                    <header>
                      <strong>{entry.title}</strong>
                      <span>{entry.channel}</span>
                    </header>
                    <p>{entry.detail || 'No extra detail'}</p>
                    <small>{formatTime(entry.createdAt)}</small>
                  </article>
                ))}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
