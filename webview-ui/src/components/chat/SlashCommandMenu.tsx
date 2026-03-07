/**
 * SlashCommandMenu — / command popup (Cline-inspired)
 * Built-in commands + extensible via .codai/commands/
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal, MessageSquare, Trash2, Code2, Brain, X } from 'lucide-react';


export interface SlashCommand {
  name: string;
  description: string;
  icon: React.ReactNode;
  action: 'builtin';
  builtinKey: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'new',     description: 'Start a new chat',                 icon: <MessageSquare size={12} />, action: 'builtin', builtinKey: 'new' },
  { name: 'clear',   description: 'Clear current conversation',       icon: <Trash2 size={12} />,        action: 'builtin', builtinKey: 'clear' },
  { name: 'code',    description: 'Switch to Code mode',              icon: <Code2 size={12} />,         action: 'builtin', builtinKey: 'mode:code' },
  { name: 'plan',    description: 'Switch to Plan mode',              icon: <Brain size={12} />,         action: 'builtin', builtinKey: 'mode:plan' },
  { name: 'chat',    description: 'Switch to Chat mode',              icon: <MessageSquare size={12} />, action: 'builtin', builtinKey: 'mode:chat' },
  { name: 'compact', description: 'Summarize and compress context',   icon: <Terminal size={12} />,      action: 'builtin', builtinKey: 'compact' },
];

interface SlashCommandMenuProps {
  query: string;
  onSelect: (cmd: SlashCommand) => void;
  onClose: () => void;
}

export function SlashCommandMenu({ query, onSelect, onClose }: SlashCommandMenuProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? SLASH_COMMANDS.filter(c => c.name.startsWith(query.toLowerCase()))
    : SLASH_COMMANDS;

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown')  { e.preventDefault(); e.stopPropagation(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); e.stopPropagation(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (filtered[activeIdx]) onSelect(filtered[activeIdx]);
      }
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [activeIdx, filtered, onSelect, onClose]);

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
    <div ref={containerRef} className="slash-menu">
      <div className="slash-menu-header">
        <span className="slash-menu-title">Commands</span>
        <button className="slash-menu-close" onClick={onClose}><X size={10} /></button>
      </div>
      <div className="slash-menu-list">
        {filtered.map((cmd, i) => (
          <button
            key={cmd.name}
            className={`slash-menu-item${i === activeIdx ? ' slash-menu-item--active' : ''}`}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => setActiveIdx(i)}
          >
            <span className="slash-menu-icon">{cmd.icon}</span>
            <span className="slash-menu-body">
              <span className="slash-menu-name">/{cmd.name}</span>
              <span className="slash-menu-desc">{cmd.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
