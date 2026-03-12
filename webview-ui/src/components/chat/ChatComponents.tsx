import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import type { ToolCall, ToolStatus, ChatMessage, ThinkingSegment, ContentSegment, CheckpointEntry } from '../../types';
import type { ProposalDecisions } from '../../App';
import { vscode } from '../../vscode';
import {
  ChevronDown, Check, Loader2, Terminal,
  FileEdit, FileSearch, AlertCircle, CheckCheck,
  XCircle, ChevronsUpDown, Copy, Folder, Trash2,
  Move, Search, Stethoscope, Globe, Code2,
  FolderPlus, Info, Replace, RefreshCw, Files, FolderTree, Layers,
  ExternalLink, GitCompare, Send, Quote, RotateCcw,
} from 'lucide-react';

// ─── CollapsibleBody ────────────────────────────────────────────────────────
export const CollapsibleBody = memo(({ open, children }: { open: boolean; children: React.ReactNode }) => (
  <div className={`collapsible-body${open ? ' open' : ''}`}>
    <div className="collapsible-inner">{children}</div>
  </div>
));
CollapsibleBody.displayName = 'CollapsibleBody';

// ─── TypewriterText ─────────────────────────────────────────────────────────
export const TypewriterText = memo(({ text, speed = 20 }: { text: string; speed?: number }) => {
  const [len, setLen] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setLen(0);
    setDone(false);
    if (!text) return;
    // BUG 5 FIX: text ve speed dep array'de doğru tanımlanmış
    const iv = setInterval(() => {
      setLen(p => {
        if (p >= text.length) { clearInterval(iv); setDone(true); return p; }
        return p + 1;
      });
    }, speed);
    return () => clearInterval(iv);
  }, [text, speed]);

  if (done) return <span className="tw-shimmer">{text}</span>;
  return <span>{text.slice(0, len)}</span>;
});
TypewriterText.displayName = 'TypewriterText';

// ─── ThinkingBlock ──────────────────────────────────────────────────────────
export const ThinkingBlock = memo(({ seg }: { seg: ThinkingSegment }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [canTop, setCanTop] = useState(false);
  const [canBottom, setCanBottom] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const checkScroll = useCallback(() => {
    if (!bodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = bodyRef.current;
    setCanTop(scrollTop > 1);
    setCanBottom(scrollTop + clientHeight < scrollHeight - 1);
  }, []);

  useEffect(() => { if (seg.done) setCollapsed(true); }, [seg.done]);

  useEffect(() => {
    if (!collapsed && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      checkScroll();
    }
  }, [seg.text, collapsed, checkScroll]);

  const label = !seg.done
    ? 'Thinking…'
    : seg.finalMs == null ? 'Thought'
      : seg.finalMs < 1000 ? `Thought for ${seg.finalMs}ms`
        : `Thought for ${(seg.finalMs / 1000).toFixed(1)}s`;

  return (
    <div className={`thinking-block ${seg.done ? 'done' : 'live'}`}>
      <button className="thinking-header" onClick={() => setCollapsed(c => !c)}>
        <span className={`thinking-indicator${seg.done ? '' : ' pulse'}`} />
        <span className={`thinking-label${!seg.done ? ' thinking-live-label' : ''}`}>{label}</span>
        <ChevronDown size={13} className={`thinking-chevron${collapsed ? '' : ' open'}`} />
      </button>
      <CollapsibleBody open={!collapsed}>
        <div className="thinking-scroll-wrap">
          <div className="thinking-body" ref={bodyRef} onScroll={checkScroll}>{seg.text}</div>
          {canTop && <div className="thinking-fade-top" />}
          {canBottom && <div className="thinking-fade-bottom" />}
        </div>
      </CollapsibleBody>
    </div>
  );
});
ThinkingBlock.displayName = 'ThinkingBlock';

// ─── ExpandHandle ────────────────────────────────────────────────────────────
export const ExpandHandle = memo(({ expanded, lineCount, onToggle }: {
  expanded: boolean; lineCount: number; onToggle: () => void;
}) => (
  <button className="expand-handle" onClick={onToggle}>
    <ChevronsUpDown size={10} />
    {expanded ? 'Show less' : `Show all ${lineCount} lines`}
  </button>
));
ExpandHandle.displayName = 'ExpandHandle';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function basename(p: string) { return p.split(/[\\\/]/).filter(Boolean).pop() || p; }

export function fmtDur(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function useCheckpointReverter(checkpoints: CheckpointEntry[]) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type !== 'checkpointReverted') return;
      if (typeof msg.checkpointId !== 'string') return;
      if (!checkpoints.some((checkpoint) => checkpoint.id === msg.checkpointId)) return;
      setBusyId(null);
      setStatus(msg.message || (msg.success ? 'Restore complete.' : 'Restore failed.'));
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [checkpoints]);

  const revert = useCallback((checkpointId: string) => {
    setBusyId(checkpointId);
    setStatus('');
    vscode.postMessage({ type: 'revertCheckpoint', checkpointId });
  }, []);

  return { busyId, status, revert };
}

