import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import type { ToolCall, ToolStatus, ChatMessage, ThinkingSegment, ContentSegment } from '../../types';
import type { ProposalDecisions } from '../../App';
import {
  ChevronDown, Check, Loader2, Terminal,
  FileEdit, FileSearch, AlertCircle, CheckCheck,
  XCircle, ChevronsUpDown, Copy, Folder, Trash2,
  Move, Search, Stethoscope, Globe, Code2,
  FolderPlus, Info, Replace, RefreshCw,
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
  const stdout: string = parsed?.stdout?.trim() || '';
  const stderr: string = parsed?.stderr?.trim() || '';
  const combined = [stdout, stderr].filter(Boolean).join('\n');
  const lineCount = combined ? combined.split('\n').length : 0;
  const AUTO_SHOW = 5;
  const [expanded, setExpanded] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current && !expanded) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [combined, expanded]);

  const cmdLabel = parsed?.command || tool.summary;
  const exitOk = !parsed?.exitCode || parsed.exitCode === 0;
  const hasOutput = tool.status !== 'running' && combined;

  return (
    <div className={`card card-terminal ${tool.status}`}>
      <div className="card-header non-clickable">
        <StatusDot status={tool.status} />
        <Terminal size={11} className="card-icon-type" />
        <span className="card-label card-filename">
          {tool.status === 'running' ? <TypewriterText text={cmdLabel} speed={18} /> : cmdLabel}
        </span>
        {dur != null && <span className="card-dur">{fmtDur(dur)}</span>}
        {parsed?.exitCode != null && (
          <span className={`exit-badge ${exitOk ? 'ok' : 'fail'}`}>exit {parsed.exitCode}</span>
        )}
      </div>
      {hasOutput && (
        <div className="terminal-output-wrap">
          <div
            ref={outputRef}
            className={`terminal-output ${lineCount <= AUTO_SHOW ? 'auto-show' : expanded ? 'full-expand' : 'limited'}`}
          >
            <div className="terminal-prompt">$ {cmdLabel}</div>
            {stdout && <pre className="terminal-stdout">{stdout}</pre>}
            {stderr && <pre className="terminal-stderr">{stderr}</pre>}
          </div>
          {lineCount > AUTO_SHOW && (
            <ExpandHandle expanded={expanded} lineCount={lineCount} onToggle={() => setExpanded(e => !e)} />
          )}
        </div>
      )}
    </div>
  );
});
RunCommandCard.displayName = 'RunCommandCard';

// ─── WriteFileCard — collapsible diff (BUG 9 FIX) ───────────────────────────
interface WriteFileCardProps {
  tool: ToolCall;
  decision?: 'accepted' | 'rejected';
  onDecide: (phaseId: string, decision: 'accepted' | 'rejected', proposalId: string) => void;
}

const WriteFileCard = memo(({ tool, decision, onDecide }: WriteFileCardProps) => {
  const dur = tool.startedAt && tool.finishedAt ? tool.finishedAt - tool.startedAt : null;
  // BUG 9 FIX: diff başlangıçta collapsed, user expand edebilir
  const [diffOpen, setDiffOpen] = useState(false);
  let parsed: any = null;
  try { if (tool.result?.trim().startsWith('{')) parsed = JSON.parse(tool.result); } catch { /* */ }
  const isEdit = parsed?.mode === 'editing';

  const rawFilename = parsed?.fileName
    || basename(tool.summary.replace(/^(creating|editing|created|edited|write|writing)\s*/i, '').trim())
    || (tool.args?.path ? basename(tool.args.path as string) : tool.summary);

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

  // BUG 1 FIX: proposalId = phaseId (her zaman unique), dosya yolu değil
  const proposalId = tool.phaseId;
  const isDecided = !!decision;
  const hasDiff = (parsed?.hunks?.length > 0) || !!parsed?.preview;
  const diffLineCount = parsed?.hunks?.length || 0;

  return (
    <div className={`card card-file ${tool.status}${decision ? ` change-${decision}` : ''}`}>
      <div className="card-header non-clickable">
        <StatusDot status={tool.status} />
        <FileEdit size={11} className="card-icon-type" />
        <span className="card-label">
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
        {/* BUG 9 FIX: Diff toggle butonu */}
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

      {/* Diff — collapsible, opens on toggle */}
      {!liveContent && tool.status !== 'running' && !isDecided && hasDiff && (
        <CollapsibleBody open={diffOpen}>
          <div className="file-diff-container">
            {parsed?.hunks?.length > 0 ? (
              <div className="diff-lines">
                {(parsed.hunks as any[]).map((h: any, i: number) => (
                  <div key={i} className={`diff-line ${h.type}`}>
                    <div className="diff-ln">{h.type === 'remove' ? h.oldLineNo : (h.newLineNo || h.oldLineNo || '')}</div>
                    <div className="diff-gutter">{h.type === 'add' ? '+' : h.type === 'remove' ? '−' : ' '}</div>
                    <div className="diff-content">{h.text || ' '}</div>
                  </div>
                ))}
              </div>
            ) : parsed?.preview ? (
              <LiveCodePreview content={parsed.preview as string} lang={lang} />
            ) : null}
          </div>
        </CollapsibleBody>
      )}

      {/* Per-card accept/reject */}
      {tool.status === 'done' && !isDecided && (
        <div className="card-action-row">
          <button className="btn-reject" onClick={() => onDecide(tool.phaseId, 'rejected', proposalId)}>
            <XCircle size={11} /> Reject
          </button>
          <button className="btn-accept" onClick={() => onDecide(tool.phaseId, 'accepted', proposalId)}>
            <CheckCheck size={11} /> Accept
          </button>
        </div>
      )}
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
}

export const AssistantMessage = memo(({ msg, decisions, onDecide, onRetry }: AssistantMessageProps) => {
  const hasAnyContent = msg.segments.length > 0 || msg.error;
  const isWaitingForOutput = msg.isStreaming && !hasAnyContent;

  return (
    <div className="asst-body">
      {msg.segments.map((seg, i) => {
        if (seg.type === 'thinking') {
          return <ThinkingBlock key={i} seg={seg} />;
        }
        if (seg.type === 'content') {
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
          {/* BUG 13 FIX: Retry butonu */}
          {onRetry && (
            <button className="retry-btn" onClick={onRetry} title="Retry">
              <RefreshCw size={11} /> Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
});
AssistantMessage.displayName = 'AssistantMessage';

export const UserMessage = memo(({ content }: { content: string }) => (
  <div className="user-bubble">{content}</div>
));
UserMessage.displayName = 'UserMessage';