// ─── StatusDot ───────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: ToolStatus }) {
  if (status === 'running') return <Loader2 size={11} className="spin-icon status-running" />;
  if (status === 'done') return <Check size={11} className="status-done" />;
  return <XCircle size={11} className="status-error" />;
}

// ─── SimplePill ──────────────────────────────────────────────────────────────
const SimplePill = memo(({ tool, icon, label, meta }: {
  tool: ToolCall; icon: React.ReactNode; label: string; meta?: string;
}) => {
  const dur = tool.startedAt && tool.finishedAt ? tool.finishedAt - tool.startedAt : null;
  return (
    <div className={`pill ${tool.status}`}>
      <StatusDot status={tool.status} />
      <span className="pill-icon">{icon}</span>
      <span className="pill-label">
        {tool.status === 'running' ? <TypewriterText text={label} speed={16} /> : label}
      </span>
      {meta && <span className="pill-meta">{meta}</span>}
      {dur != null && <span className="pill-dur">{fmtDur(dur)}</span>}
    </div>
  );
});
SimplePill.displayName = 'SimplePill';

// ─── Live Code Preview ───────────────────────────────────────────────────────
const LiveCodePreview = memo(({ content, lang }: { content: string; lang?: string }) => {
  const allLines = content.split('\n');
  const [visibleCount, setVisibleCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const LINES_PER_TICK = 4;
  const TICK_MS = 18;

  // BUG 5 FIX: allLines.length dependency array'e eklendi, eslint-disable kaldırıldı
  useEffect(() => {
    if (!content) return;
    setVisibleCount(0);
    let count = 0;
    const totalLines = content.split('\n').length;
    const iv = setInterval(() => {
      count += LINES_PER_TICK;
      setVisibleCount(count);
      if (count >= totalLines) clearInterval(iv);
      if (containerRef.current)
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [content]);

  const shown = allLines.slice(0, Math.min(visibleCount, allLines.length));
  const isAnimating = visibleCount < allLines.length;

  return (
    <div className="live-preview" ref={containerRef}>
      <div className="live-preview-header">
        <span className="live-preview-lang">{lang || 'code'}</span>
        {isAnimating && (
          <span className="live-preview-status">
            <span className="live-dot" />
            Writing…
          </span>
        )}
      </div>
      <div className="live-preview-body">
        {shown.map((line, i) => (
          <div key={i} className="live-line">
            <span className="live-ln">{i + 1}</span>
            <span className="live-gutter">+</span>
            <span className="live-code">{line || ' '}</span>
          </div>
        ))}
        {isAnimating && <div className="live-cursor" />}
      </div>
    </div>
  );
});
LiveCodePreview.displayName = 'LiveCodePreview';

// ─── RunCommandCard ──────────────────────────────────────────────────────────
const RunCommandCard = memo(({ tool }: { tool: ToolCall }) => {
  const dur = tool.startedAt && tool.finishedAt ? tool.finishedAt - tool.startedAt : null;
  let parsed: any = null;
  try { if (tool.result?.trim().startsWith('{')) parsed = JSON.parse(tool.result); } catch { /* */ }

  const stdout: string = parsed?.stdout?.trimEnd() || '';
  const stderr: string = parsed?.stderr?.trimEnd() || '';
  const stdoutLines = stdout ? stdout.split('\n') : [];
  const stderrLines = stderr ? stderr.split('\n') : [];
  const lineCount = stdoutLines.length + stderrLines.length;

  const PREVIEW_LINES = 8;
  const [expanded, setExpanded] = useState(false);
  // Interactive input state
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const cmdLabel = (parsed?.command || tool.summary || '').replace(/^(Run:|run:)\s*/i, '');
  const exitCode: number | null = parsed?.exitCode ?? null;
  const exitOk = exitCode === null || exitCode === 0;
  const isBackground = Boolean(parsed?.background);
  const isInterrupted = parsed?.status === 'interrupted';
  const isTruncated = Boolean(parsed?.truncated);
  const bgId: string | undefined = parsed?.bgId;

  const handleStop = useCallback(() => {
    vscode.postMessage({ type: 'killBgProcess', bgId });
  }, [bgId]);

  // Send text input to the running terminal
  const handleSendInput = useCallback(() => {
    const text = inputVal.trim();
    if (!text) return;
    vscode.postMessage({ type: 'sendTerminalInput', text });
    setInputVal('');
  }, [inputVal]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSendInput(); }
    // Ctrl+C shortcut in input field
    if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); vscode.postMessage({ type: 'killBgProcess', bgId }); }
  }, [handleSendInput, bgId]);

  useEffect(() => {
    if (outputRef.current && !expanded) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [stdout, stderr, expanded]);

  const hasOutput = (stdout || stderr) && tool.status !== 'running';
  const showExpander = hasOutput && lineCount > PREVIEW_LINES;
  const isRunning = tool.status === 'running';
  // Show interactive input bar when background process is alive
  const showInput = isBackground && bgId && !isInterrupted;

  return (
    <div className={`term-card ${tool.status}${isBackground ? ' bg-mode' : ''}${isInterrupted ? ' interrupted' : ''}`}>
      {/* ── Header ── */}
      <div className="term-header">
        <div className="term-header-left">
          <StatusDot status={isInterrupted ? 'error' : tool.status} />
          <span className="term-icon"><Terminal size={11} /></span>
          <span className="term-cmd">
            {isRunning ? <TypewriterText text={cmdLabel} speed={16} /> : cmdLabel}
          </span>
        </div>
        <div className="term-header-right">
          {/* Interrupted badge */}
          {isInterrupted && <span className="term-badge interrupted">interrupted</span>}
          {/* Exit code — only for completed non-background */}
          {exitCode !== null && !isInterrupted && !isBackground && (
            <span className={`term-badge exit ${exitOk ? 'ok' : 'fail'}`}>exit {exitCode}</span>
          )}
          {dur != null && <span className="term-dur">{fmtDur(dur)}</span>}
          {/* Stop button — only in header, no banner */}
          {(isRunning || (isBackground && bgId && !isInterrupted)) && (
            <button className="term-stop-btn" onClick={handleStop} title="Ctrl+C">
              <XCircle size={10} /> Stop
            </button>
          )}
        </div>
      </div>

      {/* ── Output body ── */}
      {hasOutput && (
        <div className="term-body">
          <div ref={outputRef} className={`term-output ${expanded ? 'expanded' : showExpander ? 'collapsed' : 'auto'}`}>
            <div className="term-line prompt">
              <span className="term-gutter">$</span>
              <span className="term-text">{cmdLabel}</span>
            </div>
            {stdoutLines.map((line, i) => (
              <div key={`o${i}`} className="term-line stdout">
                <span className="term-gutter" />
                <span className="term-text">{line || '\u00a0'}</span>
              </div>
            ))}
            {stderrLines.map((line, i) => (
              <div key={`e${i}`} className="term-line stderr">
                <span className="term-gutter">!</span>
                <span className="term-text">{line || '\u00a0'}</span>
              </div>
            ))}
            {isTruncated && (
              <div className="term-line truncated">
                <span className="term-gutter" /><span className="term-text">… output truncated</span>
              </div>
            )}
          </div>
          {showExpander && (
            <button className="term-expand-btn" onClick={() => setExpanded(e => !e)}>
              <ChevronsUpDown size={10} />
              {expanded ? 'Show less' : `Show all ${lineCount} lines`}
            </button>
          )}
        </div>
      )}

      {/* ── Interactive input bar — send text to running terminal ── */}
      {showInput && (
        <div className="term-input-bar">
          <span className="term-input-prompt">›</span>
          <input
            ref={inputRef}
            className="term-input-field"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Send input to terminal… (Enter to send, Ctrl+C to stop)"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            className="term-input-send"
            onClick={handleSendInput}
            disabled={!inputVal.trim()}
            title="Send (Enter)"
          >
            <Send size={10} />
          </button>
        </div>
      )}
    </div>
  );
});
RunCommandCard.displayName = 'RunCommandCard';

// ─── WriteFileCard — collapsible diff, no per-card accept/reject ────────────
interface WriteFileCardProps {
  tool: ToolCall;
  decision?: 'accepted' | 'rejected';
  onDecide: (phaseId: string, decision: 'accepted' | 'rejected', proposalId: string) => void;
}

const WriteFileCard = memo(({ tool, decision }: WriteFileCardProps) => {
  const dur = tool.startedAt && tool.finishedAt ? tool.finishedAt - tool.startedAt : null;
  let parsed: any = null;
  try { if (tool.result?.trim().startsWith('{')) parsed = JSON.parse(tool.result); } catch { /* */ }
  const isEdit = parsed?.mode === 'editing';
  const checkpoints: CheckpointEntry[] = Array.isArray(parsed?.checkpoints) ? parsed.checkpoints : [];
  const restorePoint = checkpoints[0];

  const rawFilename = parsed?.fileName
    || basename(tool.summary.replace(/^(creating|editing|created|edited|write|writing)\s*/i, '').trim())
    || (tool.args?.path ? basename(tool.args.path as string) : tool.summary);
  const filePath: string = parsed?.path || (tool.args?.path as string) || '';

  const ext = rawFilename.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    css: 'css', html: 'html', json: 'json', md: 'markdown',
    sh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  };
  const lang = langMap[ext] || ext;
  const liveContent: string | null = tool.status === 'running' && tool.args?.content
    ? (tool.args.content as string) : null;

  const isDecided = !!decision;
  const hasHunks = parsed?.hunks?.length > 0;
  const hasPreview = !!parsed?.preview;
  const hasDiff = hasHunks || hasPreview;
  const diffLineCount = parsed?.hunks?.length || 0;

  const [diffOpen, setDiffOpen] = useState(true);
  const { busyId, status, revert } = useCheckpointReverter(checkpoints);

  const openInEditor = useCallback(() => {
    if (filePath) vscode.postMessage({ type: 'openFile', path: filePath });
  }, [filePath]);

  const openDiff = useCallback(() => {
    if (filePath) vscode.postMessage({ type: 'showDiff', path: filePath });
  }, [filePath]);

  return (
    <div className={`card card-file ${tool.status}${decision ? ` change-${decision}` : ''}`}>
      <div className="card-header">
        <StatusDot status={tool.status} />
        <FileEdit size={11} className="card-icon-type" />
        <span
          className={`card-label${filePath && tool.status !== 'running' ? ' card-label-clickable' : ''}`}
          onClick={filePath && tool.status !== 'running' ? openInEditor : undefined}
          title={filePath && tool.status !== 'running' ? `Open ${filePath} in editor` : undefined}
        >
          <span className="card-verb">{isEdit ? 'Edited' : 'Created'}</span>&nbsp;
          <span className="card-filename">
            {tool.status === 'running'
              ? <TypewriterText text={rawFilename} speed={20} />
              : rawFilename}
          </span>
          {parsed?.addedCount != null && (
            <span className="diff-inline">
              &nbsp;<span className="diff-add">+{parsed.addedCount}</span>
              <span className="diff-sep"> · </span>
              <span className="diff-rem">−{parsed.removedCount}</span>
            </span>
          )}
        </span>
        {decision === 'accepted' && <span className="change-badge accepted"><CheckCheck size={10} /> Accepted</span>}
        {decision === 'rejected' && <span className="change-badge rejected"><XCircle size={10} /> Rejected</span>}
        {dur != null && <span className="card-dur">{fmtDur(dur)}</span>}
        {/* Open in VSCode diff view */}
        {filePath && tool.status !== 'running' && isEdit && (
          <button className="card-action-btn" onClick={openDiff} title="Open diff in VSCode">
            <GitCompare size={10} />
          </button>
        )}
        {/* Open in editor */}
        {filePath && tool.status !== 'running' && (
          <button className="card-action-btn" onClick={openInEditor} title="Open in editor">
            <ExternalLink size={10} />
          </button>
        )}
        {restorePoint && tool.status !== 'running' && (
          <button
            className="card-action-btn card-action-btn-restore"
            onClick={() => revert(restorePoint.id)}
            disabled={busyId === restorePoint.id}
            title={`Restore ${filePath || rawFilename} from checkpoint`}
          >
            <RotateCcw size={10} />
            {busyId === restorePoint.id ? 'Restoring...' : 'Restore'}
          </button>
        )}
        {hasDiff && tool.status !== 'running' && !isDecided && (
          <button
            className="diff-toggle-btn"
            onClick={() => setDiffOpen(o => !o)}
            title={diffOpen ? 'Hide diff' : 'Show diff'}
          >
            <ChevronsUpDown size={10} />
            {diffOpen ? 'Hide' : `Diff${diffLineCount ? ` (${diffLineCount})` : ''}`}
          </button>
        )}
      </div>

      {/* Live preview while writing */}
      {liveContent && <LiveCodePreview content={liveContent} lang={lang} />}

      {/* Diff/preview — default open */}
      {!liveContent && tool.status !== 'running' && !isDecided && hasDiff && (
        <CollapsibleBody open={diffOpen}>
          <div className="file-diff-container">
            {hasHunks ? (
              <div className="diff-lines">
                {(parsed.hunks as any[]).map((h: any, i: number) => (
                  <div key={i} className={`diff-line ${h.type}`}>
                    <div className="diff-ln">{h.type === 'remove' ? h.oldLineNo : (h.newLineNo || h.oldLineNo || '')}</div>
                    <div className="diff-gutter">{h.type === 'add' ? '+' : h.type === 'remove' ? '−' : ' '}</div>
                    <div className="diff-content">{h.text || ' '}</div>
                  </div>
                ))}
              </div>
            ) : hasPreview ? (
              <LiveCodePreview content={parsed.preview as string} lang={lang} />
            ) : null}
          </div>
        </CollapsibleBody>
      )}
      {status && <div className="checkpoint-inline-status">{status}</div>}
      {/* NO per-card accept/reject buttons — handled globally via proposal bar */}
    </div>
  );
});
WriteFileCard.displayName = 'WriteFileCard';

// ─── Simple pill tool cards — args'tan türetilen label'lar ─────────────────────
// NOT: tool.summary yerine tool.args kullanıyoruz — model duplicate isim döndürebilir

const ReadFileCard = memo(({ tool }: { tool: ToolCall }) => {
  const fn = (tool.args?.path as string) ? basename(tool.args.path as string) : 'file';
  const lineCount = tool.status !== 'running' && tool.result
    ? (() => {
      try {
        if (tool.result.trim().startsWith('{')) return null;
        const n = tool.result.split('\n').length;
        return n > 1 ? `${n} lines` : undefined;
      } catch { return undefined; }
    })()
    : undefined;
  return <SimplePill tool={tool} icon={<FileSearch size={11} />} label={fn} meta={lineCount ?? undefined} />;
});
ReadFileCard.displayName = 'ReadFileCard';

const DeleteFileCard = memo(({ tool }: { tool: ToolCall }) => {
  const fn = (tool.args?.path as string) ? basename(tool.args.path as string) : 'file';
  return <SimplePill tool={tool} icon={<Trash2 size={11} />} label={fn} />;
});
DeleteFileCard.displayName = 'DeleteFileCard';

const ListFilesCard = memo(({ tool }: { tool: ToolCall }) => {
  const target = (tool.args?.path as string) || '.';
  const count = tool.status !== 'running' && tool.result
    ? (() => {
      try {
        const parsed = JSON.parse(tool.result);
        if (Array.isArray(parsed)) return `${parsed.length} items`;
      } catch { /* */ }
      return `${tool.result.split('\n').filter(Boolean).length} items`;
    })()
    : undefined;
  return <SimplePill tool={tool} icon={<Folder size={11} />} label={target} meta={count} />;
});
ListFilesCard.displayName = 'ListFilesCard';

const SearchFilesCard = memo(({ tool }: { tool: ToolCall }) => {
  const pattern = (tool.args?.pattern as string) || (tool.args?.query as string) || '...';
  return <SimplePill tool={tool} icon={<Search size={11} />} label={`"${pattern}"`} />;
});
SearchFilesCard.displayName = 'SearchFilesCard';

const RenameFileCard = memo(({ tool }: { tool: ToolCall }) => {
  const from = (tool.args?.oldPath as string) ? basename(tool.args.oldPath as string) : 'file';
  return <SimplePill tool={tool} icon={<Move size={11} />} label={from} />;
});
RenameFileCard.displayName = 'RenameFileCard';

const DiagnosticsCard = memo(({ tool }: { tool: ToolCall }) => {
  const target = (tool.args?.path as string) ? basename(tool.args.path as string) : 'workspace';
  return <SimplePill tool={tool} icon={<Stethoscope size={11} />} label={target} />;
});
DiagnosticsCard.displayName = 'DiagnosticsCard';

const WebFetchCard = memo(({ tool }: { tool: ToolCall }) => {
  const url = (tool.args?.url as string) || '';
  let display = url || 'URL';
  try { display = new URL(url).hostname; } catch { /* */ }
  const chars = tool.status !== 'running' && tool.result
    ? `${tool.result.length} chars` : undefined;
  return <SimplePill tool={tool} icon={<Globe size={11} />} label={display} meta={chars} />;
});
WebFetchCard.displayName = 'WebFetchCard';

const GrepCodeCard = memo(({ tool }: { tool: ToolCall }) => {
  const pattern = (tool.args?.pattern as string) || tool.summary;
  const matches = tool.status !== 'running' && tool.result
    ? tool.result.match(/Found (\d+) match/)?.[1]
    : undefined;
  return <SimplePill tool={tool} icon={<Code2 size={11} />}
    label={`"${pattern}"`} meta={matches ? `${matches} matches` : undefined} />;
});
GrepCodeCard.displayName = 'GrepCodeCard';

const CreateDirCard = memo(({ tool }: { tool: ToolCall }) => (
  <SimplePill tool={tool} icon={<FolderPlus size={11} />}
    label={(tool.args?.path as string) || tool.summary} />
));
CreateDirCard.displayName = 'CreateDirCard';

const GetFileInfoCard = memo(({ tool }: { tool: ToolCall }) => {
  const fn = (tool.args?.path as string) || tool.summary;
  let meta: string | undefined;
  if (tool.status !== 'running' && tool.result) {
    try {
      const p = JSON.parse(tool.result);
      if (p.lineCount) meta = `${p.lineCount} lines`;
      else if (p.sizeBytes) meta = `${(p.sizeBytes / 1024).toFixed(1)} KB`;
    } catch { /* */ }
  }
  return <SimplePill tool={tool} icon={<Info size={11} />} label={basename(fn)} meta={meta} />;
});
GetFileInfoCard.displayName = 'GetFileInfoCard';

const FindReplaceCard = memo(({ tool }: { tool: ToolCall }) => {
  const fn = (tool.args?.path as string) || tool.summary;
  return <SimplePill tool={tool} icon={<Replace size={11} />}
    label={basename(fn)} meta={tool.args?.find ? `"${String(tool.args.find).slice(0, 20)}"` : undefined} />;
});
FindReplaceCard.displayName = 'FindReplaceCard';

const ReadMultipleFilesCard = memo(({ tool }: { tool: ToolCall }) => {
  const [open, setOpen] = useState(false);
  const paths: string[] = Array.isArray(tool.args?.paths) ? (tool.args.paths as string[]) : [];
  const count = paths.length;
  const dur = tool.startedAt && tool.finishedAt ? tool.finishedAt - tool.startedAt : null;

  return (
    <div className="read-multi-card">
      <div className="read-multi-header" onClick={() => count > 0 && setOpen(o => !o)}>
        <StatusDot status={tool.status} />
        <span className="pill-icon"><Files size={11} /></span>
        <span className="pill-label">
          {tool.status === 'running'
            ? <TypewriterText text={count ? `Read ${count} files` : tool.summary} speed={16} />
            : (count ? `Read ${count} files` : tool.summary)}
        </span>
        {tool.status !== 'running' && count > 0 && (
          <span className="pill-meta">{count} files</span>
        )}
        {dur != null && <span className="pill-dur">{fmtDur(dur)}</span>}
        {count > 0 && (
          <ChevronDown size={10} className={`batch-ops-chevron${open ? ' open' : ''}`} />
        )}
      </div>
      {open && count > 0 && (
        <div className="read-multi-list">
          {paths.map((p, i) => (
            <div
              key={i}
              className="read-multi-row"
              onClick={() => vscode.postMessage({ type: 'openFile', path: p })}
              title={`Open ${p}`}
            >
              <FileSearch size={9} className="batch-row-icon" />
              <span className="batch-row-path">{basename(p)}</span>
              <ExternalLink size={8} className="read-multi-open" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
ReadMultipleFilesCard.displayName = 'ReadMultipleFilesCard';

const ListDirectoryTreeCard = memo(({ tool }: { tool: ToolCall }) => {
  const target = (tool.args?.path as string) || '.';
  const lineCount = tool.status !== 'running' && tool.result
    ? tool.result.split('\n').filter(Boolean).length : undefined;
  const meta = lineCount ? `${lineCount} entries` : undefined;
  return <SimplePill tool={tool} icon={<FolderTree size={11} />} label={target} meta={meta} />;
});
ListDirectoryTreeCard.displayName = 'ListDirectoryTreeCard';

// ─── BatchOperationsCard — write_multiple_files / delete_multiple_files ──────
const BatchOperationsCard = memo(({ tool }: { tool: ToolCall }) => {
  const [open, setOpen] = useState(false);
  const isWrite  = tool.name === 'write_multiple_files';
  const isDelete = tool.name === 'delete_multiple_files';

  // Parse result
  let parsed: any = null;
  try { if (tool.result?.trim().startsWith('{')) parsed = JSON.parse(tool.result); } catch { /* */ }
  const checkpoints: CheckpointEntry[] = Array.isArray(parsed?.checkpoints) ? parsed.checkpoints : [];
  const { busyId, status, revert } = useCheckpointReverter(checkpoints);
  const checkpointByPath = new Map(
    checkpoints.map((checkpoint) => [checkpoint.filePath.replace(/\\/g, '/'), checkpoint])
  );

  // File list — from args (running) or parsed result (done)
  const files: Array<{ path: string; status?: string; mode?: string; addedCount?: number; removedCount?: number; error?: string }> =
    tool.status === 'running'
      ? (isWrite
          ? (Array.isArray(tool.args?.files) ? tool.args.files : [])
          : (Array.isArray(tool.args?.paths) ? (tool.args.paths as string[]).map((p: string) => ({ path: p })) : []))
      : (Array.isArray(parsed?.results) ? parsed.results : []);

  const dur = tool.startedAt && tool.finishedAt ? tool.finishedAt - tool.startedAt : null;
  const count = files.length || (isWrite ? tool.args?.files?.length : tool.args?.paths?.length) || 0;
  const successCount = parsed?.successCount ?? (tool.status === 'running' ? 0 : count);
  const errorCount   = parsed?.errorCount ?? 0;

  const icon = isDelete ? <Trash2 size={11} /> : <Layers size={11} />;
  const verb = isDelete ? 'Delete' : (tool.status === 'running' ? 'Writing' : 'Write');
  const headerLabel = count > 0 ? `${verb} ${count} file${count !== 1 ? 's' : ''}` : tool.summary;
  const meta = tool.status !== 'running'
    ? (errorCount > 0 ? `${successCount} ok · ${errorCount} failed` : `${successCount} done`)
    : undefined;

  return (
    <div className="batch-ops-card">
      {/* Header row — always visible */}
      <div className="batch-ops-header" onClick={() => files.length > 0 && setOpen(o => !o)}>
        <StatusDot status={tool.status} />
        <span className="batch-ops-icon">{icon}</span>
        <span className="batch-ops-label">
          {tool.status === 'running'
            ? <TypewriterText text={headerLabel} speed={18} />
            : headerLabel}
        </span>
        {meta && <span className="batch-ops-meta">{meta}</span>}
        {dur != null && <span className="batch-ops-dur">{fmtDur(dur)}</span>}
        {files.length > 0 && (
          <ChevronDown size={10} className={`batch-ops-chevron${open ? ' open' : ''}`} />
        )}
      </div>

      {/* Collapsible file list */}
      {open && files.length > 0 && (
        <div className="batch-ops-list">
          {files.map((f, i) => {
            const fname = f.path ? f.path.split(/[/\\]/).pop() || f.path : `file ${i + 1}`;
            const isErr = f.status === 'error';
            const diffInfo = (f.addedCount != null || f.removedCount != null)
              ? <span className="batch-ops-diff">
                  {f.addedCount != null && <span className="batch-diff-add">+{f.addedCount}</span>}
                  {f.removedCount != null && <span className="batch-diff-rem">−{f.removedCount}</span>}
                </span>
              : null;
            return (
              <div key={i} className={`batch-ops-row${isErr ? ' error' : ''}`}>
                {isDelete
                  ? <Trash2 size={9} className="batch-row-icon" />
                  : f.mode === 'editing'
                    ? <FileEdit size={9} className="batch-row-icon" />
                    : <FileEdit size={9} className="batch-row-icon create" />}
                <span className="batch-row-path" title={f.path}>{fname}</span>
                {diffInfo}
                {isErr && <span className="batch-row-err" title={f.error}>failed</span>}
                {isWrite && !isErr && (() => {
                  const checkpoint = checkpointByPath.get((f.path || '').replace(/\\/g, '/'));
                  if (!checkpoint) return null;
                  return (
                    <button
                      className="batch-row-restore"
                      onClick={() => revert(checkpoint.id)}
                      disabled={busyId === checkpoint.id}
                      title={`Restore ${f.path}`}
                    >
                      <RotateCcw size={9} />
                      {busyId === checkpoint.id ? 'Restoring...' : 'Restore'}
                    </button>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
      {status && <div className="checkpoint-inline-status checkpoint-inline-status-batch">{status}</div>}
    </div>
  );
});
BatchOperationsCard.displayName = 'BatchOperationsCard';

// ─── ToolCard Router ──────────────────────────────────────────────────────────
interface ToolCardProps {
  tool: ToolCall;
  decision?: 'accepted' | 'rejected';
  onDecide: (phaseId: string, decision: 'accepted' | 'rejected', proposalId: string) => void;
}

export const ToolCard = memo(({ tool, decision, onDecide }: ToolCardProps) => {
  const n = tool.name;

  if (n === 'task_notes') return null;

  if (['run_command', 'bash', 'shell', 'execute_command'].includes(n))
    return <RunCommandCard tool={tool} />;
  if (['write_file', 'create_file', 'edit_file', 'write_to_file'].includes(n))
    return <WriteFileCard tool={tool} decision={decision} onDecide={onDecide} />;
  if (['read_file', 'view_file'].includes(n)) return <ReadFileCard tool={tool} />;
  if (['delete_file', 'remove_file'].includes(n)) return <DeleteFileCard tool={tool} />;
  if (['list_files', 'list_dir', 'browse'].includes(n)) return <ListFilesCard tool={tool} />;
  if (n === 'list_directory_tree') return <ListDirectoryTreeCard tool={tool} />;
  if (n === 'read_multiple_files') return <ReadMultipleFilesCard tool={tool} />;
  if (n === 'write_multiple_files' || n === 'delete_multiple_files') return <BatchOperationsCard tool={tool} />;
  if (['search_files', 'grep', 'search'].includes(n)) return <SearchFilesCard tool={tool} />;
  if (['rename_file', 'move_file'].includes(n)) return <RenameFileCard tool={tool} />;
  if (['get_diagnostics', 'diagnose'].includes(n)) return <DiagnosticsCard tool={tool} />;
  if (n === 'web_fetch') return <WebFetchCard tool={tool} />;
  if (n === 'grep_code') return <GrepCodeCard tool={tool} />;
  if (n === 'create_directory') return <CreateDirCard tool={tool} />;
  if (n === 'get_file_info') return <GetFileInfoCard tool={tool} />;
  if (['find_and_replace', 'replace_in_file'].includes(n)) return <FindReplaceCard tool={tool} />;
  if (n === 'append_to_file') return <SimplePill tool={tool} icon={<FileEdit size={11} />}
    label={(tool.args?.path as string) ? basename(tool.args.path as string) : tool.summary} />;
  if (['attempt_completion', 'ask_followup_question'].includes(n)) return null;

  return <SimplePill tool={tool} icon={<Stethoscope size={11} />}
    label={tool.summary || n.replace(/_/g, ' ')} />;
});
ToolCard.displayName = 'ToolCard';

// ─── ContentBlock ─────────────────────────────────────────────────────────────
const ContentBlock = memo(({ seg, isLast }: { seg: ContentSegment; isLast: boolean }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(seg.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="asst-content-wrap">
      <MarkdownRenderer content={seg.text} />
      {!isLast && (
        <button className="copy-btn" title="Copy" onClick={copy}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}
    </div>
  );
});
ContentBlock.displayName = 'ContentBlock';

// ─── IterationBadge — kaçıncı iterasyonda olduğunu gösterir ─────────────────
export const IterationBadge = memo(({ count }: { count: number }) => {
  if (count <= 1) return null;
  return (
    <div className="iteration-badge">
      <span className="iteration-dot" />
      Iteration {count}
    </div>
  );
});
IterationBadge.displayName = 'IterationBadge';

// ─── AssistantMessage ────────────────────────────────────────────────────────
export interface AssistantMessageProps {
  msg: ChatMessage;
  decisions: ProposalDecisions;
  onDecide: (phaseId: string, decision: 'accepted' | 'rejected', proposalId: string) => void;
  onRetry?: () => void;
  onQuote?: (text: string) => void;
}

export const AssistantMessage = memo(({ msg, decisions, onDecide, onRetry, onQuote }: AssistantMessageProps) => {
  const hasAnyContent = msg.segments.length > 0 || msg.error;
  const isWaitingForOutput = msg.isStreaming && !hasAnyContent;

  // Mesajda hiç tool var mı? Varsa content segmentlerini gösterme kuralı:
  // - Tool'lar running iken aradaki content segmentleri gizlenir
  // - Sadece son content (finalResponse) ve thinking gösterilir
  const hasTools = msg.segments.some(s => s.type === 'tool');
  const hasRunningTools = msg.segments.some(s => s.type === 'tool' && s.tool.status === 'running');

  return (
    <div className="asst-body">
      {msg.segments.map((seg, i) => {
        if (seg.type === 'thinking') {
          return <ThinkingBlock key={i} seg={seg} />;
        }
        if (seg.type === 'content') {
          // Tool'lar varken ara content segmentlerini gizle — sadece son content'i göster
          if (hasTools) {
            // Son content segmenti mi? (sonraki segment yok veya sonraki de content)
            const nextSeg = msg.segments[i + 1];
            const isLastContent = !nextSeg || nextSeg.type !== 'tool';
            // Running tool varsa hiçbir content gösterme
            if (hasRunningTools) return null;
            // Running tool yoksa sadece son content'i göster
            if (!isLastContent) return null;
          }
          return <ContentBlock key={i} seg={seg} isLast={i === msg.segments.length - 1} />;
        }
        if (seg.type === 'tool') {
          return (
            <ToolCard
              key={`${seg.tool.phaseId}-${i}`}
              tool={seg.tool}
              decision={decisions.get(seg.tool.phaseId)}
              onDecide={onDecide}
            />
          );
        }
        return null;
      })}

      {isWaitingForOutput && (
        <span className="typing-dots"><span /><span /><span /></span>
      )}

      {msg.error && (
        <div className="err-pill">
          <AlertCircle size={12} />
          <span>{msg.error}</span>
          {onRetry && (
            <button className="retry-btn" onClick={onRetry} title="Retry">
              <RefreshCw size={11} /> Retry
            </button>
          )}
        </div>
      )}

      {/* Quote button — shown when message has text content */}
      {onQuote && msg.segments.some(s => s.type === 'content' && s.text?.trim()) && (
        <button
          className="msg-quote-btn"
          onClick={() => {
            const text = msg.segments
              .filter(s => s.type === 'content')
              .map(s => (s as any).text || '')
              .join('\n')
              .trim();
            if (text) onQuote(text);
          }}
          title="Quote this message"
        >
          <Quote size={10} />
          <span>Quote</span>
        </button>
      )}
    </div>
  );
});
AssistantMessage.displayName = 'AssistantMessage';

export const UserMessage = memo(({ content, onQuote }: { content: string; onQuote?: (t: string) => void }) => (
  <div className="user-bubble">
    <span>{content}</span>
    {onQuote && content.trim() && (
      <button className="msg-quote-btn msg-quote-btn--user" onClick={() => onQuote(content)} title="Quote">
        <Quote size={10} />
      </button>
    )}
  </div>
));
UserMessage.displayName = 'UserMessage';
